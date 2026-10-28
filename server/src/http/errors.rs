use crate::errors::AppError;
use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{json, Map, Value};

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let mut body = Map::new();
        body.insert("error".into(), json!({ "code": self.code, "message": self.message }));
        if let Some(extra) = self.extra {
            for (k, v) in extra {
                body.insert(k, v);
            }
        }
        if self.status == 500 {
            eprintln!("internal: {}", body["error"]["message"]);
        }
        (StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), axum::Json(Value::Object(body))).into_response()
    }
}

/// A body-limit refusal from the framework, as the calm JSON error the UI expects.
pub async fn json_413(res: Response) -> Response {
    if res.status() == StatusCode::PAYLOAD_TOO_LARGE {
        let is_json = res.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(|v| v.starts_with("application/json")).unwrap_or(false);
        if !is_json {
            return AppError::new(413, "too_large", "That is larger than Pager accepts.").into_response();
        }
    }
    res
}

/// Rewrite an error response's message (the remote listener strips paths on the computer).
pub async fn redact_response(res: Response, redact: fn(&str) -> String) -> Response {
    if !res.status().is_client_error() && !res.status().is_server_error() {
        return res;
    }
    let is_json = res.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(|v| v.starts_with("application/json")).unwrap_or(false);
    if !is_json {
        return res;
    }
    let (parts, body) = res.into_parts();
    let bytes = match axum::body::to_bytes(body, 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return Response::from_parts(parts, Body::empty()),
    };
    let mut v: Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => return Response::from_parts(parts, Body::from(bytes)),
    };
    if let Some(m) = v.get_mut("error").and_then(|e| e.get_mut("message")) {
        if let Some(s) = m.as_str() {
            *m = Value::String(redact(s));
        }
    }
    let out = serde_json::to_vec(&v).unwrap_or_default();
    let mut parts = parts;
    parts.headers.remove(header::CONTENT_LENGTH);
    Response::from_parts(parts, Body::from(out))
}
