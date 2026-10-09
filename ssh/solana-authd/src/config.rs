use anyhow::{ensure, Context, Result};
use auth_core::{challenge::Identity, hex32, pubkey};
use serde::Deserialize;
use std::{
    fs::OpenOptions,
    io::Read,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
};

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub cluster: String,
    pub rpc_url: String,
    pub program_id: String,
    pub provider_pubkey: String,
    pub server_id: String,
    pub unix_user: String,
    pub auth_gateway: String,
    pub auth_origin: String,
    pub gateway_token: String,
    pub commitment: String,
    pub challenge_ttl_seconds: u64,
    #[serde(default)]
    pub local_test: bool,
    #[serde(default = "default_socket")]
    pub socket_path: String,
}

fn default_socket() -> String {
    "/run/solana-authd.sock".into()
}

impl Config {
    pub fn load(path: &str) -> Result<Self> {
        let mut file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
            .context("open configuration")?;
        let meta = file.metadata()?;
        ensure!(
            meta.is_file() && meta.uid() == 0 && meta.mode() & 0o077 == 0 && meta.len() <= 16384,
            "configuration must be a root-owned regular file, mode 0600, at most 16 KiB"
        );
        let mut text = String::new();
        file.read_to_string(&mut text)?;
        let config: Self = toml::from_str(&text)
            .map_err(|_| anyhow::anyhow!("invalid configuration syntax or fields"))?;
        config.validate()?;
        Ok(config)
    }

    pub fn identity(&self) -> Identity {
        Identity {
            cluster: self.cluster.clone(),
            program_id: self.program_id.clone(),
            provider: self.provider_pubkey.clone(),
            server_id: self.server_id.clone(),
            unix_user: self.unix_user.clone(),
            auth_origin: self.auth_origin.clone(),
        }
    }

    pub fn validate(&self) -> Result<()> {
        self.identity().validate()?;
        ensure!(self.unix_user != "root", "root SSH login is not supported");
        ensure!(
            self.commitment == "finalized" && self.challenge_ttl_seconds == 90,
            "require finalized commitment and 90-second challenges"
        );
        ensure!(
            self.gateway_token.len() >= 32
                && self.gateway_token.len() <= 256
                && self.gateway_token.bytes().all(|b| b.is_ascii_graphic()),
            "invalid gateway token"
        );
        ensure!(
            !self.local_test || self.cluster == "localnet",
            "HTTP test mode requires localnet"
        );
        for value in [&self.auth_gateway, &self.auth_origin, &self.rpc_url] {
            let url = reqwest::Url::parse(value).context("invalid endpoint URL")?;
            ensure!(
                url.username().is_empty()
                    && url.password().is_none()
                    && url.query().is_none()
                    && url.fragment().is_none()
                    && url.host().is_some(),
                "endpoint must not contain credentials, query or fragment"
            );
            let loopback = url
                .host_str()
                .and_then(|host| {
                    host.trim_matches(['[', ']'])
                        .parse::<std::net::IpAddr>()
                        .ok()
                })
                .is_some_and(|ip| ip.is_loopback());
            ensure!(
                url.scheme() == "https" || (self.local_test && url.scheme() == "http" && loopback),
                "require HTTPS, or explicit loopback HTTP tests"
            );
            ensure!(
                url.path() == "/",
                "endpoint must be an origin without a path"
            );
        }
        ensure!(
            !self.auth_origin.ends_with('/'),
            "auth_origin must not end in slash"
        );
        ensure!(
            std::path::Path::new(&self.socket_path).is_absolute(),
            "socket must be absolute"
        );
        pubkey(&self.program_id)?;
        pubkey(&self.provider_pubkey)?;
        hex32(&self.server_id)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> Config {
        Config {
            cluster: "localnet".into(),
            rpc_url: "http://127.0.0.1:8899".into(),
            program_id: bs58::encode([1; 32]).into_string(),
            provider_pubkey: bs58::encode([2; 32]).into_string(),
            server_id: auth_core::hex(&[3; 32]),
            unix_user: "ubuntu".into(),
            auth_gateway: "http://127.0.0.1:8080".into(),
            auth_origin: "http://127.0.0.2:8080".into(),
            gateway_token: "a".repeat(32),
            commitment: "finalized".into(),
            challenge_ttl_seconds: 90,
            local_test: true,
            socket_path: default_socket(),
        }
    }

    #[test]
    fn insecure_endpoints_and_policy_overrides_are_rejected() {
        assert!(config().validate().is_ok());
        let changes: Vec<fn(&mut Config)> = vec![
            |c| c.local_test = false,
            |c| c.cluster = "devnet".into(),
            |c| c.commitment = "processed".into(),
            |c| c.challenge_ttl_seconds = 91,
            |c| c.unix_user = "root".into(),
            |c| c.auth_origin = "http://example.com".into(),
            |c| c.auth_gateway = "http://127.0.0.1@evil.example".into(),
            |c| c.auth_origin = "https://example.com/path".into(),
            |c| c.rpc_url = "https://example.com?secret=token".into(),
        ];
        for change in changes {
            let mut c = config();
            change(&mut c);
            assert!(c.validate().is_err());
        }
        let mut c = config();
        c.local_test = false;
        c.cluster = "devnet".into();
        c.auth_gateway = "https://auth.example".into();
        c.auth_origin = c.auth_gateway.clone();
        c.rpc_url = "https://api.devnet.solana.com".into();
        assert!(c.validate().is_ok());
    }
}
