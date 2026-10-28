//! Serve the built web app (the UI's `dist/`) on the same origin as the API, with a fallback to
//! index.html for client-side routes like /read/:docId. Only files inside `dir` are ever read.

use axum::body::Body;
use axum::extract::Request;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use std::path::{Path, PathBuf};

fn content_type(ext: &str) -> &'static str {
    match ext {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        "webmanifest" => "application/manifest+json",
        _ => "application/octet-stream",
    }
}

pub fn serve(root: &Path, path: &str) -> Response {
    let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let index = root.join("index.html");
    let rel = percent_encoding::percent_decode_str(path).decode_utf8().map(|s| s.into_owned()).unwrap_or_else(|_| "/".to_string());
    let mut full = root.clone();
    for seg in rel.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                full.pop();
            }
            s => full.push(s),
        }
    }
    let inside = full == root || full.starts_with(&root);
    let mut file: Option<PathBuf> = if inside && full.is_file() { Some(full.clone()) } else { None };
    let has_ext = rel.rsplit('/').next().map(|n| n.contains('.')).unwrap_or(false);
    // Client-side routes fall back to the app shell; missing assets are a 404.
    if file.is_none() && !has_ext && index.exists() {
        file = Some(index.clone());
    }
    let Some(file) = file else { return (StatusCode::NOT_FOUND, "Not found").into_response() };
    let Ok(bytes) = std::fs::read(&file) else { return (StatusCode::NOT_FOUND, "Not found").into_response() };
    let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("");
    let immutable = file.components().any(|c| c.as_os_str() == "assets");
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type(ext))
        .header(header::CACHE_CONTROL, if immutable { "public, max-age=31536000, immutable" } else { "no-cache" })
        .header("X-Content-Type-Options", "nosniff")
        .body(Body::from(bytes))
        .unwrap()
}

/// A fallback handler serving `dir`.
pub fn fallback(dir: PathBuf) -> axum::routing::MethodRouter<std::sync::Arc<crate::app::App>> {
    axum::routing::get(move |req: Request| {
        let dir = dir.clone();
        async move {
            let path = req.uri().path().to_string();
            if path == "/api" || path.starts_with("/api/") {
                return (StatusCode::NOT_FOUND, "Not found").into_response();
            }
            serve(&dir, &path)
        }
    })
}
