//! A dev server whose model is a recording: for checking Context's UI while a briefing is made, at no
//! cost and with no key.
//!
//!   PAGER_DATA_DIR=<a scratch copy of server/.data-dev> cargo run --example context-replay
//!
//! It runs the reading service like `pager-server` (port 3006, the `reads/` library), but every call to
//! Anthropic's API is answered here, from the test fixtures (tests/fixtures/context), after a pause
//! (`REPLAY_DELAY_MS`, default 8000; `REPLAY_FETCH_DELAY_MS` slows the catalogue and page requests too,
//! to watch the checking). Nothing is ever sent to the API and no key is read: the key it
//! holds is a placeholder. The catalogues and pages the verifier checks are fetched for real (free).
//!
//! The briefing it makes is the fixtures' Darwin one, whatever the book: point it at a copy of the dev
//! data, never at your own.

use futures::future::BoxFuture;
use pager_server::app::AppOptions;
use pager_server::briefing::secrets::ApiKey;
use pager_server::briefing::transport::{LiveTransport, OutError, OutRequest, OutResponse, Transport};
use pager_server::briefing::API_URL;
use pager_server::config::{default_data_dir, default_port, default_reads_dir, default_remote_port, web_dir};
use pager_server::server::{start, StartOptions};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

const RESEARCH: &str = include_str!("../tests/fixtures/context/api-1-research.json");
const PAUSE: &str = include_str!("../tests/fixtures/context/api-2-pause.json");
const SUBMIT: &str = include_str!("../tests/fixtures/context/api-3-submit.json");

/// A few more searches and reads in the first answer, one of each failing, so the progress view has
/// something like a real run's list. Display only: their pages hold no text the briefing quotes.
fn research() -> Value {
    let mut v: Value = serde_json::from_str(RESEARCH).unwrap();
    let mut extra = Vec::new();
    for (i, q) in ["Darwin Malthus 1838 notebook reading", "Origin of Species reception 1860 Huxley Wilberforce", "Lyell Principles of Geology influence on Darwin"].iter().enumerate() {
        let id = format!("srvtoolu_replay_s{i}");
        extra.push(json!({ "type": "server_tool_use", "id": id, "name": "web_search", "input": { "query": q } }));
        let content = if i == 1 { json!({ "type": "web_search_tool_result_error", "error_code": "unavailable" }) } else { json!([]) };
        extra.push(json!({ "type": "web_search_tool_result", "tool_use_id": id, "content": content }));
    }
    for (i, (url, ok)) in [("https://www.darwinproject.ac.uk/commentary/life-sciences/darwin-and-malthus", true), ("https://www.britannica.com/biography/Thomas-Malthus", false)].iter().enumerate() {
        let id = format!("srvtoolu_replay_f{i}");
        extra.push(json!({ "type": "server_tool_use", "id": id, "name": "web_fetch", "input": { "url": url } }));
        let content = if *ok { json!({ "type": "web_fetch_result", "url": url, "content": { "type": "document", "source": { "type": "text", "media_type": "text/plain", "data": "" }, "title": "Darwin and Malthus" } }) } else { json!({ "type": "web_fetch_tool_error", "error_code": "url_not_accessible" }) };
        extra.push(json!({ "type": "web_fetch_tool_result", "tool_use_id": id, "content": content }));
    }
    let content = v["content"].as_array_mut().unwrap();
    // After the opening text, before the fixture's own search.
    for (i, b) in extra.into_iter().enumerate() {
        content.insert(1 + i, b);
    }
    v
}

/// Answers the model's API from the recording, by where the conversation is (its message count);
/// everything else goes out for real.
struct Replay {
    live: LiveTransport,
    delay: Duration,
    /// Added before each catalogue or page request (`REPLAY_FETCH_DELAY_MS`), to watch the checking.
    fetch_delay: Duration,
}

impl Transport for Replay {
    fn send(&self, req: OutRequest) -> BoxFuture<'_, Result<OutResponse, OutError>> {
        Box::pin(async move {
            if req.url != API_URL {
                tokio::time::sleep(self.fetch_delay).await;
                return self.live.send(req).await;
            }
            tokio::time::sleep(self.delay).await;
            let body: Value = req.body.as_deref().and_then(|b| serde_json::from_slice(b).ok()).unwrap_or(Value::Null);
            let turns = body["messages"].as_array().map(Vec::len).unwrap_or(0);
            let answer = match turns {
                1 => research(),
                3 => serde_json::from_str(PAUSE).unwrap(),
                _ => serde_json::from_str(SUBMIT).unwrap(),
            };
            Ok(OutResponse { status: 200, url: req.url, content_type: "application/json".into(), body: answer.to_string().into_bytes(), truncated: false })
        })
    }
}

#[tokio::main]
async fn main() {
    let data_dir = default_data_dir();
    let reads_dir = default_reads_dir();
    let port = default_port();
    let ms = |var: &str, default: u64| std::env::var(var).ok().and_then(|v| v.parse().ok()).unwrap_or(default);
    let delay = ms("REPLAY_DELAY_MS", 8000);
    let fetch_delay = ms("REPLAY_FETCH_DELAY_MS", 0);
    let mut app = AppOptions::new(data_dir.clone());
    app.reads_dir = Some(reads_dir.clone());
    app.port = port;
    app.remote_port = default_remote_port();
    app.web = web_dir();
    // A placeholder: the replay answers the API itself, so no key is read and none is sent.
    app.anthropic_key = ApiKey::new("replay-placeholder-not-a-key");
    app.briefing_transport = Some(Arc::new(Replay { live: LiveTransport::new().expect("outbound HTTPS"), delay: Duration::from_millis(delay), fetch_delay: Duration::from_millis(fetch_delay) }));
    let mut running = start(StartOptions { app, watch: true, idle_shutdown: false }).await.unwrap_or_else(|e| {
        eprintln!("{}", e.message);
        std::process::exit(1);
    });
    println!("Pager (Context replay, {delay} ms a call) at http://localhost:{port}  (library: {}, data: {})", reads_dir.display(), data_dir.display());
    tokio::select! {
        _ = running.wait_for_shutdown() => {}
        _ = tokio::signal::ctrl_c() => {}
    }
    running.close().await;
}
