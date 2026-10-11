use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use chrono::{Duration, Utc};
use serde_json::json;
use uuid::Uuid;

use crate::models::{
    AddDelegatePayload, ChallengeResponse, CreateOrderPayload, ListOrdersQuery,
    OrderStatus, PaymentAttempt, PaymentAttemptStatus, PaymentKind,
    RespondChallengePayload, VPSOrder, VerifyPaymentPayload,
};
use crate::state::AppState;

// POST /api/orders
pub async fn create_order(
    State(state): State<AppState>,
    Json(payload): Json<CreateOrderPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let order_id = format!("ord_{}", &Uuid::new_v4().to_string().replace('-', "")[..12]);
    let server_id = format!("srv_{}", &Uuid::new_v4().to_string().replace('-', "")[..16]);
    let payment_id = format!("pay_{}", &Uuid::new_v4().to_string().replace('-', "")[..16]);
    let created_at = Utc::now().to_rfc3339();
    let status = OrderStatus::PaymentPending.to_string();

    // Insert Order with server_id and active_payment_id
    sqlx::query(
        r#"
        INSERT INTO orders (order_id, server_id, name, owner_wallet, region,
            status, price_lamports, period_days, created_at, port, username, active_payment_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 22, 'ubuntu', ?)
        "#,
    )
    .bind(&order_id)
    .bind(&server_id)
    .bind(&payload.name)
    .bind(&payload.owner_wallet)
    .bind(&payload.region)
    .bind(&status)
    .bind(&payload.price_lamports)
    .bind(payload.period_days)
    .bind(&created_at)
    .bind(&payment_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Create initial PaymentAttempt (Purchase)
    let payment_status = PaymentAttemptStatus::Pending.to_string();
    let payment_kind = PaymentKind::Purchase.to_string();

    sqlx::query(
        r#"
        INSERT INTO payment_attempts (payment_id, order_id, kind, status, created_at)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(&payment_id)
    .bind(&order_id)
    .bind(&payment_kind)
    .bind(&payment_status)
    .bind(&created_at)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let order = VPSOrder {
        order_id,
        server_id,
        name: payload.name,
        owner_wallet: payload.owner_wallet,
        region: payload.region,
        status,
        price_lamports: payload.price_lamports,
        period_days: payload.period_days,
        created_at,
        paid_until: None,
        host: None,
        port: 22,
        username: "ubuntu".to_string(),
        tx_hash: None,
        active_payment_id: Some(payment_id),
    };

    Ok((StatusCode::CREATED, Json(order)))
}

// GET /api/orders
pub async fn list_orders(
    State(state): State<AppState>,
    Query(query): Query<ListOrdersQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let orders = if let Some(owner) = query.owner_wallet {
        sqlx::query_as::<_, VPSOrder>(
            "SELECT * FROM orders WHERE owner_wallet = ? ORDER BY created_at DESC",
        )
        .bind(owner)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as::<_, VPSOrder>("SELECT * FROM orders ORDER BY created_at DESC")
            .fetch_all(&state.db)
            .await
    }
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(orders))
}

// GET /api/orders/{order_id}
pub async fn get_order(
    State(state): State<AppState>,
    Path(order_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let order = sqlx::query_as::<_, VPSOrder>("SELECT * FROM orders WHERE order_id = ?")
        .bind(&order_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Order not found".to_string()))?;

    Ok(Json(order))
}

// POST /api/orders/{order_id}/pay
pub async fn verify_payment(
    State(state): State<AppState>,
    Path(order_id): Path<String>,
    Json(payload): Json<VerifyPaymentPayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let order = sqlx::query_as::<_, VPSOrder>("SELECT * FROM orders WHERE order_id = ?")
        .bind(&order_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Order not found".to_string()))?;

    let now = Utc::now();
    let paid_until = (now + Duration::days(order.period_days as i64)).to_rfc3339();
    let updated_status = OrderStatus::Active.to_string();
    let assigned_ip = "185.220.101.42";

    // Reconcile PaymentAttempt to FINALIZED
    let payment_id = payload.payment_id.or(order.active_payment_id.clone());
    if let Some(ref pid) = payment_id {
        sqlx::query(
            r#"
            UPDATE payment_attempts
            SET transaction_signature = ?, status = ?
            WHERE payment_id = ?
            "#,
        )
        .bind(&payload.tx_hash)
        .bind(PaymentAttemptStatus::Finalized.to_string())
        .bind(pid)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    // Update order status and assigned IP
    sqlx::query(
        r#"
        UPDATE orders
        SET status = ?, tx_hash = ?, paid_until = ?, host = ?
        WHERE order_id = ?
        "#,
    )
    .bind(&updated_status)
    .bind(&payload.tx_hash)
    .bind(&paid_until)
    .bind(assigned_ip)
    .bind(&order_id)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(json!({
        "status": "success",
        "order_id": order_id,
        "payment_id": payment_id,
        "paid_until": paid_until,
        "host": assigned_ip
    })))
}

// GET /api/orders/{order_id}/payments
pub async fn list_payment_attempts(
    State(state): State<AppState>,
    Path(order_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let payments = sqlx::query_as::<_, PaymentAttempt>(
        "SELECT * FROM payment_attempts WHERE order_id = ? ORDER BY created_at DESC",
    )
    .bind(&order_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(payments))
}

// POST /api/orders/{order_id}/renew
pub async fn create_renewal_payment_attempt(
    State(state): State<AppState>,
    Path(order_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let order = sqlx::query_as::<_, VPSOrder>("SELECT * FROM orders WHERE order_id = ?")
        .bind(&order_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Order not found".to_string()))?;

    let payment_id = format!("pay_{}", &Uuid::new_v4().to_string().replace('-', "")[..16]);
    let created_at = Utc::now().to_rfc3339();
    let payment_status = PaymentAttemptStatus::Pending.to_string();
    let payment_kind = PaymentKind::Renewal.to_string();

    sqlx::query(
        r#"
        INSERT INTO payment_attempts (payment_id, order_id, kind, status, created_at)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(&payment_id)
    .bind(&order.order_id)
    .bind(&payment_kind)
    .bind(&payment_status)
    .bind(&created_at)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("UPDATE orders SET active_payment_id = ? WHERE order_id = ?")
        .bind(&payment_id)
        .bind(&order_id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "order_id": order_id,
            "payment_id": payment_id,
            "kind": "RENEWAL",
            "status": "PENDING",
            "price_lamports": order.price_lamports,
            "created_at": created_at
        })),
    ))
}

// GET /api/orders/{order_id}/challenge
pub async fn get_challenge(
    Path(order_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let now = Utc::now();
    let expires = (now + Duration::minutes(5)).to_rfc3339();
    let challenge = format!(
        "SOLANA-VPS-AUTH: order={}, timestamp={}, nonce={}",
        order_id,
        now.timestamp(),
        Uuid::new_v4()
    );

    Ok(Json(ChallengeResponse {
        order_id,
        challenge,
        expires_at: expires,
    }))
}

// POST /api/orders/{order_id}/challenge/respond
pub async fn respond_challenge(
    Path(order_id): Path<String>,
    Json(payload): Json<RespondChallengePayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    Ok(Json(json!({
        "status": "authenticated",
        "order_id": order_id,
        "wallet": payload.wallet_pubkey
    })))
}

// POST /api/orders/{order_id}/delegates
pub async fn add_delegate(
    State(state): State<AppState>,
    Path(order_id): Path<String>,
    Json(payload): Json<AddDelegatePayload>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let created_at = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT OR IGNORE INTO delegates (order_id, delegate_wallet, created_at) VALUES (?, ?, ?)",
    )
    .bind(&order_id)
    .bind(&payload.delegate_wallet)
    .bind(created_at)
    .execute(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok((StatusCode::CREATED, Json(json!({ "status": "delegate_added" }))))
}

// DELETE /api/orders/{order_id}/delegates/{delegate_wallet}
pub async fn remove_delegate(
    State(state): State<AppState>,
    Path((order_id, delegate_wallet)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    sqlx::query("DELETE FROM delegates WHERE order_id = ? AND delegate_wallet = ?")
        .bind(&order_id)
        .bind(&delegate_wallet)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(json!({ "status": "delegate_removed" })))
}

// GET /api/orders/{order_id}/delegates
pub async fn list_delegates(
    State(state): State<AppState>,
    Path(order_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let delegates = sqlx::query_as::<_, crate::models::DelegateRecord>(
        "SELECT order_id, delegate_wallet, created_at FROM delegates WHERE order_id = ? ORDER BY created_at DESC",
    )
    .bind(&order_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(delegates))
}



// POST /api/gateway/challenges
// Called by solana-authd to publish a locally generated 90-second challenge session
pub async fn publish_gateway_challenge(
    State(state): State<AppState>,
    Json(payload): Json<crate::models::PublishGatewayChallengeRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let session_id = format!("ses_{}", &Uuid::new_v4().to_string().replace('-', "")[..16]);
    let now = Utc::now();
    let expires = (now + Duration::seconds(90)).to_rfc3339();

    let session = crate::state::GatewaySession {
        session_id: session_id.clone(),
        server_id: payload.server_id,
        unix_user: payload.unix_user,
        exact_challenge_bytes: payload.exact_challenge_bytes,
        challenge_base64: None,
        issued_at: now.to_rfc3339(),
        expires_at: expires.clone(),
        expires_at_unix: (now + Duration::seconds(90)).timestamp(),
        wallet_pubkey: None,
        signature: None,
        status: "PENDING".to_string(),
    };

    let mut sessions = state.gateway_sessions.write().await;
    sessions.insert(session_id.clone(), session);

    let login_url = format!("http://localhost:3000/auth?session_id={}", session_id);

    Ok((
        StatusCode::CREATED,
        Json(crate::models::PublishGatewayChallengeResponse {
            session_id,
            login_url,
            expires_at: expires,
        }),
    ))
}

// GET /api/gateway/challenges/{session_id}
// Called by Browser Wallet Portal to retrieve exact challenge bytes
pub async fn get_gateway_challenge(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let sessions = state.gateway_sessions.read().await;
    let session = sessions
        .get(&session_id)
        .ok_or((StatusCode::NOT_FOUND, "Challenge session not found".to_string()))?;

    // Check expiry
    if let Ok(expires_time) = chrono::DateTime::parse_from_rfc3339(&session.expires_at) {
        if Utc::now() > expires_time {
            return Err((StatusCode::GONE, "Challenge session has expired (TTL 90s)".to_string()));
        }
    }

    Ok(Json(crate::models::GetGatewayChallengeResponse {
        session_id: session.session_id.clone(),
        server_id: session.server_id.clone(),
        unix_user: session.unix_user.clone(),
        exact_challenge_bytes: session.exact_challenge_bytes.clone(),
        expires_at: session.expires_at.clone(),
        status: session.status.clone(),
    }))
}

// POST /api/gateway/challenges/{session_id}/respond
// Called by Browser Wallet Portal when user signs the challenge with Phantom/Solflare
pub async fn submit_gateway_signature(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(payload): Json<crate::models::SubmitGatewaySignatureRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let mut sessions = state.gateway_sessions.write().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or((StatusCode::NOT_FOUND, "Challenge session not found".to_string()))?;

    if session.status != "PENDING" {
        return Err((StatusCode::BAD_REQUEST, format!("Session is already {}", session.status)));
    }

    if let Ok(expires_time) = chrono::DateTime::parse_from_rfc3339(&session.expires_at) {
        if Utc::now() > expires_time {
            session.status = "EXPIRED".to_string();
            return Err((StatusCode::GONE, "Challenge session has expired".to_string()));
        }
    }

    session.wallet_pubkey = Some(payload.wallet_pubkey);
    session.signature = Some(payload.signature);
    session.status = "SUBMITTED".to_string();

    Ok(Json(json!({
        "session_id": session_id,
        "status": "SUBMITTED"
    })))
}

// GET /api/gateway/challenges/{session_id}/poll
// Called by solana-authd to poll for the signed response
pub async fn poll_gateway_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let sessions = state.gateway_sessions.read().await;
    let session = sessions
        .get(&session_id)
        .ok_or((StatusCode::NOT_FOUND, "Challenge session not found".to_string()))?;

    Ok(Json(crate::models::PollGatewayResponse {
        session_id: session.session_id.clone(),
        status: session.status.clone(),
        wallet_pubkey: session.wallet_pubkey.clone(),
        signature: session.signature.clone(),
    }))
}

// POST /v1/sessions
// Standard session publication called by solana-authd per CONTRACTS.md
pub async fn publish_v1_session(
    State(state): State<AppState>,
    Json(payload): Json<crate::models::PublishV1SessionRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    use base64::Engine;
    let now = Utc::now();
    let expires_at_unix = payload.expires_at;
    let expires = chrono::DateTime::from_timestamp(expires_at_unix, 0)
        .map(|t| t.to_rfc3339())
        .unwrap_or_else(|| (now + Duration::seconds(90)).to_rfc3339());

    let exact_bytes = match base64::engine::general_purpose::STANDARD.decode(&payload.challenge_base64) {
        Ok(bytes) => String::from_utf8(bytes).unwrap_or_else(|_| payload.challenge_base64.clone()),
        Err(_) => payload.challenge_base64.clone(),
    };

    let mut server_id = "srv_solana_vps".to_string();
    let mut unix_user = "ubuntu".to_string();
    for line in exact_bytes.lines() {
        if let Some(val) = line.strip_prefix("server_id=") {
            server_id = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("unix_user=") {
            unix_user = val.trim().to_string();
        }
    }

    let session = crate::state::GatewaySession {
        session_id: payload.session_id.clone(),
        server_id,
        unix_user,
        exact_challenge_bytes: exact_bytes,
        challenge_base64: Some(payload.challenge_base64),
        issued_at: now.to_rfc3339(),
        expires_at: expires,
        expires_at_unix,
        wallet_pubkey: None,
        signature: None,
        status: "PENDING".to_string(),
    };

    let mut sessions = state.gateway_sessions.write().await;
    sessions.insert(payload.session_id.clone(), session);

    Ok((StatusCode::CREATED, ()))
}

// GET /v1/sessions/{session_id}
// Standard session retrieval called by Web Portal per CONTRACTS.md
pub async fn get_v1_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    use base64::Engine;
    let sessions = state.gateway_sessions.read().await;
    let session = sessions
        .get(&session_id)
        .ok_or((StatusCode::NOT_FOUND, "Session not found".to_string()))?;

    if Utc::now().timestamp() > session.expires_at_unix {
        return Err((StatusCode::GONE, "Session expired".to_string()));
    }

    let challenge_base64 = session.challenge_base64.clone().unwrap_or_else(|| {
        base64::engine::general_purpose::STANDARD.encode(&session.exact_challenge_bytes)
    });

    Ok(Json(crate::models::GetV1SessionResponse {
        session_id: session.session_id.clone(),
        challenge_base64,
        expires_at: session.expires_at_unix,
    }))
}

// POST /v1/sessions/{session_id}/response
// Standard wallet proof submission called by Web Portal per CONTRACTS.md
pub async fn submit_v1_response(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(payload): Json<crate::models::SubmitV1ResponseRequest>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let mut sessions = state.gateway_sessions.write().await;
    let session = sessions
        .get_mut(&session_id)
        .ok_or((StatusCode::NOT_FOUND, "Session not found".to_string()))?;

    if session.status != "PENDING" {
        return Err((StatusCode::CONFLICT, "Session already responded".to_string()));
    }

    if Utc::now().timestamp() > session.expires_at_unix {
        session.status = "EXPIRED".to_string();
        return Err((StatusCode::GONE, "Session expired".to_string()));
    }

    session.wallet_pubkey = Some(payload.wallet);
    session.signature = Some(payload.signature_base64);
    session.status = "SUBMITTED".to_string();

    Ok((StatusCode::ACCEPTED, ()))
}

// GET /v1/sessions/{session_id}/response
// Standard polling called by solana-authd per CONTRACTS.md (204 if pending, 200 with proof when submitted)
pub async fn poll_v1_response(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let sessions = state.gateway_sessions.read().await;
    let session = sessions
        .get(&session_id)
        .ok_or((StatusCode::NOT_FOUND, "Session not found".to_string()))?;

    if session.status == "PENDING" {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }

    if session.status == "SUBMITTED" {
        if let (Some(wallet), Some(sig)) = (&session.wallet_pubkey, &session.signature) {
            return Ok((
                StatusCode::OK,
                Json(crate::models::V1SignedResponse {
                    wallet: wallet.clone(),
                    signature_base64: sig.clone(),
                }),
            )
                .into_response());
        }
    }

    Err((StatusCode::GONE, "Session expired or invalid".to_string()))
}

// DELETE /v1/sessions/{session_id}
// Standard session cleanup called by solana-authd per CONTRACTS.md
pub async fn delete_v1_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let mut sessions = state.gateway_sessions.write().await;
    sessions.remove(&session_id);
    Ok((StatusCode::NO_CONTENT, ()))
}

