//! Shared HTML/static serving for the real gateway and the VM fixture.
use crate::dashboard::DashboardConfig;
use axum::{
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::get,
    Json, Router,
};
use std::{path::PathBuf, sync::Arc};
use tower_http::services::ServeDir;

/// The pages' Content-Security-Policy, with `$connect_src` as its connect-src.
macro_rules! content_security_policy {
    ($connect_src:expr) => {
        concat!("default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src ", $connect_src, "; frame-src https://connect.solflare.com; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
    };
}

#[derive(Clone)]
pub struct Frontend {
    directory: PathBuf,
    dashboard: Option<Arc<DashboardConfig>>,
    content_security_policy: HeaderValue,
}

impl Frontend {
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
            dashboard: None,
            content_security_policy: HeaderValue::from_static(content_security_policy!("'self'")),
        }
    }

    /// Serves the owner dashboard settings and lets pages reach its RPC origin.
    pub fn with_dashboard(mut self, config: DashboardConfig) -> anyhow::Result<Self> {
        config.validate()?;
        self.content_security_policy = HeaderValue::try_from(format!(
            content_security_policy!("'self' {}"),
            config.rpc_origin()?
        ))?;
        self.dashboard = Some(Arc::new(config));
        Ok(self)
    }

    pub async fn page(&self, status: StatusCode) -> Response {
        let mut response = match tokio::fs::read_to_string(self.directory.join("index.html")).await {
            Ok(html) => (status, Html(html)).into_response(),
            Err(_) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "The signing page is unavailable. Ask the server operator to install the frontend build.",
            )
                .into_response(),
        };
        let headers = response.headers_mut();
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        headers.insert(
            header::REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        );
        headers.insert(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        );
        headers.insert(
            header::CONTENT_SECURITY_POLICY,
            self.content_security_policy.clone(),
        );
        response
    }

    pub fn routes(&self) -> Router {
        let frontend = self.clone();
        let dashboard = self.dashboard.clone();
        Router::new()
            .route(
                "/",
                get(move || {
                    let frontend = frontend.clone();
                    async move { frontend.page(StatusCode::OK).await }
                }),
            )
            .route(
                "/v1/dashboard",
                get(move || {
                    let dashboard = dashboard.clone();
                    async move {
                        let mut response = match dashboard {
                            Some(config) => Json(config.as_ref().clone()).into_response(),
                            None => StatusCode::NOT_FOUND.into_response(),
                        };
                        response
                            .headers_mut()
                            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
                        response
                    }
                }),
            )
            .nest_service("/assets", ServeDir::new(self.directory.join("assets")))
    }
}

/// Only an explicit HTML preference triggers the page. Wildcards stay JSON.
pub fn wants_html(headers: &HeaderMap) -> bool {
    let mut html = 0.0_f32;
    let mut json = 0.0_f32;
    for value in headers.get_all(header::ACCEPT) {
        let Ok(value) = value.to_str() else {
            continue;
        };
        for range in value.split(',') {
            let mut parts = range.trim().split(';');
            let mime = parts.next().unwrap_or("").trim();
            let mut quality = 1.0_f32;
            for parameter in parts {
                if let Some((key, value)) = parameter.trim().split_once('=') {
                    if key.trim().eq_ignore_ascii_case("q") {
                        quality = value.trim().parse().unwrap_or(0.0);
                    }
                }
            }
            if !(0.0..=1.0).contains(&quality) {
                quality = 0.0;
            }
            if mime.eq_ignore_ascii_case("text/html") {
                html = html.max(quality);
            } else if mime.eq_ignore_ascii_case("application/json") {
                json = json.max(quality);
            }
        }
    }
    html > json
}

pub fn session_headers(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
        .headers_mut()
        .insert(header::VARY, HeaderValue::from_static("Accept"));
    response.headers_mut().insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    response
}
