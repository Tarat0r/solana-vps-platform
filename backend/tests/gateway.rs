#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a panic in a test helper fails the test"
)]
use auth_core::{unix_time, TTL_SECONDS_I64};
use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::Response,
    Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use solana_auth_gateway::{
    dashboard::{DashboardConfig, DashboardServer, MAX_SERVERS},
    frontend::Frontend,
    router,
};
use tempfile::TempDir;
use tower::ServiceExt;

const TOKEN: &str = "gateway-contract-test-token-00000001";

fn app() -> (Router, TempDir) {
    let directory = TempDir::new().unwrap();
    std::fs::create_dir(directory.path().join("assets")).unwrap();
    std::fs::write(
        directory.path().join("index.html"),
        "<html>Signing page</html>",
    )
    .unwrap();
    std::fs::write(directory.path().join("assets/app.js"), "console.log('app')").unwrap();
    (
        router(TOKEN, Frontend::new(directory.path())).unwrap(),
        directory,
    )
}

fn challenge(id: &str) -> Value {
    json!({"session_id": id, "challenge_base64": STANDARD.encode(b"exact bytes\n"), "expires_at": unix_time() + 90})
}

fn proof() -> Value {
    json!({"wallet": "1".repeat(32), "signature_base64": STANDARD.encode([0; 64])})
}

async fn request(
    app: &Router,
    method: &str,
    path: &str,
    body: Option<Value>,
    auth: bool,
    accept: Option<&str>,
) -> Response {
    let mut request = Request::builder().method(method).uri(path);
    if auth {
        request = request.header("Authorization", format!("Bearer {TOKEN}"));
    }
    if let Some(accept) = accept {
        request = request.header("Accept", accept);
    }
    let body = if let Some(body) = body {
        request = request.header("Content-Type", "application/json");
        Body::from(body.to_string())
    } else {
        Body::empty()
    };
    app.clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap()
}

async fn json_body(response: Response) -> Value {
    serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
}

#[tokio::test]
async fn immutable_proof_and_authenticated_lifecycle() {
    let (app, _directory) = app();
    let id = "ab".repeat(32);
    let path = format!("/v1/sessions/{id}");
    let published = challenge(&id);
    assert_eq!(
        request(
            &app,
            "POST",
            "/v1/sessions",
            Some(published.clone()),
            false,
            None
        )
        .await
        .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/v1/sessions",
            Some(published.clone()),
            true,
            None
        )
        .await
        .status(),
        StatusCode::CREATED
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/v1/sessions",
            Some(published.clone()),
            true,
            None
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
    let fetched = request(&app, "GET", &path, None, false, None).await;
    assert_eq!(fetched.headers()["cache-control"], "no-store");
    assert_eq!(fetched.headers()["vary"], "Accept");
    assert_eq!(json_body(fetched).await, published);
    let response_path = format!("{path}/response");
    assert_eq!(
        request(&app, "GET", &response_path, None, false, None)
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(&app, "GET", &response_path, None, true, None)
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
    let (first, second) = tokio::join!(
        request(&app, "POST", &response_path, Some(proof()), false, None),
        request(&app, "POST", &response_path, Some(proof()), false, None)
    );
    let mut statuses = [first.status().as_u16(), second.status().as_u16()];
    statuses.sort();
    assert_eq!(statuses, [202, 409]);
    assert_eq!(
        json_body(request(&app, "GET", &response_path, None, true, None).await).await,
        proof()
    );
    assert_eq!(
        request(&app, "DELETE", &path, None, false, None)
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(&app, "DELETE", &path, None, true, None)
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        request(&app, "GET", &path, None, false, None)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn content_negotiation_assets_and_missing_pages() {
    let (app, _directory) = app();
    let id = "cd".repeat(32);
    let path = format!("/v1/sessions/{id}");
    request(
        &app,
        "POST",
        "/v1/sessions",
        Some(challenge(&id)),
        true,
        None,
    )
    .await;
    for accept in [
        None,
        Some("*/*"),
        Some("application/json"),
        Some("text/html;q=0, */*"),
        Some("application/json, text/html;q=0.8"),
    ] {
        let response = request(&app, "GET", &path, None, false, accept).await;
        assert_eq!(response.headers()["content-type"], "application/json");
    }
    let html = request(
        &app,
        "GET",
        &path,
        None,
        false,
        Some("text/html, */*;q=0.8"),
    )
    .await;
    assert_eq!(html.status(), StatusCode::OK);
    assert!(html.headers()["content-type"]
        .to_str()
        .unwrap()
        .starts_with("text/html"));
    assert_eq!(html.headers()["referrer-policy"], "no-referrer");
    assert_eq!(
        request(&app, "GET", "/assets/app.js", None, false, None)
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        request(&app, "GET", "/assets/../index.html", None, false, None)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &app,
            "GET",
            "/v1/sessions/missing",
            None,
            false,
            Some("text/html")
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    for path in ["/_test/status", "/_test/scenario", "/rpc"] {
        assert_eq!(
            request(&app, "GET", path, None, true, None).await.status(),
            StatusCode::NOT_FOUND
        );
    }
}

#[tokio::test]
async fn publications_may_last_exactly_the_challenge_lifetime() {
    let (app, _directory) = app();
    let ttl = TTL_SECONDS_I64;
    // The server may read the clock a second later; allow it room on both sides.
    let mut full = challenge(&"a1".repeat(32));
    full["expires_at"] = json!(unix_time() + ttl);
    assert_eq!(
        request(&app, "POST", "/v1/sessions", Some(full), true, None)
            .await
            .status(),
        StatusCode::CREATED
    );
    let mut longer = challenge(&"a2".repeat(32));
    longer["expires_at"] = json!(unix_time() + ttl + 5);
    assert_eq!(
        request(&app, "POST", "/v1/sessions", Some(longer), true, None)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn expiry_validation_and_resource_bounds() {
    let (app, _directory) = app();
    let id = "ef".repeat(32);
    for invalid in [
        json!({"session_id": "invalid", "challenge_base64": "AA==", "expires_at": unix_time() + 90}),
        json!({"session_id": id, "challenge_base64": "!", "expires_at": unix_time() + 90}),
        json!({"session_id": id, "challenge_base64": "AA==", "expires_at": unix_time() - 1}),
        json!({"session_id": id, "challenge_base64": "AA==", "expires_at": unix_time() + 1000}),
        json!({"session_id": id, "challenge_base64": STANDARD.encode([0; 4097]), "expires_at": unix_time() + 90}),
    ] {
        assert_eq!(
            request(&app, "POST", "/v1/sessions", Some(invalid), true, None)
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    let mut expiring = challenge(&id);
    expiring["expires_at"] = json!(unix_time() + 1);
    assert_eq!(
        request(&app, "POST", "/v1/sessions", Some(expiring), true, None)
            .await
            .status(),
        StatusCode::CREATED
    );
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("/v1/sessions/{id}/response"),
            Some(json!({"wallet":"invalid", "signature_base64":"AA=="})),
            false,
            None
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    for (method, path, body, auth, accept) in [
        ("GET", format!("/v1/sessions/{id}"), None, false, None),
        (
            "GET",
            format!("/v1/sessions/{id}"),
            None,
            false,
            Some("text/html"),
        ),
        (
            "GET",
            format!("/v1/sessions/{id}/response"),
            None,
            true,
            None,
        ),
        (
            "POST",
            format!("/v1/sessions/{id}/response"),
            Some(proof()),
            false,
            None,
        ),
    ] {
        assert_eq!(
            request(&app, method, &path, body, auth, accept)
                .await
                .status(),
            StatusCode::GONE
        );
    }
    for number in 0..256 {
        assert_eq!(
            request(
                &app,
                "POST",
                "/v1/sessions",
                Some(challenge(&format!("{number:064x}"))),
                true,
                None
            )
            .await
            .status(),
            StatusCode::CREATED
        );
    }
    assert_eq!(
        request(
            &app,
            "POST",
            "/v1/sessions",
            Some(challenge(&"ff".repeat(32))),
            true,
            None
        )
        .await
        .status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(request(&app, "POST", "/v1/sessions", Some(json!({"session_id": id, "challenge_base64":"A".repeat(20_000), "expires_at": unix_time() + 90})), true, None).await.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert!(router("short", Frontend::new("unused")).is_err());
}

fn dashboard_config() -> DashboardConfig {
    DashboardConfig {
        cluster: "devnet".into(),
        rpc_url: "https://api.devnet.solana.com".into(),
        program_id: "1".repeat(32),
        provider_pubkey: "1".repeat(32),
        servers: vec![server("Server 1", "ab"), server("Server 2", "cd")],
    }
}

fn server(name: &str, id_byte: &str) -> DashboardServer {
    DashboardServer {
        name: name.into(),
        server_id: id_byte.repeat(32),
        unix_user: "ubuntu".into(),
        ssh_host: "vps.example.com".into(),
        ssh_port: 22,
    }
}

fn csp(response: &Response) -> String {
    response.headers()["content-security-policy"]
        .to_str()
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn dashboard_settings_and_rpc_origin_are_served_only_when_configured() {
    let (app, directory) = app();
    let missing = request(&app, "GET", "/v1/dashboard", None, false, None).await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    let page = request(&app, "GET", "/", None, false, Some("text/html")).await;
    assert!(csp(&page).contains("connect-src 'self';"));

    let frontend = Frontend::new(directory.path())
        .with_dashboard(dashboard_config())
        .unwrap();
    let app = router(TOKEN, frontend).unwrap();
    let served = request(&app, "GET", "/v1/dashboard", None, false, None).await;
    assert_eq!(served.status(), StatusCode::OK);
    assert_eq!(served.headers()["cache-control"], "no-store");
    assert_eq!(
        json_body(served).await,
        serde_json::to_value(dashboard_config()).unwrap()
    );
    let id = "ab".repeat(32);
    request(
        &app,
        "POST",
        "/v1/sessions",
        Some(challenge(&id)),
        true,
        None,
    )
    .await;
    for path in ["/".to_string(), format!("/v1/sessions/{id}")] {
        let page = request(&app, "GET", &path, None, false, Some("text/html")).await;
        assert!(csp(&page).contains("connect-src 'self' https://api.devnet.solana.com;"));
    }
}

#[test]
fn dashboard_config_rejects_unsafe_or_malformed_values() {
    assert!(dashboard_config().validate().is_ok());
    let mut local = dashboard_config();
    local.cluster = "localnet".into();
    local.rpc_url = "http://127.0.0.1:8899".into();
    assert_eq!(local.rpc_origin().unwrap(), "http://127.0.0.1:8899");

    let changes: Vec<fn(&mut DashboardConfig)> = vec![
        |c| c.cluster = "mainnet".into(),
        |c| c.rpc_url = "http://api.devnet.solana.com".into(),
        |c| c.rpc_url = "http://127.0.0.1:8899".into(),
        |c| c.rpc_url = "https://user:secret@rpc.example".into(),
        |c| c.rpc_url = "not a url".into(),
        |c| c.program_id = "not-a-key".into(),
        |c| c.provider_pubkey = "1".repeat(31),
        |c| c.servers.clear(),
        |c| c.servers = vec![server("Server", "ab"); MAX_SERVERS + 1],
        |c| c.servers[1].server_id = c.servers[0].server_id.clone(),
        |c| c.servers[1].server_id = "AB".repeat(32),
        |c| c.servers[1].name = String::new(),
        |c| c.servers[1].name = " padded".into(),
        |c| c.servers[1].name = "line\nbreak".into(),
        |c| c.servers[1].name = "x".repeat(65),
        |c| c.servers[1].unix_user = "root".into(),
        |c| c.servers[1].unix_user = "two words".into(),
        |c| c.servers[1].ssh_host = "-oProxyCommand=x".into(),
        |c| c.servers[1].ssh_host = "host name".into(),
        |c| c.servers[1].ssh_port = 0,
    ];
    for change in changes {
        let mut config = dashboard_config();
        change(&mut config);
        assert!(config.validate().is_err(), "{config:?}");
        assert!(Frontend::new("unused").with_dashboard(config).is_err());
    }

    let directory = TempDir::new().unwrap();
    let path = directory.path().join("dashboard.json");
    let mut value = serde_json::to_value(dashboard_config()).unwrap();
    std::fs::write(&path, value.to_string()).unwrap();
    assert!(DashboardConfig::load(&path).is_ok());
    value["gateway_token"] = json!("secrets do not belong here");
    std::fs::write(&path, value.to_string()).unwrap();
    assert!(DashboardConfig::load(&path).is_err());
    let mut value = serde_json::to_value(dashboard_config()).unwrap();
    value["servers"][0]["gateway_token"] = json!("nor here");
    std::fs::write(&path, value.to_string()).unwrap();
    assert!(DashboardConfig::load(&path).is_err());
}
