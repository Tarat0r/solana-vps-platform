use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use sqlx::SqlitePool;

#[derive(Debug, Clone)]
pub struct GatewaySession {
    pub session_id: String,
    pub server_id: String,
    pub unix_user: String,
    pub exact_challenge_bytes: String,
    pub challenge_base64: Option<String>,
    pub issued_at: String,
    pub expires_at: String, // 90 seconds TTL
    pub expires_at_unix: i64,
    pub wallet_pubkey: Option<String>,
    pub signature: Option<String>,
    pub status: String, // "PENDING", "SUBMITTED", "CONSUMED", "EXPIRED"
}

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub treasury_wallet: String,
    pub gateway_sessions: Arc<RwLock<HashMap<String, GatewaySession>>>,
}
