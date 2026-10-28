//! Export, import, the mirror, history, sessions and merges.

use crate::app::App;
use crate::errors::invalid;
use crate::http::{json_object, ok, query, Api};
use crate::mirror::format::{mirror_markdown, slug, MirrorDoc};
use crate::Result;
use axum::body::{Body, Bytes};
use axum::extract::{Path, RawQuery, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde_json::Value;
use std::sync::Arc;

pub fn mount(api: Api) -> Api {
    api.add("GET", "/export", get(export_all))
        .add("POST", "/import", post(import))
        .add("GET", "/documents/:id/export", get(export_document))
        .add("POST", "/mirror/rebuild", post(mirror_rebuild))
        .add("GET", "/documents/:id/history", get(history))
        .add("GET", "/documents/:id/sessions", get(sessions))
        .add("POST", "/documents/:id/merge", post(merge))
}

async fn export_all(State(app): State<Arc<App>>) -> Result<Response> {
    let (export, date) = app.run(|c| Ok((c.export(None)?, c.now()))).await?;
    let mut res = ok(export);
    res.headers_mut().insert(header::CONTENT_DISPOSITION, format!("attachment; filename=\"pager-export-{}.json\"", &date[..10]).parse().unwrap());
    Ok(res)
}

async fn import(State(app): State<Arc<App>>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    Ok(ok(app.run(move |c| c.import(&b)).await?))
}

async fn export_document(State(app): State<Arc<App>>, Path(id): Path<String>, RawQuery(raw): RawQuery) -> Result<Response> {
    let q = query(&raw);
    let format = q.get("format").cloned().unwrap_or_else(|| "md".into());
    if format == "json" {
        let (export, title) = app
            .run(move |c| {
                let row = c.row(&id)?;
                Ok((c.export(Some(&id))?, row.title_override.unwrap_or(row.title)))
            })
            .await?;
        let mut res = ok(export);
        res.headers_mut().insert(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}.pager.json\"", slug(&title)).parse().unwrap());
        return Ok(res);
    }
    if format != "md" {
        return Err(invalid("format is md or json."));
    }
    let (md, title) = app
        .run(move |c| {
            let row = c.row(&id)?;
            let idx = c.index(&id)?;
            let annotations = c.list_annotations(&id, false)?;
            let title = row.title_override.clone().unwrap_or_else(|| row.title.clone());
            let md = mirror_markdown(
                &MirrorDoc {
                    id: id.clone(),
                    title: title.clone(),
                    authors: row.authors(),
                    format: row.format.clone(),
                    path: row.path.clone(),
                    section_titles: idx.doc.sections.iter().map(|s| (s.id.clone(), s.title.clone())).collect(),
                    section_order: idx.doc.sections.iter().map(|s| s.id.clone()).collect(),
                },
                &annotations,
                &format!("http://localhost:{}", c.port),
            );
            Ok((md, title))
        })
        .await?;
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/markdown; charset=utf-8")
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}-notes.md\"", slug(&title)))
        .body(Body::from(md))
        .unwrap())
}

async fn mirror_rebuild(State(app): State<Arc<App>>) -> Result<Response> {
    let (written, dir) = app.run(|c| Ok((c.mirror_rebuild()?, c.mirror_dir()))).await?;
    Ok(ok(serde_json::json!({ "written": written, "dir": dir.to_string_lossy() })))
}

async fn history(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response> {
    Ok(ok(app
        .run(move |c| {
            c.live_row(&id)?;
            c.history(&id)
        })
        .await?))
}

async fn sessions(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response> {
    Ok(ok(app
        .run(move |c| {
            c.live_row(&id)?;
            c.list_sessions(&id)
        })
        .await?))
}

async fn merge(State(app): State<Arc<App>>, Path(id): Path<String>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    let into = b.get("intoId").and_then(Value::as_str).map(str::to_string).ok_or_else(|| invalid("Say which document to merge into: { intoId }."))?;
    let r = app
        .run(move |c| {
            let (moved, orphaned) = c.merge_documents(&id, &into)?;
            let document = c.detail(&into)?;
            Ok(serde_json::json!({ "moved": moved, "orphaned": orphaned, "document": document }))
        })
        .await?;
    Ok(ok(r).into_response())
}
