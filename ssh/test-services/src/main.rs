//! Deliberately synthetic services and public test keys. Never deploy as a gateway.
use anyhow::{ensure, Result};
use auth_core::{
    accounts::{self, AccessGrant, GrantType, ServerRecord, Subscription},
    hex,
    protocol::{PublishedChallenge, SignedResponse},
    unix_time,
};
use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use serde::Deserialize;
use serde_json::{json, Value};
use solana_auth_gateway::frontend::{session_headers, wants_html, Frontend};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
};

const PROGRAM: [u8; 32] = [1; 32];
const PROVIDER: [u8; 32] = [2; 32];
const SERVER: [u8; 32] = [3; 32];
const DEFAULT_TOKEN: &str = "test-only-daemon-token-not-for-production-0001";
const SCENARIOS: &[&str] = &[
    "allow",
    "subscription_expired",
    "owner_expired",
    "delegate_expired",
    "delegate_revoked",
    "owner_revoked",
    "disabled",
    "stale_rpc",
    "future_rpc",
    "rpc_unavailable",
    "gateway_unavailable",
    "wrong_program",
    "wrong_discriminator",
    "wrong_bump",
    "wrong_server",
    "wrong_role",
    "missing_account",
    "stale_context",
    "changed_owner",
    "expiring",
];
/// How long access lasts after the "expiring" scenario is selected.
const EXPIRING_SECONDS: i64 = 70;

fn key(bytes: [u8; 32]) -> String {
    bs58::encode(bytes).into_string()
}
fn wallet(seed: u8) -> [u8; 32] {
    SigningKey::from_bytes(&[seed; 32])
        .verifying_key()
        .to_bytes()
}
fn token() -> String {
    std::env::var("SOLANA_TEST_TOKEN").unwrap_or_else(|_| DEFAULT_TOKEN.into())
}

struct Entry {
    challenge: PublishedChallenge,
    proof: Option<SignedResponse>,
}
struct Data {
    scenario: String,
    /// When the scenario was selected.
    selected_at: i64,
    sessions: HashMap<String, Entry>,
}
#[derive(Clone)]
struct App {
    token: String,
    data: Arc<Mutex<Data>>,
    frontend: Frontend,
    phone_wallet: Option<[u8; 32]>,
}
impl App {
    /// Every update leaves the data valid, so a panic in another request does not poison it.
    fn data(&self) -> MutexGuard<'_, Data> {
        self.data.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
fn authenticated(headers: &HeaderMap, app: &App) -> bool {
    headers.get("authorization").and_then(|v| v.to_str().ok())
        == Some(format!("Bearer {}", app.token).as_str())
}
fn purge(data: &mut Data) {
    data.sessions
        .retain(|_, entry| entry.challenge.expires_at > unix_time());
}

async fn publish(
    State(app): State<App>,
    headers: HeaderMap,
    Json(challenge): Json<PublishedChallenge>,
) -> Response {
    if !authenticated(&headers, &app) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let mut data = app.data();
    purge(&mut data);
    if data.scenario == "gateway_unavailable" {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    if auth_core::hex32(&challenge.session_id).is_err()
        || challenge.expires_at <= unix_time()
        || challenge.expires_at > unix_time() + auth_core::TTL_SECONDS_I64
        || STANDARD
            .decode(&challenge.challenge_base64)
            .map_or(true, |b| b.len() > 4096)
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    if data.sessions.contains_key(&challenge.session_id) {
        return StatusCode::CONFLICT.into_response();
    }
    if data.sessions.len() >= 256 {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    data.sessions.insert(
        challenge.session_id.clone(),
        Entry {
            challenge,
            proof: None,
        },
    );
    StatusCode::CREATED.into_response()
}

async fn fetch(State(app): State<App>, Path(id): Path<String>, headers: HeaderMap) -> Response {
    if wants_html(&headers) {
        let status = {
            let data = app.data();
            if data.scenario == "gateway_unavailable" {
                StatusCode::SERVICE_UNAVAILABLE
            } else {
                match data.sessions.get(&id) {
                    Some(entry) if entry.challenge.expires_at > unix_time() => StatusCode::OK,
                    Some(_) => StatusCode::GONE,
                    None => StatusCode::NOT_FOUND,
                }
            }
        };
        return session_headers(app.frontend.page(status).await);
    }
    let data = app.data();
    if data.scenario == "gateway_unavailable" {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    match data.sessions.get(&id) {
        Some(e) if e.challenge.expires_at > unix_time() => {
            Json(e.challenge.clone()).into_response()
        }
        Some(_) => StatusCode::GONE.into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn submit(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(proof): Json<SignedResponse>,
) -> Response {
    let mut data = app.data();
    if data.scenario == "gateway_unavailable" {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let Some(entry) = data.sessions.get_mut(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if entry.challenge.expires_at <= unix_time() {
        return StatusCode::GONE.into_response();
    }
    if entry.proof.is_some() {
        return StatusCode::CONFLICT.into_response();
    }
    if auth_core::pubkey(&proof.wallet).is_err()
        || STANDARD
            .decode(&proof.signature_base64)
            .map_or(true, |b| b.len() != 64)
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    entry.proof = Some(proof);
    StatusCode::ACCEPTED.into_response()
}

async fn poll(State(app): State<App>, Path(id): Path<String>, headers: HeaderMap) -> Response {
    if !authenticated(&headers, &app) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let data = app.data();
    if data.scenario == "gateway_unavailable" {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    match data.sessions.get(&id) {
        Some(e) if e.challenge.expires_at <= unix_time() => StatusCode::GONE.into_response(),
        Some(e) => match &e.proof {
            Some(p) => Json(p.clone()).into_response(),
            None => StatusCode::NO_CONTENT.into_response(),
        },
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn delete(State(app): State<App>, Path(id): Path<String>, headers: HeaderMap) -> StatusCode {
    if !authenticated(&headers, &app) {
        return StatusCode::UNAUTHORIZED;
    }
    app.data().sessions.remove(&id);
    StatusCode::NO_CONTENT
}

#[derive(Deserialize)]
struct Scenario {
    scenario: String,
}
async fn scenario(
    State(app): State<App>,
    headers: HeaderMap,
    Json(input): Json<Scenario>,
) -> StatusCode {
    if !authenticated(&headers, &app) {
        return StatusCode::UNAUTHORIZED;
    }
    if !SCENARIOS.contains(&input.scenario.as_str()) {
        return StatusCode::BAD_REQUEST;
    }
    let mut data = app.data();
    data.scenario = input.scenario;
    data.selected_at = unix_time();
    StatusCode::NO_CONTENT
}

async fn status(State(app): State<App>, headers: HeaderMap) -> Response {
    if !authenticated(&headers, &app) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let mut data = app.data();
    purge(&mut data);
    Json(json!({"scenario":data.scenario, "sessions":data.sessions.len()})).into_response()
}

fn account_value<T: accounts::Account>(account: &T, scenario: &str) -> Value {
    let mut bytes = accounts::encode(account);
    if scenario == "wrong_discriminator" {
        bytes[0] ^= 1;
    }
    json!({"owner":if scenario=="wrong_program" {key([99;32])} else {key(PROGRAM)},"executable":false,"lamports":1_000_000,"data":[STANDARD.encode(bytes),"base64"],"rentEpoch":0})
}

fn fixtures(
    scenario: &str,
    selected_at: i64,
    combined: bool,
    phone_wallet: Option<[u8; 32]>,
) -> HashMap<String, Value> {
    let (server, bump) = accounts::pda(&PROGRAM, &[b"server", &PROVIDER, &SERVER]);
    let owner = wallet(7);
    let delegate = wallet(8);
    let now = unix_time();
    let mut record = ServerRecord {
        provider: PROVIDER,
        server_id: SERVER,
        owner_wallet: owner,
        treasury: [5; 32],
        price_lamports: 1_000_000,
        period_seconds: 3600,
        enabled: scenario != "disabled",
        bump,
    };
    if scenario == "wrong_bump" {
        record.bump ^= 1;
    }
    if scenario == "wrong_server" {
        record.server_id = [55; 32];
    }
    if scenario == "changed_owner" && combined {
        record.owner_wallet = delegate;
    }
    let (subscription, sub_bump) = accounts::pda(&PROGRAM, &[b"subscription", &server]);
    let sub = Subscription {
        server,
        owner_wallet: owner,
        paid_until: match scenario {
            "subscription_expired" => now,
            "expiring" => selected_at + EXPIRING_SECONDS,
            _ => now + 3600,
        },
        bump: sub_bump,
    };
    let grant = |who: [u8; 32], is_owner: bool| {
        let (address, bump) = accounts::pda(&PROGRAM, &[b"grant", &server, &who]);
        let grant = AccessGrant {
            server,
            wallet: who,
            grant_type: if is_owner || scenario == "wrong_role" {
                GrantType::Owner
            } else {
                GrantType::Delegated
            },
            active: scenario
                != if is_owner {
                    "owner_revoked"
                } else {
                    "delegate_revoked"
                },
            valid_until: if scenario
                == if is_owner {
                    "owner_expired"
                } else {
                    "delegate_expired"
                } {
                now
            } else {
                now + 3600
            },
            bump,
        };
        (key(address), account_value(&grant, scenario))
    };
    let mut values = HashMap::from([
        (key(server), account_value(&record, scenario)),
        (key(subscription), account_value(&sub, scenario)),
        grant(owner, true),
        grant(delegate, false),
    ]);
    if let Some(wallet) = phone_wallet.filter(|wallet| *wallet != owner && *wallet != delegate) {
        let (address, value) = grant(wallet, false);
        values.insert(address, value);
    }
    if scenario == "missing_account" {
        values.remove(&key(subscription));
    }
    values
}

async fn rpc(State(app): State<App>, Json(request): Json<Value>) -> Response {
    let (mode, selected_at) = {
        let data = app.data();
        (data.scenario.clone(), data.selected_at)
    };
    if mode == "rpc_unavailable" {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let method = request["method"].as_str().unwrap_or("");
    let params = &request["params"];
    let accounts = fixtures(
        &mode,
        selected_at,
        method == "getMultipleAccounts",
        app.phone_wallet,
    );
    let result=match method {
        "getAccountInfo" if params[1]["commitment"]=="finalized" => json!({"context":{"slot":100},"value":accounts.get(params[0].as_str().unwrap_or(""))}),
        "getMultipleAccounts" if params[1]["commitment"]=="finalized" && params[1]["minContextSlot"]==100 => {
            let values: Vec<_>=params[0].as_array().into_iter().flatten().map(|v| accounts.get(v.as_str().unwrap_or("")).cloned().unwrap_or(Value::Null)).collect();
            json!({"context":{"slot":if mode=="stale_context" {99} else {100}},"value":values})
        },
        "getBlockTime" if params[0]==100 => json!(unix_time()+match mode.as_str() {"stale_rpc"=>-60,"future_rpc"=>60,_=>0}),
        _ => return Json(json!({"jsonrpc":"2.0","id":request["id"],"error":{"code":-32602,"message":"unsupported fixture request"}})).into_response(),
    };
    Json(json!({"jsonrpc":"2.0","id":request["id"],"result":result})).into_response()
}

async fn serve() -> Result<()> {
    let frontend = Frontend::new(
        std::env::var_os("SOLANA_TEST_FRONTEND_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../frontend/dist")
            }),
    );
    let app = App {
        token: token(),
        frontend: frontend.clone(),
        phone_wallet: std::env::var("SOLANA_TEST_PHONE_WALLET")
            .ok()
            .map(|wallet| auth_core::pubkey(&wallet))
            .transpose()?,
        data: Arc::new(Mutex::new(Data {
            scenario: "allow".into(),
            selected_at: unix_time(),
            sessions: HashMap::new(),
        })),
    };
    let bind = std::env::var("SOLANA_TEST_BIND").unwrap_or_else(|_| "127.0.0.1".into());
    let gateway = Router::new()
        .route("/v1/sessions", post(publish))
        .route("/v1/sessions/{id}", get(fetch).delete(delete))
        .route("/v1/sessions/{id}/response", get(poll).post(submit))
        .route("/_test/scenario", post(scenario))
        .route("/_test/status", get(status))
        .layer(DefaultBodyLimit::max(16384))
        .layer(axum::middleware::map_response(
            async |response: Response| session_headers(response),
        ))
        .with_state(app.clone())
        .merge(frontend.routes());
    let rpc_router = Router::new()
        .route("/", post(rpc))
        .layer(DefaultBodyLimit::max(16384))
        .with_state(app);
    let gateway_port = configured_port("SOLANA_TEST_GATEWAY_PORT")?;
    let gateway_listener = tokio::net::TcpListener::bind(format!("{bind}:{gateway_port}")).await?;
    let rpc_listener = tokio::net::TcpListener::bind(format!("{bind}:8899")).await?;
    tokio::try_join!(
        axum::serve(gateway_listener, gateway),
        axum::serve(rpc_listener, rpc_router)
    )?;
    Ok(())
}

async fn proof(url: &str, who: &str) -> Result<SignedResponse> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    let challenge: PublishedChallenge = client
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let mut bytes = STANDARD.decode(challenge.challenge_base64)?;
    if who == "wrong-user" {
        bytes = String::from_utf8(bytes)?
            .replace("unix_user=ubuntu", "unix_user=root")
            .into_bytes();
    }
    if who == "wrong-server" {
        bytes = String::from_utf8(bytes)?
            .replace(&hex(&SERVER), &hex(&[55; 32]))
            .into_bytes();
    }
    let key = if who == "phone" {
        let path = std::env::var("SOLANA_TEST_WALLET_FILE").map_err(|_| {
            anyhow::anyhow!("SOLANA_TEST_WALLET_FILE is required for the phone signer")
        })?;
        read_test_keypair(std::path::Path::new(&path))?
    } else {
        SigningKey::from_bytes(
            &[match who {
                "delegate" => 8,
                "outsider" => 9,
                _ => 7,
            }; 32],
        )
    };
    let mut signature = key.sign(&bytes).to_bytes();
    if who == "bad-signature" {
        signature[0] ^= 1;
    }
    Ok(SignedResponse {
        wallet: bs58::encode(key.verifying_key().to_bytes()).into_string(),
        signature_base64: STANDARD.encode(signature),
    })
}

fn validate_test_origin(origin: &str, lan_http: bool) -> Result<()> {
    let url = reqwest::Url::parse(origin)?;
    let ip = url
        .host_str()
        .and_then(|host| host.parse::<std::net::Ipv4Addr>().ok());
    ensure!(
        url.origin().ascii_serialization() == origin
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
            && (url.scheme() == "https"
                || (url.scheme() == "http"
                    && ip.is_some_and(|ip| ip.is_loopback() || (lan_http && ip.is_private())))),
        "test signing origin must be HTTPS, loopback HTTP, or explicitly enabled private LAN HTTP"
    );
    Ok(())
}

fn read_test_keypair(path: &std::path::Path) -> Result<SigningKey> {
    use std::os::unix::fs::PermissionsExt;
    let meta = std::fs::metadata(path)?;
    ensure!(
        meta.is_file() && meta.len() <= 1024 && meta.permissions().mode() & 0o077 == 0,
        "test keypair must be a private mode-0600 file"
    );
    let bytes: Vec<u8> = serde_json::from_slice(&std::fs::read(path)?)?;
    let bytes: [u8; 64] = bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("expected a 64-byte Solana keypair"))?;
    let key = SigningKey::from_bytes((&bytes[..32]).try_into()?);
    ensure!(
        key.to_keypair_bytes() == bytes,
        "test keypair public key does not match its seed"
    );
    Ok(key)
}

fn create_test_keypair(path: &std::path::Path) -> Result<String> {
    use std::{io::Write, os::unix::fs::OpenOptionsExt};
    let import = path.with_extension("private-key.txt");
    // Never pair a new keypair with an existing, possibly user-edited, import file.
    ensure!(
        path.exists() || !import.exists(),
        "{} exists without its keypair file; move it away, or pass --wallet with its public address",
        import.display()
    );
    let key = if path.exists() {
        read_test_keypair(path)?
    } else {
        let key = SigningKey::generate(&mut rand::rngs::OsRng);
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(serde_json::to_string(&key.to_keypair_bytes().to_vec())?.as_bytes())?;
        key
    };
    if !import.exists() {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(import)?;
        writeln!(
            file,
            "{}",
            bs58::encode(key.to_keypair_bytes()).into_string()
        )?;
    }
    Ok(bs58::encode(key.verifying_key().to_bytes()).into_string())
}

fn configured_port(variable: &str) -> Result<u16> {
    let port = std::env::var(variable)
        .unwrap_or_else(|_| "8080".into())
        .parse()?;
    ensure!(port != 0, "test gateway port must be nonzero");
    Ok(port)
}

fn config() -> Result<()> {
    let public_port = configured_port("SOLANA_SSH_GATEWAY_PORT")?;
    let origin = std::env::var("SOLANA_TEST_AUTH_ORIGIN")
        .unwrap_or_else(|_| format!("http://127.0.0.2:{public_port}"));
    let lan_http = std::env::var("SOLANA_TEST_LAN_HTTP").as_deref() == Ok("1");
    validate_test_origin(&origin, lan_http)?;
    println!("cluster = \"localnet\"\nrpc_url = \"http://127.0.0.1:8899\"\nprogram_id = \"{}\"\nprovider_pubkey = \"{}\"\nserver_id = \"{}\"\nunix_user = \"ubuntu\"\nauth_gateway = \"http://127.0.0.1:8080\"\nauth_origin = \"{origin}\"\ngateway_token = \"{}\"\ncommitment = \"finalized\"\nchallenge_ttl_seconds = {}\nlocal_test = true\nlocal_test_lan_http = {lan_http}", key(PROGRAM), key(PROVIDER), hex(&SERVER), token(), auth_core::TTL_SECONDS);
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("serve") => serve().await,
        Some("config") => config(),
        Some("keygen") => {
            ensure!(args.len() == 2, "usage: test-services keygen KEYPAIR_FILE");
            println!("{}", create_test_keypair(std::path::Path::new(&args[1]))?);
            Ok(())
        }
        Some("proof") | Some("sign") => {
            ensure!(args.len()>=2,"usage: test-services proof|sign URL [owner|delegate|outsider|bad-signature|wrong-user|wrong-server]");
            let proof = proof(&args[1], args.get(2).map(String::as_str).unwrap_or("owner")).await?;
            if args[0] == "proof" {
                println!("{}", serde_json::to_string(&proof)?)
            } else {
                reqwest::Client::builder().no_proxy().build()?
                    .post(format!("{}/response", args[1]))
                    .json(&proof)
                    .send()
                    .await?
                    .error_for_status()?;
            }
            Ok(())
        }
        _ => anyhow::bail!("usage: test-services serve|config|keygen KEYPAIR_FILE|proof|sign URL [owner|delegate|phone|outsider|bad-signature|wrong-user|wrong-server]"),
    }
}

#[cfg(test)]
mod phone_tests {
    use super::*;

    #[test]
    fn phone_grant_is_optional_and_obeys_the_delegated_access_scenarios() {
        let wallet = [42; 32];
        let (server, _) = accounts::pda(&PROGRAM, &[b"server", &PROVIDER, &SERVER]);
        let (grant, _) = accounts::pda(&PROGRAM, &[b"grant", &server, &wallet]);
        let address = key(grant);
        assert!(!fixtures("allow", 0, true, None).contains_key(&address));
        let values = fixtures("allow", 0, true, Some(wallet));
        let bytes = STANDARD
            .decode(values[&address]["data"][0].as_str().unwrap())
            .unwrap();
        let decoded = accounts::decode::<AccessGrant>(&bytes).unwrap();
        assert_eq!(decoded.wallet, wallet);
        assert_eq!(decoded.server, server);
        assert_eq!(decoded.grant_type, GrantType::Delegated);
        assert!(decoded.active && decoded.valid_until > unix_time());
        let revoked = fixtures("delegate_revoked", 0, true, Some(wallet));
        let bytes = STANDARD
            .decode(revoked[&address]["data"][0].as_str().unwrap())
            .unwrap();
        assert!(!accounts::decode::<AccessGrant>(&bytes).unwrap().active);
    }

    #[test]
    fn phone_origin_requires_a_canonical_origin_and_explicit_lan_http() {
        assert!(validate_test_origin("http://127.0.0.2:18080", false).is_ok());
        assert!(validate_test_origin("https://auth.example", false).is_ok());
        assert!(validate_test_origin("http://192.168.1.9:18080", true).is_ok());
        for (origin, enabled) in [
            ("http://192.168.1.9:18080", false),
            ("http://8.8.8.8:18080", true),
            ("http://192.168.1.9:18080/", true),
            ("http://192.168.1.9:18080/path", true),
            ("http://user@192.168.1.9:18080", true),
            ("http://192.168.1.9:18080?token=x", true),
        ] {
            assert!(validate_test_origin(origin, enabled).is_err());
        }
    }

    #[test]
    fn generated_solana_keypair_is_private_reusable_and_verified() {
        use std::os::unix::fs::PermissionsExt;
        let directory = std::env::temp_dir().join(format!(
            "solana-phone-key-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("phone-wallet.json");
        let address = create_test_keypair(&path).unwrap();
        assert_eq!(create_test_keypair(&path).unwrap(), address);
        let key = read_test_keypair(&path).unwrap();
        assert_eq!(
            bs58::encode(key.verifying_key().to_bytes()).into_string(),
            address
        );
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            std::fs::metadata(path.with_extension("private-key.txt"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        let mut bytes = key.to_keypair_bytes().to_vec();
        bytes[63] ^= 1;
        std::fs::write(&path, serde_json::to_vec(&bytes).unwrap()).unwrap();
        assert!(read_test_keypair(&path).is_err());
        std::fs::remove_file(&path).unwrap();
        assert!(create_test_keypair(&path).is_err());
        assert!(!path.exists());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
