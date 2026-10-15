//! End to end on solana-test-validator: provider.sh registers the server, the
//! owner pays and delegates, and the daemon's own RPC reader decides logins from
//! finalized state. Needs `npm ci` and `npm run build` in programs/; run with
//! `npm run test:daemon`. Finalization makes it take about a minute.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::arithmetic_side_effects,
    reason = "a panic in a test helper fails the test"
)]
use anchor_lang::{
    prelude::Pubkey, solana_program::instruction::Instruction, system_program, InstructionData,
    ToAccountMetas,
};
use auth_core::{hex, hex32, pubkey, unix_time};
use base64::{engine::general_purpose::STANDARD, Engine};
use billing_access::{accounts, instruction, ID};
use serde_json::{json, Value};
use solana_authd::{config::Config, rpc::read_access};
use solana_hash::Hash;
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::{
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::Duration,
};
use tokio::time::sleep;

const RPC_PORT: u16 = 28899;
const SERVER_ID: [u8; 32] = [0xa5; 32];
const PRICE: u64 = 1_000_000;
const PERIOD: i64 = 30 * 24 * 60 * 60;

fn programs_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &ID).0
}

struct Validator {
    child: Child,
    dir: PathBuf,
}

impl Validator {
    fn start(dir: &Path) -> Self {
        for port in [RPC_PORT, RPC_PORT + 1, 28001, 29900] {
            TcpListener::bind(("127.0.0.1", port))
                .unwrap_or_else(|_| panic!("port {port} is in use"));
        }
        let program = programs_dir().join("target/deploy/billing_access.so");
        let child = Command::new("solana-test-validator")
            .arg("--ledger")
            .arg(dir.join("ledger"))
            .args(["--reset", "--quiet", "--bind-address", "127.0.0.1"])
            .args([
                "--rpc-port",
                &RPC_PORT.to_string(),
                "--faucet-port",
                "29900",
            ])
            .args([
                "--gossip-port",
                "28001",
                "--dynamic-port-range",
                "28100-28200",
            ])
            .args(["--upgradeable-program", &ID.to_string()])
            .arg(program)
            .arg("none")
            .stdout(Stdio::null())
            .spawn()
            .expect("solana-test-validator must be on PATH");
        Self {
            child,
            dir: dir.to_path_buf(),
        }
    }
}

impl Drop for Validator {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

struct Rpc {
    http: reqwest::Client,
    url: String,
}

impl Rpc {
    async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let body = json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params});
        let reply: Value = self
            .http
            .post(&self.url)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        match reply.get("error") {
            Some(error) => Err(format!("{method}: {error}")),
            None => Ok(reply["result"].clone()),
        }
    }

    async fn wait_healthy(&self, validator: &mut Validator) {
        for _ in 0..600 {
            assert!(
                validator.child.try_wait().unwrap().is_none(),
                "solana-test-validator exited"
            );
            if self.call("getHealth", json!([])).await == Ok(json!("ok")) {
                return;
            }
            sleep(Duration::from_millis(100)).await;
        }
        panic!("validator startup timeout");
    }

    /// Waits until `signature` succeeds at `level` ("confirmed" or "finalized").
    async fn wait(&self, signature: &str, level: &str) {
        for _ in 0..600 {
            let params = json!([[signature], {"searchTransactionHistory": true}]);
            let statuses = self.call("getSignatureStatuses", params).await.unwrap();
            let status = &statuses["value"][0];
            if !status.is_null() {
                assert!(status["err"].is_null(), "{signature} failed: {status}");
                let reached = status["confirmationStatus"].as_str();
                if reached == Some("finalized") || reached == Some(level) {
                    return;
                }
            }
            sleep(Duration::from_millis(100)).await;
        }
        panic!("{signature} did not reach {level}");
    }

    async fn airdrop(&self, key: &Pubkey) {
        let params = json!([key.to_string(), 10_000_000_000u64]);
        let signature = self.call("requestAirdrop", params).await.unwrap();
        self.wait(signature.as_str().unwrap(), "confirmed").await;
    }

    async fn send(
        &self,
        signer: &Keypair,
        accounts: impl ToAccountMetas,
        args: impl InstructionData,
    ) -> String {
        let ix = Instruction {
            program_id: ID,
            accounts: accounts.to_account_metas(None),
            data: args.data(),
        };
        let latest = self
            .call("getLatestBlockhash", json!([{"commitment": "confirmed"}]))
            .await
            .unwrap();
        let blockhash: Hash = latest["value"]["blockhash"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();
        let tx =
            Transaction::new_signed_with_payer(&[ix], Some(&signer.pubkey()), &[signer], blockhash);
        let wire = STANDARD.encode(bincode::serialize(&tx).unwrap());
        let params = json!([wire, {"encoding": "base64", "preflightCommitment": "confirmed"}]);
        let signature = self.call("sendTransaction", params).await.unwrap();
        let signature = signature.as_str().unwrap().to_string();
        self.wait(&signature, "confirmed").await;
        signature
    }
}

/// Runs provider.sh without a prompt and returns its final JSON state.
async fn provider_sh(keypair: &Path, args: &[&str]) -> Value {
    let output = tokio::process::Command::new(programs_dir().join("scripts/provider.sh"))
        .args(args)
        .args([
            "--url",
            &format!("http://127.0.0.1:{RPC_PORT}"),
            "--keypair",
        ])
        .arg(keypair)
        .args(["--server-id", &hex(&SERVER_ID), "--yes"])
        .output()
        .await
        .unwrap();
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(
        output.status.success(),
        "provider.sh failed: {stdout}{}",
        String::from_utf8_lossy(&output.stderr)
    );
    // The script prints the state before and after the transaction.
    let last = stdout.rfind("\n{").map_or(0, |index| index + 1);
    serde_json::from_str(&stdout[last..]).unwrap()
}

/// The daemon's decision for `wallet`, as in solana-authd's session handler.
async fn decide(http: &reqwest::Client, config: &Config, wallet: &Pubkey) -> Result<(), String> {
    let wallet = wallet.to_bytes();
    let snapshot = read_access(http, config, &wallet)
        .await
        .map_err(|e| format!("{e:#}"))?;
    snapshot
        .authorize(
            &pubkey(&config.program_id).unwrap(),
            &pubkey(&config.provider_pubkey).unwrap(),
            &hex32(&config.server_id).unwrap(),
            &wallet,
            unix_time(),
        )
        .map_err(|e| e.to_string())
}

fn assert_denied(result: Result<(), String>, reason: &str) {
    let error = result.expect_err("login should be denied");
    assert!(error.contains(reason), "expected {reason}, got {error}");
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "starts solana-test-validator; run with `npm run test:daemon`"]
async fn daemon_authorizes_from_finalized_program_state() {
    let programs = programs_dir();
    assert!(
        programs.join("target/deploy/billing_access.so").exists(),
        "run `npm run build` in programs/ first"
    );
    assert!(
        programs.join("node_modules/@solana/kit").exists(),
        "run `npm ci` in programs/ first"
    );
    let dir = std::env::temp_dir().join(format!("billing-access-daemon-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut validator = Validator::start(&dir);
    let rpc = Rpc {
        http: reqwest::Client::new(),
        url: format!("http://127.0.0.1:{RPC_PORT}"),
    };
    rpc.wait_healthy(&mut validator).await;

    let (provider, owner, delegate) = (Keypair::new(), Keypair::new(), Keypair::new());
    let treasury = Keypair::new().pubkey();
    rpc.airdrop(&provider.pubkey()).await;
    rpc.airdrop(&owner.pubkey()).await;
    let keypair = dir.join("provider.json");
    std::fs::write(
        &keypair,
        serde_json::to_string(&provider.to_bytes().to_vec()).unwrap(),
    )
    .unwrap();

    let registered = provider_sh(
        &keypair,
        &[
            "register",
            "--treasury",
            &treasury.to_string(),
            "--price-lamports",
            &PRICE.to_string(),
            "--period-seconds",
            &PERIOD.to_string(),
        ],
    )
    .await;
    // The script derives the same server address as the contract.
    let server = pda(&[b"server", provider.pubkey().as_ref(), &SERVER_ID]);
    assert_eq!(registered["server"], json!(server.to_string()));
    assert_eq!(registered["paidUntil"], json!("0"));

    let subscription = pda(&[b"subscription", server.as_ref()]);
    let owner_grant = pda(&[b"grant", server.as_ref(), owner.pubkey().as_ref()]);
    let purchase = accounts::PurchaseAccess {
        buyer: owner.pubkey(),
        server,
        subscription,
        owner_grant,
        receipt: pda(&[b"payment", server.as_ref(), &[1; 32]]),
        treasury,
        system_program: system_program::ID,
    };
    let args = instruction::PurchaseAccess {
        payment_id: [1; 32],
    };
    rpc.send(&owner, purchase, args).await;
    let delegate_grant = pda(&[b"grant", server.as_ref(), delegate.pubkey().as_ref()]);
    let grant = accounts::GrantDelegatedAccess {
        owner: owner.pubkey(),
        server,
        subscription,
        owner_grant,
        grant: delegate_grant,
        system_program: system_program::ID,
    };
    let args = instruction::GrantDelegatedAccess {
        wallet: delegate.pubkey(),
        valid_until: unix_time() + 3600,
    };
    let signature = rpc.send(&owner, grant, args).await;
    rpc.wait(&signature, "finalized").await;

    let config = Config {
        cluster: "localnet".into(),
        rpc_url: rpc.url.clone(),
        program_id: ID.to_string(),
        provider_pubkey: provider.pubkey().to_string(),
        server_id: hex(&SERVER_ID),
        unix_user: "ubuntu".into(),
        auth_gateway: "http://127.0.0.1:8080".into(),
        auth_origin: "http://127.0.0.1:8080".into(),
        gateway_token: "t".repeat(32),
        commitment: "finalized".into(),
        challenge_ttl_seconds: auth_core::TTL_SECONDS,
        local_test: true,
        local_test_lan_http: false,
        socket_path: "/run/solana-authd.sock".into(),
    };
    config.validate().unwrap();
    let http = reqwest::Client::new();
    decide(&http, &config, &owner.pubkey()).await.unwrap();
    decide(&http, &config, &delegate.pubkey()).await.unwrap();
    let stranger = Keypair::new().pubkey();
    assert_denied(
        decide(&http, &config, &stranger).await,
        "invalid account metadata",
    );

    let revoke = accounts::RevokeDelegatedAccess {
        owner: owner.pubkey(),
        server,
        subscription,
        owner_grant,
        grant: delegate_grant,
    };
    let args = instruction::RevokeDelegatedAccess {
        wallet: delegate.pubkey(),
    };
    let signature = rpc.send(&owner, revoke, args).await;
    rpc.wait(&signature, "finalized").await;
    assert_denied(
        decide(&http, &config, &delegate.pubkey()).await,
        "grant inactive or expired",
    );
    decide(&http, &config, &owner.pubkey()).await.unwrap();

    let disabled = provider_sh(&keypair, &["disable"]).await;
    assert_eq!(disabled["record"]["enabled"], json!(false));
    rpc.wait(disabled["signature"].as_str().unwrap(), "finalized")
        .await;
    assert_denied(
        decide(&http, &config, &owner.pubkey()).await,
        "server disabled",
    );
}
