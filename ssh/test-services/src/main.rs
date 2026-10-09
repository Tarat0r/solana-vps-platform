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
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
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
];

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
    sessions: HashMap<String, Entry>,
}
#[derive(Clone)]
struct App {
    token: String,
    data: Arc<Mutex<Data>>,
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
    let mut data = app.data.lock().unwrap();
    purge(&mut data);
    if data.scenario == "gateway_unavailable" {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    if auth_core::hex32(&challenge.session_id).is_err()
        || challenge.expires_at <= unix_time()
        || challenge.expires_at > unix_time() + 90
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

async fn fetch(State(app): State<App>, Path(id): Path<String>) -> Response {
    let data = app.data.lock().unwrap();
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
    let mut data = app.data.lock().unwrap();
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
    let data = app.data.lock().unwrap();
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
    app.data.lock().unwrap().sessions.remove(&id);
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
    app.data.lock().unwrap().scenario = input.scenario;
    StatusCode::NO_CONTENT
}

async fn status(State(app): State<App>, headers: HeaderMap) -> Response {
    if !authenticated(&headers, &app) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let mut data = app.data.lock().unwrap();
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

fn fixtures(scenario: &str, combined: bool) -> HashMap<String, Value> {
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
        paid_until: if scenario == "subscription_expired" {
            now
        } else {
            now + 3600
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
    if scenario == "missing_account" {
        values.remove(&key(subscription));
    }
    values
}

async fn rpc(State(app): State<App>, Json(request): Json<Value>) -> Response {
    let mode = app.data.lock().unwrap().scenario.clone();
    if mode == "rpc_unavailable" {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let method = request["method"].as_str().unwrap_or("");
    let params = &request["params"];
    let accounts = fixtures(&mode, method == "getMultipleAccounts");
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
    let app = App {
        token: token(),
        data: Arc::new(Mutex::new(Data {
            scenario: "allow".into(),
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
        .with_state(app.clone());
    let rpc_router = Router::new()
        .route("/", post(rpc))
        .layer(DefaultBodyLimit::max(16384))
        .with_state(app);
    let gateway_listener = tokio::net::TcpListener::bind(format!("{bind}:8080")).await?;
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
    let key = SigningKey::from_bytes(
        &[match who {
            "delegate" => 8,
            "outsider" => 9,
            _ => 7,
        }; 32],
    );
    let mut signature = key.sign(&bytes).to_bytes();
    if who == "bad-signature" {
        signature[0] ^= 1;
    }
    Ok(SignedResponse {
        wallet: bs58::encode(key.verifying_key().to_bytes()).into_string(),
        signature_base64: STANDARD.encode(signature),
    })
}

fn config() {
    println!("cluster = \"localnet\"\nrpc_url = \"http://127.0.0.1:8899\"\nprogram_id = \"{}\"\nprovider_pubkey = \"{}\"\nserver_id = \"{}\"\nunix_user = \"ubuntu\"\nauth_gateway = \"http://127.0.0.1:8080\"\nauth_origin = \"http://127.0.0.2:8080\"\ngateway_token = \"{}\"\ncommitment = \"finalized\"\nchallenge_ttl_seconds = 90\nlocal_test = true", key(PROGRAM), key(PROVIDER), hex(&SERVER), token());
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("serve") => serve().await,
        Some("config") => {
            config();
            Ok(())
        }
        Some("proof") | Some("sign") => {
            ensure!(args.len()>=2,"usage: test-services proof|sign URL [owner|delegate|outsider|bad-signature|wrong-user|wrong-server]");
            let proof = proof(&args[1], args.get(2).map(String::as_str).unwrap_or("owner")).await?;
            if args[0] == "proof" {
                println!("{}", serde_json::to_string(&proof)?)
            } else {
                reqwest::Client::new()
                    .post(format!("{}/response", args[1]))
                    .json(&proof)
                    .send()
                    .await?
                    .error_for_status()?;
            }
            Ok(())
        }
        _ => anyhow::bail!("usage: test-services serve|config|proof|sign"),
    }
}
