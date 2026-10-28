//! Annotations, tool records, search, settings, presets, the journal and the live stream.

use crate::app::App;
use crate::http::sse;
use crate::http::{created, json_array, json_object, no_content, ok, opt_num, query, Api, DeviceCtx};
use crate::model::SettingsResponse;
use crate::Result;
use axum::body::Bytes;
use axum::extract::{Extension, Path, RawQuery, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
use std::collections::HashMap;
use std::sync::Arc;

pub fn mount(api: Api) -> Api {
    api.add("GET", "/documents/:id/annotations", get(list_annotations))
        .add("POST", "/documents/:id/annotations", post(create_annotation))
        .add("GET", "/annotations/:aid", get(get_annotation))
        .add("PATCH", "/annotations/:aid", patch(update_annotation))
        .add("DELETE", "/annotations/:aid", delete(delete_annotation))
        .add("POST", "/annotations/:aid/restore", post(restore_annotation))
        .add("GET", "/annotations", get(library_annotations))
        .add("GET", "/highlights", get(highlights))
        .add("GET", "/tags", get(tags))
        .add("GET", "/tools/:tool/records", get(list_records))
        .add("POST", "/tools/:tool/records", post(create_record))
        .add("GET", "/tools/:tool/records/:rid", get(get_record))
        .add("PATCH", "/tools/:tool/records/:rid", patch(update_record))
        .add("DELETE", "/tools/:tool/records/:rid", delete(delete_record))
        .add("GET", "/search/documents", get(search_documents))
        .add("GET", "/search", get(search))
        .add("GET", "/settings", get(get_settings))
        .add("PATCH", "/settings/global", patch(patch_global))
        .add("PATCH", "/settings/app", patch(patch_app))
        .add("PATCH", "/settings/documents/:id", patch(patch_document_settings))
        .add("DELETE", "/settings/documents/:id", delete(reset_document_settings))
        .add("GET", "/presets", get(presets))
        .add("POST", "/presets", post(create_preset))
        .add("PATCH", "/presets/:pid", patch(update_preset))
        .add("DELETE", "/presets/:pid", delete(delete_preset))
        .add("POST", "/events", post(post_events))
        .add("GET", "/events", get(list_events))
        .add("DELETE", "/events", delete(purge_events))
        .add("GET", "/stream", get(sse::stream))
}

fn s<'a>(q: &'a HashMap<String, String>, k: &str) -> Option<&'a str> {
    q.get(k).map(String::as_str).filter(|v| !v.is_empty())
}

// ---- Annotations ----

async fn list_annotations(State(app): State<Arc<App>>, Path(id): Path<String>, RawQuery(raw): RawQuery) -> Result<Response> {
    let include_deleted = query(&raw).get("include").map(|i| i == "deleted").unwrap_or(false);
    Ok(ok(app.run(move |c| c.list_annotations(&id, include_deleted)).await?))
}

async fn create_annotation(State(app): State<Arc<App>>, Path(id): Path<String>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    let (annotation, was_created) = app.run(move |c| c.create_annotation(&id, &b)).await?;
    Ok(if was_created { created(annotation) } else { ok(annotation) })
}

async fn get_annotation(State(app): State<Arc<App>>, Path(aid): Path<String>) -> Result<Response> {
    Ok(ok(app.run(move |c| c.get_annotation(&aid)).await?))
}

async fn update_annotation(State(app): State<Arc<App>>, Path(aid): Path<String>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    Ok(ok(app.run(move |c| c.update_annotation(&aid, &b)).await?))
}

async fn delete_annotation(State(app): State<Arc<App>>, Path(aid): Path<String>) -> Result<Response> {
    app.run(move |c| c.remove_annotation(&aid)).await?;
    Ok(no_content())
}

async fn restore_annotation(State(app): State<Arc<App>>, Path(aid): Path<String>) -> Result<Response> {
    Ok(ok(app.run(move |c| c.restore_annotation(&aid)).await?))
}

async fn library_list(app: &Arc<App>, q: HashMap<String, String>, default_kind: Option<String>) -> Result<Response> {
    let kind = s(&q, "kind").map(str::to_string).or(default_kind);
    let tag = s(&q, "tag").map(str::to_string);
    let doc_id = s(&q, "docId").map(str::to_string);
    let text = s(&q, "q").map(str::to_string);
    let before = s(&q, "before").map(str::to_string);
    let limit = opt_num(&q, "limit");
    Ok(ok(app.run(move |c| c.library_annotations(kind.as_deref(), tag.as_deref(), doc_id.as_deref(), text.as_deref(), before.as_deref(), limit)).await?))
}

async fn library_annotations(State(app): State<Arc<App>>, RawQuery(raw): RawQuery) -> Result<Response> {
    library_list(&app, query(&raw), None).await
}

/// The UI's reserved /api/highlights: the same list (highlights and notes unless ?kind= says otherwise).
async fn highlights(State(app): State<Arc<App>>, RawQuery(raw): RawQuery) -> Result<Response> {
    let q = query(&raw);
    if s(&q, "kind").is_some() {
        return library_list(&app, q, None).await;
    }
    let tag = s(&q, "tag").map(str::to_string);
    let doc_id = s(&q, "docId").map(str::to_string);
    let text = s(&q, "q").map(str::to_string);
    let list = app.run(move |c| c.library_annotations(None, tag.as_deref(), doc_id.as_deref(), text.as_deref(), None, None)).await?;
    let list: Vec<_> = list.into_iter().filter(|a| a.annotation.kind != "bookmark").collect();
    Ok(ok(list))
}

async fn tags(State(app): State<Arc<App>>) -> Result<Response> {
    Ok(ok(app.run(|c| c.tags()).await?))
}

// ---- Tool records ----

async fn list_records(State(app): State<Arc<App>>, Path(tool): Path<String>, RawQuery(raw): RawQuery) -> Result<Response> {
    let q = query(&raw);
    let doc_id = s(&q, "docId").map(str::to_string);
    let include_deleted = q.get("include").map(|i| i == "deleted").unwrap_or(false);
    Ok(ok(app.run(move |c| c.list_records(&tool, doc_id.as_deref(), include_deleted)).await?))
}

async fn create_record(State(app): State<Arc<App>>, Path(tool): Path<String>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    let (record, was_created) = app.run(move |c| c.create_record(&tool, &b)).await?;
    Ok(if was_created { created(record) } else { ok(record) })
}

async fn get_record(State(app): State<Arc<App>>, Path((tool, rid)): Path<(String, String)>) -> Result<Response> {
    Ok(ok(app.run(move |c| c.get_record(&tool, &rid)).await?))
}

async fn update_record(State(app): State<Arc<App>>, Path((tool, rid)): Path<(String, String)>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    Ok(ok(app.run(move |c| c.update_record(&tool, &rid, &b)).await?))
}

async fn delete_record(State(app): State<Arc<App>>, Path((tool, rid)): Path<(String, String)>) -> Result<Response> {
    app.run(move |c| c.remove_record(&tool, &rid)).await?;
    Ok(no_content())
}

// ---- Search ----

async fn search_documents(State(app): State<Arc<App>>, RawQuery(raw): RawQuery) -> Result<Response> {
    let q = query(&raw);
    let text = q.get("q").cloned().unwrap_or_default();
    let limit = opt_num(&q, "limit");
    Ok(ok(app.run_ensured(move |c| c.search_documents(&text, limit)).await?))
}

async fn search(State(app): State<Arc<App>>, RawQuery(raw): RawQuery) -> Result<Response> {
    let q = query(&raw);
    let text = q.get("q").cloned().unwrap_or_default();
    let doc_id = s(&q, "docId").map(str::to_string);
    let in_annotations = q.get("in").map(|i| i == "annotations").unwrap_or(false);
    let limit = opt_num(&q, "limit");
    Ok(ok(app.run(move |c| c.search(&text, doc_id.as_deref(), in_annotations, limit)).await?))
}

// ---- Settings and presets. A paired device never gets the app settings: mirror.dir is a path on the computer. ----

fn settings_for(device: &Option<Extension<DeviceCtx>>, mut s: SettingsResponse) -> SettingsResponse {
    if device.is_some() {
        s.app = None;
    }
    s
}

async fn get_settings(State(app): State<Arc<App>>, RawQuery(raw): RawQuery, device: Option<Extension<DeviceCtx>>) -> Result<Response> {
    let q = query(&raw);
    let doc_id = s(&q, "docId").map(str::to_string);
    let r = app
        .run(move |c| {
            if let Some(d) = &doc_id {
                c.live_row(d)?;
            }
            c.settings_get(doc_id.as_deref())
        })
        .await?;
    Ok(ok(settings_for(&device, r)))
}

async fn patch_global(State(app): State<Arc<App>>, device: Option<Extension<DeviceCtx>>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    let r = app.run(move |c| c.patch_global_settings(&b)).await?;
    Ok(ok(settings_for(&device, r)))
}

async fn patch_app(State(app): State<Arc<App>>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    Ok(ok(app.run(move |c| c.patch_app_settings(&b)).await?))
}

async fn patch_document_settings(State(app): State<Arc<App>>, Path(id): Path<String>, device: Option<Extension<DeviceCtx>>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    let r = app.run(move |c| c.patch_document_settings(&id, &b)).await?;
    Ok(ok(settings_for(&device, r)))
}

async fn reset_document_settings(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response> {
    app.run(move |c| c.reset_document_settings(&id)).await?;
    Ok(no_content())
}

async fn presets(State(app): State<Arc<App>>) -> Result<Response> {
    Ok(ok(app.run(|c| c.presets()).await?))
}

async fn create_preset(State(app): State<Arc<App>>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    Ok(created(app.run(move |c| c.create_preset(&b)).await?))
}

async fn update_preset(State(app): State<Arc<App>>, Path(pid): Path<String>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    Ok(ok(app.run(move |c| c.update_preset(&pid, &b)).await?))
}

async fn delete_preset(State(app): State<Arc<App>>, Path(pid): Path<String>) -> Result<Response> {
    app.run(move |c| c.delete_preset(&pid)).await?;
    Ok(no_content())
}

// ---- The journal ----

async fn post_events(State(app): State<Arc<App>>, body: Bytes) -> Result<Response> {
    let b = json_array(&body)?;
    Ok(ok(app
        .run(move |c| {
            let record = c.app_settings().record;
            c.record_client_events(&record, &b)
        })
        .await?))
}

async fn list_events(State(app): State<Arc<App>>, RawQuery(raw): RawQuery) -> Result<Response> {
    let q = query(&raw);
    let doc_id = s(&q, "docId").map(str::to_string);
    let kind = s(&q, "type").map(str::to_string);
    let after = s(&q, "after").and_then(|a| a.parse::<f64>().ok()).filter(|n| n.is_finite()).map(|n| n as i64);
    let limit = opt_num(&q, "limit");
    Ok(ok(app.run(move |c| c.list_events(doc_id.as_deref(), kind.as_deref(), after, limit)).await?))
}

async fn purge_events(State(app): State<Arc<App>>, RawQuery(raw): RawQuery) -> Result<Response> {
    let q = query(&raw);
    let doc_id = s(&q, "docId").map(str::to_string);
    let category = s(&q, "category").map(str::to_string);
    app.run(move |c| c.purge_events(doc_id.as_deref(), category.as_deref())).await?;
    Ok(StatusCode::NO_CONTENT.into_response())
}
