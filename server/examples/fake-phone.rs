//! A phone, in Rust: it pairs with this computer over iroh and reads, so the whole path (relay
//! included) can be checked before the iPhone app exists.
//!
//!   cargo run --example fake-phone -- 'pager://pair?v=1&t=...&code=XXXX-XXXX' [--name "Fake phone"] [--key FILE] [--relay-only]
//!   cargo run --example fake-phone -- --ticket <ticket> --token <token> --key FILE [--relay-token RT] [--relay-only]
//!
//! On the computer, open Settings → Phone → Pair a phone, and paste the link the dialog shows under
//! its QR code (the `appUrl` of POST /api/devices/pairing). `--relay-only` drops the direct addresses
//! from the ticket, so the connection goes through the relay. The token is printed once paired, for
//! `--token` later. A token is good only from the endpoint that paired, so keep the phone's key with
//! `--key`: it is read from FILE, or made there on the first run. With your own relay, the link
//! carries its token (`rt`); with `--ticket`, pass it as `--relay-token`. The phone then uses only
//! that relay, as the app does.

use iroh::endpoint::{Connection, ConnectionError};
use pager_server::remote::client::{self, addr_from_ticket, parse_pair_link, CallError, Phone};
use pager_server::remote::identity;
use pager_server::remote::node::IrohOptions;
use serde_json::json;
use std::time::Duration;

fn usage() -> ! {
    eprintln!("usage: fake-phone 'pager://pair?v=1&t=...&code=...' [--name NAME] [--key FILE] [--relay-only]\n       fake-phone --ticket TICKET --token TOKEN --key FILE [--relay-token RT] [--relay-only]");
    std::process::exit(2)
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (mut link, mut ticket, mut token, mut name, mut key, mut relay_only, mut relay_token) = (None, None, None, "Fake phone".to_string(), None, false, None);
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--name" => {
                name = args.get(i + 1).cloned().unwrap_or_else(|| usage());
                i += 2;
            }
            "--ticket" => {
                ticket = args.get(i + 1).cloned();
                i += 2;
            }
            "--token" => {
                token = args.get(i + 1).cloned();
                i += 2;
            }
            "--key" => {
                key = Some(args.get(i + 1).cloned().unwrap_or_else(|| usage()));
                i += 2;
            }
            "--relay-token" => {
                relay_token = Some(args.get(i + 1).cloned().unwrap_or_else(|| usage()));
                i += 2;
            }
            "--relay-only" => {
                relay_only = true;
                i += 1;
            }
            a if a.starts_with("pager://") => {
                link = Some(a.to_string());
                i += 1;
            }
            _ => usage(),
        }
    }
    let (ticket, code) = match (link, ticket) {
        (Some(l), _) => {
            let l = parse_pair_link(&l).unwrap_or_else(|e| fail(&e.message));
            relay_token = relay_token.or(l.relay_token);
            (l.ticket, Some(l.code))
        }
        (None, Some(t)) => (t, None),
        _ => usage(),
    };
    if code.is_none() && token.is_none() {
        usage();
    }

    let addr = addr_from_ticket(&ticket, relay_only).unwrap_or_else(|e| fail(&e.message));
    println!("Computer: {}", addr.id);
    if code.is_none() && key.is_none() {
        eprintln!("fake-phone: without --key this run is a new endpoint, which a token paired from another endpoint doesn't open.");
    }
    let secret_key = key.map(|k| identity::load_or_create_at(std::path::Path::new(&k)).unwrap_or_else(|e| fail(&e.message)));
    let phone = Phone::bind(IrohOptions::phone(secret_key, &addr, relay_token.as_deref())).await.unwrap_or_else(|e| fail(&e.message));
    println!("This phone: {}{}", phone.id(), if relay_token.is_some() { " (your relay, with its token)" } else { "" });
    let conn = phone.connect(addr).await.unwrap_or_else(|e| fail(&e.message));
    println!("Connected.");

    let health = client::call(&conn, "GET", "/api/health", &[], b"").await.unwrap_or_else(|e| fail(&why(&conn, e)));
    println!("health: {} {}", health.status, health.text());

    let token = match (token, code) {
        (Some(t), _) => t,
        (None, Some(code)) => {
            let req = client::call_json(&conn, "POST", "/api/pair", None, Some(&json!({ "code": code, "name": name }))).await.unwrap_or_else(|e| fail(&why(&conn, e)));
            if req.status != 201 {
                fail(&format!("pair: {} {}", req.status, req.text()));
            }
            println!("Asked to pair. Choose Allow on the computer...");
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                let poll = client::call_json(&conn, "POST", "/api/pair/poll", None, Some(&req.json())).await.unwrap_or_else(|e| fail(&why(&conn, e)));
                match poll.status {
                    202 => continue,
                    200 => {
                        let t = poll.json()["token"].as_str().unwrap().to_string();
                        println!("Paired as {}. Token (for --token): {t}", poll.json()["device"]["name"]);
                        break t;
                    }
                    s => fail(&format!("poll: {s} {}", poll.text())),
                }
            }
        }
        _ => usage(),
    };

    let auth = format!("Bearer {token}");
    let docs = client::call(&conn, "GET", "/api/documents", &[("authorization", &auth)], b"").await.unwrap_or_else(|e| fail(&why(&conn, e)));
    if docs.status != 200 {
        fail(&format!("documents: {} {}", docs.status, docs.text()));
    }
    let list = docs.json();
    let titles: Vec<String> = list.as_array().map(|a| a.iter().map(|d| d["title"].as_str().unwrap_or("?").to_string()).collect()).unwrap_or_default();
    println!("{} documents: {}", titles.len(), titles.iter().take(8).cloned().collect::<Vec<_>>().join(" · "));
    let health = client::call(&conn, "GET", "/api/health", &[("authorization", &auth)], b"").await.unwrap_or_else(|e| fail(&why(&conn, e)));
    println!("health as this phone: {}", health.text());

    println!("Following the live stream for five seconds...");
    let (head, mut recv) = client::open(&conn, "GET", "/api/stream", &[("authorization", &auth)], b"").await.unwrap_or_else(|e| fail(&why(&conn, e)));
    if head.status != 200 {
        fail(&format!("stream: {}", head.status));
    }
    let (text, ended) = client::read_for(&mut recv, 5000, None).await;
    let kinds: Vec<&str> = text.lines().filter_map(|l| l.strip_prefix("event: ")).collect();
    println!("events: {:?}{}", kinds, if ended { " (the computer ended the stream)" } else { "" });
    phone.close().await;
}

/// The failed call's error, or the computer's reason when it closed the connection (`not paired`, `revoked`).
fn why(conn: &Connection, e: CallError) -> String {
    match conn.close_reason() {
        Some(ConnectionError::ApplicationClosed(c)) => format!("the computer closed the connection: {}", String::from_utf8_lossy(&c.reason)),
        _ => e.to_string(),
    }
}

fn fail(msg: &str) -> ! {
    eprintln!("fake-phone: {msg}");
    std::process::exit(1)
}
