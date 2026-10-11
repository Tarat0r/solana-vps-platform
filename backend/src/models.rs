use std::fmt;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderStatus {
    Created,
    PaymentPending,
    Paid,
    Provisioning,
    Active,
    ProvisioningFailed,
    Expired,
}

impl fmt::Display for OrderStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let status_str = match self {
            Self::Created => "CREATED",
            Self::PaymentPending => "PAYMENT_PENDING",
            Self::Paid => "PAID",
            Self::Provisioning => "PROVISIONING",
            Self::Active => "ACTIVE",
            Self::ProvisioningFailed => "PROVISIONING_FAILED",
            Self::Expired => "EXPIRED",
        };
        write!(f, "{}", status_str)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PaymentKind {
    Purchase,
    Renewal,
}

impl fmt::Display for PaymentKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Purchase => write!(f, "PURCHASE"),
            Self::Renewal => write!(f, "RENEWAL"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PaymentAttemptStatus {
    Pending,
    Finalized,
    Failed,
}

impl fmt::Display for PaymentAttemptStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Pending => write!(f, "PENDING"),
            Self::Finalized => write!(f, "FINALIZED"),
            Self::Failed => write!(f, "FAILED"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct VPSOrder {
    pub order_id: String,
    pub server_id: String,
    pub name: String,
    pub owner_wallet: String,
    pub region: String,
    pub status: String,
    pub price_lamports: String,
    pub period_days: i32,
    pub created_at: String,
    pub paid_until: Option<String>,
    pub host: Option<String>,
    pub port: i32,
    pub username: String,
    pub tx_hash: Option<String>,
    pub active_payment_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PaymentAttempt {
    pub payment_id: String,
    pub order_id: String,
    pub kind: String, // PURCHASE or RENEWAL
    pub transaction_signature: Option<String>,
    pub status: String, // PENDING, FINALIZED, FAILED
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateOrderPayload {
    pub name: String,
    pub owner_wallet: String,
    pub region: String,
    pub period_days: i32,
    pub price_lamports: String,
}

#[derive(Debug, Deserialize)]
pub struct ListOrdersQuery {
    pub owner_wallet: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VerifyPaymentPayload {
    pub payment_id: Option<String>,
    pub tx_hash: String,
}

#[derive(Debug, Serialize)]
pub struct ChallengeResponse {
    pub order_id: String,
    pub challenge: String,
    pub expires_at: String,
}

#[derive(Debug, Deserialize)]
pub struct RespondChallengePayload {
    pub wallet_pubkey: String,
    pub signature: String,
}

#[derive(Debug, Deserialize)]
pub struct AddDelegatePayload {
    pub delegate_wallet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct DelegateRecord {
    pub order_id: String,
    pub delegate_wallet: String,
    pub created_at: String,
}

// Gateway Relay Protocol DTOs (docs/diagrams/ssh-login.puml)
#[derive(Debug, Deserialize)]
pub struct PublishGatewayChallengeRequest {
    pub server_id: String,
    pub unix_user: String,
    pub exact_challenge_bytes: String,
}

#[derive(Debug, Serialize)]
pub struct PublishGatewayChallengeResponse {
    pub session_id: String,
    pub login_url: String,
    pub expires_at: String,
}

#[derive(Debug, Serialize)]
pub struct GetGatewayChallengeResponse {
    pub session_id: String,
    pub server_id: String,
    pub unix_user: String,
    pub exact_challenge_bytes: String,
    pub expires_at: String,
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct SubmitGatewaySignatureRequest {
    pub wallet_pubkey: String,
    pub signature: String,
}

#[derive(Debug, Serialize)]
pub struct PollGatewayResponse {
    pub session_id: String,
    pub status: String, // "PENDING", "SUBMITTED", "CONSUMED", "EXPIRED"
    pub wallet_pubkey: Option<String>,
    pub signature: Option<String>,
}

// Standard v1 sessions protocol DTOs (CONTRACTS.md)
#[derive(Debug, Deserialize)]
pub struct PublishV1SessionRequest {
    pub session_id: String,
    pub challenge_base64: String,
    pub expires_at: i64,
}

#[derive(Debug, Serialize)]
pub struct GetV1SessionResponse {
    pub session_id: String,
    pub challenge_base64: String,
    pub expires_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct SubmitV1ResponseRequest {
    pub wallet: String,
    pub signature_base64: String,
}

#[derive(Debug, Serialize)]
pub struct V1SignedResponse {
    pub wallet: String,
    pub signature_base64: String,
}


