use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use backend::{create_app, db::init_db, state::AppState};
use chrono::Utc;
use serde_json::{json, Value};

async fn spawn_test_app() -> (String, String, reqwest::Client) {
    let test_id = uuid::Uuid::new_v4().to_string().replace('-', "");
    let db_path = format!("/tmp/test_backend_{}.sqlite", test_id);
    let db_url = format!("sqlite://{}?mode=rwc", db_path);
    let pool = init_db(&db_url).await.expect("Failed to initialize test SQLite database");

    let state = AppState {
        db: pool,
        treasury_wallet: "DemoTreasury111111111111111111111111111111".to_string(),
        gateway_sessions: Arc::new(RwLock::new(HashMap::new())),
    };

    let app = create_app(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("Failed to bind ephemeral test port");
    let port = listener.local_addr().unwrap().port();
    let base_url = format!("http://127.0.0.1:{}", port);

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .expect("Failed to build reqwest client");

    (base_url, db_path, client)
}

fn cleanup_db(path: &str) {
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(format!("{}-wal", path));
    let _ = std::fs::remove_file(format!("{}-shm", path));
}

#[tokio::test]
async fn test_db_initial_seed_and_health() {
    let (base_url, db_path, client) = spawn_test_app().await;

    let res = client
        .get(format!("{}/api/orders", base_url))
        .send()
        .await
        .expect("Failed to send request");

    assert_eq!(res.status(), reqwest::StatusCode::OK);
    let orders: Vec<Value> = res.json().await.expect("Failed to parse orders json");
    assert!(!orders.is_empty(), "Database should contain seeded demo orders");
    assert!(orders.iter().any(|o| o["order_id"] == "ord_active_01"));

    cleanup_db(&db_path);
}

#[tokio::test]
async fn test_order_creation_retrieval_and_filter() {
    let (base_url, db_path, client) = spawn_test_app().await;

    let owner = "TestOwnerWallet11111111111111111111111111111";
    let create_payload = json!({
        "name": "validator-tokyo-01",
        "owner_wallet": owner,
        "region": "Tokyo (ap-northeast-1)",
        "period_days": 14,
        "price_lamports": "90000000"
    });

    // 1. Create order
    let res = client
        .post(format!("{}/api/orders", base_url))
        .json(&create_payload)
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), reqwest::StatusCode::CREATED);
    let created: Value = res.json().await.unwrap();
    let order_id = created["order_id"].as_str().unwrap().to_string();
    assert!(order_id.starts_with("ord_"));
    assert!(created["server_id"].as_str().unwrap().starts_with("srv_"));
    assert_eq!(created["status"], "PAYMENT_PENDING");
    assert_eq!(created["name"], "validator-tokyo-01");
    assert_eq!(created["owner_wallet"], owner);
    assert_eq!(created["port"], 22);
    assert_eq!(created["username"], "ubuntu");
    assert!(created["active_payment_id"].is_string());

    // 2. Retrieve order by ID
    let res = client
        .get(format!("{}/api/orders/{}", base_url, order_id))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::OK);
    let fetched: Value = res.json().await.unwrap();
    assert_eq!(fetched["order_id"], order_id);

    // 3. Filter orders by owner_wallet
    let res = client
        .get(format!("{}/api/orders?owner_wallet={}", base_url, owner))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::OK);
    let filtered: Vec<Value> = res.json().await.unwrap();
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0]["order_id"], order_id);

    // 4. Non-existent order returns 404
    let res = client
        .get(format!("{}/api/orders/non_existent_order_id", base_url))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::NOT_FOUND);

    cleanup_db(&db_path);
}

#[tokio::test]
async fn test_payment_verification_and_activation() {
    let (base_url, db_path, client) = spawn_test_app().await;

    // Create order
    let create_payload = json!({
        "name": "build-box",
        "owner_wallet": "Owner1111111111111111111111111111111111111111",
        "region": "Frankfurt (eu-central-1)",
        "period_days": 7,
        "price_lamports": "50000000"
    });
    let res = client
        .post(format!("{}/api/orders", base_url))
        .json(&create_payload)
        .send()
        .await
        .unwrap();
    let created: Value = res.json().await.unwrap();
    let order_id = created["order_id"].as_str().unwrap();

    // Verify payment
    let tx_hash = "5MockSolanaTxSignatureVerified111111111111111111111111";
    let pay_payload = json!({
        "tx_hash": tx_hash
    });
    let res = client
        .post(format!("{}/api/orders/{}/pay", base_url, order_id))
        .json(&pay_payload)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::OK);
    let pay_res: Value = res.json().await.unwrap();
    assert_eq!(pay_res["status"], "success");
    assert_eq!(pay_res["order_id"], order_id);
    assert_eq!(pay_res["host"], "185.220.101.42");
    assert!(pay_res["paid_until"].is_string());

    // Check order is ACTIVE
    let res = client
        .get(format!("{}/api/orders/{}", base_url, order_id))
        .send()
        .await
        .unwrap();
    let order: Value = res.json().await.unwrap();
    assert_eq!(order["status"], "ACTIVE");
    assert_eq!(order["tx_hash"], tx_hash);
    assert_eq!(order["host"], "185.220.101.42");

    // Check payment attempt is FINALIZED
    let res = client
        .get(format!("{}/api/orders/{}/payments", base_url, order_id))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::OK);
    let payments: Vec<Value> = res.json().await.unwrap();
    assert!(!payments.is_empty());
    assert_eq!(payments[0]["status"], "FINALIZED");
    assert_eq!(payments[0]["transaction_signature"], tx_hash);

    cleanup_db(&db_path);
}

#[tokio::test]
async fn test_order_renewal_flow() {
    let (base_url, db_path, client) = spawn_test_app().await;

    // Use seeded active order
    let order_id = "ord_active_01";

    let res = client
        .post(format!("{}/api/orders/{}/renew", base_url, order_id))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::CREATED);
    let renewal: Value = res.json().await.unwrap();
    assert_eq!(renewal["kind"], "RENEWAL");
    assert_eq!(renewal["status"], "PENDING");
    let renewal_payment_id = renewal["payment_id"].as_str().unwrap();

    // Verify order's active_payment_id updated
    let res = client
        .get(format!("{}/api/orders/{}", base_url, order_id))
        .send()
        .await
        .unwrap();
    let order: Value = res.json().await.unwrap();
    assert_eq!(order["active_payment_id"], renewal_payment_id);

    // List payments for order
    let res = client
        .get(format!("{}/api/orders/{}/payments", base_url, order_id))
        .send()
        .await
        .unwrap();
    let payments: Vec<Value> = res.json().await.unwrap();
    assert!(payments.iter().any(|p| p["payment_id"] == renewal_payment_id && p["kind"] == "RENEWAL"));

    cleanup_db(&db_path);
}

#[tokio::test]
async fn test_delegates_crud_operations() {
    let (base_url, db_path, client) = spawn_test_app().await;
    let order_id = "ord_active_01";
    let delegate_wallet = "DelegateWallet1111111111111111111111111111111";

    // 1. Add delegate
    let res = client
        .post(format!("{}/api/orders/{}/delegates", base_url, order_id))
        .json(&json!({ "delegate_wallet": delegate_wallet }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::CREATED);

    // 2. List delegates
    let res = client
        .get(format!("{}/api/orders/{}/delegates", base_url, order_id))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::OK);
    let delegates: Vec<Value> = res.json().await.unwrap();
    assert!(delegates.iter().any(|d| d["delegate_wallet"] == delegate_wallet));

    // 3. Remove delegate
    let res = client
        .delete(format!("{}/api/orders/{}/delegates/{}", base_url, order_id, delegate_wallet))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::OK);

    // 4. Verify removed
    let res = client
        .get(format!("{}/api/orders/{}/delegates", base_url, order_id))
        .send()
        .await
        .unwrap();
    let delegates: Vec<Value> = res.json().await.unwrap();
    assert!(!delegates.iter().any(|d| d["delegate_wallet"] == delegate_wallet));

    cleanup_db(&db_path);
}

#[tokio::test]
async fn test_order_challenge_respond() {
    let (base_url, db_path, client) = spawn_test_app().await;
    let order_id = "ord_active_01";

    // Get challenge
    let res = client
        .get(format!("{}/api/orders/{}/challenge", base_url, order_id))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::OK);
    let chal: Value = res.json().await.unwrap();
    assert_eq!(chal["order_id"], order_id);
    assert!(chal["challenge"].as_str().unwrap().contains("SOLANA-VPS-AUTH"));

    // Respond challenge
    let res = client
        .post(format!("{}/api/orders/{}/challenge/respond", base_url, order_id))
        .json(&json!({
            "wallet_pubkey": "WalletPubkey11111111111111111111111111111111",
            "signature": "MockSig111111111111111111111111111111111111111111"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::OK);
    let resp: Value = res.json().await.unwrap();
    assert_eq!(resp["status"], "authenticated");

    cleanup_db(&db_path);
}

#[tokio::test]
async fn test_gateway_v1_sessions_contracts() {
    let (base_url, db_path, client) = spawn_test_app().await;

    let session_id = "v1_test_session_abc123";
    let challenge_base64 = "VlBTLUFDQ0VTUy1BVVRILzEKY2x1c3Rlcj1sb2NhbG5ldA==";
    let expires_at = Utc::now().timestamp() + 90;

    // 1. Publish session (expect 201 Created)
    let publish_body = json!({
        "session_id": session_id,
        "challenge_base64": challenge_base64,
        "expires_at": expires_at
    });
    let res = client
        .post(format!("{}/v1/sessions", base_url))
        .json(&publish_body)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::CREATED);

    // 2. Reject duplicate session publication (expect 409 Conflict)
    let res = client
        .post(format!("{}/v1/sessions", base_url))
        .json(&publish_body)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::CONFLICT);

    // 3. Reject expired session publication (expect 400 Bad Request)
    let expired_body = json!({
        "session_id": "expired_session_001",
        "challenge_base64": challenge_base64,
        "expires_at": Utc::now().timestamp() - 10
    });
    let res = client
        .post(format!("{}/v1/sessions", base_url))
        .json(&expired_body)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::BAD_REQUEST);

    // 4. Retrieve session (expect 200 OK)
    let res = client
        .get(format!("{}/v1/sessions/{}", base_url, session_id))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::OK);
    let session: Value = res.json().await.unwrap();
    assert_eq!(session["session_id"], session_id);
    assert_eq!(session["challenge_base64"], challenge_base64);

    // 5. Poll response while pending (expect 204 No Content)
    let res = client
        .get(format!("{}/v1/sessions/{}/response", base_url, session_id))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::NO_CONTENT);

    // 6. Submit wallet signature response (expect 202 Accepted)
    let wallet = "SolanaWalletPubkey1111111111111111111111111111";
    let signature_base64 = "TW9ja1NpZ25hdHVyZUJhc2U2NEJ5dGVzMTExMTExMTExMTExMTE=";
    let res = client
        .post(format!("{}/v1/sessions/{}/response", base_url, session_id))
        .json(&json!({
            "wallet": wallet,
            "signature_base64": signature_base64
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::ACCEPTED);

    // 7. Duplicate response submission returns 409 Conflict
    let res = client
        .post(format!("{}/v1/sessions/{}/response", base_url, session_id))
        .json(&json!({
            "wallet": wallet,
            "signature_base64": signature_base64
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::CONFLICT);

    // 8. Poll response after submission (expect 200 OK with signed proof)
    let res = client
        .get(format!("{}/v1/sessions/{}/response", base_url, session_id))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::OK);
    let proof: Value = res.json().await.unwrap();
    assert_eq!(proof["wallet"], wallet);
    assert_eq!(proof["signature_base64"], signature_base64);

    // 9. Delete session (expect 204 No Content)
    let res = client
        .delete(format!("{}/v1/sessions/{}", base_url, session_id))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::NO_CONTENT);

    // 10. Subsequent retrieval returns 404 Not Found
    let res = client
        .get(format!("{}/v1/sessions/{}", base_url, session_id))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::NOT_FOUND);

    cleanup_db(&db_path);
}

#[tokio::test]
async fn test_gateway_legacy_challenge_routes() {
    let (base_url, db_path, client) = spawn_test_app().await;

    // Publish challenge via /api/gateway/challenges
    let res = client
        .post(format!("{}/api/gateway/challenges", base_url))
        .json(&json!({
            "server_id": "srv_fra_01",
            "unix_user": "ubuntu",
            "exact_challenge_bytes": "server_id=srv_fra_01\nunix_user=ubuntu\n"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::CREATED);
    let pub_res: Value = res.json().await.unwrap();
    let session_id = pub_res["session_id"].as_str().unwrap();
    assert!(pub_res["login_url"].as_str().unwrap().contains(session_id));

    // Get gateway challenge
    let res = client
        .get(format!("{}/api/gateway/challenges/{}", base_url, session_id))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::OK);
    let chal: Value = res.json().await.unwrap();
    assert_eq!(chal["status"], "PENDING");

    // Poll status pending
    let res = client
        .get(format!("{}/api/gateway/challenges/{}/poll", base_url, session_id))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::OK);
    let poll: Value = res.json().await.unwrap();
    assert_eq!(poll["status"], "PENDING");
    assert!(poll["signature"].is_null());

    // Respond signature
    let res = client
        .post(format!("{}/api/gateway/challenges/{}/respond", base_url, session_id))
        .json(&json!({
            "wallet_pubkey": "TestWalletPubkey1111111111111111111111111",
            "signature": "MockGatewaySig11111111111111111111111111111"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::OK);

    // Poll status submitted
    let res = client
        .get(format!("{}/api/gateway/challenges/{}/poll", base_url, session_id))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), reqwest::StatusCode::OK);
    let poll: Value = res.json().await.unwrap();
    assert_eq!(poll["status"], "SUBMITTED");
    assert_eq!(poll["wallet_pubkey"], "TestWalletPubkey1111111111111111111111111");

    cleanup_db(&db_path);
}
