use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    Start { version: u8, unix_user: String },
    Wait { version: u8 },
    Cancel { version: u8 },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Response {
    Challenge {
        version: u8,
        url: String,
        expires_at: i64,
    },
    Result {
        version: u8,
        allow: bool,
        reason: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublishedChallenge {
    pub session_id: String,
    pub challenge_base64: String,
    pub expires_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedResponse {
    pub wallet: String,
    pub signature_base64: String,
}
