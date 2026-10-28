//! The reads folder: browse it, and make, rename, move, trash and import files and folders in it.

use crate::app::App;
use crate::errors::{invalid, AppError};
use crate::http::remote::redact_paths;
use crate::http::{created, json_object, no_content, ok, query, Api, DeviceCtx};
use crate::model::TreeFolder;
use crate::Result;
use axum::body::Bytes;
use axum::extract::{Extension, RawQuery, State};
use axum::response::Response;
use axum::routing::{delete, get, post};
use serde_json::Value;
use std::sync::Arc;

pub fn mount(api: Api) -> Api {
    api.add("GET", "/tree", get(tree)).add("POST", "/files", post(create_file)).add("POST", "/folders", post(create_folder)).add("POST", "/files/move", post(move_entry)).add("DELETE", "/files", delete(remove_entry)).add("POST", "/files/import", post(import_path))
}

async fn tree(State(app): State<Arc<App>>, device: Option<Extension<DeviceCtx>>) -> Result<Response> {
    let mut tree = app.run_ensured(|c| c.tree()).await?;
    // A file's read error can quote its absolute path; a paired device gets the file name only.
    if device.is_some() {
        fn walk(f: &mut TreeFolder) {
            for file in f.files.iter_mut() {
                if let Some(e) = &file.error {
                    file.error = Some(redact_paths(e));
                }
            }
            for sub in f.folders.iter_mut() {
                walk(sub);
            }
        }
        walk(&mut tree.root);
    }
    Ok(ok(tree))
}

fn dir_of(b: &Value) -> Value {
    b.get("dir").cloned().unwrap_or_else(|| Value::String(String::new()))
}

async fn create_file(State(app): State<Arc<App>>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    Ok(created(app.run_ensured(move |c| c.create_file(Some(&dir_of(&b)), b.get("title"), b.get("author"))).await?))
}

async fn create_folder(State(app): State<Arc<App>>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    let path = app.run_ensured(move |c| c.create_folder(Some(&dir_of(&b)), b.get("name"))).await?;
    Ok(created(serde_json::json!({ "path": path })))
}

async fn move_entry(State(app): State<Arc<App>>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    Ok(ok(app.run_ensured(move |c| c.move_entry(b.get("from"), b.get("to"))).await?))
}

async fn remove_entry(State(app): State<Arc<App>>, RawQuery(raw): RawQuery) -> Result<Response> {
    let q = query(&raw);
    let p = q.get("path").cloned().ok_or_else(|| invalid("Say which file or folder: ?path="))?;
    app.run_ensured(move |c| c.remove_entry(Some(&Value::String(p)))).await?;
    Ok(no_content())
}

async fn import_path(State(app): State<Arc<App>>, body: Bytes) -> Result<Response> {
    let b = json_object(&body)?;
    let app2 = app.clone();
    let job = tokio::task::spawn_blocking(move || app2.import_path(Some(&dir_of(&b)), b.get("path"))).await.map_err(|e| AppError::internal(e.to_string()))??;
    Ok(created(job))
}
