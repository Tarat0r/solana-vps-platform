//! Non-secret owner dashboard settings, served to the browser as JSON.
use anyhow::{ensure, Context, Result};
use axum::http::Uri;
use serde::{Deserialize, Serialize};
use std::{net::IpAddr, path::Path};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DashboardConfig {
    pub cluster: String,
    pub rpc_url: String,
    pub program_id: String,
    pub provider_pubkey: String,
    /// The provider's servers for sale, each with its own daemon `server_id`.
    pub servers: Vec<DashboardServer>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DashboardServer {
    pub name: String,
    pub server_id: String,
    pub unix_user: String,
    pub ssh_host: String,
    pub ssh_port: u16,
}

pub const MAX_SERVERS: usize = 16;

impl DashboardConfig {
    pub fn load(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path)
            .with_context(|| format!("read dashboard configuration {}", path.display()))?;
        let config: Self =
            serde_json::from_str(&text).context("invalid dashboard configuration fields")?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<()> {
        ensure!(
            ["localnet", "devnet", "testnet", "mainnet-beta"].contains(&self.cluster.as_str()),
            "unknown cluster"
        );
        auth_core::pubkey(&self.program_id).context("invalid program_id")?;
        auth_core::pubkey(&self.provider_pubkey).context("invalid provider_pubkey")?;
        ensure!(
            (1..=MAX_SERVERS).contains(&self.servers.len()),
            "list 1 to {MAX_SERVERS} servers"
        );
        for (index, server) in self.servers.iter().enumerate() {
            server
                .validate()
                .with_context(|| format!("servers[{index}]"))?;
            ensure!(
                self.servers[..index]
                    .iter()
                    .all(|other| other.server_id != server.server_id),
                "servers[{index}] repeats a server_id"
            );
        }
        self.rpc_origin()?;
        Ok(())
    }

    /// The RPC origin pages may contact: HTTPS, or loopback HTTP on localnet.
    pub fn rpc_origin(&self) -> Result<String> {
        let uri: Uri = self.rpc_url.parse().context("invalid rpc_url")?;
        let authority = uri.authority().context("rpc_url needs a host")?;
        ensure!(
            !authority.as_str().contains('@'),
            "rpc_url must not contain credentials"
        );
        let host = authority.host().trim_matches(['[', ']']);
        let loopback =
            host == "localhost" || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback());
        let scheme = uri.scheme_str().unwrap_or_default();
        ensure!(
            scheme == "https" || (scheme == "http" && loopback && self.cluster == "localnet"),
            "rpc_url must use HTTPS, or loopback HTTP on localnet"
        );
        Ok(format!("{scheme}://{authority}"))
    }
}

impl DashboardServer {
    fn validate(&self) -> Result<()> {
        ensure!(
            (1..=64).contains(&self.name.chars().count())
                && self.name.trim() == self.name
                && !self.name.chars().any(char::is_control),
            "name must be 1 to 64 characters without control characters"
        );
        ensure!(
            self.server_id.len() == 64
                && self
                    .server_id
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
            "server_id must be 64 lowercase hex characters"
        );
        ensure!(
            (1..=32).contains(&self.unix_user.len())
                && self
                    .unix_user
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                && self.unix_user != "root",
            "invalid unix_user"
        );
        ensure!(
            (1..=253).contains(&self.ssh_host.len())
                && !self.ssh_host.starts_with('-')
                && self
                    .ssh_host
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b".-:".contains(&b))
                && self.ssh_port != 0,
            "invalid SSH host or port"
        );
        Ok(())
    }
}
