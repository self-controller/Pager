//! A `pager/1` client: what the phone app does, in Rust, for the tests and the fake phone.

use crate::errors::AppError;
use crate::remote::node::{bind_endpoint, IrohOptions};
use crate::remote::protocol::{self, HeadError, RequestHead, ResponseHead};
use crate::Result;
use iroh::endpoint::{Connection, RecvStream};
use iroh::{Endpoint, EndpointAddr};
use iroh_base::TransportAddr;
use serde_json::Value;
use std::collections::BTreeMap;
use std::str::FromStr;
use std::time::Duration;

pub struct Phone {
    pub endpoint: Endpoint,
}

impl Phone {
    pub async fn bind(opts: IrohOptions) -> Result<Phone> {
        Ok(Phone { endpoint: bind_endpoint(opts).await? })
    }

    /// This phone's endpoint ID.
    pub fn id(&self) -> String {
        self.endpoint.id().to_string()
    }

    pub async fn connect(&self, addr: EndpointAddr) -> Result<Connection> {
        self.endpoint.connect(addr, protocol::ALPN).await.map_err(|e| AppError::internal(format!("couldn't reach the computer: {e}")))
    }

    pub async fn close(&self) {
        self.endpoint.close().await;
    }
}

/// The address inside a `pager://pair?...` link or a bare ticket. `relay_only` drops the direct
/// addresses, so the first path goes through the relay.
pub fn addr_from_ticket(ticket: &str, relay_only: bool) -> Result<EndpointAddr> {
    let t = iroh_tickets::endpoint::EndpointTicket::from_str(ticket).map_err(|e| AppError::new(400, "invalid_request", format!("That isn't a Pager ticket: {e}")))?;
    let addr = t.endpoint_addr().clone();
    if !relay_only {
        return Ok(addr);
    }
    Ok(EndpointAddr::from_parts(addr.id, addr.addrs.into_iter().filter(|a| matches!(a, TransportAddr::Relay(_)))))
}

/// The ticket and code inside `pager://pair?v=1&t=<ticket>&code=XXXX-XXXX`.
pub fn parse_pair_link(link: &str) -> Result<(String, String)> {
    let url = url::Url::parse(link).map_err(|_| AppError::new(400, "invalid_request", "That isn't a pager://pair link."))?;
    if url.scheme() != "pager" || url.host_str() != Some("pair") {
        return Err(AppError::new(400, "invalid_request", "That isn't a pager://pair link."));
    }
    let q: BTreeMap<String, String> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    if q.get("v").map(String::as_str) != Some("1") {
        return Err(AppError::new(400, "invalid_request", "That pairing link is for another version of Pager."));
    }
    match (q.get("t"), q.get("code")) {
        (Some(t), Some(c)) => Ok((t.clone(), c.clone())),
        _ => Err(AppError::new(400, "invalid_request", "The pairing link is missing its ticket or code.")),
    }
}

#[derive(Debug)]
pub enum CallError {
    /// The computer reset the stream with this code (see protocol::reset).
    Reset(u32),
    /// The stream or connection ended before an answer.
    Gone(String),
}

impl std::fmt::Display for CallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CallError::Reset(c) => write!(f, "the computer refused the request (stream reset {c})"),
            CallError::Gone(m) => write!(f, "{m}"),
        }
    }
}

pub struct Answer {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

impl Answer {
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

fn gone<E: std::fmt::Display>(e: E) -> CallError {
    CallError::Gone(e.to_string())
}

/// Send a request and read the response head; the body stays on the stream (a live stream, say).
pub async fn open(conn: &Connection, method: &str, path: &str, headers: &[(&str, &str)], body: &[u8]) -> std::result::Result<(ResponseHead, RecvStream), CallError> {
    let head = RequestHead { v: protocol::VERSION, method: method.to_string(), path: path.to_string(), headers: headers.iter().map(|(k, v)| (k.to_lowercase(), v.to_string())).collect() };
    open_raw(conn, &protocol::frame(&head), body).await
}

/// Send any bytes as the head (the tests send bad ones), then the body.
pub async fn open_raw(conn: &Connection, frame: &[u8], body: &[u8]) -> std::result::Result<(ResponseHead, RecvStream), CallError> {
    let (mut send, mut recv) = conn.open_bi().await.map_err(gone)?;
    send.write_all(frame).await.map_err(gone)?;
    if !body.is_empty() {
        send.write_all(body).await.map_err(gone)?;
    }
    send.finish().map_err(gone)?;
    match protocol::read_head::<ResponseHead>(&mut recv).await {
        Ok(h) => Ok((h, recv)),
        Err(HeadError::Reset(code)) => Err(CallError::Reset(code)),
        Err(e) => Err(CallError::Gone(e.to_string())),
    }
}

/// One request, the body collected (up to 64 MB).
pub async fn call(conn: &Connection, method: &str, path: &str, headers: &[(&str, &str)], body: &[u8]) -> std::result::Result<Answer, CallError> {
    let (head, mut recv) = open(conn, method, path, headers, body).await?;
    let bytes = recv.read_to_end(64 * 1024 * 1024).await.map_err(gone)?;
    Ok(Answer { status: head.status, headers: head.headers, body: bytes })
}

/// A JSON request with a bearer token.
pub async fn call_json(conn: &Connection, method: &str, path: &str, token: Option<&str>, json: Option<&Value>) -> std::result::Result<Answer, CallError> {
    let auth = token.map(|t| format!("Bearer {t}"));
    let mut headers: Vec<(&str, &str)> = Vec::new();
    if let Some(a) = &auth {
        headers.push(("authorization", a));
    }
    let body = json.map(|j| serde_json::to_vec(j).unwrap()).unwrap_or_default();
    if json.is_some() {
        headers.push(("content-type", "application/json"));
    }
    call(conn, method, path, &headers, &body).await
}

/// Read a streaming body for up to `ms`, or until `until` says so. `ended` is true when the
/// computer finished or reset the stream.
pub async fn read_for(recv: &mut RecvStream, ms: u64, until: Option<fn(&str) -> bool>) -> (String, bool) {
    let deadline = tokio::time::Instant::now() + Duration::from_millis(ms);
    let mut buf = vec![0u8; 64 * 1024];
    let mut text = String::new();
    let mut ended = false;
    loop {
        let now = tokio::time::Instant::now();
        if now >= deadline {
            break;
        }
        match tokio::time::timeout(deadline - now, recv.read(&mut buf)).await {
            Err(_) => break,
            Ok(Ok(Some(n))) => {
                text.push_str(&String::from_utf8_lossy(&buf[..n]));
                if until.map(|u| u(&text)).unwrap_or(false) {
                    break;
                }
            }
            Ok(Ok(None)) | Ok(Err(_)) => {
                ended = true;
                break;
            }
        }
    }
    (text, ended)
}
