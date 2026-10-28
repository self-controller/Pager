//! The HTTP apps: one shared API router, mounted behind the local listener's Host guard (3006) and
//! behind the remote listener's device gate (3007).

pub mod errors;
pub mod remote;
pub mod routes;
pub mod security;
pub mod sse;
pub mod static_files;

use crate::app::App;
use crate::errors::{invalid, AppError};
use crate::model::DeviceView;
use crate::Result;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::MethodRouter;
use axum::{Json, Router};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

/// Set by the remote listener: the paired device this request comes from. Never set on 3006.
#[derive(Clone, Debug)]
pub struct DeviceCtx(pub DeviceView);

/// Set by the iroh bridge: the phone this request came from, as the QUIC handshake proved it. Never
/// set on the loopback listeners, and never readable from a header.
#[derive(Clone, Debug)]
pub struct Peer {
    /// The phone's endpoint ID.
    pub endpoint_id: String,
    /// `ip:port` when the connection arrived directly, "relay" through a relay. Informational.
    pub addr: String,
}

/// The shared API router plus the names of the routes it registers ("GET /documents/:id"), so the
/// remote allowlist test can check every route was classified.
pub struct Api {
    pub router: Router<Arc<App>>,
    pub names: Vec<String>,
}

impl Api {
    pub fn new() -> Api {
        Api { router: Router::new(), names: Vec::new() }
    }

    pub fn add(mut self, method: &str, path: &str, mr: MethodRouter<Arc<App>>) -> Api {
        self.names.push(format!("{method} {path}"));
        self.router = self.router.route(&axum_path(path), mr);
        self
    }
}

impl Default for Api {
    fn default() -> Self {
        Api::new()
    }
}

/// `/documents/:id` → `/documents/{id}`.
pub fn axum_path(p: &str) -> String {
    p.split('/').map(|seg| if let Some(name) = seg.strip_prefix(':') { format!("{{{name}}}") } else { seg.to_string() }).collect::<Vec<_>>().join("/")
}

/// The shared API: system, library, files and sync routes, plus annotations, settings, the stream,
/// export, history. The remote listener puts its own gate in front of it.
pub fn api(app: &Arc<App>, remote: bool) -> Api {
    let mut api = Api::new();
    api = routes::system::mount(api, remote);
    api = routes::library::mount(api);
    api = routes::files::mount(api);
    api = routes::sync::mount(api);
    api = routes::remember::mount(api);
    api = routes::keep::mount(api);
    api.router = api.router.fallback(api_not_found);
    let _ = app;
    api
}

/// Every route the shared router registers, as "METHOD /path".
pub fn api_route_names(app: &Arc<App>) -> Vec<String> {
    api(app, false).names
}

async fn api_not_found() -> Response {
    AppError::new(404, "not_found", "There is nothing at that address.").into_response()
}

/// The HTTP app on the loopback port (3006): the shared API behind the Host and Origin guard, with
/// the device-management routes that exist here only, and the built web app.
pub fn local_app(app: &Arc<App>) -> Router {
    let shared = api(app, false).router;
    let own = routes::devices::router();
    let mut r = Router::new().nest("/api", own.merge(shared));
    if let Some(dir) = &app.web_dir {
        r = r.fallback(static_files::fallback(dir.clone()));
    } else {
        r = r.fallback(|| async { (StatusCode::NOT_FOUND, "Not found") });
    }
    r.layer(middleware::from_fn_with_state(app.clone(), security::local_only)).layer(middleware::map_response(errors::json_413)).with_state(app.clone())
}

// ---- Request helpers ----

/// Query parameters, decoded; the last value of a repeated key wins.
pub fn query(raw: &Option<String>) -> HashMap<String, String> {
    match raw {
        Some(q) => url::form_urlencoded::parse(q.as_bytes()).map(|(k, v)| (k.into_owned(), v.into_owned())).collect(),
        None => HashMap::new(),
    }
}

/// Parse a JSON object body or fail with invalid_request.
pub fn json_object(bytes: &Bytes) -> Result<Value> {
    let v: Value = serde_json::from_slice(bytes).map_err(|_| invalid("The request body should be JSON."))?;
    if !v.is_object() {
        return Err(invalid("The request body should be a JSON object."));
    }
    Ok(v)
}

pub fn json_array(bytes: &Bytes) -> Result<Value> {
    let v: Value = serde_json::from_slice(bytes).map_err(|_| invalid("The request body should be JSON."))?;
    if !v.is_array() {
        return Err(invalid("The request body should be a JSON array."));
    }
    Ok(v)
}

pub fn ok<T: Serialize>(v: T) -> Response {
    Json(v).into_response()
}

pub fn created<T: Serialize>(v: T) -> Response {
    (StatusCode::CREATED, Json(v)).into_response()
}

pub fn no_content() -> Response {
    StatusCode::NO_CONTENT.into_response()
}

pub fn opt_num(q: &HashMap<String, String>, key: &str) -> Option<i64> {
    q.get(key).and_then(|v| v.parse::<f64>().ok()).filter(|n| n.is_finite() && *n > 0.0).map(|n| n as i64)
}

pub fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

/// The handler's shared state, for routes that need the app without the core.
pub type AppState = State<Arc<App>>;
