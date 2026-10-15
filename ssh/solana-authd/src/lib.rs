// geteuid, flock, and peer credentials need libc.
#![allow(unsafe_code)]
pub mod config;
pub mod rpc;

use anyhow::{ensure, Result};
use auth_core::{
    challenge::Challenge,
    hex32,
    protocol::{PublishedChallenge, Request, Response, SignedResponse},
    pubkey, unix_time, MAX_FRAME, TTL_SECONDS, TTL_SECONDS_I64, VERSION,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use config::Config;
use std::{
    fs::OpenOptions,
    os::{
        fd::AsRawFd,
        unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    },
    path::Path,
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader},
    net::{UnixListener, UnixStream},
    sync::Semaphore,
    time::{timeout, timeout_at, Instant},
};

struct Session {
    challenge: Challenge,
    deadline: Instant,
    consumed: bool,
}

impl Session {
    fn new(config: &Config) -> Result<Self> {
        Ok(Self {
            challenge: Challenge::new(&config.identity(), unix_time())?,
            deadline: Instant::now() + Duration::from_secs(TTL_SECONDS),
            consumed: false,
        })
    }
    fn consume(&mut self) -> Result<()> {
        ensure!(
            !self.consumed
                && Instant::now() < self.deadline
                && unix_time() < self.challenge.expires_at
                && unix_time() >= self.challenge.expires_at - TTL_SECONDS_I64,
            "session expired or consumed"
        );
        self.consumed = true;
        Ok(())
    }
}

async fn read_request<R: AsyncRead + Unpin>(reader: &mut BufReader<R>) -> Result<Request> {
    let mut bytes = Vec::new();
    reader
        .take((MAX_FRAME + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .await?;
    ensure!(
        bytes.len() <= MAX_FRAME && bytes.last() == Some(&b'\n'),
        "invalid IPC frame"
    );
    Ok(serde_json::from_slice(&bytes)?)
}

async fn respond<W: AsyncWrite + Unpin>(writer: &mut W, message: &Response) -> Result<()> {
    let mut bytes = serde_json::to_vec(message)?;
    bytes.push(b'\n');
    writer.write_all(&bytes).await?;
    Ok(())
}

fn audit(config: &Config, allow: bool) {
    eprintln!(
        "{}",
        serde_json::json!({"event":"ssh_login", "timestamp":unix_time(), "server_id":config.server_id, "unix_user":config.unix_user, "allow":allow, "reason":if allow {"authorized"} else {"authentication_failed"}})
    );
}

async fn poll_and_authorize(
    client: &reqwest::Client,
    config: &Config,
    session: &mut Session,
    endpoint: &str,
) -> Result<()> {
    loop {
        let response = client
            .get(format!("{endpoint}/response"))
            .bearer_auth(&config.gateway_token)
            .send()
            .await?;
        if response.status() == reqwest::StatusCode::NO_CONTENT {
            tokio::time::sleep(Duration::from_millis(250)).await;
            continue;
        }
        ensure!(
            response.status() == reqwest::StatusCode::OK,
            "gateway failure"
        );
        let proof: SignedResponse = rpc::bounded_json(response).await?;
        let wallet = session.challenge.verify(&proof, unix_time())?;
        let snapshot = rpc::read_access(client, config, &wallet).await?;
        snapshot.authorize(
            &pubkey(&config.program_id)?,
            &pubkey(&config.provider_pubkey)?,
            &hex32(&config.server_id)?,
            &wallet,
            unix_time(),
        )?;
        session.consume()?;
        return Ok(());
    }
}

async fn run_session(
    stream: &mut UnixStream,
    config: &Config,
    client: &reqwest::Client,
    session: &mut Session,
    endpoint: &str,
) -> Result<()> {
    let published = PublishedChallenge {
        session_id: session.challenge.id.clone(),
        challenge_base64: STANDARD.encode(&session.challenge.bytes),
        expires_at: session.challenge.expires_at,
    };
    let response = client
        .post(format!(
            "{}/v1/sessions",
            config.auth_gateway.trim_end_matches('/')
        ))
        .bearer_auth(&config.gateway_token)
        .json(&published)
        .send()
        .await?;
    ensure!(
        response.status() == reqwest::StatusCode::CREATED,
        "challenge publication failed"
    );
    respond(
        stream,
        &Response::Challenge {
            version: VERSION,
            url: format!(
                "{}/v1/sessions/{}",
                config.auth_origin, session.challenge.id
            ),
            expires_at: session.challenge.expires_at,
        },
    )
    .await?;
    let (read, _) = stream.split();
    let mut reader = BufReader::new(read);
    ensure!(
        matches!(
            read_request(&mut reader).await?,
            Request::Wait { version: VERSION }
        ),
        "cancelled or invalid wait"
    );
    tokio::select! {
        biased;
        _ = read_request(&mut reader) => anyhow::bail!("cancelled or disconnected"),
        outcome = poll_and_authorize(client, config, session, endpoint) => outcome,
    }
}

async fn handle(
    mut stream: UnixStream,
    config: Arc<Config>,
    client: reqwest::Client,
) -> Result<()> {
    ensure!(stream.peer_cred()?.uid() == 0, "unauthorized peer");
    // Reading just the first frame without buffering prevents discarding pipelined bytes.
    let initial = timeout(
        Duration::from_secs(5),
        read_request(&mut BufReader::with_capacity(1, &mut stream)),
    )
    .await;
    let valid_start = matches!(initial, Ok(Ok(Request::Start {version: VERSION, unix_user})) if unix_user == config.unix_user);
    if !valid_start {
        audit(&config, false);
        let _ = respond(
            &mut stream,
            &Response::Result {
                version: VERSION,
                allow: false,
                reason: "invalid_request".into(),
            },
        )
        .await;
        return Ok(());
    }
    let mut session = Session::new(&config)?;
    let endpoint = format!(
        "{}/v1/sessions/{}",
        config.auth_gateway.trim_end_matches('/'),
        session.challenge.id
    );
    let allowed = matches!(
        timeout_at(
            session.deadline,
            run_session(&mut stream, &config, &client, &mut session, &endpoint)
        )
        .await,
        Ok(Ok(()))
    );
    audit(&config, allowed);
    let _ = timeout(
        Duration::from_secs(1),
        respond(
            &mut stream,
            &Response::Result {
                version: VERSION,
                allow: allowed,
                reason: if allowed {
                    "authorized"
                } else {
                    "authentication_failed"
                }
                .into(),
            },
        ),
    )
    .await;
    // Best-effort deletion cannot change the local decision or resurrect a session.
    let _ = client
        .delete(endpoint)
        .bearer_auth(&config.gateway_token)
        .send()
        .await;
    Ok(())
}

pub async fn serve(config: Config) -> Result<()> {
    // SAFETY: geteuid has no preconditions and cannot fail.
    let euid = unsafe { libc::geteuid() };
    ensure!(euid == 0, "daemon must run as root");
    config.validate()?;
    let socket_path = config.socket_path.clone();
    let socket = Path::new(&socket_path);
    let parent = socket
        .parent()
        .ok_or_else(|| anyhow::anyhow!("invalid socket parent"))?;
    let meta = std::fs::symlink_metadata(parent)?;
    ensure!(
        meta.is_dir() && meta.uid() == 0 && meta.mode() & 0o022 == 0,
        "socket directory must be root-owned and not writable by others"
    );
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(socket.with_extension("lock"))?;
    // SAFETY: the descriptor belongs to `lock`, which stays open while the daemon runs.
    let locked = unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0;
    ensure!(locked, "daemon already running");
    if let Ok(meta) = std::fs::symlink_metadata(socket) {
        ensure!(
            meta.file_type().is_socket() && meta.uid() == 0,
            "refuse to replace non-socket or unowned path"
        );
        std::fs::remove_file(socket)?;
    }
    // SAFETY: umask only replaces the process's file-mode mask, so the socket is private from creation.
    unsafe {
        libc::umask(0o077);
    }
    let listener = UnixListener::bind(socket)?;
    std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600))?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .connect_timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()?;
    let config = Arc::new(config);
    let limit = Arc::new(Semaphore::new(64));
    let mut stop = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    loop {
        tokio::select! {
            _ = stop.recv() => break,
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                if let Ok(permit) = limit.clone().try_acquire_owned() {
                    let config = config.clone(); let client = client.clone();
                    tokio::spawn(async move { let _permit = permit; let _ = handle(stream, config, client).await; });
                }
            }
        }
    }
    std::fs::remove_file(socket)?;
    drop(lock);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_oversized_unknown_and_truncated_frames() {
        for bytes in [
            vec![b'x'; MAX_FRAME + 1],
            br#"{"op":"wait","version":1,"extra":true}
"#
            .to_vec(),
            br#"{"op":"wait","version":1}"#.to_vec(),
        ] {
            assert!(read_request(&mut BufReader::new(bytes.as_slice()))
                .await
                .is_err());
        }
        let bytes = b"{\"op\":\"wait\",\"version\":1}\n";
        assert!(matches!(
            read_request(&mut BufReader::new(bytes.as_slice()))
                .await
                .unwrap(),
            Request::Wait { version: 1 }
        ));
    }

    #[test]
    fn consumption_is_single_use_and_checks_monotonic_deadline() {
        let mut session = Session {
            challenge: Challenge {
                id: "test".into(),
                bytes: vec![],
                expires_at: unix_time() + TTL_SECONDS_I64,
            },
            deadline: Instant::now() + Duration::from_secs(TTL_SECONDS),
            consumed: false,
        };
        assert!(session.consume().is_ok());
        assert!(session.consume().is_err());
        session.consumed = false;
        session.deadline = Instant::now() - Duration::from_secs(1);
        assert!(session.consume().is_err());
    }
}
