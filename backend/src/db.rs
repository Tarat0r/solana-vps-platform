use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::fs;
use std::path::Path;

pub async fn init_db(database_url: &str) -> Result<SqlitePool, sqlx::Error> {
    if let Some(path_str) = database_url.strip_prefix("sqlite://") {
        let clean_path = path_str.split('?').next().unwrap_or(path_str);
        if let Some(parent) = Path::new(clean_path).parent() {
            if !parent.as_os_str().is_empty() {
                let _ = fs::create_dir_all(parent);
            }
        }
    }

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await?;

    tracing::debug!("Ensuring SQLite database schema tables exist (orders, payment_attempts, delegates)");

    // Execute each DDL statement separately for reliable SQLite preparation
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS orders (
            order_id TEXT PRIMARY KEY,
            server_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            owner_wallet TEXT NOT NULL,
            region TEXT NOT NULL,
            status TEXT NOT NULL,
            price_lamports TEXT NOT NULL,
            period_days INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            paid_until TEXT,
            host TEXT,
            port INTEGER NOT NULL DEFAULT 22,
            username TEXT NOT NULL DEFAULT 'ubuntu',
            tx_hash TEXT,
            active_payment_id TEXT
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS payment_attempts (
            payment_id TEXT PRIMARY KEY,
            order_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            transaction_signature TEXT,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(order_id)
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS delegates (
            order_id TEXT NOT NULL,
            delegate_wallet TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (order_id, delegate_wallet),
            FOREIGN KEY (order_id) REFERENCES orders(order_id)
        );
        "#,
    )
    .execute(&pool)
    .await?;

    // Migrate any legacy mock wallet addresses to valid ed25519 demo public key
    let _ = sqlx::query(
        "UPDATE orders SET owner_wallet = '2iXtA8oeZqUU5pofxK971TCEvFGfems2AcDRaZHKD2pQ' WHERE owner_wallet = '8xP3kM9L71z4QvB9mK1xY2qT4L8z9QvB9mK1xY2q'",
    )
    .execute(&pool)
    .await;

    // Seed default demo orders if orders table is empty
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM orders")
        .fetch_one(&pool)
        .await
        .unwrap_or((0,));

    if count.0 == 0 {
        tracing::info!(seed_count = 3, "Database empty; seeding demo VPS orders and payment attempts");
        sqlx::query(
            r#"
            INSERT INTO orders (
                order_id, server_id, name, owner_wallet, region, status, price_lamports,
                period_days, created_at, paid_until, host, port, username, tx_hash, active_payment_id
            ) VALUES
            (
                'ord_active_01', 'srv_fra_01', 'vps-solana-validator-fra',
                '2iXtA8oeZqUU5pofxK971TCEvFGfems2AcDRaZHKD2pQ', 'Frankfurt (eu-central-1)',
                'ACTIVE', '50000000', 7, '2025-05-10T12:00:00Z', '2025-05-17T12:00:00Z',
                '185.220.101.42', 22, 'ubuntu', '5xK9MockSolanaTxHashActive11894a', 'pay_init_01'
            ),
            (
                'ord_pending_02', 'srv_ash_02', 'vps-rust-build-box',
                '2iXtA8oeZqUU5pofxK971TCEvFGfems2AcDRaZHKD2pQ', 'Ashburn (us-east-1)',
                'PAYMENT_PENDING', '50000000', 7, '2025-05-12T08:15:00Z', NULL,
                'TBD', 22, 'ubuntu', NULL, 'pay_init_02'
            ),
            (
                'ord_prov_03', 'srv_sg_03', 'vps-rpc-proxy-sg',
                '2iXtA8oeZqUU5pofxK971TCEvFGfems2AcDRaZHKD2pQ', 'Singapore (ap-southeast-1)',
                'PROVISIONING', '90000000', 14, '2025-05-12T09:40:00Z', NULL,
                '103.25.14.88', 22, 'ubuntu', '4h99SolanaTxConfirmProv771a', 'pay_init_03'
            )
            "#,
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO payment_attempts (payment_id, order_id, kind, transaction_signature, status, created_at)
            VALUES
            ('pay_init_01', 'ord_active_01', 'PURCHASE', '5xK9MockSolanaTxHashActive11894a', 'FINALIZED', '2025-05-10T12:00:00Z'),
            ('pay_init_02', 'ord_pending_02', 'PURCHASE', NULL, 'PENDING', '2025-05-12T08:15:00Z'),
            ('pay_init_03', 'ord_prov_03', 'PURCHASE', '4h99SolanaTxConfirmProv771a', 'CONFIRMED', '2025-05-12T09:40:00Z')
            "#,
        )
        .execute(&pool)
        .await?;
        tracing::info!("Seeding completed successfully");
    } else {
        tracing::debug!(existing_orders = count.0, "Database already initialized with records");
    }

    tracing::info!("Database ready");
    Ok(pool)
}
