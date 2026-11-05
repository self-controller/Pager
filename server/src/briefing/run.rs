//! One briefing: extract → seed lookups → the research loop with the model → verify → a Briefing.
//! Everything that costs money is in `research`, which stops at the first cap it reaches.

use super::extract::{BookInput, Extracted};
use super::lookup::Lookups;
use super::prompt::{system_prompt, tools, user_message, BUDGET_SPENT, NUDGE};
use super::schema::*;
use super::secrets::ApiKey;
use super::transport::{OutError, OutRequest, Transport};
use super::verify::{verify_shaped, Evidence, Report, Shape};
use super::*;
use crate::app::App;
use serde_json::{json, Value};
use std::result::Result;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Where a run is, for the reader's progress line.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    Queued,
    Reading,
    Researching,
    Checking,
    Done,
    Failed,
}

impl Stage {
    pub fn as_str(self) -> &'static str {
        match self {
            Stage::Queued => "queued",
            Stage::Reading => "reading",
            Stage::Researching => "researching",
            Stage::Checking => "checking",
            Stage::Done => "done",
            Stage::Failed => "failed",
        }
    }
}

/// Why a run stopped without a briefing. `message` is shown to the reader as is.
#[derive(Clone, Debug, PartialEq)]
pub enum Failure {
    NotConfigured,
    KeyRefused,
    Busy,
    Network(String),
    Api(String),
    Cap(String),
    Refusal,
    NoSubmission,
    Timeout,
    Book(String),
    Internal(String),
}

impl Failure {
    pub fn message(&self) -> String {
        match self {
            Failure::NotConfigured => "Context needs an API key on the computer.".into(),
            Failure::KeyRefused => "Anthropic refused the API key. Check ANTHROPIC_API_KEY on the computer.".into(),
            Failure::Busy => "Anthropic's API is busy right now. Try again in a minute.".into(),
            Failure::Network(m) => format!("Couldn't reach Anthropic's API ({m}). Check the connection and try again."),
            Failure::Api(m) => format!("Anthropic's API returned an error: {m}"),
            Failure::Cap(m) => format!("{m} Nothing was saved."),
            Failure::Refusal => "The model declined to write this briefing.".into(),
            Failure::NoSubmission => "The model finished without handing in a briefing. Nothing was saved.".into(),
            Failure::Timeout => "The briefing took too long and was stopped. Nothing was saved.".into(),
            Failure::Book(m) => m.clone(),
            Failure::Internal(m) => format!("Something went wrong while writing the briefing ({m})."),
        }
    }
}

/// Token, search and call counts across a run.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Usage {
    pub calls: u32,
    pub input: u64,
    pub cache_write: u64,
    pub cache_read: u64,
    pub output: u64,
    pub searches: u32,
    pub fetches: u32,
}

impl Usage {
    pub fn add(&mut self, u: &Value) {
        let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
        self.input += n("input_tokens");
        self.cache_write += n("cache_creation_input_tokens");
        self.cache_read += n("cache_read_input_tokens");
        self.output += n("output_tokens");
        let st = u.get("server_tool_use");
        self.searches += st.and_then(|s| s.get("web_search_requests")).and_then(Value::as_u64).unwrap_or(0) as u32;
        self.fetches += st.and_then(|s| s.get("web_fetch_requests")).and_then(Value::as_u64).unwrap_or(0) as u32;
    }

    pub fn total_input(&self) -> u64 {
        self.input + self.cache_write + self.cache_read
    }

    /// An estimate at Sonnet's list prices.
    pub fn cost_usd(&self) -> f64 {
        self.input as f64 * PRICE_INPUT + self.cache_write as f64 * PRICE_CACHE_WRITE + self.cache_read as f64 * PRICE_CACHE_READ + self.output as f64 * PRICE_OUTPUT + self.searches as f64 * PRICE_SEARCH
    }

    pub fn to_json(&self) -> Value {
        json!({
            "calls": self.calls, "inputTokens": self.input, "cacheWriteTokens": self.cache_write, "cacheReadTokens": self.cache_read,
            "outputTokens": self.output, "searches": self.searches, "fetches": self.fetches, "costUsd": (self.cost_usd() * 10000.0).round() / 10000.0,
        })
    }

    pub fn summary(&self) -> String {
        format!(
            "{} calls, input {}k (cache read {}k, written {}k), output {}k, {} searches, {} fetches, ≈ ${:.2}",
            self.calls,
            (self.total_input() + 500) / 1000,
            (self.cache_read + 500) / 1000,
            (self.cache_write + 500) / 1000,
            (self.output + 500) / 1000,
            self.searches,
            self.fetches,
            self.cost_usd()
        )
    }
}

/// The run's caps. `Limits::default()` is what the server uses; tests lower them.
#[derive(Clone, Debug)]
pub struct Limits {
    pub max_calls: u32,
    pub max_tokens_per_call: u32,
    pub max_output_tokens: u64,
    pub max_input_tokens: u64,
    pub search_hard_cap: u32,
    pub fetch_hard_cap: u32,
    pub model_lookups: u32,
    pub verify_lookups: u32,
    pub call_timeout: Duration,
    pub run_timeout: Duration,
    /// Waits before retrying a busy or failed call (one entry per retry).
    pub retry_delays: Vec<Duration>,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_calls: MAX_CALLS,
            max_tokens_per_call: MAX_TOKENS_PER_CALL,
            max_output_tokens: MAX_OUTPUT_TOKENS,
            max_input_tokens: MAX_INPUT_TOKENS,
            search_hard_cap: SEARCH_HARD_CAP,
            fetch_hard_cap: FETCH_HARD_CAP,
            model_lookups: MODEL_LOOKUPS,
            verify_lookups: VERIFY_LOOKUPS,
            call_timeout: CALL_TIMEOUT,
            run_timeout: RUN_TIMEOUT,
            retry_delays: vec![Duration::from_secs(4), Duration::from_secs(12)],
        }
    }
}

/// The main title, for catalogue searches: before a slash, colon or semicolon, and before ", or".
pub fn main_title(t: &str) -> String {
    let cut = t.split(['/', ':', ';']).next().unwrap_or(t);
    let lower = cut.to_lowercase();
    let cut = match lower.find(", or ").or_else(|| lower.find("; or ")) {
        Some(i) => &cut[..i],
        None => cut,
    };
    cut.trim().to_string()
}

/// Open Library's guesses for the book, and Wikidata's for its first author.
pub async fn seed(lookups: &Lookups, book: &BookInput) -> Value {
    let title = main_title(&book.title);
    let author = book.authors.first().cloned();
    let books = lookups.find_book(&title, author.as_deref(), 3).await.unwrap_or_default();
    let people = match &author {
        Some(a) => lookups.wikidata_search(a, 3).await.unwrap_or_default(),
        None => vec![],
    };
    json!({ "openLibrary": books, "wikidataAuthor": people })
}

/// The request body for one call, given the conversation so far.
pub fn request_body(messages: &[Value], max_tokens: u32) -> Value {
    json!({
        "model": MODEL,
        "max_tokens": max_tokens,
        "system": [{ "type": "text", "text": system_prompt() }],
        "messages": messages,
        "tools": tools(),
        "tool_choice": { "type": "auto" },
        "output_config": { "effort": EFFORT },
        "cache_control": { "type": "ephemeral" },
        "fallbacks": "default",
    })
}

/// The first request of a run, as it would be sent (for `context-live --dry-run`).
pub fn first_request(level: Level, book: &BookInput, seed: &Value, focus: Option<&str>) -> Value {
    request_body(&[json!({ "role": "user", "content": user_message(level, book, seed, focus) })], MAX_TOKENS_PER_CALL)
}

async fn call_api(transport: &Arc<dyn Transport>, key: &ApiKey, body: &Value, limits: &Limits) -> Result<Value, Failure> {
    let bytes = serde_json::to_vec(body).map_err(|e| Failure::Internal(e.to_string()))?;
    let mut attempt = 0;
    loop {
        let req = OutRequest {
            method: "POST",
            url: API_URL.to_string(),
            headers: vec![
                ("x-api-key".into(), key.expose().to_string()),
                ("anthropic-version".into(), API_VERSION.into()),
                ("anthropic-beta".into(), FALLBACK_BETA.into()),
                ("content-type".into(), "application/json".into()),
            ],
            body: Some(bytes.clone()),
            timeout: limits.call_timeout,
            max_bytes: 16 * 1024 * 1024,
        };
        let failure = match transport.send(req).await {
            Ok(r) if r.status == 200 => return serde_json::from_slice(&r.body).map_err(|_| Failure::Api("the answer wasn't JSON".into())),
            Ok(r) => {
                let msg = serde_json::from_slice::<Value>(&r.body).ok().and_then(|v| v.get("error").and_then(|e| e.get("message")).and_then(Value::as_str).map(str::to_string)).unwrap_or_else(|| format!("HTTP {}", r.status));
                match r.status {
                    401 | 403 => return Err(Failure::KeyRefused),
                    429 | 500 | 502 | 503 | 504 | 529 => Failure::Busy,
                    _ => return Err(Failure::Api(msg)),
                }
            }
            Err(OutError::Timeout) => Failure::Network("the request timed out".into()),
            Err(OutError::Refused) => return Err(Failure::Network("outbound requests are off".into())),
            Err(OutError::Network(m)) => Failure::Network(m),
        };
        match limits.retry_delays.get(attempt) {
            Some(d) => {
                tokio::time::sleep(*d).await;
                attempt += 1;
            }
            None => return Err(failure),
        }
    }
}

fn tool_result(id: &str, content: String, is_error: bool) -> Value {
    json!({ "type": "tool_result", "tool_use_id": id, "content": content, "is_error": is_error })
}

pub struct Research {
    pub draft: Draft,
    pub evidence: Evidence,
    pub model: String,
}

/// The loop with the model. Stops at the first cap, refusal or error; returns the usage either way.
#[allow(clippy::too_many_arguments)]
pub async fn research(transport: &Arc<dyn Transport>, key: &ApiKey, level: Level, book: &BookInput, seed: &Value, focus: Option<&str>, lookups: &Lookups, limits: &Limits, usage: &mut Usage) -> Result<Research, Failure> {
    let started = Instant::now();
    let (search_budget, fetch_budget) = if focus.is_some() { (FOCUS_SEARCH_BUDGET, FOCUS_FETCH_BUDGET) } else { (SEARCH_BUDGET, FETCH_BUDGET) };
    let mut messages: Vec<Value> = vec![json!({ "role": "user", "content": user_message(level, book, seed, focus) })];
    let mut evidence = Evidence::default();
    let mut model = MODEL.to_string();
    let mut nudged = false;
    loop {
        if usage.calls >= limits.max_calls {
            return Err(Failure::Cap(format!("The briefing reached its limit of {} API calls.", limits.max_calls)));
        }
        if usage.output >= limits.max_output_tokens {
            return Err(Failure::Cap(format!("The briefing reached its limit of {} output tokens.", limits.max_output_tokens)));
        }
        if usage.total_input() >= limits.max_input_tokens {
            return Err(Failure::Cap(format!("The briefing reached its limit of {} input tokens.", limits.max_input_tokens)));
        }
        if usage.searches > limits.search_hard_cap || usage.fetches > limits.fetch_hard_cap {
            return Err(Failure::Cap("The briefing kept searching past its budget.".into()));
        }
        if started.elapsed() >= limits.run_timeout {
            return Err(Failure::Timeout);
        }
        let resp = call_api(transport, key, &request_body(&messages, limits.max_tokens_per_call), limits).await?;
        usage.calls += 1;
        if let Some(u) = resp.get("usage") {
            usage.add(u);
        }
        if let Some(m) = resp.get("model").and_then(Value::as_str) {
            model = m.to_string();
        }
        let content = resp.get("content").cloned().unwrap_or(Value::Array(vec![]));
        evidence.collect(&content);
        messages.push(json!({ "role": "assistant", "content": content }));
        let stop = resp.get("stop_reason").and_then(Value::as_str).unwrap_or("");
        match stop {
            "tool_use" => {
                let mut results = Vec::new();
                for block in content.as_array().into_iter().flatten().filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_use")) {
                    let id = block.get("id").and_then(Value::as_str).unwrap_or("");
                    let input = block.get("input").cloned().unwrap_or(Value::Null);
                    let s = |k: &str| input.get(k).and_then(Value::as_str).map(str::trim).filter(|x| !x.is_empty()).map(str::to_string);
                    match block.get("name").and_then(Value::as_str).unwrap_or("") {
                        "submit_briefing" => match serde_json::from_value::<Draft>(input.clone()) {
                            Ok(draft) => return Ok(Research { draft, evidence, model }),
                            Err(e) => results.push(tool_result(id, format!("The briefing didn't match the schema ({e}). Fix it and call submit_briefing again."), true)),
                        },
                        "find_book" => match s("title") {
                            Some(t) => match lookups.find_book(&t, s("author").as_deref(), 5).await {
                                Ok(hits) => results.push(tool_result(id, json!(hits).to_string(), false)),
                                Err(e) => results.push(tool_result(id, format!("Open Library couldn't be searched ({e})."), true)),
                            },
                            None => results.push(tool_result(id, "Give a title.".into(), true)),
                        },
                        "find_entity" => match s("name") {
                            Some(n) => match lookups.wikidata_search(&n, 5).await {
                                Ok(hits) => results.push(tool_result(id, json!(hits).to_string(), false)),
                                Err(e) => results.push(tool_result(id, format!("Wikidata couldn't be searched ({e})."), true)),
                            },
                            None => results.push(tool_result(id, "Give a name.".into(), true)),
                        },
                        "find_article" => match s("query") {
                            Some(q) => match lookups.find_article(&q, 5).await {
                                Ok(hits) => results.push(tool_result(id, json!(hits).to_string(), false)),
                                Err(e) => results.push(tool_result(id, format!("Crossref couldn't be searched ({e})."), true)),
                            },
                            None => results.push(tool_result(id, "Give a query.".into(), true)),
                        },
                        other => results.push(tool_result(id, format!("There is no tool called {other}."), true)),
                    }
                }
                if results.is_empty() {
                    return Err(Failure::Api("the model asked for a tool but named none".into()));
                }
                if usage.searches >= search_budget || usage.fetches >= fetch_budget {
                    results.push(json!({ "type": "text", "text": BUDGET_SPENT }));
                }
                messages.push(json!({ "role": "user", "content": results }));
            }
            // The server paused its own loop: send the conversation back as it is.
            "pause_turn" => {}
            "end_turn" | "stop_sequence" => {
                if nudged {
                    return Err(Failure::NoSubmission);
                }
                nudged = true;
                messages.push(json!({ "role": "user", "content": NUDGE }));
            }
            "max_tokens" => return Err(Failure::Cap("The briefing ran past its length limit.".into())),
            "refusal" => return Err(Failure::Refusal),
            other => return Err(Failure::Api(format!("the model stopped unexpectedly ({other})"))),
        }
    }
}

pub struct Generated {
    pub briefing: Briefing,
    pub report: Report,
    pub usage: Usage,
}

/// A briefing for a document, or (with `focus`) on one name or work in it. `progress` hears each stage.
pub async fn generate(app: &Arc<App>, doc_id: &str, level: Level, focus: Option<&str>, limits: &Limits, progress: &(dyn Fn(Stage) + Send + Sync)) -> Result<Generated, (Failure, Usage)> {
    let started = Instant::now();
    let mut usage = Usage::default();
    let Some(key) = app.briefing.key().cloned() else { return Err((Failure::NotConfigured, usage)) };
    progress(Stage::Reading);
    let doc = doc_id.to_string();
    let extracted: Extracted = app.run(move |c| c.briefing_extract(&doc)).await.map_err(|e| (Failure::Book(e.message), usage))?;
    let transport = app.briefing.transport.clone();
    progress(Stage::Researching);
    let lookups = Lookups::new(transport.clone(), limits.model_lookups);
    let seed_records = seed(&lookups, &extracted.input).await;
    let research = match research(&transport, &key, level, &extracted.input, &seed_records, focus, &lookups, limits, &mut usage).await {
        Ok(r) => r,
        Err(f) => return Err((f, usage)),
    };
    progress(Stage::Checking);
    Ok(finish(app, extracted, level, focus.map(str::to_string), research, usage, lookups.used(), limits, started).await)
}

/// Verify a draft and assemble the briefing. Also used for drafts written elsewhere (the
/// `context-live --draft` check, where Claude Code agents stand in for the API).
#[allow(clippy::too_many_arguments)]
pub async fn finish(app: &Arc<App>, extracted: Extracted, level: Level, focus: Option<String>, research: Research, usage: Usage, model_lookups: u32, limits: &Limits, started: Instant) -> Generated {
    let verifier = Lookups::new(app.briefing.transport.clone(), limits.verify_lookups);
    let mut evidence = research.evidence;
    evidence.book = extracted.input.front_matter.iter().map(|f| format!("{}\n{}", f.title, f.text)).collect::<Vec<_>>().join("\n\n");
    let shape = if focus.is_some() { Shape::Focus } else { Shape::Book };
    let checked = verify_shaped(research.draft, &evidence, &verifier, shape).await;
    let report = checked.report;
    let stats = Stats {
        claims_kept: report.claims_kept,
        claims_dropped: report.claims_dropped,
        works_kept: report.works_kept,
        works_dropped: report.works_dropped,
        links_kept: report.links_kept,
        links_dropped: report.links_dropped,
        api_calls: usage.calls,
        searches: usage.searches,
        fetches: usage.fetches,
        lookups: model_lookups + verifier.used(),
        input_tokens: usage.input,
        cache_read_tokens: usage.cache_read,
        cache_write_tokens: usage.cache_write,
        output_tokens: usage.output,
        cost_usd: (usage.cost_usd() * 10000.0).round() / 10000.0,
        duration_ms: started.elapsed().as_millis() as u64,
    };
    let briefing = Briefing {
        version: BRIEFING_VERSION,
        doc_id: extracted.doc_id,
        level,
        focus,
        content_hash: extracted.content_hash,
        generated_at: app.clock.iso(),
        model: research.model,
        little_known: checked.little_known,
        sections: checked.sections,
        entities: checked.entities,
        links: checked.links,
        stats,
    };
    Generated { briefing, report, usage }
}
