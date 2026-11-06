//! One briefing: extract → seed lookups → the research loop with the model → verify → a Briefing.
//! Everything that costs money is in `research`, which stops at the first cap it reaches.

use super::extract::{BookInput, Extracted};
use super::lookup::Lookups;
use super::prompt::{system_prompt, tools, user_message, BUDGET_SPENT, NUDGE};
use super::schema::*;
use super::secrets::ApiKey;
use super::transport::{OutError, OutRequest, Transport};
use super::verify::{draft_counts, verify_shaped, Evidence, Report, Shape};
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

/// What `generate` reports while it works: the stage, each step, and what the checker has before it.
#[derive(Clone, Debug, PartialEq)]
pub enum Progress {
    Stage(Stage),
    Step(RunStep),
    Checking(Checking),
}

/// The steps a response from the model holds: its web searches and the pages it read, in order. A
/// tool whose result is an error (`error_code`) is marked not ok; one whose result isn't in this
/// response (a paused turn) counts as ok.
pub fn steps_in(content: &Value) -> Vec<RunStep> {
    let blocks: &[Value] = content.as_array().map(Vec::as_slice).unwrap_or(&[]);
    let result_for = |id: &str| blocks.iter().find(|b| matches!(b.get("type").and_then(Value::as_str), Some("web_search_tool_result" | "web_fetch_tool_result")) && b.get("tool_use_id").and_then(Value::as_str) == Some(id));
    let mut steps = Vec::new();
    for b in blocks.iter().filter(|b| b.get("type").and_then(Value::as_str) == Some("server_tool_use")) {
        let id = b.get("id").and_then(Value::as_str).unwrap_or("");
        let input = b.get("input");
        let text = |k: &str| input.and_then(|i| i.get(k)).and_then(Value::as_str).map(str::trim).filter(|x| !x.is_empty()).map(str::to_string);
        let result = result_for(id).and_then(|r| r.get("content"));
        let ok = result.map(|c| c.get("error_code").is_none()).unwrap_or(true);
        match b.get("name").and_then(Value::as_str) {
            Some("web_search") => {
                if let Some(query) = text("query") {
                    steps.push(RunStep::Search { query, ok });
                }
            }
            Some("web_fetch") => {
                let url = text("url").or_else(|| result.and_then(|c| c.get("url")).and_then(Value::as_str).map(str::to_string));
                let title = result.and_then(|c| c.get("content")).and_then(|d| d.get("title")).and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty()).map(str::to_string);
                if let Some(url) = url {
                    steps.push(RunStep::Read { url, title, ok });
                }
            }
            _ => {}
        }
    }
    steps
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

/// Where a run's time went, for the log and the run's record (not shown to the reader).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Timings {
    /// Extracting the book's front matter and lists on the computer.
    pub reading_ms: u64,
    /// The seed lookups (the book on Open Library, the author on Wikidata).
    pub seed_ms: u64,
    /// Each API call, retries and their waits included. Server-side searches and fetches run inside.
    pub calls_ms: Vec<u64>,
    /// The model's catalogue lookups (find_book, find_article, find_entity), all together.
    pub tools_ms: u64,
    /// The verifier.
    pub checking_ms: u64,
}

fn secs(ms: u64) -> String {
    format!("{:.1} s", ms as f64 / 1000.0)
}

impl Timings {
    pub fn total_ms(&self) -> u64 {
        self.reading_ms + self.seed_ms + self.calls_ms.iter().sum::<u64>() + self.tools_ms + self.checking_ms
    }

    pub fn to_json(&self) -> Value {
        json!({ "readingMs": self.reading_ms, "seedMs": self.seed_ms, "callsMs": self.calls_ms, "toolsMs": self.tools_ms, "checkingMs": self.checking_ms, "totalMs": self.total_ms() })
    }

    /// "reading 0.2 s, seed lookups 1.4 s, API calls 21.3 + 18.0 + 38.9 s, catalogue lookups 2.1 s, checking 6.3 s"
    pub fn summary(&self) -> String {
        let calls = if self.calls_ms.is_empty() { "none".to_string() } else { format!("{} s", self.calls_ms.iter().map(|ms| format!("{:.1}", *ms as f64 / 1000.0)).collect::<Vec<_>>().join(" + ")) };
        format!("reading {}, seed lookups {}, API calls {}, catalogue lookups {}, checking {}", secs(self.reading_ms), secs(self.seed_ms), calls, secs(self.tools_ms), secs(self.checking_ms))
    }
}

fn ms_since(t: Instant) -> u64 {
    t.elapsed().as_millis() as u64
}

/// Token, search and call counts across a run, and where its time went.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Usage {
    pub calls: u32,
    pub input: u64,
    pub cache_write: u64,
    pub cache_read: u64,
    pub output: u64,
    pub searches: u32,
    pub fetches: u32,
    pub timings: Timings,
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
            "timings": self.timings.to_json(),
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
pub async fn research(transport: &Arc<dyn Transport>, key: &ApiKey, level: Level, book: &BookInput, seed: &Value, focus: Option<&str>, lookups: &Lookups, limits: &Limits, usage: &mut Usage, progress: &(dyn Fn(Progress) + Send + Sync)) -> Result<Research, Failure> {
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
        let call_started = Instant::now();
        let resp = call_api(transport, key, &request_body(&messages, limits.max_tokens_per_call), limits).await;
        usage.timings.calls_ms.push(ms_since(call_started));
        let resp = resp?;
        usage.calls += 1;
        if let Some(u) = resp.get("usage") {
            usage.add(u);
        }
        if let Some(m) = resp.get("model").and_then(Value::as_str) {
            model = m.to_string();
        }
        let content = resp.get("content").cloned().unwrap_or(Value::Array(vec![]));
        evidence.collect(&content);
        for step in steps_in(&content) {
            progress(Progress::Step(step));
        }
        messages.push(json!({ "role": "assistant", "content": content }));
        let stop = resp.get("stop_reason").and_then(Value::as_str).unwrap_or("");
        match stop {
            "tool_use" => {
                let mut results = Vec::new();
                for block in content.as_array().into_iter().flatten().filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_use")) {
                    let id = block.get("id").and_then(Value::as_str).unwrap_or("");
                    let input = block.get("input").cloned().unwrap_or(Value::Null);
                    let s = |k: &str| input.get(k).and_then(Value::as_str).map(str::trim).filter(|x| !x.is_empty()).map(str::to_string);
                    let tool_started = Instant::now();
                    let before = results.len();
                    let name = block.get("name").and_then(Value::as_str).unwrap_or("");
                    match name {
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
                    // A catalogue lookup the model asked for: one step, and its time.
                    let source = match name {
                        "find_book" => Some(("openLibrary", s("title"))),
                        "find_entity" => Some(("wikidata", s("name"))),
                        "find_article" => Some(("crossref", s("query"))),
                        _ => None,
                    };
                    if let Some((source, Some(query))) = source {
                        usage.timings.tools_ms += ms_since(tool_started);
                        let ok = results.get(before).map(|r| r.get("is_error") != Some(&Value::Bool(true))).unwrap_or(false);
                        progress(Progress::Step(RunStep::Lookup { source, query, ok }));
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

/// A briefing for a document, or (with `focus`) on one name or work in it. `progress` hears each
/// stage, each step, and what there is to check.
pub async fn generate(app: &Arc<App>, doc_id: &str, level: Level, focus: Option<&str>, limits: &Limits, progress: &(dyn Fn(Progress) + Send + Sync)) -> Result<Generated, (Failure, Usage)> {
    let started = Instant::now();
    let mut usage = Usage::default();
    let Some(key) = app.briefing.key().cloned() else { return Err((Failure::NotConfigured, usage)) };
    progress(Progress::Stage(Stage::Reading));
    let doc = doc_id.to_string();
    let extracted: Result<Extracted, _> = app.run(move |c| c.briefing_extract(&doc)).await;
    usage.timings.reading_ms = ms_since(started);
    let extracted = match extracted {
        Ok(x) => x,
        Err(e) => return Err((Failure::Book(e.message), usage)),
    };
    let transport = app.briefing.transport.clone();
    progress(Progress::Stage(Stage::Researching));
    let lookups = Lookups::new(transport.clone(), limits.model_lookups);
    let seed_started = Instant::now();
    let seed_records = seed(&lookups, &extracted.input).await;
    usage.timings.seed_ms = ms_since(seed_started);
    for step in seed_steps(&extracted.input, &seed_records) {
        progress(Progress::Step(step));
    }
    let research = match research(&transport, &key, level, &extracted.input, &seed_records, focus, &lookups, limits, &mut usage, progress).await {
        Ok(r) => r,
        Err(f) => return Err((f, usage)),
    };
    progress(Progress::Checking(draft_counts(&research.draft)));
    progress(Progress::Stage(Stage::Checking));
    Ok(finish(app, extracted, level, focus.map(str::to_string), research, usage, lookups.used(), limits, started).await)
}

/// The seed lookups as steps: the book on Open Library, its first author on Wikidata. Ok when they
/// found something.
pub fn seed_steps(book: &BookInput, seed: &Value) -> Vec<RunStep> {
    let found = |k: &str| seed.get(k).and_then(Value::as_array).map(|a| !a.is_empty()).unwrap_or(false);
    let mut steps = vec![RunStep::Lookup { source: "openLibrary", query: main_title(&book.title), ok: found("openLibrary") }];
    if let Some(a) = book.authors.first() {
        steps.push(RunStep::Lookup { source: "wikidata", query: a.clone(), ok: found("wikidataAuthor") });
    }
    steps
}

/// Verify a draft and assemble the briefing. Also used for drafts written elsewhere (the
/// `context-live --draft` check, where Claude Code agents stand in for the API).
#[allow(clippy::too_many_arguments)]
pub async fn finish(app: &Arc<App>, extracted: Extracted, level: Level, focus: Option<String>, research: Research, mut usage: Usage, model_lookups: u32, limits: &Limits, started: Instant) -> Generated {
    let checking_started = Instant::now();
    let verifier = Lookups::new(app.briefing.transport.clone(), limits.verify_lookups);
    let mut evidence = research.evidence;
    evidence.book = extracted.input.front_matter.iter().map(|f| format!("{}\n{}", f.title, f.text)).collect::<Vec<_>>().join("\n\n");
    let shape = if focus.is_some() { Shape::Focus } else { Shape::Book };
    let checked = verify_shaped(research.draft, &evidence, &verifier, shape).await;
    usage.timings.checking_ms = ms_since(checking_started);
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
