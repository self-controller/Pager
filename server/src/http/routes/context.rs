//! Context briefings (/api/tools/context/*): status, the stored briefing, starting a run, a run's
//! progress. See prompts/book-context.md and API.md, "Context".

use crate::app::App;
use crate::briefing::schema::Level;
use crate::briefing::{self, Started};
use crate::errors::invalid;
use crate::http::{json_object, ok, query, Api, DeviceCtx};
use crate::Result;
use axum::body::Bytes;
use axum::extract::{Extension, Path, RawQuery, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Json;
use serde_json::{json, Value};
use std::sync::Arc;

pub fn mount(api: Api) -> Api {
    api.add("GET", "/tools/context/status", get(status))
        .add("GET", "/tools/context/briefings/:id", get(get_briefing))
        .add("POST", "/tools/context/briefings/:id", post(start_briefing))
        .add("GET", "/tools/context/runs/:rid", get(get_run))
}

fn level_of(v: Option<&str>) -> Result<Level> {
    match v {
        None | Some("") => Ok(Level::General),
        Some(s) => Level::parse(s).ok_or_else(|| invalid("level is general, student or scholar.")),
    }
}

async fn status(State(app): State<Arc<App>>, device: Option<Extension<DeviceCtx>>) -> Result<Response> {
    Ok(ok(briefing::status(&app, device.map(|d| d.0 .0.id.clone())).await?))
}

async fn get_briefing(State(app): State<Arc<App>>, Path(id): Path<String>, RawQuery(raw): RawQuery) -> Result<Response> {
    let q = query(&raw);
    let level = level_of(q.get("level").map(String::as_str))?;
    Ok(ok(briefing::state(&app, &id, level).await?))
}

async fn start_briefing(State(app): State<Arc<App>>, Path(id): Path<String>, device: Option<Extension<DeviceCtx>>, body: Bytes) -> Result<Response> {
    let b = if body.is_empty() { json!({}) } else { json_object(&body)? };
    let level = level_of(b.get("level").and_then(Value::as_str))?;
    let refresh = b.get("refresh").and_then(Value::as_bool).unwrap_or(false);
    let device_id = device.map(|d| d.0 .0.id.clone());
    Ok(match briefing::start(&app, &id, level, refresh, device_id).await? {
        Started::Cached(b) => ok(json!({ "briefing": b, "run": null })),
        Started::Run(run) => (StatusCode::ACCEPTED, Json(json!({ "briefing": null, "run": run }))).into_response(),
    })
}

async fn get_run(State(app): State<Arc<App>>, Path(rid): Path<String>) -> Result<Response> {
    Ok(ok(briefing::run_view(&app, &rid).await?))
}
