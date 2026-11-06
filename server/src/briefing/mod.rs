//! Context: a sourced background briefing for the open book (prompts/book-context.md).
//!
//! The pipeline (run.rs): extract on the computer → seed lookups → research with the model and web
//! search → a deterministic verifier → a stored briefing. Runs live on the server, survive a closed
//! connection, and are shared by requests for the same book, level and file version.
//!
//! Every constant that bounds cost is here.

pub mod extract;
pub mod focus;
pub mod lookup;
pub mod media;
pub mod prompt;
pub mod run;
pub mod schema;
pub mod secrets;
pub mod store;
pub mod text_match;
pub mod transport;
pub mod verify;

use crate::app::App;
use crate::errors::{not_found, AppError};
use crate::Result;
use focus::Focus;
use run::{generate, Failure, Limits, Progress, Stage};
use schema::{Briefing, Level};
use secrets::ApiKey;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Semaphore;
use transport::Transport;

// ---- The model and its API ----
pub const MODEL: &str = "claude-sonnet-5-5";
pub const API_URL: &str = "https://api.anthropic.com/v1/messages";
pub const API_VERSION: &str = "2026-10-21";
/// Refusal fallback (`fallbacks: "default"`): a declined call is retried on another model.
pub const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
pub const EFFORT: &str = "medium";

// ---- Caps per run ----
pub const MAX_CALLS: u32 = 12;
pub const MAX_TOKENS_PER_CALL: u32 = 16_000;
pub const MAX_OUTPUT_TOKENS: u64 = 40_000;
pub const MAX_INPUT_TOKENS: u64 = 800_000;
/// `max_uses` on each call. Constant, so the tool list (and the prompt cache) never changes.
pub const SEARCHES_PER_CALL: u32 = 5;
pub const FETCHES_PER_CALL: u32 = 5;
/// The budget the model is given; past it, it is told to hand in.
pub const SEARCH_BUDGET: u32 = 10;
pub const FETCH_BUDGET: u32 = 8;
/// Past these the run fails.
pub const SEARCH_HARD_CAP: u32 = 16;
pub const FETCH_HARD_CAP: u32 = 14;
pub const FETCH_MAX_CONTENT_TOKENS: u32 = 8_000;
/// A focused briefing ("Context for this", on one name or work) is short: a smaller budget, told to
/// the model. The hard caps and the tool list stay the same.
pub const FOCUS_SEARCH_BUDGET: u32 = 5;
pub const FOCUS_FETCH_BUDGET: u32 = 4;
/// Catalogue requests: the seed and the model's find_book / find_article; then the verifier's.
pub const MODEL_LOOKUPS: u32 = 60;
pub const VERIFY_LOOKUPS: u32 = 150;
/// A 16,000-token answer can take a few minutes.
pub const CALL_TIMEOUT: Duration = Duration::from_secs(300);
pub const RUN_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Runs at once, across all books.
pub const MAX_CONCURRENT_RUNS: usize = 2;

// ---- Prices (USD), for the logged estimate ----
pub const PRICE_INPUT: f64 = 2.0 / 1_000_000.0;
pub const PRICE_CACHE_WRITE: f64 = 2.5 / 1_000_000.0;
pub const PRICE_CACHE_READ: f64 = 0.2 / 1_000_000.0;
pub const PRICE_OUTPUT: f64 = 10.0 / 1_000_000.0;
pub const PRICE_SEARCH: f64 = 10.0 / 1_000.0;

/// Where the key lives, for messages (never its contents).
pub const SECRETS_HINT: &str = "~/.config/pager/secrets.env";

/// A run as the reader sees it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunView {
    pub id: String,
    pub doc_id: String,
    pub level: Level,
    /// running | done | failed
    pub status: String,
    /// queued | reading | researching | checking | done | failed
    pub stage: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    /// While it runs: what it has done so far, oldest first (searches, pages read, catalogue lookups).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<RunStep>,
    /// While it is checking: how much there is to check.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checking: Option<Checking>,
    /// While it runs: milliseconds since it started, by the computer's clock (a phone's may differ).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elapsed_ms: Option<u64>,
}

impl RunView {
    pub fn new(id: String, doc_id: String, level: Level, started_at: String) -> RunView {
        RunView { id, doc_id, level, status: "running".into(), stage: Stage::Queued.as_str().into(), error: None, started_at, finished_at: None, steps: vec![], checking: None, elapsed_ms: None }
    }
}

/// One thing a run did, for the reader's progress view ("Searched “Malthus Darwin 1838”").
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RunStep {
    /// A web search the model ran.
    Search { query: String, ok: bool },
    /// A page the model read.
    Read {
        url: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        ok: bool,
    },
    /// A catalogue lookup: `openLibrary`, `wikidata` or `crossref`.
    Lookup { source: &'static str, query: String, ok: bool },
}

/// What the checker has before it: the distinct sources cited and the claims that cite them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Checking {
    pub sources: u32,
    pub claims: u32,
}

/// Most steps kept for a run's progress view (the caps allow about 90).
pub const MAX_STEPS: usize = 100;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct RunKey {
    doc_id: String,
    level: Level,
    focus: String,
    content_hash: String,
}

pub struct BriefingService {
    pub transport: Arc<dyn Transport>,
    key: Option<ApiKey>,
    pub limits: Limits,
    /// Runs in progress: by key (so requests share one), and their live view by id.
    active: Mutex<HashMap<RunKey, String>>,
    live: Mutex<HashMap<String, RunView>>,
    slots: Arc<Semaphore>,
    /// One media lookup at a time (Phase 5), so two requests never fetch the same pictures twice.
    pub media_lock: tokio::sync::Mutex<()>,
}

impl BriefingService {
    pub fn new(transport: Arc<dyn Transport>, key: Option<ApiKey>, limits: Limits) -> BriefingService {
        BriefingService { transport, key, limits, active: Mutex::new(HashMap::new()), live: Mutex::new(HashMap::new()), slots: Arc::new(Semaphore::new(MAX_CONCURRENT_RUNS)), media_lock: tokio::sync::Mutex::new(()) }
    }

    pub fn key(&self) -> Option<&ApiKey> {
        self.key.as_ref()
    }

    pub fn ready(&self) -> bool {
        self.key.is_some()
    }

    /// A run's progress, as `generate` reports it.
    fn progress(&self, run_id: &str, p: Progress) {
        if let Some(v) = self.live.lock().unwrap().get_mut(run_id) {
            match p {
                Progress::Stage(stage) => v.stage = stage.as_str().to_string(),
                Progress::Step(step) => {
                    if v.steps.len() < MAX_STEPS {
                        v.steps.push(step);
                    }
                }
                Progress::Checking(c) => v.checking = Some(c),
            }
        }
    }
}

/// A live run as served: with the time since it started.
fn served(app: &App, mut v: RunView) -> RunView {
    if v.status == "running" {
        v.elapsed_ms = crate::clock::parse_iso(&v.started_at).map(|t| (app.clock.now_ms() - t).max(0) as u64);
    }
    v
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub ready: bool,
    pub model: &'static str,
    /// Where the key goes, for the setup message.
    pub key_file: &'static str,
    pub key_variable: &'static str,
    /// On a paired phone: its paid runs in the last 24 hours against its limit. None on the computer.
    pub phone: Option<PhoneRuns>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneRuns {
    pub used: i64,
    pub limit: i64,
    pub left: i64,
}

/// `device_id` is the paired phone asking (None on the computer).
pub async fn status(app: &Arc<App>, device_id: Option<String>) -> Result<Status> {
    let phone = match device_id {
        Some(d) => {
            let now = app.clock.now_ms();
            let a = app.run(move |c| c.briefing_phone_allowance(&d, now)).await?;
            Some(PhoneRuns { used: a.used, limit: a.limit, left: a.left() })
        }
        None => None,
    };
    Ok(Status { ready: app.briefing.ready(), model: MODEL, key_file: SECRETS_HINT, key_variable: secrets::KEY_VAR, phone })
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefingState {
    pub briefing: Option<Briefing>,
    /// The briefing was made for an earlier version of the file.
    pub stale: bool,
    pub run: Option<RunView>,
    pub cached_levels: Vec<Level>,
}

pub fn not_configured() -> AppError {
    AppError::new(503, "not_configured", format!("Context needs an API key on the computer. Put {} in {SECRETS_HINT} (chmod 600) and restart Pager.", secrets::KEY_VAR))
}

/// The stored briefing for a document, level and focus (None: the whole book), and any run in
/// progress for it.
pub async fn state(app: &Arc<App>, doc_id: &str, level: Level, focus: Option<&Focus>) -> Result<BriefingState> {
    let doc = doc_id.to_string();
    let fkey = focus.map(|f| f.key.clone()).unwrap_or_default();
    let fk = fkey.clone();
    let (hash, current, latest, levels) = app
        .run(move |c| {
            let hash = c.briefing_content_hash(&doc)?;
            let current = c.briefing_get(&doc, level, &fk, &hash)?;
            let latest = if current.is_none() { c.briefing_latest(&doc, level, &fk)? } else { None };
            Ok((hash, current, latest, c.briefing_levels(&doc, &fk)?))
        })
        .await?;
    let key = RunKey { doc_id: doc_id.to_string(), level, focus: fkey, content_hash: hash };
    let run = {
        let active = app.briefing.active.lock().unwrap();
        active.get(&key).and_then(|id| app.briefing.live.lock().unwrap().get(id).cloned())
    }
    .map(|v| served(app, v));
    let stale = current.is_none() && latest.is_some();
    Ok(BriefingState { briefing: current.or(latest), stale, run, cached_levels: levels })
}

pub enum Started {
    Cached(Box<Briefing>),
    Run(RunView),
}

/// Answer from the cache, join a run in progress, or start one. `device_id` is the paired phone
/// that asked (None on the computer): a new run from a phone counts toward its daily limit, checked
/// in the same step that records the run, so two requests at once can't both slip past it.
pub async fn start(app: &Arc<App>, doc_id: &str, level: Level, refresh: bool, device_id: Option<String>, focus: Option<Focus>) -> Result<Started> {
    if !app.briefing.ready() {
        return Err(not_configured());
    }
    let doc = doc_id.to_string();
    let fkey = focus.as_ref().map(|f| f.key.clone()).unwrap_or_default();
    let fk = fkey.clone();
    let (hash, cached) = app
        .run(move |c| {
            let hash = c.briefing_content_hash(&doc)?;
            let cached = c.briefing_get(&doc, level, &fk, &hash)?;
            Ok((hash, cached))
        })
        .await?;
    if !refresh {
        if let Some(b) = cached {
            return Ok(Started::Cached(Box::new(b)));
        }
    }
    let key = RunKey { doc_id: doc_id.to_string(), level, focus: fkey.clone(), content_hash: hash.clone() };
    let view = {
        let mut active = app.briefing.active.lock().unwrap();
        if let Some(id) = active.get(&key) {
            if let Some(v) = app.briefing.live.lock().unwrap().get(id) {
                return Ok(Started::Run(served(app, v.clone())));
            }
        }
        let view = RunView::new(crate::ids::new_id(app.clock.now_ms()), doc_id.to_string(), level, app.clock.iso());
        active.insert(key.clone(), view.id.clone());
        app.briefing.live.lock().unwrap().insert(view.id.clone(), view.clone());
        view
    };
    let row = view.clone();
    let device = device_id.clone();
    let now = app.clock.now_ms();
    let recorded = app
        .run(move |c| {
            if let Some(d) = device.as_deref() {
                c.briefing_phone_allowance(d, now)?.check()?;
            }
            c.briefing_run_insert(&row, &hash, &fkey, device.as_deref())
        })
        .await;
    if let Err(e) = recorded {
        app.briefing.active.lock().unwrap().remove(&key);
        app.briefing.live.lock().unwrap().remove(&view.id);
        return Err(e);
    }
    let task_app = app.clone();
    let run_id = view.id.clone();
    tokio::spawn(async move { run_task(task_app, key, run_id, focus).await });
    Ok(Started::Run(view))
}

pub async fn run_view(app: &Arc<App>, run_id: &str) -> Result<RunView> {
    let live = app.briefing.live.lock().unwrap().get(run_id).cloned();
    if let Some(v) = live {
        return Ok(served(app, v));
    }
    let id = run_id.to_string();
    app.run(move |c| c.briefing_run_get(&id)).await?.ok_or_else(|| not_found("That briefing run"))
}

async fn run_task(app: Arc<App>, key: RunKey, run_id: String, focus: Option<Focus>) {
    let _slot = app.briefing.slots.clone().acquire_owned().await;
    let limits = app.briefing.limits.clone();
    let progress_app = app.clone();
    let progress_id = run_id.clone();
    let progress = move |p: Progress| progress_app.briefing.progress(&progress_id, p);
    let outcome = match tokio::time::timeout(limits.run_timeout + Duration::from_secs(60), generate(&app, &key.doc_id, key.level, focus.as_ref().map(|f| f.text.as_str()), &limits, &progress)).await {
        Ok(r) => r,
        Err(_) => Err((Failure::Timeout, run::Usage::default())),
    };
    let mut view = app.briefing.live.lock().unwrap().get(&run_id).cloned().unwrap_or_else(|| RunView::new(run_id.clone(), key.doc_id.clone(), key.level, app.clock.iso()));
    // The progress view is for the run while it goes; the stored row keeps the outcome.
    view.steps.clear();
    view.checking = None;
    view.finished_at = Some(app.clock.iso());
    let line = match outcome {
        Ok(g) => {
            let usage = g.usage.to_json();
            let b = g.briefing;
            let summary = format!(
                "context: run {} doc {} level {}{}: done in {} s; {}; kept {} claims and {} works, dropped {} claims and {} works{}{}; time: {}",
                run_id,
                key.doc_id,
                key.level.as_str(),
                if key.focus.is_empty() { String::new() } else { " (focused)".to_string() },
                b.stats.duration_ms / 1000,
                g.usage.summary(),
                b.stats.claims_kept,
                b.stats.works_kept,
                b.stats.claims_dropped,
                b.stats.works_dropped,
                if b.little_known { "; little known" } else { "" },
                if b.model != MODEL { format!("; answered by {}", b.model) } else { String::new() },
                g.usage.timings.summary(),
            );
            let finished = view.clone();
            let saved = app
                .run(move |c| {
                    let id = c.briefing_save(&b, &usage)?;
                    let mut done = finished;
                    done.status = "done".into();
                    done.stage = Stage::Done.as_str().into();
                    c.briefing_run_finish(&done, &usage, Some(&id))?;
                    Ok(())
                })
                .await;
            match saved {
                Ok(()) => {
                    view.status = "done".into();
                    view.stage = Stage::Done.as_str().into();
                    summary
                }
                Err(e) => {
                    view.status = "failed".into();
                    view.stage = Stage::Failed.as_str().into();
                    view.error = Some(Failure::Internal(e.message.clone()).message());
                    format!("context: run {run_id} doc {}: couldn't save the briefing ({})", key.doc_id, e.message)
                }
            }
        }
        Err((failure, usage)) => {
            view.status = "failed".into();
            view.stage = Stage::Failed.as_str().into();
            view.error = Some(failure.message());
            let failed = view.clone();
            let u = usage.to_json();
            let _ = app.run(move |c| c.briefing_run_finish(&failed, &u, None)).await;
            format!("context: run {run_id} doc {} level {}: failed ({:?}); {}; time: {}", key.doc_id, key.level.as_str(), failure, usage.summary(), usage.timings.summary())
        }
    };
    println!("{line}");
    app.briefing.active.lock().unwrap().remove(&key);
    app.briefing.live.lock().unwrap().remove(&run_id);
}
