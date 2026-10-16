//! Ends wallet SSH logins when their on-chain access ends.
//!
//! Each allowed login is recorded with its per-connection `sshd-session`
//! process, wallet, and access deadline. A background task warns the login's
//! terminal before the deadline, ends the login at the deadline, and re-reads
//! finalized access state periodically: revocation, a disabled server, or a new
//! owner end the login, and renewal extends it. Logins are saved under /run, so
//! a daemon restart keeps enforcing them.

use anyhow::{ensure, Context, Result};
use auth_core::{hex32, pubkey, unix_time};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::OpenOptions,
    io::Write,
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard, PoisonError},
    time::Duration,
};
use tokio::{process::Command, time::Instant};

use crate::{config::Config, rpc};

/// How long before its deadline a login's terminal is warned.
pub const WARNING_SECONDS: i64 = 60;
/// How often finalized access state is re-read for open logins.
pub const RECHECK_SECONDS: u64 = 60;
const WARNING: &[u8] =
    b"\r\n*** Wallet access to this server ends in 1 minute; this session will then be closed. ***\r\n";

/// An open wallet login.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Login {
    /// The per-connection `sshd-session` process; with its start time, it stays
    /// identifiable if the PID is later reused.
    pub pid: i32,
    pub start_time: u64,
    pub wallet: [u8; 32],
    /// Unix time at which access ends.
    pub deadline: i64,
    pub warned: bool,
}

#[derive(Debug, PartialEq)]
struct Process {
    comm: String,
    ppid: i32,
    /// The controlling terminal's device number, or 0.
    tty: u32,
    start_time: u64,
    uid: u32,
}

fn process(proc: &Path, pid: i32) -> Result<Process> {
    let dir = proc.join(pid.to_string());
    let stat = std::fs::read_to_string(dir.join("stat"))?;
    // The command name is parenthesized and may itself contain spaces or parentheses.
    let open = stat.find('(').context("invalid stat")?;
    let close = stat.rfind(')').context("invalid stat")?;
    let fields: Vec<&str> = stat
        .get(close + 1..)
        .context("invalid stat")?
        .split_whitespace()
        .collect();
    // After the name come field 3 (state), 4 (ppid), 7 (tty), ..., 22 (start time).
    let status = std::fs::read_to_string(dir.join("status"))?;
    let uid = status
        .lines()
        .find_map(|line| line.strip_prefix("Uid:"))
        .and_then(|ids| ids.split_whitespace().next())
        .context("invalid status")?;
    Ok(Process {
        comm: stat.get(open + 1..close).context("invalid stat")?.into(),
        ppid: fields.get(1).context("invalid stat")?.parse()?,
        tty: fields.get(4).context("invalid stat")?.parse()?,
        start_time: fields.get(19).context("invalid stat")?.parse()?,
        uid: uid.parse()?,
    })
}

/// The number N of /dev/pts/N for a device number, if it is a pseudo-terminal.
fn pts_number(device: u32) -> Option<u32> {
    let major = (device >> 8) & 0xfff;
    let minor = (device & 0xff) | ((device >> 12) & 0xfff00);
    // Unix98 pseudo-terminals use majors 136 to 143, 256 minors each.
    (136..=143)
        .contains(&major)
        .then(|| (major - 136) * 256 + minor)
}

/// The pseudo-terminal of the login whose `sshd-session` process is `pid`: the
/// controlling terminal of a process started under it. OpenSSH opens the login
/// session before allocating the terminal, so logind does not record it.
fn terminal(proc: &Path, pid: i32) -> Option<PathBuf> {
    let processes: HashMap<i32, Process> = std::fs::read_dir(proc)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let pid = entry.file_name().to_str()?.parse().ok()?;
            Some((pid, process(proc, pid).ok()?))
        })
        .collect();
    let under_login = |mut current: i32| {
        for _ in 0..64 {
            match processes.get(&current) {
                Some(p) if p.ppid == pid => return true,
                Some(p) => current = p.ppid,
                None => return false,
            }
        }
        false
    };
    processes
        .iter()
        .filter(|(child, _)| under_login(**child))
        .find_map(|(_, p)| pts_number(p.tty))
        .map(|n| PathBuf::from(format!("/dev/pts/{n}")))
}

/// Finds the per-connection `sshd-session` process of the PAM client `peer`.
/// OpenSSH runs PAM in a child of that process, which is a child of the `sshd`
/// listener and lives as long as the connection.
pub fn monitor(proc: &Path, peer: i32) -> Result<(i32, u64)> {
    let mut pid = peer;
    let mut current = process(proc, pid)?;
    ensure!(
        current.comm == "sshd-session",
        "PAM client is not an sshd-session process"
    );
    for _ in 0..8 {
        let parent = process(proc, current.ppid)?;
        if parent.comm != "sshd-session" {
            ensure!(
                parent.comm == "sshd" && current.uid == 0,
                "unexpected OpenSSH process layout"
            );
            return Ok((pid, current.start_time));
        }
        pid = current.ppid;
        current = parent;
    }
    anyhow::bail!("unexpected OpenSSH process layout")
}

fn alive(proc: &Path, login: &Login) -> bool {
    process(proc, login.pid)
        .is_ok_and(|p| p.start_time == login.start_time && p.comm == "sshd-session")
}

/// The logind session (from `session-ID.scope`) that contains process `pid`.
fn logind_session(proc: &Path, pid: i32) -> Option<String> {
    let cgroup = std::fs::read_to_string(proc.join(pid.to_string()).join("cgroup")).ok()?;
    cgroup.lines().find_map(|line| {
        let id = line
            .rsplit('/')
            .next()?
            .strip_prefix("session-")?
            .strip_suffix(".scope")?;
        (!id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric())).then(|| id.into())
    })
}

#[derive(Debug, PartialEq)]
enum Due {
    Warn,
    End,
}

fn due(login: &Login, now: i64) -> Option<Due> {
    if now >= login.deadline {
        Some(Due::End)
    } else if !login.warned && now >= login.deadline - WARNING_SECONDS {
        Some(Due::Warn)
    } else {
        None
    }
}

/// Seconds until something is next due for `login`.
fn next_due(login: &Login, now: i64) -> i64 {
    let at = if login.warned {
        login.deadline
    } else {
        login.deadline - WARNING_SECONDS
    };
    (at - now).max(0)
}

fn audit(config: &Config, reason: &str, ended_by: &str) {
    eprintln!(
        "{}",
        serde_json::json!({"event":"ssh_session_ended", "timestamp":unix_time(), "server_id":config.server_id, "unix_user":config.unix_user, "reason":reason, "ended_by":ended_by})
    );
}

/// Ends `login` by terminating its logind session, which also ends processes
/// left running in the background, or else its `sshd-session` process. Returns
/// how it ended the login.
async fn end(proc: &Path, login: &Login) -> &'static str {
    if !alive(proc, login) {
        return "disconnected";
    }
    if let Some(id) = logind_session(proc, login.pid) {
        let ended = Command::new("loginctl")
            .args(["terminate-session", &id])
            .status()
            .await
            .is_ok_and(|status| status.success());
        if ended {
            return "logind";
        }
    }
    // SAFETY: kill only sends a signal, to the process just verified to be this login's.
    unsafe {
        libc::kill(login.pid, libc::SIGTERM);
    }
    "signal"
}

/// Writes the expiry warning to the terminal of `login`, if it has one.
fn warn(proc: &Path, login: &Login) {
    let Some(terminal) = terminal(proc, login.pid) else {
        return;
    };
    // Group tty may write to terminals whose user has not disabled messages (mesg).
    let _ = OpenOptions::new()
        .write(true)
        .custom_flags(libc::O_NOCTTY | libc::O_NONBLOCK)
        .open(terminal)
        .and_then(|mut terminal| terminal.write_all(WARNING));
}

/// The open wallet logins, saved to `path` after every change.
pub struct Logins {
    path: PathBuf,
    proc: PathBuf,
    logins: Mutex<Vec<Login>>,
}

impl Logins {
    /// Loads the saved logins whose connections are still open.
    pub fn load(path: PathBuf, proc: PathBuf) -> Self {
        let saved: Vec<Login> = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let logins = saved.into_iter().filter(|l| alive(&proc, l)).collect();
        Self {
            path,
            proc,
            logins: Mutex::new(logins),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Vec<Login>> {
        // Every update leaves the list valid, so a panic elsewhere does not poison it.
        self.logins.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn save(&self, logins: &[Login]) -> Result<()> {
        let temporary = self.path.with_extension("tmp");
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&temporary)?;
        file.write_all(&serde_json::to_vec(logins)?)?;
        file.sync_all()?;
        std::fs::rename(&temporary, &self.path)?;
        Ok(())
    }

    /// Records an allowed login; an error means it cannot be enforced.
    pub fn add(&self, login: Login) -> Result<()> {
        let mut logins = self.lock();
        logins.push(login);
        let saved = self.save(&logins);
        if saved.is_err() {
            logins.pop();
        }
        saved
    }

    /// Re-reads finalized access for every wallet with an open login. Unreadable
    /// state keeps the known deadline; state that no longer authorizes the
    /// wallet ends its logins; otherwise the deadline follows the chain, so
    /// renewal extends it.
    async fn recheck(&self, config: &Config, client: &reqwest::Client) {
        let wallets: Vec<[u8; 32]> = {
            let mut wallets: Vec<_> = self.lock().iter().map(|l| l.wallet).collect();
            wallets.sort_unstable();
            wallets.dedup();
            wallets
        };
        let mut outcomes = HashMap::new();
        for wallet in wallets {
            let Ok(snapshot) = rpc::read_access(client, config, &wallet).await else {
                continue;
            };
            let authorized = match (
                pubkey(&config.program_id),
                pubkey(&config.provider_pubkey),
                hex32(&config.server_id),
            ) {
                (Ok(program), Ok(provider), Ok(server_id)) => snapshot
                    .authorize(&program, &provider, &server_id, &wallet, unix_time())
                    .is_ok(),
                _ => false,
            };
            outcomes.insert(wallet, authorized.then(|| snapshot.access_until()));
        }
        let mut ended = Vec::new();
        {
            let mut logins = self.lock();
            logins.retain_mut(|login| match outcomes.get(&login.wallet) {
                Some(Some(deadline)) => {
                    if *deadline > login.deadline {
                        login.warned = false;
                    }
                    login.deadline = *deadline;
                    true
                }
                Some(None) => {
                    ended.push(login.clone());
                    false
                }
                None => true,
            });
            let _ = self.save(&logins);
        }
        for login in ended {
            let ended_by = end(&self.proc, &login).await;
            audit(config, "access_revoked", ended_by);
        }
    }

    /// Warns or ends the logins that are due, forgets closed connections, and
    /// returns the seconds until the next login is due.
    async fn step(&self, config: &Config) -> Option<i64> {
        let now = unix_time();
        let (warn_now, end_now, next) = {
            let mut logins = self.lock();
            logins.retain(|login| alive(&self.proc, login));
            let mut warn_now = Vec::new();
            let mut end_now = Vec::new();
            logins.retain_mut(|login| match due(login, now) {
                Some(Due::End) => {
                    end_now.push(login.clone());
                    false
                }
                Some(Due::Warn) => {
                    login.warned = true;
                    warn_now.push(login.clone());
                    true
                }
                None => true,
            });
            let next = logins.iter().map(|login| next_due(login, now)).min();
            let _ = self.save(&logins);
            (warn_now, end_now, next)
        };
        for login in warn_now {
            warn(&self.proc, &login);
        }
        for login in end_now {
            let ended_by = end(&self.proc, &login).await;
            audit(config, "access_expired", ended_by);
        }
        next
    }
}

/// Enforces the access deadlines of open logins until the daemon stops.
pub async fn enforce(logins: Arc<Logins>, config: Arc<Config>, client: reqwest::Client) {
    let recheck = Duration::from_secs(RECHECK_SECONDS);
    let mut next_recheck = Instant::now();
    loop {
        if Instant::now() >= next_recheck {
            logins.recheck(&config, &client).await;
            next_recheck = Instant::now() + recheck;
        }
        let wake = match logins.step(&config).await {
            // Wake within a second of the due time, and at least every recheck interval.
            Some(seconds) => {
                Instant::now() + Duration::from_secs(seconds.unsigned_abs()).min(recheck)
            }
            None => next_recheck,
        };
        tokio::time::sleep_until(wake.min(next_recheck)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_proc() -> PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "solana-authd-proc-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn add(proc: &Path, pid: i32, comm: &str, ppid: i32, uid: u32, start: u64) {
        add_with_tty(proc, pid, comm, ppid, uid, start, 0);
    }

    fn add_with_tty(proc: &Path, pid: i32, comm: &str, ppid: i32, uid: u32, start: u64, tty: u32) {
        let dir = proc.join(pid.to_string());
        std::fs::create_dir_all(&dir).unwrap();
        // Fields 7 (tty) and 22 (start time) matter here; the others do not.
        let filler = "0 ".repeat(14);
        std::fs::write(
            dir.join("stat"),
            format!("{pid} ({comm}) S {ppid} 0 0 {tty} {filler}{start} 0 0\n"),
        )
        .unwrap();
        std::fs::write(
            dir.join("status"),
            format!("Name:\t{comm}\nUid:\t{uid}\t{uid}\t{uid}\t{uid}\n"),
        )
        .unwrap();
    }

    /// The OpenSSH 10 layout observed on Ubuntu 26.04 and Debian 13.
    fn openssh(proc: &Path) {
        add(proc, 1, "systemd", 0, 0, 1);
        add(proc, 2881, "sshd", 1, 0, 50);
        add(proc, 3264, "sshd-session", 2881, 0, 900);
        add(proc, 3265, "sshd-auth", 3264, 986, 901);
        add(proc, 3266, "sshd-session", 3264, 0, 902);
    }

    #[test]
    fn decodes_pseudo_terminal_device_numbers() {
        // makedev(136, 0) is /dev/pts/0; makedev(137, 2) is /dev/pts/258.
        assert_eq!(pts_number(136 << 8), Some(0));
        assert_eq!(pts_number((136 << 8) | 5), Some(5));
        assert_eq!(pts_number((137 << 8) | 2), Some(258));
        // A large minor number is split across the low and high bits.
        assert_eq!(pts_number((136 << 8) | (0x100 << 12)), Some(256));
        // /dev/ttyS0 (4, 64) and no terminal at all.
        assert_eq!(pts_number((4 << 8) | 64), None);
        assert_eq!(pts_number(0), None);
    }

    #[test]
    fn finds_the_terminal_of_a_login_from_its_processes() {
        let proc = fake_proc();
        openssh(&proc);
        // The established login: sshd-session, its unprivileged child, then the shell.
        add_with_tty(&proc, 3300, "sshd-session", 3264, 1000, 950, 0);
        add_with_tty(&proc, 3301, "bash", 3300, 1000, 951, (136 << 8) | 3);
        // Another login's terminal is not this login's.
        add(&proc, 5000, "sshd-session", 2881, 0, 960);
        add_with_tty(&proc, 5001, "bash", 5000, 1000, 961, (136 << 8) | 9);
        assert_eq!(terminal(&proc, 3264), Some(PathBuf::from("/dev/pts/3")));
        assert_eq!(terminal(&proc, 5000), Some(PathBuf::from("/dev/pts/9")));
        // A login that runs a command without a terminal gets no warning.
        add(&proc, 6000, "sshd-session", 2881, 0, 970);
        add(&proc, 6001, "sleep", 6000, 1000, 971);
        assert_eq!(terminal(&proc, 6000), None);
        std::fs::remove_dir_all(proc).unwrap();
    }

    #[test]
    fn finds_the_connection_process_of_the_pam_client() {
        let proc = fake_proc();
        openssh(&proc);
        assert_eq!(monitor(&proc, 3266).unwrap(), (3264, 900));
        assert_eq!(monitor(&proc, 3264).unwrap(), (3264, 900));
        // Not OpenSSH, an unexpected parent, or a non-root connection process.
        assert!(monitor(&proc, 3265).is_err());
        assert!(monitor(&proc, 2881).is_err());
        add(&proc, 4000, "sshd-session", 1, 0, 1000);
        assert!(monitor(&proc, 4000).is_err());
        add(&proc, 4100, "sshd-session", 2881, 1000, 1100);
        assert!(monitor(&proc, 4100).is_err());
        assert!(monitor(&proc, 99999).is_err());
        // A command name with spaces and parentheses does not shift the fields.
        add(&proc, 4200, "a) (b", 1, 0, 7);
        assert_eq!(process(&proc, 4200).unwrap().start_time, 7);
        std::fs::remove_dir_all(proc).unwrap();
    }

    #[test]
    fn a_reused_pid_is_not_the_recorded_login() {
        let proc = fake_proc();
        openssh(&proc);
        let login = Login {
            pid: 3264,
            start_time: 900,
            wallet: [1; 32],
            deadline: 0,
            warned: false,
        };
        assert!(alive(&proc, &login));
        assert!(!alive(
            &proc,
            &Login {
                start_time: 901,
                ..login.clone()
            }
        ));
        add(&proc, 3264, "bash", 2881, 0, 900);
        assert!(!alive(&proc, &login));
        std::fs::remove_dir_all(proc).unwrap();
    }

    #[test]
    fn reads_the_logind_session_from_the_cgroup() {
        let proc = fake_proc();
        openssh(&proc);
        std::fs::write(
            proc.join("3264/cgroup"),
            "0::/user.slice/user-1000.slice/session-15.scope\n",
        )
        .unwrap();
        assert_eq!(logind_session(&proc, 3264).as_deref(), Some("15"));
        std::fs::write(proc.join("3264/cgroup"), "0::/system.slice/ssh.service\n").unwrap();
        assert_eq!(logind_session(&proc, 3264), None);
        std::fs::write(
            proc.join("3264/cgroup"),
            "0::/user.slice/session-../x.scope\n",
        )
        .unwrap();
        assert_eq!(logind_session(&proc, 3264), None);
        std::fs::remove_dir_all(proc).unwrap();
    }

    #[test]
    fn warns_a_minute_before_and_ends_at_the_deadline() {
        let login = Login {
            pid: 1,
            start_time: 1,
            wallet: [1; 32],
            deadline: 1000,
            warned: false,
        };
        assert_eq!(due(&login, 900), None);
        assert_eq!(next_due(&login, 900), 40);
        assert_eq!(due(&login, 940), Some(Due::Warn));
        let warned = Login {
            warned: true,
            ..login.clone()
        };
        assert_eq!(due(&warned, 999), None);
        assert_eq!(next_due(&warned, 990), 10);
        assert_eq!(due(&warned, 1000), Some(Due::End));
        assert_eq!(due(&login, 1500), Some(Due::End));
        assert_eq!(next_due(&login, 1500), 0);
    }

    #[test]
    fn saved_logins_survive_a_restart_while_their_connections_stay_open() {
        let proc = fake_proc();
        openssh(&proc);
        let path = proc.join("sessions");
        let open = Login {
            pid: 3264,
            start_time: 900,
            wallet: [1; 32],
            deadline: 5,
            warned: true,
        };
        let closed = Login {
            pid: 4242,
            start_time: 3,
            wallet: [2; 32],
            deadline: 5,
            warned: false,
        };
        let logins = Logins::load(path.clone(), proc.clone());
        logins.add(open.clone()).unwrap();
        logins.add(closed).unwrap();
        assert_eq!(*Logins::load(path.clone(), proc.clone()).lock(), vec![open]);
        std::fs::write(&path, b"not json").unwrap();
        assert!(Logins::load(path, proc.clone()).lock().is_empty());
        std::fs::remove_dir_all(proc).unwrap();
    }
}
