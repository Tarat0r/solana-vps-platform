use anyhow::{ensure, Result};
use auth_core::{
    accounts::{self, AccessGrant, AccessSnapshot, Account, ServerRecord, Subscription},
    hex32, pubkey,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::config::Config;

pub async fn bounded_json<T: DeserializeOwned>(mut response: reqwest::Response) -> Result<T> {
    response.error_for_status_ref()?;
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        ensure!(data.len() + chunk.len() <= 65536, "HTTP response too large");
        data.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&data)?)
}

async fn rpc(
    client: &reqwest::Client,
    config: &Config,
    method: &str,
    params: Value,
) -> Result<Value> {
    let reply: Value = bounded_json(
        client
            .post(&config.rpc_url)
            .json(&json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}))
            .send()
            .await?,
    )
    .await?;
    ensure!(
        reply.get("error").is_none() && reply["jsonrpc"] == "2.0" && reply["id"] == 1,
        "RPC error or invalid envelope"
    );
    reply
        .get("result")
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("missing RPC result"))
}

fn account<T: Account>(value: &Value, program: &str) -> Result<T> {
    ensure!(
        value["owner"].as_str() == Some(program)
            && value["executable"].as_bool() == Some(false)
            && value["lamports"].as_u64().is_some_and(|n| n > 0),
        "invalid account metadata"
    );
    let data = value["data"]
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("invalid account data"))?;
    ensure!(
        data.len() == 2 && data[1] == "base64",
        "invalid account encoding"
    );
    accounts::decode(
        &STANDARD.decode(
            data[0]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("invalid account data"))?,
        )?,
    )
}

pub async fn read_access(
    client: &reqwest::Client,
    config: &Config,
    wallet: &[u8; 32],
) -> Result<AccessSnapshot> {
    let program = pubkey(&config.program_id)?;
    let provider = pubkey(&config.provider_pubkey)?;
    let server_id = hex32(&config.server_id)?;
    let (server_key, bump) = accounts::pda(&program, &[b"server", &provider, &server_id]);
    let key_string = |key: [u8; 32]| bs58::encode(key).into_string();
    let discovered = rpc(
        client,
        config,
        "getAccountInfo",
        json!([key_string(server_key), {"encoding":"base64","commitment":"finalized"}]),
    )
    .await?;
    let slot = discovered["context"]["slot"]
        .as_u64()
        .ok_or_else(|| anyhow::anyhow!("missing context slot"))?;
    let server: ServerRecord = account(&discovered["value"], &config.program_id)?;
    ensure!(
        server.provider == provider && server.server_id == server_id && server.bump == bump,
        "discovery binding"
    );
    let owner = server.owner_wallet;
    let keys = [
        server_key,
        accounts::pda(&program, &[b"subscription", &server_key]).0,
        accounts::pda(&program, &[b"grant", &server_key, &owner]).0,
        accounts::pda(&program, &[b"grant", &server_key, wallet]).0,
    ];
    let combined = rpc(client, config, "getMultipleAccounts", json!([keys.map(key_string), {"encoding":"base64","commitment":"finalized","minContextSlot":slot}])).await?;
    let combined_slot = combined["context"]["slot"]
        .as_u64()
        .ok_or_else(|| anyhow::anyhow!("missing combined slot"))?;
    ensure!(combined_slot >= slot, "RPC context rollback");
    let values = combined["value"]
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("missing accounts"))?;
    ensure!(values.len() == 4, "incorrect account count");
    let snapshot = AccessSnapshot {
        server: account::<ServerRecord>(&values[0], &config.program_id)?,
        subscription: account::<Subscription>(&values[1], &config.program_id)?,
        owner_grant: account::<AccessGrant>(&values[2], &config.program_id)?,
        wallet_grant: account::<AccessGrant>(&values[3], &config.program_id)?,
    };
    ensure!(
        snapshot.server.owner_wallet == owner,
        "owner changed during discovery"
    );
    let block_time = rpc(client, config, "getBlockTime", json!([combined_slot]))
        .await?
        .as_i64()
        .ok_or_else(|| anyhow::anyhow!("missing block time"))?;
    accounts::check_freshness(block_time, auth_core::unix_time())?;
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_or_invalid_rpc_metadata_is_rejected() {
        for value in [
            Value::Null,
            json!({"owner":"p","executable":true,"lamports":1,"data":["", "base64"]}),
            json!({"owner":"wrong","executable":false,"lamports":1,"data":["", "base64"]}),
        ] {
            assert!(account::<ServerRecord>(&value, "p").is_err());
        }
    }
}
