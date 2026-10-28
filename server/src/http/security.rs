//! The server only answers requests addressed to a loopback name (defeats DNS rebinding), and only
//! accepts changes from its own origin (defeats cross-site requests from other pages in the
//! browser). Requests without Origin/Sec-Fetch-Site (the CLI, curl) are allowed.

use crate::app::App;
use crate::errors::AppError;
use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use std::sync::Arc;

fn is_local_host(hostname: &str) -> bool {
    let h = hostname.to_lowercase();
    matches!(h.as_str(), "localhost" | "127.0.0.1" | "[::1]" | "::1") || h.ends_with(".localhost")
}

fn hostname_of(host: &str) -> String {
    // "[::1]:3006" keeps its brackets; "localhost:3006" drops the port.
    if host.starts_with('[') {
        match host.find(']') {
            Some(i) => host[..=i].to_string(),
            None => host.to_string(),
        }
    } else {
        host.rsplit_once(':').filter(|(_, p)| p.bytes().all(|b| b.is_ascii_digit())).map(|(h, _)| h.to_string()).unwrap_or_else(|| host.to_string())
    }
}

pub async fn local_only(State(app): State<Arc<App>>, req: Request, next: Next) -> Response {
    app.touch();
    let host = req.headers().get("host").and_then(|v| v.to_str().ok()).map(hostname_of).unwrap_or_else(|| req.uri().host().unwrap_or("").to_string());
    if !is_local_host(&host) {
        return AppError::new(403, "forbidden", "This reading service only answers on this computer.").into_response();
    }
    let method = req.method().as_str();
    if method != "GET" && method != "HEAD" && method != "OPTIONS" {
        let refused = || AppError::new(403, "forbidden", "Changes can only come from Pager itself.").into_response();
        match req.headers().get("origin").and_then(|v| v.to_str().ok()) {
            Some("null") => return refused(),
            Some(origin) => {
                let oh = url::Url::parse(origin).ok().and_then(|u| u.host_str().map(|h| h.to_string())).unwrap_or_default();
                if !is_local_host(&oh) {
                    return refused();
                }
            }
            None => {}
        }
        if let Some(site) = req.headers().get("sec-fetch-site").and_then(|v| v.to_str().ok()) {
            if site != "same-origin" && site != "same-site" && site != "none" {
                return refused();
            }
        }
    }
    next.run(req).await
}
