//! Phones over iroh: two endpoints in this process, dialled by loopback address with relays off.

mod common;

use common::*;
use iroh::endpoint::{Connection, ConnectionError};
use pager_server::clock::Clock;
use pager_server::remote::client::{self, CallError, Phone};
use pager_server::remote::node::{loopback_addr, IrohOptions};
use pager_server::remote::protocol::{self, close, reset, RequestHead};
use serde_json::{json, Value};
use std::time::Duration;

const ORIGIN: &str = "https://fedora.tail1234.ts.net";

/// A Pager with remote access on and its iroh endpoint bound on loopback, and a phone.
struct Rig {
    t: TestApp,
    phone: Phone,
}

async fn rig() -> Rig {
    let t = make_app_with(Clock::fake("2026-10-26T12:00:00Z"), None, None);
    let on = t.json("PATCH", "/api/settings/app", Some(json!({ "remote": { "enabled": true, "origin": ORIGIN } }))).await;
    assert_eq!(on.status, 200, "{}", on.text);
    t.app.iroh.start(t.app.clone(), t.remote.clone(), IrohOptions::loopback()).await.unwrap();
    let phone = Phone::bind(IrohOptions::loopback()).await.unwrap();
    Rig { t, phone }
}

impl Rig {
    fn addr(&self) -> iroh::EndpointAddr {
        loopback_addr(&self.t.app.iroh.endpoint().unwrap())
    }

    async fn connect(&self) -> Connection {
        self.phone.connect(self.addr()).await.unwrap()
    }

    /// Open a pairing window on the desktop, then connect: the gate lets an unknown phone in while one is open.
    async fn connect_to_pair(&self) -> (Connection, Value) {
        let w = self.t.json("POST", "/api/devices/pairing", None).await;
        assert_eq!(w.status, 201, "{}", w.text);
        (self.connect().await, w.body)
    }

    /// The rest of the ceremony over `conn`, with the window `w`: the phone asks, the desktop allows, the phone collects.
    async fn pair(&self, conn: &Connection, w: &Value, name: &str) -> (String, Value) {
        let req = client::call_json(conn, "POST", "/api/pair", None, Some(&json!({ "code": w["code"], "name": name }))).await.unwrap();
        assert_eq!(req.status, 201, "{}", req.text());
        let state = self.t.get("/api/devices/pairing").await.body;
        assert_eq!(state["pending"]["name"], name);
        assert_eq!(state["pending"]["endpointId"], self.phone.id());
        let ok = self.t.json("POST", "/api/devices/pairing/approve", Some(json!({ "requestId": req.json()["requestId"] }))).await;
        assert_eq!(ok.status, 201, "{}", ok.text);
        let done = client::call_json(conn, "POST", "/api/pair/poll", None, Some(&req.json())).await.unwrap();
        assert_eq!(done.status, 200, "{}", done.text());
        assert!(done.headers.get("set-cookie").is_none(), "no cookie over iroh");
        (done.json()["token"].as_str().unwrap().to_string(), done.json()["device"].clone())
    }

    async fn stop(&self) {
        self.t.app.iroh.stop().await;
        self.phone.close().await;
    }
}

/// Pair over the TCP listener (the Tailscale path), as tests/remote.rs does.
async fn pair_http(t: &TestApp, name: &str) -> String {
    let w = t.json("POST", "/api/devices/pairing", None).await;
    assert_eq!(w.status, 201, "{}", w.text);
    let req = t.remote_call(Call::new("POST", "/api/pair").json(json!({ "code": w.body["code"], "name": name }))).await;
    assert_eq!(req.status, 201, "{}", req.text);
    assert_eq!(t.json("POST", "/api/devices/pairing/approve", Some(json!({ "requestId": req.body["requestId"] }))).await.status, 201);
    let done = t.remote_call(Call::new("POST", "/api/pair/poll").json(req.body.clone())).await;
    assert_eq!(done.status, 200, "{}", done.text);
    done.body["token"].as_str().unwrap().to_string()
}

/// The application close code the computer closed this connection with, within five seconds.
async fn closed_with(conn: &Connection) -> Option<u32> {
    match tokio::time::timeout(Duration::from_secs(5), conn.closed()).await {
        Ok(ConnectionError::ApplicationClosed(c)) => Some(c.error_code.into_inner() as u32),
        Ok(other) => panic!("closed otherwise: {other}"),
        Err(_) => None,
    }
}

fn bearer(token: &str) -> String {
    format!("Bearer {token}")
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unknown_endpoint_is_closed_unless_a_pairing_window_is_open() {
    let r = rig().await;
    let conn = r.connect().await;
    assert_eq!(closed_with(&conn).await, Some(close::NOT_PAIRED));

    // Inside a window only health, pair and poll answer.
    let w = r.t.json("POST", "/api/devices/pairing", None).await.body;
    let conn = r.connect().await;
    let health = client::call(&conn, "GET", "/api/health", &[], b"").await.unwrap();
    assert_eq!(health.status, 200, "{}", health.text());
    let computer = r.t.app.iroh.info().unwrap();
    assert_eq!(health.json()["remote"], json!({ "endpointId": computer.endpoint_id }));
    assert_eq!(health.headers.get("content-type").map(String::as_str), Some("application/json"));
    assert_eq!(client::call(&conn, "GET", "/api/documents", &[], b"").await.unwrap().status, 401);
    assert_eq!(client::call(&conn, "GET", "/api/stream", &[], b"").await.unwrap().status, 401);
    assert_eq!(client::call(&conn, "GET", "/api/nothing", &[], b"").await.unwrap().status, 401);
    let wrong = client::call_json(&conn, "POST", "/api/pair", None, Some(&json!({ "code": "BBBB-BBBB", "name": "x" }))).await.unwrap();
    assert_eq!(wrong.status, 400);
    assert_eq!(r.t.get("/api/devices/pairing").await.body["attempts"], 1);

    // The window carries the phone app's link, with a ticket that names this computer.
    let app_url = w["appUrl"].as_str().unwrap();
    let (ticket, code) = client::parse_pair_link(app_url).unwrap();
    assert_eq!(code, w["code"]);
    assert_eq!(client::addr_from_ticket(&ticket, false).unwrap().id.to_string(), computer.endpoint_id);
    assert!(app_url.len() < 400, "the QR link should stay small: {} chars", app_url.len());
    assert_eq!(r.t.get("/api/devices/pairing").await.body["appUrl"], app_url);
    // The desktop's health names this computer too.
    assert_eq!(r.t.get("/api/health").await.body["remote"]["endpointId"], computer.endpoint_id);
    r.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_paired_phone_reads_and_its_token_is_bound_to_its_endpoint() {
    let r = rig().await;
    r.t.write("a.md", "# A\n\nText.");
    assert_eq!(r.t.get("/api/tree").await.status, 200);
    let (conn, w) = r.connect_to_pair().await;
    let (token, device) = r.pair(&conn, &w, "iPhone").await;
    let auth = bearer(&token);
    let docs = client::call(&conn, "GET", "/api/documents", &[("authorization", &auth)], b"").await.unwrap();
    assert_eq!(docs.status, 200, "{}", docs.text());
    assert_eq!(docs.json()[0]["title"], "A");
    let health = client::call(&conn, "GET", "/api/health", &[("authorization", &auth)], b"").await.unwrap().json();
    assert_eq!(health["remote"]["device"], device);
    assert!(health["remote"]["endpointId"].is_string());
    let listed = r.t.get("/api/devices").await.body;
    assert_eq!(listed[0]["endpointId"], r.phone.id());
    assert!(listed[0]["lastIp"].as_str().unwrap().starts_with("127.0.0.1:"), "{}", listed[0]);

    // The token is useless from another phone, and over the Tailscale path.
    let other = Phone::bind(IrohOptions::loopback()).await.unwrap();
    r.t.json("POST", "/api/devices/pairing", None).await;
    let other_conn = other.connect(r.addr()).await.unwrap();
    assert_eq!(client::call(&other_conn, "GET", "/api/documents", &[("authorization", &auth)], b"").await.unwrap().status, 401);
    assert_eq!(r.t.remote_call(Call::get("/api/documents").token(&token)).await.status, 401);
    r.t.json("DELETE", "/api/devices/pairing", None).await;
    // A cookie means nothing over iroh.
    let cookie = format!("pager_device={token}");
    assert_eq!(client::call(&conn, "GET", "/api/documents", &[("cookie", &cookie)], b"").await.unwrap().status, 401);
    // Nor is a token paired over Tailscale any good over iroh.
    let tcp_token = pair_http(&r.t, "Old phone").await;
    assert_eq!(r.t.remote_call(Call::get("/api/documents").token(&tcp_token)).await.status, 200);
    assert_eq!(client::call(&conn, "GET", "/api/documents", &[("authorization", &bearer(&tcp_token))], b"").await.unwrap().status, 401);
    assert_eq!(r.t.get("/api/devices").await.body[0]["endpointId"], Value::Null);

    // The same phone pairing again replaces its earlier credential.
    let w2 = r.t.json("POST", "/api/devices/pairing", None).await.body;
    let (token2, device2) = r.pair(&conn, &w2, "iPhone again").await;
    assert_ne!(device2["id"], device["id"]);
    assert_eq!(client::call(&conn, "GET", "/api/documents", &[("authorization", &auth)], b"").await.unwrap().status, 401);
    assert_eq!(client::call(&conn, "GET", "/api/documents", &[("authorization", &bearer(&token2))], b"").await.unwrap().status, 200);
    let by_name: Vec<(Value, Value)> = r.t.get("/api/devices").await.body.as_array().unwrap().iter().map(|d| (d["name"].clone(), d["status"].clone())).collect();
    assert_eq!(by_name, vec![(json!("iPhone again"), json!("active")), (json!("Old phone"), json!("active")), (json!("iPhone"), json!("revoked"))]);
    other.close().await;
    r.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_phone_keeps_at_most_four_connections() {
    let r = rig().await;
    let (first, w) = r.connect_to_pair().await;
    r.pair(&first, &w, "iPhone").await;
    let mut more = Vec::new();
    for _ in 0..4 {
        more.push(r.connect().await);
    }
    assert_eq!(closed_with(&first).await, Some(close::TOO_MANY_CONNECTIONS));
    assert_eq!(client::call(&more[3], "GET", "/api/health", &[], b"").await.unwrap().status, 200);
    assert_eq!(r.t.app.iroh.connected(), vec![r.phone.id()]);
    r.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn the_stream_delivers_events_and_ends_on_revoke_and_on_remote_off() {
    let r = rig().await;
    let (conn, w) = r.connect_to_pair().await;
    let (token, device) = r.pair(&conn, &w, "iPhone").await;
    let auth = bearer(&token);
    let (head, mut recv) = client::open(&conn, "GET", "/api/stream", &[("authorization", &auth)], b"").await.unwrap();
    assert_eq!(head.status, 200);
    assert_eq!(head.headers.get("content-type").map(String::as_str), Some("text/event-stream"));
    let reading = tokio::spawn(async move { client::read_for(&mut recv, 3000, Some(|text: &str| text.contains("tree.changed"))).await });
    r.t.write("x.md", "# X\n\nText.");
    r.t.get("/api/tree").await;
    r.t.json("POST", "/api/files", Some(json!({ "dir": "", "title": "Fresh" }))).await;
    let (text, ended) = reading.await.unwrap();
    let kinds = sse_types(&text);
    assert!(kinds.contains(&"document.added".to_string()), "{text}");
    assert!(kinds.contains(&"tree.changed".to_string()), "{text}");
    assert!(!ended);

    // Revoking ends the stream and closes the connection; the next connection is refused.
    let (_, mut live) = client::open(&conn, "GET", "/api/stream", &[("authorization", &auth)], b"").await.unwrap();
    let closing = tokio::spawn(async move { client::read_for(&mut live, 3000, None).await });
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(r.t.json("DELETE", &format!("/api/devices/{}", device["id"].as_str().unwrap()), None).await.status, 204);
    assert!(closing.await.unwrap().1);
    assert_eq!(closed_with(&conn).await, Some(close::REVOKED));
    let again = r.connect().await;
    assert_eq!(closed_with(&again).await, Some(close::NOT_PAIRED));

    // Turning remote access off ends streams and closes every connection.
    let (conn, w) = r.connect_to_pair().await;
    let (token, _) = r.pair(&conn, &w, "iPhone").await;
    let auth = bearer(&token);
    let (_, mut live) = client::open(&conn, "GET", "/api/stream", &[("authorization", &auth)], b"").await.unwrap();
    let closing = tokio::spawn(async move { client::read_for(&mut live, 3000, None).await });
    tokio::time::sleep(Duration::from_millis(50)).await;
    r.t.app.notify(pager_server::core::Notice::RemoteClosing);
    r.t.app.iroh.stop().await;
    assert!(closing.await.unwrap().1);
    assert_eq!(closed_with(&conn).await, Some(close::REMOTE_OFF));
    assert!(!r.t.app.iroh.is_on());
    assert!(r.t.app.iroh.ticket().is_none());
    assert!(r.t.json("POST", "/api/devices/pairing", None).await.body.get("appUrl").is_none());
    r.phone.close().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn bodies_stream_both_ways() {
    let r = rig().await;
    let long: String = (0..3000).map(|i| format!("Paragraph {i} of a long chapter, long enough that one section runs past a single read.\n\n")).collect();
    r.t.write("long.md", &format!("# Long\n\n{long}"));
    assert_eq!(r.t.get("/api/tree").await.status, 200);
    let asset = r.t.app.lock().assets.put(&png_1px()).unwrap();
    let (conn, w) = r.connect_to_pair().await;
    let (token, _) = r.pair(&conn, &w, "iPhone").await;
    let auth = bearer(&token);

    // A large response, identical to the desktop's (an iroh token is no good over Tailscale, by design).
    let doc = r.t.get("/api/documents").await.body[0].clone();
    let id = doc["id"].as_str().unwrap();
    let detail = r.t.get(&format!("/api/documents/{id}")).await.body;
    let path = format!("/api/documents/{id}/sections/{}?include=blocks", detail["toc"][0]["id"].as_str().unwrap());
    let over_iroh = client::call(&conn, "GET", &path, &[("authorization", &auth)], b"").await.unwrap();
    let on_desk = r.t.get(&path).await;
    assert_eq!(over_iroh.status, 200);
    // The first section is capped near 120k characters: well over one 64 KB read.
    assert!(over_iroh.body.len() > 100 * 1024, "{} bytes", over_iroh.body.len());
    assert_eq!(over_iroh.text(), on_desk.text);
    assert_eq!(over_iroh.headers.get("content-length").map(String::as_str), on_desk.headers.get("content-length").map(|v| v.to_str().unwrap()));

    // Bytes out: an image, as the computer stores it.
    let image = client::call(&conn, "GET", &format!("/api/assets/{asset}"), &[("authorization", &auth)], b"").await.unwrap();
    assert_eq!(image.status, 200);
    assert_eq!(image.body, png_1px());
    assert_eq!(image.headers.get("content-type").map(String::as_str), Some("image/png"));

    // A large request body: a full batch of client events, each near its 4 KB payload limit.
    let events: Vec<Value> = (0..100).map(|i| json!({ "type": "nav.toc_used", "docId": id, "payload": { "n": i, "pad": "x".repeat(3500) } })).collect();
    let body = serde_json::to_vec(&events).unwrap();
    assert!(body.len() > 300 * 1024, "{} bytes", body.len());
    let posted = client::call(&conn, "POST", "/api/events", &[("authorization", &auth), ("content-type", "application/json")], &body).await.unwrap();
    assert!(posted.status < 300, "{} {}", posted.status, posted.text());
    assert_eq!(r.t.db_count("SELECT COUNT(*) FROM events WHERE type = 'nav.toc_used'"), 100);

    // Errors are redacted and JSON, as over Tailscale.
    let missing = client::call(&conn, "GET", "/api/documents/nope", &[("authorization", &auth)], b"").await.unwrap();
    assert_eq!(missing.status, 404);
    assert_eq!(missing.json()["error"]["code"], "not_found");
    r.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn bad_heads_reset_the_stream_and_the_connection_goes_on() {
    let r = rig().await;
    let (conn, w) = r.connect_to_pair().await;
    r.pair(&conn, &w, "iPhone").await;
    let frame = |head: &Value| protocol::frame(head);
    let cases: Vec<(&str, Vec<u8>, u32)> = vec![
        ("not JSON", [&[0u8, 0, 0, 3][..], b"xyz"].concat(), reset::BAD_HEAD),
        ("a 1 MB head", vec![0, 16, 0, 0], reset::HEAD_TOO_LARGE),
        ("version 2", frame(&json!({ "v": 2, "method": "GET", "path": "/api/health", "headers": {} })), reset::BAD_VERSION),
        ("no method", frame(&json!({ "v": 1, "path": "/api/health" })), reset::BAD_HEAD),
        ("a method with a space", frame(&json!({ "v": 1, "method": "GET THIS", "path": "/api/health" })), reset::BAD_HEAD),
        ("a path without a slash", frame(&json!({ "v": 1, "method": "GET", "path": "api/health" })), reset::BAD_HEAD),
        ("a path with a newline", frame(&json!({ "v": 1, "method": "GET", "path": "/api/health\nX: y" })), reset::BAD_HEAD),
        ("a header name with a space", frame(&json!({ "v": 1, "method": "GET", "path": "/api/health", "headers": { "bad name": "x" } })), reset::BAD_HEAD),
    ];
    for (what, bytes, code) in cases {
        match client::open_raw(&conn, &bytes, b"").await {
            Err(CallError::Reset(c)) => assert_eq!(c, code, "{what}"),
            Ok((h, _)) => panic!("{what}: answered {}", h.status),
            Err(e) => panic!("{what}: {e}"),
        }
    }
    // A well-formed head still works on the same connection, and a forwarded-for header is ignored.
    let head = RequestHead { v: 1, method: "GET".into(), path: "/api/health".into(), headers: [("x-forwarded-for".to_string(), "10.0.0.1".to_string())].into_iter().collect() };
    let (h, _) = client::open_raw(&conn, &protocol::frame(&head), b"").await.unwrap();
    assert_eq!(h.status, 200);
    r.t.json("POST", "/api/devices/pairing", None).await;
    let w = r.t.get("/api/devices/pairing").await.body;
    client::call(&conn, "POST", "/api/pair", &[("content-type", "application/json"), ("x-forwarded-for", "10.0.0.1")], serde_json::to_vec(&json!({ "code": w["code"], "name": "Spoof" })).unwrap().as_slice()).await.unwrap();
    assert!(r.t.get("/api/devices/pairing").await.body["pending"]["ip"].as_str().unwrap().starts_with("127.0.0.1:"));
    r.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn the_relay_setting_is_checked_and_stored() {
    let t = make_app_with(Clock::fake("2026-10-26T12:00:00Z"), None, None);
    for bad in ["relay.example.com", "ftp://relay.example.com", "https://relay.example.com/?x=1", ""] {
        assert_eq!((bad, t.json("PATCH", "/api/settings/app", Some(json!({ "remote": { "relay": bad } }))).await.status), (bad, 400));
    }
    let ok = t.json("PATCH", "/api/settings/app", Some(json!({ "remote": { "relay": "https://relay.example.com" } }))).await;
    assert_eq!(ok.status, 200, "{}", ok.text);
    assert_eq!(ok.body["app"]["remote"]["relay"], "https://relay.example.com/");
    assert_eq!(t.json("PATCH", "/api/settings/app", Some(json!({ "remote": { "relay": null } }))).await.body["app"]["remote"]["relay"], Value::Null);
}
