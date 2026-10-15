//! Ephemeral challenge relay. Signature and access verification belongs to authd.
pub mod dashboard;
pub mod frontend;

use auth_core::{
    protocol::{PublishedChallenge, SignedResponse},
    unix_time, TTL_SECONDS_I64,
};
use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use frontend::{session_headers, wants_html, Frontend};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
};
use subtle::ConstantTimeEq;

const MAX_SESSIONS: usize = 256;
const MAX_BODY: usize = 16_384;

struct Entry {
    challenge: PublishedChallenge,
    proof: Option<SignedResponse>,
}

#[derive(Clone)]
struct App {
    authorization: Arc<[u8]>,
    sessions: Arc<Mutex<HashMap<String, Entry>>>,
    frontend: Frontend,
}

impl App {
    /// Every update leaves the map valid, so a panic in another request does not poison it.
    fn sessions(&self) -> MutexGuard<'_, HashMap<String, Entry>> {
        self.sessions.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn authenticated(&self, headers: &HeaderMap) -> bool {
        headers
            .get("authorization")
            .is_some_and(|value| bool::from(value.as_bytes().ct_eq(&self.authorization)))
    }
}

pub fn router(token: &str, frontend: Frontend) -> anyhow::Result<Router> {
    anyhow::ensure!(
        (32..=256).contains(&token.len()) && token.bytes().all(|byte| byte.is_ascii_graphic()),
        "SOLANA_GATEWAY_TOKEN must contain 32–256 printable ASCII characters"
    );
    let app = App {
        authorization: format!("Bearer {token}").into_bytes().into(),
        sessions: Arc::new(Mutex::new(HashMap::new())),
        frontend: frontend.clone(),
    };
    Ok(Router::new()
        .route("/v1/sessions", post(publish))
        .route("/v1/sessions/{id}", get(fetch).delete(delete))
        .route("/v1/sessions/{id}/response", get(poll).post(submit))
        .layer(DefaultBodyLimit::max(MAX_BODY))
        .layer(middleware::map_response(async |response: Response| {
            session_headers(response)
        }))
        .with_state(app)
        .merge(frontend.routes()))
}

async fn publish(
    State(app): State<App>,
    headers: HeaderMap,
    Json(challenge): Json<PublishedChallenge>,
) -> StatusCode {
    if !app.authenticated(&headers) {
        return StatusCode::UNAUTHORIZED;
    }
    let now = unix_time();
    if auth_core::hex32(&challenge.session_id).is_err()
        || challenge.expires_at <= now
        || challenge.expires_at > now + TTL_SECONDS_I64
        || STANDARD
            .decode(&challenge.challenge_base64)
            .map_or(true, |bytes| bytes.len() > 4096)
    {
        return StatusCode::BAD_REQUEST;
    }
    let mut sessions = app.sessions();
    sessions.retain(|_, entry| entry.challenge.expires_at > now);
    if sessions.contains_key(&challenge.session_id) {
        return StatusCode::CONFLICT;
    }
    if sessions.len() >= MAX_SESSIONS {
        return StatusCode::TOO_MANY_REQUESTS;
    }
    sessions.insert(
        challenge.session_id.clone(),
        Entry {
            challenge,
            proof: None,
        },
    );
    StatusCode::CREATED
}

async fn fetch(State(app): State<App>, Path(id): Path<String>, headers: HeaderMap) -> Response {
    // Drop the lock before filesystem I/O. Never serialize or rebuild signed bytes.
    let (status, challenge) = {
        let sessions = app.sessions();
        match sessions.get(&id) {
            Some(entry) if entry.challenge.expires_at > unix_time() => {
                (StatusCode::OK, Some(entry.challenge.clone()))
            }
            Some(_) => (StatusCode::GONE, None),
            None => (StatusCode::NOT_FOUND, None),
        }
    };
    if wants_html(&headers) {
        app.frontend.page(status).await
    } else if let Some(challenge) = challenge {
        Json(challenge).into_response()
    } else {
        status.into_response()
    }
}

async fn submit(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(proof): Json<SignedResponse>,
) -> StatusCode {
    let mut sessions = app.sessions();
    let Some(entry) = sessions.get_mut(&id) else {
        return StatusCode::NOT_FOUND;
    };
    if entry.challenge.expires_at <= unix_time() {
        return StatusCode::GONE;
    }
    if entry.proof.is_some() {
        return StatusCode::CONFLICT;
    }
    if auth_core::pubkey(&proof.wallet).is_err()
        || STANDARD
            .decode(&proof.signature_base64)
            .map_or(true, |bytes| bytes.len() != 64)
    {
        return StatusCode::BAD_REQUEST;
    }
    entry.proof = Some(proof);
    StatusCode::ACCEPTED
}

async fn poll(State(app): State<App>, Path(id): Path<String>, headers: HeaderMap) -> Response {
    if !app.authenticated(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let sessions = app.sessions();
    match sessions.get(&id) {
        Some(entry) if entry.challenge.expires_at <= unix_time() => {
            StatusCode::GONE.into_response()
        }
        Some(entry) => match &entry.proof {
            Some(proof) => Json(proof.clone()).into_response(),
            None => StatusCode::NO_CONTENT.into_response(),
        },
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn delete(State(app): State<App>, Path(id): Path<String>, headers: HeaderMap) -> StatusCode {
    if !app.authenticated(&headers) {
        return StatusCode::UNAUTHORIZED;
    }
    app.sessions().remove(&id);
    StatusCode::NO_CONTENT
}
