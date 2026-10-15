//! Provisional v1 account contract: Anchor discriminator + Borsh fields + bump.
use anyhow::{ensure, Result};
use borsh::{BorshDeserialize, BorshSerialize};
use sha2::{Digest, Sha256};
use solana_pubkey::Pubkey;

pub type Key = [u8; 32];

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
pub struct ServerRecord {
    pub provider: Key,
    pub server_id: Key,
    pub owner_wallet: Key,
    pub treasury: Key,
    pub price_lamports: u64,
    pub period_seconds: i64,
    pub enabled: bool,
    pub bump: u8,
}

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
pub struct Subscription {
    pub server: Key,
    pub owner_wallet: Key,
    pub paid_until: i64,
    pub bump: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, BorshSerialize, BorshDeserialize)]
pub enum GrantType {
    Owner,
    Delegated,
}

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
pub struct AccessGrant {
    pub server: Key,
    pub wallet: Key,
    pub grant_type: GrantType,
    pub active: bool,
    pub valid_until: i64,
    pub bump: u8,
}

pub trait Account: BorshDeserialize + BorshSerialize {
    const NAME: &'static str;
}
impl Account for ServerRecord {
    const NAME: &'static str = "ServerRecord";
}
impl Account for Subscription {
    const NAME: &'static str = "Subscription";
}
impl Account for AccessGrant {
    const NAME: &'static str = "AccessGrant";
}

#[expect(
    clippy::expect_used,
    reason = "borsh writes fixed-size fields into a Vec, which cannot fail"
)]
pub fn encode<T: Account>(account: &T) -> Vec<u8> {
    let mut data = Sha256::digest(format!("account:{}", T::NAME))[..8].to_vec();
    data.extend(borsh::to_vec(account).expect("serializing fixed account fields"));
    data
}

pub fn decode<T: Account>(data: &[u8]) -> Result<T> {
    let discriminator = Sha256::digest(format!("account:{}", T::NAME));
    ensure!(
        data.len() >= 8 && data[..8] == discriminator[..8],
        "invalid discriminator"
    );
    Ok(T::try_from_slice(&data[8..])?)
}

pub fn pda(program: &Key, seeds: &[&[u8]]) -> (Key, u8) {
    let (key, bump) = Pubkey::find_program_address(seeds, &Pubkey::new_from_array(*program));
    (key.to_bytes(), bump)
}

pub struct AccessSnapshot {
    pub server: ServerRecord,
    pub subscription: Subscription,
    pub owner_grant: AccessGrant,
    pub wallet_grant: AccessGrant,
}

impl AccessSnapshot {
    pub fn authorize(
        &self,
        program: &Key,
        provider: &Key,
        server_id: &Key,
        wallet: &Key,
        now: i64,
    ) -> Result<()> {
        let (server_key, server_bump) = pda(program, &[b"server", provider, server_id]);
        let (_, subscription_bump) = pda(program, &[b"subscription", &server_key]);
        let owner = self.server.owner_wallet;
        let (_, owner_bump) = pda(program, &[b"grant", &server_key, &owner]);
        let (_, wallet_bump) = pda(program, &[b"grant", &server_key, wallet]);
        ensure!(
            self.server.provider == *provider
                && self.server.server_id == *server_id
                && self.server.bump == server_bump,
            "server binding"
        );
        ensure!(self.server.enabled, "server disabled");
        ensure!(
            self.subscription.server == server_key
                && self.subscription.owner_wallet == owner
                && self.subscription.bump == subscription_bump,
            "subscription binding"
        );
        ensure!(self.subscription.paid_until > now, "subscription expired");
        for (grant, expected_wallet, bump) in [
            (&self.owner_grant, &owner, owner_bump),
            (&self.wallet_grant, wallet, wallet_bump),
        ] {
            ensure!(
                grant.server == server_key
                    && grant.wallet == *expected_wallet
                    && grant.bump == bump,
                "grant binding"
            );
            ensure!(
                grant.active && grant.valid_until > now,
                "grant inactive or expired"
            );
        }
        ensure!(
            self.owner_grant.grant_type == GrantType::Owner,
            "invalid owner role"
        );
        ensure!(
            self.wallet_grant.grant_type
                == if *wallet == owner {
                    GrantType::Owner
                } else {
                    GrantType::Delegated
                },
            "invalid wallet role"
        );
        Ok(())
    }
}

pub fn check_freshness(block_time: i64, now: i64) -> Result<()> {
    ensure!(
        block_time.abs_diff(now) <= 30,
        "stale or future RPC block time"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(wallet: Key) -> AccessSnapshot {
        let (server, bump) = pda(&[1; 32], &[b"server", &[2; 32], &[3; 32]]);
        let grant = |key| AccessGrant {
            server,
            wallet: key,
            grant_type: if key == [4; 32] {
                GrantType::Owner
            } else {
                GrantType::Delegated
            },
            active: true,
            valid_until: 101,
            bump: pda(&[1; 32], &[b"grant", &server, &key]).1,
        };
        AccessSnapshot {
            server: ServerRecord {
                provider: [2; 32],
                server_id: [3; 32],
                owner_wallet: [4; 32],
                treasury: [5; 32],
                price_lamports: 1,
                period_seconds: 90,
                enabled: true,
                bump,
            },
            subscription: Subscription {
                server,
                owner_wallet: [4; 32],
                paid_until: 101,
                bump: pda(&[1; 32], &[b"subscription", &server]).1,
            },
            owner_grant: grant([4; 32]),
            wallet_grant: grant(wallet),
        }
    }

    #[test]
    fn owner_delegate_and_denials() {
        for wallet in [[4; 32], [6; 32]] {
            let check =
                |s: &AccessSnapshot| s.authorize(&[1; 32], &[2; 32], &[3; 32], &wallet, 100);
            assert!(check(&snapshot(wallet)).is_ok());
            let changes: Vec<fn(&mut AccessSnapshot)> = vec![
                |s| s.server.enabled = false,
                |s| s.subscription.paid_until = 100,
                |s| s.owner_grant.active = false,
                |s| s.wallet_grant.active = false,
                |s| s.owner_grant.valid_until = 100,
                |s| s.wallet_grant.valid_until = 100,
                |s| s.server.provider = [9; 32],
                |s| s.subscription.owner_wallet = [9; 32],
                |s| s.wallet_grant.server = [9; 32],
                |s| s.wallet_grant.wallet = [9; 32],
                |s| s.server.bump ^= 1,
                |s| s.owner_grant.grant_type = GrantType::Delegated,
            ];
            for change in changes {
                let mut s = snapshot(wallet);
                change(&mut s);
                assert!(check(&s).is_err());
            }
        }
    }

    #[test]
    fn rejects_wrong_discriminator_truncated_or_trailing_data() {
        let bytes = encode(&snapshot([4; 32]).server);
        assert!(decode::<ServerRecord>(&bytes).is_ok());
        assert!(decode::<Subscription>(&bytes).is_err());
        assert!(decode::<ServerRecord>(&bytes[..bytes.len() - 1]).is_err());
        let mut extra = bytes;
        extra.push(0);
        assert!(decode::<ServerRecord>(&extra).is_err());
        assert!(check_freshness(70, 100).is_ok());
        assert!(check_freshness(69, 100).is_err());
        assert!(check_freshness(131, 100).is_err());
    }
}
