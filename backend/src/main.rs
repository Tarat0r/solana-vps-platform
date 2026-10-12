use std::env;
use std::net::SocketAddr;

use backend::{create_app, db::init_db, state::AppState};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "backend=info,tower_http=info".into()),
        )
        .init();

    let db_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "sqlite://./solana-vps.sqlite?mode=rwc".to_string());
    let treasury_wallet = env::var("TREASURY_WALLET")
        .unwrap_or_else(|_| "DemoTreasury111111111111111111111111111111".to_string());
    let port: u16 = env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse()
        .unwrap_or(8080);

    tracing::info!(db_url = %db_url, "Initializing database");
    let pool = init_db(&db_url).await?;

    let state = AppState {
        db: pool,
        treasury_wallet: treasury_wallet.clone(),
        gateway_sessions: std::sync::Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
    };

    let app = create_app(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!(address = %addr, treasury = %treasury_wallet, "Backend server running");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
