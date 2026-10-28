//! The remote listener's app (PAGER_REMOTE_PORT, 127.0.0.1 only, behind `tailscale serve`). Every
//! /api request needs a paired, unrevoked, unexpired device, except health and pairing. Routes are
//! denied by default; REMOTE_ALLOW opens the reading surface of the shared router. The built web
//! app is served too, unauthenticated: the shell holds no user data.
//!
//! The same app answers phones over iroh: the bridge (`remote::bridge`) calls it in this process
//! with a `Peer` extension naming the phone's endpoint. On that path the only credential is a bearer
//! token, good only from the endpoint it was paired from; cookies, CSRF and the origin check belong
//! to the Tailscale path alone.

use super::{api, created, json_object, ok, static_files, DeviceCtx, Peer};
use crate::app::App;
use crate::config::{API_VERSION, VERSION};
use crate::errors::AppError;
use crate::model::{Health, HealthRemote, PairPollResult, RemoteDevice};
use crate::Result;
use axum::body::Bytes;
use axum::extract::{Extension, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use regex::Regex;
use std::sync::{Arc, OnceLock};

pub const DEVICE_COOKIE: &str = "pager_device";
const COOKIE_MAX_AGE: u64 = 90 * 24 * 60 * 60;

/// Everything a paired device may call, as the shared router registers it (paths inside /api).
/// Anything else is refused with 403 before its handler runs. A test checks every registered route
/// is either here or in REMOTE_DENY / REMOTE_REPLACED, so a new route can't slip through.
pub const REMOTE_ALLOW: &[&str] = &[
    // Reading
    "GET /documents",
    "GET /documents/:id",
    "GET /documents/:id/sections/:sid",
    "GET /documents/:id/locate",
    "PATCH /documents/:id",
    "PUT /documents/:id/progress",
    "GET /documents/:id/history",
    "GET /documents/:id/sessions",
    // Highlights and notes
    "GET /documents/:id/annotations",
    "POST /documents/:id/annotations",
    "GET /annotations/:aid",
    "PATCH /annotations/:aid",
    "DELETE /annotations/:aid",
    "POST /annotations/:aid/restore",
    "GET /annotations",
    "GET /highlights",
    "GET /tags",
    // Tool records: opaque data, no effect on files
    "GET /tools/:tool/records",
    "POST /tools/:tool/records",
    "GET /tools/:tool/records/:rid",
    "PATCH /tools/:tool/records/:rid",
    "DELETE /tools/:tool/records/:rid",
    "GET /search",
    "GET /search/documents",
    // Reading settings (the UI's own JSON)
    "GET /settings",
    "PATCH /settings/global",
    "PATCH /settings/documents/:id",
    "DELETE /settings/documents/:id",
    "GET /presets",
    "POST /events",
    "GET /stream",
    "GET /assets/:file",
    "GET /tree",
    "GET /sync/manifest",
];

/// Refused from a phone. Listed so the route test can tell a deliberate refusal from a forgotten route.
pub const REMOTE_DENY: &[&str] = &[
    "PATCH /settings/app",
    "POST /presets",
    "PATCH /presets/:pid",
    "DELETE /presets/:pid",
    "GET /events",
    "DELETE /events",
    "GET /sources",
    "POST /sources",
    "DELETE /sources/:id",
    "POST /uploads",
    "POST /files",
    "POST /folders",
    "POST /files/move",
    "DELETE /files",
    "POST /files/import",
    "GET /jobs/:id",
    "DELETE /documents/:id",
    "POST /documents/:id/reload",
    "POST /documents/:id/merge",
    "GET /export",
    "POST /import",
    "GET /documents/:id/export",
    "POST /mirror/rebuild",
    "POST /shutdown",
];

/// Answered by the remote app itself, ahead of the shared router.
pub const REMOTE_REPLACED: &[&str] = &["GET /health"];

fn allowed() -> &'static Vec<(String, Regex)> {
    static ALLOWED: OnceLock<Vec<(String, Regex)>> = OnceLock::new();
    ALLOWED.get_or_init(|| {
        static PARAM: OnceLock<Regex> = OnceLock::new();
        let param = PARAM.get_or_init(|| Regex::new(r":[A-Za-z]+").unwrap());
        REMOTE_ALLOW
            .iter()
            .map(|r| {
                let (method, pattern) = r.split_once(' ').unwrap();
                // `:param` matches one path segment.
                (method.to_string(), Regex::new(&format!("^{}$", param.replace_all(pattern, "[^/]+"))).unwrap())
            })
            .collect()
    })
}

/// `api_path` is inside /api. HEAD is a GET.
pub fn remote_allows(method: &str, api_path: &str) -> bool {
    let m = if method == "HEAD" { "GET" } else { method };
    allowed().iter().any(|(am, re)| am == m && re.is_match(api_path))
}

/// Absolute paths in a message become their last segment, so nothing about this computer's folders leaves it.
pub fn redact_paths(text: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r#"(^|[\s'"(=])((?:/[^\s'"()/]+)+/?)"#).unwrap());
    re.replace_all(text, |caps: &regex::Captures| {
        let p = caps[2].trim_end_matches('/');
        format!("{}{}", &caps[1], p.rsplit('/').next().unwrap_or(""))
    })
    .into_owned()
}

fn is_api_path(p: &str) -> bool {
    p == "/api" || p.starts_with("/api/")
}

fn mutating(method: &str) -> bool {
    !matches!(method, "GET" | "HEAD" | "OPTIONS")
}

/// Informational only (shown on the desktop): over iroh, where the connection came from (`ip:port`,
/// or "relay"); over Tailscale, the address tailscale serve says it forwarded for.
fn client_ip(headers: &HeaderMap, peer: Option<&Peer>) -> Option<String> {
    if let Some(p) = peer {
        return Some(p.addr.clone());
    }
    let first = headers.get("x-forwarded-for")?.to_str().ok()?.split(',').next()?.trim();
    if first.is_empty() {
        None
    } else {
        Some(first.chars().take(64).collect())
    }
}

fn cookie_header(token: &str) -> HeaderValue {
    HeaderValue::from_str(&format!("{DEVICE_COOKIE}={token}; Max-Age={COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Strict")).unwrap()
}

enum By {
    Bearer,
    Cookie,
}

/// The credential a request carries. An Authorization header wins over the cookie; over iroh it is
/// the only credential (no browser, so no cookie).
fn credential(headers: &HeaderMap, peer: Option<&Peer>) -> Option<(String, By)> {
    if let Some(auth) = headers.get(header::AUTHORIZATION) {
        let auth = auth.to_str().ok()?;
        let rest = auth.strip_prefix("Bearer ").or_else(|| auth.strip_prefix("bearer "))?;
        let token = rest.trim();
        if token.is_empty() || token.contains(char::is_whitespace) {
            return None;
        }
        return Some((token.to_string(), By::Bearer));
    }
    if peer.is_some() {
        return None;
    }
    let cookies = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in cookies.split(';') {
        let part = part.trim();
        if let Some(v) = part.strip_prefix(&format!("{DEVICE_COOKIE}=")) {
            if !v.is_empty() {
                return Some((v.to_string(), By::Cookie));
            }
        }
    }
    None
}

fn origin(app: &App) -> Option<String> {
    app.lock().app_settings().remote.origin
}

/// Pairing carries no ambient credential, but a page on another site shouldn't spend the window's attempts.
fn from_this_app(app: &App, headers: &HeaderMap) -> Result<()> {
    let site = headers.get("sec-fetch-site").and_then(|v| v.to_str().ok());
    let from = headers.get("origin").and_then(|v| v.to_str().ok());
    if site.map(|s| s != "same-origin" && s != "none").unwrap_or(false) || from.map(|f| Some(f.to_string()) != origin(app)).unwrap_or(false) {
        return Err(AppError::new(403, "forbidden", "Pair from the Pager app itself."));
    }
    Ok(())
}

async fn health(State(app): State<Arc<App>>, headers: HeaderMap, peer: Option<Extension<Peer>>) -> Response {
    let peer = peer.map(|p| p.0);
    let cred = credential(&headers, peer.as_ref());
    let ip = client_ip(&headers, peer.as_ref());
    let peer_id = peer.as_ref().map(|p| p.endpoint_id.clone());
    let device = match cred {
        Some((token, _)) => app.run(move |c| c.device_authenticate(&token, ip.as_deref(), peer_id.as_deref())).await.ok().flatten(),
        None => None,
    };
    // Over iroh, health also names this computer's ID and the relay carrying it, so the phone can refresh its ticket.
    let iroh = if peer.is_some() { app.iroh.info() } else { None };
    let remote = if device.is_none() && iroh.is_none() {
        None
    } else {
        Some(HealthRemote { device: device.map(|d| RemoteDevice { id: d.id, name: d.name }), suggested_origin: None, endpoint_id: iroh.as_ref().map(|i| i.endpoint_id.clone()), relay: iroh.and_then(|i| i.relay) })
    };
    ok(Health {
        app: "pager".into(),
        api_version: API_VERSION,
        version: VERSION.into(),
        pid: None,
        port: None,
        data_dir: None,
        reads_dir: None,
        started_at: None,
        remote: Some(remote),
    })
}

async fn pair(State(app): State<Arc<App>>, headers: HeaderMap, peer: Option<Extension<Peer>>, body: Bytes) -> Result<Response> {
    let peer = peer.map(|p| p.0);
    if peer.is_none() {
        from_this_app(&app, &headers)?;
    }
    let b = json_object(&body)?;
    let ip = client_ip(&headers, peer.as_ref());
    // The phone's endpoint is recorded with the request and written to the device on approval.
    let endpoint_id = peer.map(|p| p.endpoint_id);
    let r = app.run(move |c| c.pairing.request(&b, ip.as_deref(), endpoint_id.as_deref())).await?;
    Ok(created(r))
}

async fn pair_poll(State(app): State<Arc<App>>, headers: HeaderMap, peer: Option<Extension<Peer>>, body: Bytes) -> Result<Response> {
    if peer.is_none() {
        from_this_app(&app, &headers)?;
    }
    let b = json_object(&body)?;
    let r = app.run(move |c| c.pairing.poll(&b)).await?;
    match r {
        PairPollResult::Pending { .. } => Ok((StatusCode::ACCEPTED, axum::Json(r)).into_response()),
        PairPollResult::Done { token, device } => {
            let mut res = ok(PairPollResult::Done { token: token.clone(), device });
            // The web app keeps the cookie (EventSource and <img> can't send headers); a phone app keeps the token.
            if peer.is_none() {
                res.headers_mut().insert(header::SET_COOKIE, cookie_header(&token));
            }
            Ok(res)
        }
    }
}

/// Device authentication, CSRF for cookie-authenticated changes, and the allowlist.
async fn gate(State(app): State<Arc<App>>, req: Request, next: Next) -> Response {
    app.touch();
    let path = req.uri().path().to_string();
    if !is_api_path(&path) {
        return next.run(req).await;
    }
    let method = req.method().as_str().to_string();
    let public = matches!((method.as_str(), path.as_str()), ("GET", "/api/health") | ("HEAD", "/api/health") | ("POST", "/api/pair") | ("POST", "/api/pair/poll"));
    if public {
        return next.run(req).await;
    }
    let peer = req.extensions().get::<Peer>().cloned();
    let cred = credential(req.headers(), peer.as_ref());
    let ip = client_ip(req.headers(), peer.as_ref());
    let peer_id = peer.as_ref().map(|p| p.endpoint_id.clone());
    let device = match &cred {
        Some((token, _)) => {
            let t = token.clone();
            app.run(move |c| c.device_authenticate(&t, ip.as_deref(), peer_id.as_deref())).await.ok().flatten()
        }
        None => None,
    };
    let (Some((token, by)), Some(device)) = (cred, device) else {
        return AppError::new(401, "unauthorized", "Pair this phone with Pager to read your library.").into_response();
    };
    let mut renew = false;
    if let By::Cookie = by {
        // A bearer token is never sent by a browser on its own, so only the cookie needs this.
        if mutating(&method) {
            let site = req.headers().get("sec-fetch-site").and_then(|v| v.to_str().ok());
            let same_origin = match site {
                Some(s) => s == "same-origin",
                None => {
                    let o = origin(&app);
                    o.is_some() && req.headers().get("origin").and_then(|v| v.to_str().ok()).map(|f| Some(f.to_string()) == o).unwrap_or(false)
                }
            };
            if !same_origin {
                return AppError::new(403, "forbidden", "Changes can only come from Pager itself.").into_response();
            }
        }
        renew = true;
    }
    if !remote_allows(&method, &path[4..]) {
        return AppError::new(403, "forbidden", "That isn't available from a phone.").into_response();
    }
    let mut req = req;
    req.extensions_mut().insert(DeviceCtx(device));
    let mut res = next.run(req).await;
    if renew {
        res.headers_mut().insert(header::SET_COOKIE, cookie_header(&token));
    }
    res
}

async fn redact(res: Response) -> Response {
    super::errors::redact_response(res, redact_paths).await
}

pub fn remote_app(app: &Arc<App>) -> Router {
    let shared = api(app, true).router.route("/health", get(health)).route("/pair", post(pair)).route("/pair/poll", post(pair_poll));
    let mut r = Router::new().nest("/api", shared);
    if let Some(dir) = &app.web_dir {
        r = r.fallback(static_files::fallback(dir.clone()));
    } else {
        r = r.fallback(|| async { (StatusCode::NOT_FOUND, "Not found") });
    }
    r.layer(middleware::from_fn_with_state(app.clone(), gate)).layer(middleware::map_response(redact)).layer(middleware::map_response(super::errors::json_413)).with_state(app.clone())
}
