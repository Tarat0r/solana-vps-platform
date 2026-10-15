use anyhow::{ensure, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use rand::{rngs::OsRng, RngCore};

use crate::{hex, hex32, protocol::SignedResponse, pubkey, TTL_SECONDS_I64};

#[derive(Clone, Debug)]
pub struct Identity {
    pub cluster: String,
    pub program_id: String,
    pub provider: String,
    pub server_id: String,
    pub unix_user: String,
    pub auth_origin: String,
}

impl Identity {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            matches!(
                self.cluster.as_str(),
                "localnet" | "devnet" | "testnet" | "mainnet-beta"
            ),
            "invalid cluster"
        );
        pubkey(&self.program_id)?;
        pubkey(&self.provider)?;
        hex32(&self.server_id)?;
        ensure!(
            self.unix_user.len() <= 32
                && !self.unix_user.is_empty()
                && self
                    .unix_user
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b)),
            "invalid unix user"
        );
        ensure!(
            !self.auth_origin.is_empty() && !self.auth_origin.chars().any(|c| c.is_control()),
            "invalid origin"
        );
        Ok(())
    }
}

#[derive(Debug)]
pub struct Challenge {
    pub id: String,
    pub bytes: Vec<u8>,
    pub expires_at: i64,
}

impl Challenge {
    pub fn new(identity: &Identity, now: i64) -> Result<Self> {
        let mut id = [0; 32];
        let mut nonce = [0; 32];
        OsRng.try_fill_bytes(&mut id)?;
        OsRng.try_fill_bytes(&mut nonce)?;
        Self::with_entropy(identity, now, id, nonce)
    }

    fn with_entropy(identity: &Identity, now: i64, id: [u8; 32], nonce: [u8; 32]) -> Result<Self> {
        identity.validate()?;
        let id = hex(&id);
        let expires_at = now
            .checked_add(TTL_SECONDS_I64)
            .ok_or_else(|| anyhow::anyhow!("clock overflow"))?;
        let text = format!(
            "VPS-ACCESS-AUTH/1\ncluster={}\nprogram_id={}\nprovider={}\nserver_id={}\nunix_user={}\nsession_id={}\nnonce={}\nissued_at={}\nexpires_at={}\nauth_origin={}\n",
            identity.cluster, identity.program_id, identity.provider, identity.server_id.to_lowercase(), identity.unix_user,
            id, hex(&nonce), now, expires_at, identity.auth_origin
        );
        Ok(Self {
            id,
            bytes: text.into_bytes(),
            expires_at,
        })
    }

    pub fn verify(&self, proof: &SignedResponse, now: i64) -> Result<[u8; 32]> {
        ensure!(
            now < self.expires_at && now >= self.expires_at - TTL_SECONDS_I64,
            "expired challenge or clock rollback"
        );
        let wallet = pubkey(&proof.wallet)?;
        let key = VerifyingKey::from_bytes(&wallet)?;
        let signature = Signature::from_slice(&STANDARD.decode(&proof.signature_base64)?)?;
        key.verify_strict(&self.bytes, &signature)?;
        Ok(wallet)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn identity() -> Identity {
        Identity {
            cluster: "localnet".into(),
            program_id: bs58::encode([1; 32]).into_string(),
            provider: bs58::encode([2; 32]).into_string(),
            server_id: hex(&[3; 32]),
            unix_user: "ubuntu".into(),
            auth_origin: "http://127.0.0.2:8080".into(),
        }
    }

    #[test]
    fn canonical_bytes_and_signature_binding() {
        let mut identity = identity();
        let c = Challenge::with_entropy(&identity, 1000, [4; 32], [5; 32]).unwrap();
        let expected = format!("VPS-ACCESS-AUTH/1\ncluster=localnet\nprogram_id={}\nprovider={}\nserver_id={}\nunix_user=ubuntu\nsession_id={}\nnonce={}\nissued_at=1000\nexpires_at=1300\nauth_origin=http://127.0.0.2:8080\n", identity.program_id, identity.provider, hex(&[3;32]), hex(&[4;32]), hex(&[5;32]));
        assert_eq!(c.bytes, expected.as_bytes());
        let key = SigningKey::from_bytes(&[7; 32]);
        let proof = SignedResponse {
            wallet: bs58::encode(key.verifying_key().to_bytes()).into_string(),
            signature_base64: STANDARD.encode(key.sign(&c.bytes).to_bytes()),
        };
        assert!(c.verify(&proof, 1299).is_ok());
        assert!(c.verify(&proof, 1300).is_err());
        assert!(c.verify(&proof, 999).is_err());
        identity.unix_user = "root".into();
        assert!(Challenge::with_entropy(&identity, 1000, [4; 32], [5; 32])
            .unwrap()
            .verify(&proof, 1001)
            .is_err());
        identity.server_id = hex(&[9; 32]);
        assert!(Challenge::with_entropy(&identity, 1000, [4; 32], [5; 32])
            .unwrap()
            .verify(&proof, 1001)
            .is_err());
        assert!(Challenge::with_entropy(&identity, 1000, [6; 32], [5; 32])
            .unwrap()
            .verify(&proof, 1001)
            .is_err());
    }

    #[test]
    fn untrusted_fields_cannot_inject_challenge_lines() {
        let mut identity = identity();
        identity.unix_user = "ubuntu\nserver_id=bad".into();
        assert!(Challenge::new(&identity, 1).is_err());
    }
}
