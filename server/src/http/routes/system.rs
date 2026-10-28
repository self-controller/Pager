use crate::app::App;
use crate::config::{API_VERSION, VERSION};
use crate::core::Notice;
use crate::errors::not_found;
use crate::http::{ok, Api};
use crate::library::assets::content_type_of;
use crate::model::{Health, HealthRemote};
use crate::Result;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use std::sync::Arc;

pub fn mount(api: Api, remote: bool) -> Api {
    // The remote listener answers /health itself, ahead of the shared router.
    let api = if remote { api } else { api.add("GET", "/health", get(health)) };
    api.add("POST", "/shutdown", post(shutdown)).add("GET", "/assets/:file", get(asset))
}

// The remote listener answers /health itself, so this one is only ever seen on this computer.
async fn health(State(app): State<Arc<App>>) -> Response {
    let suggest = app.suggest_origin.clone();
    let suggested = tokio::task::spawn_blocking(move || suggest()).await.ok().flatten();
    let iroh = app.iroh.info();
    let remote = if suggested.is_some() || iroh.is_some() {
        Some(Some(HealthRemote { device: None, suggested_origin: suggested, endpoint_id: iroh.as_ref().map(|i| i.endpoint_id.clone()), relay: iroh.and_then(|i| i.relay) }))
    } else {
        None
    };
    ok(Health {
        app: "pager".into(),
        api_version: API_VERSION,
        version: VERSION.into(),
        pid: Some(std::process::id()),
        port: Some(app.port),
        data_dir: Some(app.data_dir.to_string_lossy().into_owned()),
        reads_dir: Some(app.reads_dir.to_string_lossy().into_owned()),
        started_at: Some(app.started_at.clone()),
        remote,
    })
}

async fn shutdown(State(app): State<Arc<App>>) -> Response {
    let app2 = app.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        app2.notify(Notice::Shutdown);
    });
    StatusCode::NO_CONTENT.into_response()
}

// Images extracted from documents. Content-addressed, so cached forever; served with a CSP that
// keeps an SVG opened directly from running script on this origin.
async fn asset(State(app): State<Arc<App>>, Path(file): Path<String>) -> Result<Response> {
    let full = app.lock().assets.path(&file).filter(|p| p.exists()).ok_or_else(|| not_found("That image"))?;
    let bytes = std::fs::read(&full)?;
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type_of(&file).unwrap_or("application/octet-stream"))
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        .header("Cross-Origin-Resource-Policy", "same-origin")
        .body(Body::from(bytes))
        .unwrap())
}
