//! The bridge: a connection is let in when its endpoint ID belongs to an active device, or while a
//! pairing window is open; each `pager/1` stream becomes one request to the remote app, called in
//! this process with the peer's identity attached as a request extension that no header can forge.

use crate::app::App;
use crate::core::Notice;
use crate::http::Peer;
use crate::remote::protocol::{self, close, reset, HeadError, RequestHead, ResponseHead};
use axum::body::{Body, Bytes};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, Request, Uri};
use axum::Router;
use http_body_util::BodyExt;
use iroh::endpoint::{Accepting, Connection, IncomingAddr, RecvStream, SendStream};
use iroh::{Endpoint, EndpointId};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast::error::RecvError;
use tower::ServiceExt;

/// Connections kept per endpoint ID; the oldest is closed when a phone opens more.
pub const MAX_CONNECTIONS_PER_PEER: usize = 4;
/// Requests in flight per connection.
pub const MAX_STREAMS_PER_CONNECTION: u32 = 32;
const READ_CHUNK: usize = 64 * 1024;

/// The open connections, so a revocation or stop can close a phone's at once.
#[derive(Clone, Default)]
pub struct Conns(Arc<Mutex<Vec<(EndpointId, Connection)>>>);

impl Conns {
    fn add(&self, id: EndpointId, conn: Connection) {
        let mut v = self.0.lock().unwrap();
        let mine: Vec<usize> = v.iter().enumerate().filter(|(_, (i, _))| *i == id).map(|(n, _)| n).collect();
        if mine.len() >= MAX_CONNECTIONS_PER_PEER {
            let (_, old) = v.remove(mine[0]);
            old.close(protocol::code(close::TOO_MANY_CONNECTIONS), b"too many connections");
        }
        v.push((id, conn));
    }

    fn remove(&self, conn: &Connection) {
        self.0.lock().unwrap().retain(|(_, c)| c.stable_id() != conn.stable_id());
    }

    pub fn close_peer(&self, endpoint_id: &str, code: u32, reason: &[u8]) {
        let gone: Vec<Connection> = {
            let mut v = self.0.lock().unwrap();
            let (gone, keep): (Vec<_>, Vec<_>) = v.drain(..).partition(|(i, _)| i.to_string() == endpoint_id);
            *v = keep;
            gone.into_iter().map(|(_, c)| c).collect()
        };
        for c in gone {
            c.close(protocol::code(code), reason);
        }
    }

    pub fn close_all(&self, code: u32, reason: &[u8]) {
        let all: Vec<Connection> = self.0.lock().unwrap().drain(..).map(|(_, c)| c).collect();
        for c in all {
            c.close(protocol::code(code), reason);
        }
    }

    pub fn peers(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.0.lock().unwrap().iter().map(|(i, _)| i.to_string()).collect();
        ids.sort();
        ids.dedup();
        ids
    }
}

/// Accept connections until the endpoint closes.
pub async fn accept_loop(app: Arc<App>, endpoint: Endpoint, router: Router, conns: Conns) {
    while let Some(incoming) = endpoint.accept().await {
        let from = match incoming.remote_addr() {
            IncomingAddr::Ip(s) => s.to_string(),
            IncomingAddr::Relay { .. } => "relay".to_string(),
            _ => "unknown".to_string(),
        };
        let Ok(accepting) = incoming.accept() else { continue };
        tokio::spawn(serve_connection(app.clone(), router.clone(), conns.clone(), accepting, from));
    }
}

async fn serve_connection(app: Arc<App>, router: Router, conns: Conns, accepting: Accepting, from: String) {
    let Ok(conn) = accepting.await else { return };
    let id = conn.remote_id();
    let endpoint_id = id.to_string();
    let asking = endpoint_id.clone();
    let allowed = app.run(move |c| Ok(c.peer_may_connect(&asking))).await.unwrap_or(false);
    if !allowed {
        conn.close(protocol::code(close::NOT_PAIRED), b"not paired");
        return;
    }
    conn.set_max_concurrent_bi_streams(protocol::code(MAX_STREAMS_PER_CONNECTION));
    conns.add(id, conn.clone());
    let peer = Peer { endpoint_id, addr: from };
    loop {
        let Ok((send, recv)) = conn.accept_bi().await else { break };
        tokio::spawn(serve_stream(router.clone(), peer.clone(), send, recv));
    }
    conns.remove(&conn);
}

/// One request: head in, the app's answer out, the body streamed both ways.
async fn serve_stream(router: Router, peer: Peer, mut send: SendStream, mut recv: RecvStream) {
    let head: RequestHead = match protocol::read_head(&mut recv).await {
        Ok(h) => h,
        Err(HeadError::Reset(_)) | Err(HeadError::Gone(_)) => return,
        Err(e) => return reject(&mut send, &mut recv, e.reset_code()),
    };
    if head.v != protocol::VERSION {
        return reject(&mut send, &mut recv, reset::BAD_VERSION);
    }
    let (method, uri, headers) = match validate(&head) {
        Ok(v) => v,
        Err(code) => return reject(&mut send, &mut recv, code),
    };
    let mut req = Request::builder().method(method).uri(uri).body(body_from(recv)).expect("a validated request builds");
    *req.headers_mut() = headers;
    req.extensions_mut().insert(peer);
    let res = match router.oneshot(req).await {
        Ok(r) => r,
        Err(never) => match never {},
    };
    let (parts, mut body) = res.into_parts();
    let head = ResponseHead { status: parts.status.as_u16(), headers: flatten(&parts.headers) };
    if protocol::write_head(&mut send, &head).await.is_err() {
        return;
    }
    // The phone stopping the stream drops the body here, which ends a live stream at once.
    let stopped = send.stopped();
    tokio::pin!(stopped);
    loop {
        tokio::select! {
            frame = body.frame() => match frame {
                Some(Ok(f)) => {
                    if let Some(data) = f.data_ref() {
                        if send.write_all(data).await.is_err() {
                            return;
                        }
                    }
                }
                Some(Err(_)) => {
                    let _ = send.reset(protocol::code(reset::INTERNAL));
                    return;
                }
                None => break,
            },
            _ = &mut stopped => return,
        }
    }
    let _ = send.finish();
}

fn reject(send: &mut SendStream, recv: &mut RecvStream, code: u32) {
    let _ = send.reset(protocol::code(code));
    let _ = recv.stop(protocol::code(code));
}

/// The head's method, path and headers as the app will see them, or the code to reset with.
fn validate(head: &RequestHead) -> Result<(Method, Uri, HeaderMap), u32> {
    let method = Method::from_bytes(head.method.as_bytes()).map_err(|_| reset::BAD_HEAD)?;
    if !head.path.starts_with('/') || head.path.starts_with("//") || head.path.contains(['\r', '\n', ' ']) {
        return Err(reset::BAD_HEAD);
    }
    let uri: Uri = format!("http://pager.remote{}", head.path).parse().map_err(|_| reset::BAD_HEAD)?;
    let mut headers = HeaderMap::new();
    for (k, v) in &head.headers {
        let name = HeaderName::from_bytes(k.as_bytes()).map_err(|_| reset::BAD_HEAD)?;
        let value = HeaderValue::from_str(v).map_err(|_| reset::BAD_HEAD)?;
        headers.append(name, value);
    }
    // Where the request came from is the QUIC handshake's business, not a header's.
    headers.remove("x-forwarded-for");
    headers.insert(header::HOST, HeaderValue::from_static("pager.remote"));
    Ok((method, uri, headers))
}

/// The rest of the stream after the head, as the request body.
fn body_from(mut recv: RecvStream) -> Body {
    Body::from_stream(async_stream::stream! {
        let mut buf = vec![0u8; READ_CHUNK];
        loop {
            match recv.read(&mut buf).await {
                Ok(Some(n)) => yield Ok::<Bytes, std::io::Error>(Bytes::copy_from_slice(&buf[..n])),
                Ok(None) => break,
                Err(e) => {
                    yield Err(std::io::Error::other(e.to_string()));
                    break;
                }
            }
        }
    })
}

/// Response headers as the head carries them: one string per name, repeats joined with ", ".
fn flatten(headers: &HeaderMap) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for name in headers.keys() {
        let values: Vec<String> = headers.get_all(name).iter().map(|v| String::from_utf8_lossy(v.as_bytes()).into_owned()).collect();
        out.insert(name.as_str().to_string(), values.join(", "));
    }
    out
}

/// Close a phone's connections the moment its device is revoked on the computer.
pub async fn watch_revocations(app: Arc<App>, conns: Conns) {
    let mut rx = app.notices.subscribe();
    loop {
        match rx.recv().await {
            Ok(Notice::DeviceRevoked(device_id)) => {
                let id = device_id.clone();
                if let Ok(Some(endpoint_id)) = app.run(move |c| c.device_endpoint_of(&id)).await {
                    conns.close_peer(&endpoint_id, close::REVOKED, b"revoked");
                }
            }
            Err(RecvError::Closed) => break,
            _ => {}
        }
    }
}
