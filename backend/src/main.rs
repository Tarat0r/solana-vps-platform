use solana_auth_gateway::{dashboard::DashboardConfig, frontend::Frontend, router};
use std::{net::SocketAddr, path::PathBuf};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let token = std::env::var("SOLANA_GATEWAY_TOKEN")
        .map_err(|_| anyhow::anyhow!("SOLANA_GATEWAY_TOKEN is required"))?;
    let bind: SocketAddr = std::env::var("SOLANA_GATEWAY_BIND")
        .unwrap_or_else(|_| "127.0.0.1:3000".into())
        .parse()?;
    let directory = std::env::var_os("SOLANA_FRONTEND_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend/dist"));
    anyhow::ensure!(
        directory.join("index.html").is_file(),
        "Frontend build missing; build frontend/ or configure SOLANA_FRONTEND_DIR"
    );
    let mut frontend = Frontend::new(directory);
    if let Some(path) = std::env::var_os("SOLANA_DASHBOARD_CONFIG") {
        frontend = frontend.with_dashboard(DashboardConfig::load(path.as_ref())?)?;
    }
    let app = router(&token, frontend)?;
    let listener = tokio::net::TcpListener::bind(bind).await?;
    eprintln!(
        "Authentication gateway listening on {}",
        listener.local_addr()?
    );
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
