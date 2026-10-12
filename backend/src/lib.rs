pub mod db;
pub mod handlers;
pub mod models;
pub mod state;

use axum::{
    http::{header, HeaderValue, Method},
    routing::{delete, get, post},
    Router,
};
use tower_http::cors::CorsLayer;

use crate::handlers::{
    add_delegate, create_order, create_renewal_payment_attempt, delete_v1_session, get_challenge,
    get_gateway_challenge, get_order, get_v1_session, list_delegates, list_orders,
    list_payment_attempts, poll_gateway_session, poll_v1_response, publish_gateway_challenge,
    publish_v1_session, remove_delegate, respond_challenge, submit_gateway_signature,
    submit_v1_response, verify_payment,
};
use crate::state::AppState;

pub fn create_app(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost:3000".parse::<HeaderValue>().unwrap(),
            "http://127.0.0.1:3000".parse::<HeaderValue>().unwrap(),
        ])
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::ACCEPT,
            header::AUTHORIZATION,
        ]);

    Router::new()
        .route("/api/orders", post(create_order).get(list_orders))
        .route("/api/orders/{order_id}", get(get_order))
        .route("/api/orders/{order_id}/pay", post(verify_payment))
        .route("/api/orders/{order_id}/payments", get(list_payment_attempts))
        .route("/api/orders/{order_id}/renew", post(create_renewal_payment_attempt))
        .route("/api/orders/{order_id}/challenge", get(get_challenge))
        .route(
            "/api/orders/{order_id}/challenge/respond",
            post(respond_challenge),
        )
        .route(
            "/api/orders/{order_id}/delegates",
            post(add_delegate).get(list_delegates),
        )
        .route(
            "/api/orders/{order_id}/delegates/{delegate_wallet}",
            delete(remove_delegate),
        )
        // Auth Gateway Relay Routes (docs/diagrams/off-chain-components.puml & ssh-login.puml)
        .route("/api/gateway/challenges", post(publish_gateway_challenge))
        .route("/api/gateway/challenges/{session_id}", get(get_gateway_challenge))
        .route("/api/gateway/challenges/{session_id}/respond", post(submit_gateway_signature))
        .route("/api/gateway/challenges/{session_id}/poll", get(poll_gateway_session))
        // Standard v1 sessions routes matching CONTRACTS.md for pam_solana / solana-authd
        .route("/v1/sessions", post(publish_v1_session))
        .route("/v1/sessions/{session_id}", get(get_v1_session).delete(delete_v1_session))
        .route(
            "/v1/sessions/{session_id}/response",
            post(submit_v1_response).get(poll_v1_response),
        )
        .layer(cors)
        .with_state(state)
}
