#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let path = args
        .next()
        .unwrap_or_else(|| "/etc/solana-auth/server.toml".into());
    anyhow::ensure!(args.next().is_none(), "usage: solana-authd [server.toml]");
    solana_authd::serve(solana_authd::config::Config::load(&path)?).await
}
