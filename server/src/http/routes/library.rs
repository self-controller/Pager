use crate::app::App;
use crate::config::limits;
use crate::errors::{invalid, not_found, AppError};
use crate::http::{created, json_object, no_content, ok, query, Api, DeviceCtx};
use crate::model::DocumentQuery;
use crate::Result;
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Extension, Multipart, Path, RawQuery, State};
use axum::response::Response;
use axum::routing::{delete, get, patch, post, put};
use serde_json::Value;
use std::sync::Arc;

pub fn mount(api: Api) -> Api {
    api.add("GET", "/documents", get(list_documents))
        .add("GET", "/documents/:id", get(get_document))
        .add("GET", "/documents/:id/sections/:sid", get(get_section))
        .add("PATCH", "/documents/:id", patch(patch_document))
        .add("DELETE", "/documents/:id", delete(delete_document))
        .add("POST", "/documents/:id/reload", post(reload))
        .add("GET", "/documents/:id/locate", get(locate))
        .add("PUT", "/documents/:id/progress", put(progress))
        .add("GET", "/sources", get(list_sources))
        .add("POST", "/sources", post(add_source))
        .add("DELETE", "/sources/:id", delete(remove_source))
        .add("POST", "/uploads", post(upload).layer(DefaultBodyLimit::max((limits::FILE_BYTES + 1024 * 1024) as usize)))
        .add("GET", "/jobs/:id", get(get_job))
}

async fn list_documents(State(app): State<Arc<App>>, RawQuery(raw): RawQuery) -> Result<Response> {
    let q = query(&raw);
    let mut dq = DocumentQuery::default();
    if let Some(k) = q.get("kind").filter(|k| *k == "book" || *k == "article") {
        dq.kind = Some(k.clone());
    }
    dq.saved = match q.get("saved").map(String::as_str) {
        Some("true") => Some(true),
        Some("false") => Some(false),
        _ => None,
    };
    dq.history = q.get("history").map(|h| h == "true").unwrap_or(false);
    if let Some(s) = q.get("sort").filter(|s| matches!(s.as_str(), "recent" | "title" | "added")) {
        dq.sort = Some(s.clone());
    }
    if let Some(t) = q.get("q").map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
        dq.q = Some(t);
    }
    if let Some(s) = q.get("sourceId").filter(|s| !s.is_empty()) {
        dq.source_id = Some(s.clone());
    }
    Ok(ok(app.run(move |c| c.list_documents(&dq)).await?))
}

async fn get_document(State(app): State<Arc<App>>, Path(id): Path<String>, device: Option<Extension<DeviceCtx>>) -> Result<Response> {
    let mut detail = app.run(move |c| c.detail(&id)).await?;
    // The absolute path is for this computer only.
    if device.is_some() {
        detail.path = None;
    }
    Ok(ok(detail))
}

async fn get_section(State(app): State<Arc<App>>, Path((id, sid)): Path<(String, String)>, RawQuery(raw): RawQuery) -> Result<Response> {
    let q = query(&raw);
    let include: Vec<String> = q.get("include").map(|s| s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()).unwrap_or_default();
    let section = app.run(move |c| c.section(&id, &sid, &include)).await?;
    let mut res = ok(section);
    res.headers_mut().insert(axum::http::header::CACHE_CONTROL, "no-cache".parse().unwrap());
    Ok(res)
}

async fn patch_document(State(app): State<Arc<App>>, Path(id): Path<String>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    let saved = match b.get("saved") {
        None => None,
        Some(Value::Bool(v)) => Some(*v),
        Some(_) => return Err(invalid("saved should be true or false.")),
    };
    let text_or_null = |k: &str| -> Result<Option<Option<String>>> {
        match b.get(k) {
            None => Ok(None),
            Some(Value::Null) => Ok(Some(None)),
            Some(Value::String(s)) => Ok(Some(Some(s.clone()))),
            Some(_) => Err(invalid(format!("{k} should be text or null."))),
        }
    };
    let title = text_or_null("title")?;
    let author = text_or_null("author")?;
    Ok(ok(app.run(move |c| c.patch_document(&id, saved, title, author)).await?))
}

async fn delete_document(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response> {
    app.run(move |c| c.remove_document(&id)).await?;
    Ok(no_content())
}

async fn reload(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response> {
    Ok(ok(app.run(move |c| c.reload(&id)).await?))
}

async fn locate(State(app): State<Arc<App>>, Path(id): Path<String>, RawQuery(raw): RawQuery) -> Result<Response> {
    let q = query(&raw);
    let block_id = q.get("blockId").filter(|b| !b.is_empty()).cloned().ok_or_else(|| invalid("Say which block: ?blockId="))?;
    let section_id = app
        .run(move |c| {
            let idx = c.fresh(&id)?;
            idx.section_of_block(&block_id).map(|s| s.id.clone()).ok_or_else(|| not_found("That passage"))
        })
        .await?;
    Ok(ok(serde_json::json!({ "sectionId": section_id })))
}

async fn progress(State(app): State<Arc<App>>, Path(id): Path<String>, device: Option<Extension<DeviceCtx>>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    let device_id = device.map(|d| d.0 .0.id);
    Ok(ok(app.run(move |c| c.save_progress(&id, &b, device_id.as_deref())).await?))
}

async fn list_sources(State(app): State<Arc<App>>) -> Result<Response> {
    Ok(ok(app.run(|c| c.list_sources()).await?))
}

async fn add_source(State(app): State<Arc<App>>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    let path = b.get("path").and_then(Value::as_str).map(str::to_string).filter(|p| !p.trim().is_empty()).ok_or_else(|| invalid("Type the path of a file or folder."))?;
    let app2 = app.clone();
    let r = tokio::task::spawn_blocking(move || app2.add_source(&path)).await.map_err(|e| AppError::internal(e.to_string()))??;
    Ok(created(r))
}

async fn remove_source(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response> {
    app.run(move |c| c.remove_source(&id)).await?;
    Ok(no_content())
}

async fn upload(State(app): State<Arc<App>>, RawQuery(raw): RawQuery, mut multipart: Multipart) -> Result<Response> {
    let q = query(&raw);
    let dir = q.get("dir").cloned().unwrap_or_default();
    let bad = || invalid("Send the file as multipart form data in a field called file.");
    let mut found: Option<(String, Bytes)> = None;
    while let Some(field) = multipart.next_field().await.map_err(|_| bad())? {
        if field.name() == Some("file") {
            let name = field.file_name().map(str::to_string).filter(|n| !n.is_empty()).unwrap_or_else(|| "upload".to_string());
            let bytes = field.bytes().await.map_err(|_| AppError::new(413, "too_large", "This file is larger than Pager opens (200 MB)."))?;
            found = Some((name, bytes));
            break;
        }
    }
    let (name, bytes) = found.ok_or_else(bad)?;
    let dir_v = Value::String(dir);
    Ok(created(app.run_ensured(move |c| c.import_bytes(Some(&dir_v), &bytes, &name)).await?))
}

async fn get_job(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response> {
    let job = app.run(move |c| Ok(c.jobs.get(&id))).await?.ok_or_else(|| not_found("That job"))?;
    Ok(ok(job))
}
