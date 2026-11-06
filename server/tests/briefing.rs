//! Context briefings (Phases 1–3): the pipeline against a fake transport. No test touches the network
//! or needs a key: the model's answers and the catalogues' are fixtures (tests/fixtures/context).

mod common;

use common::*;
use futures::future::BoxFuture;
use pager_server::briefing::extract::extract_lists;
use pager_server::briefing::lookup::Lookups;
use pager_server::briefing::run::{first_request, generate, seed_steps, steps_in, Limits, Progress, Stage};
use pager_server::briefing::verify::draft_counts;
use pager_server::briefing::{Checking, RunStep};
use pager_server::briefing::schema::*;
use pager_server::briefing::secrets::{load_api_key, ApiKey, KeySource};
use pager_server::briefing::transport::{OutError, OutRequest, OutResponse, Transport};
use pager_server::briefing::verify::{verify, verify_shaped, Evidence, Shape};
use pager_server::briefing::API_URL;
use pager_server::clock::Clock;
use pager_server::ingest::versions::Format;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// The key the tests use: it must only ever leave in `x-api-key` to the model's API.
const SENTINEL: &str = "sk-ant-test-SENTINEL-0123456789";
const BODY_SENTENCE: &str = "secret ledger of tumblers and pouters";

fn fx(name: &str) -> Vec<u8> {
    std::fs::read(fixtures().join("context").join(name)).unwrap()
}

fn fxj(name: &str) -> Value {
    serde_json::from_slice(&fx(name)).unwrap()
}

enum Api {
    Answer(u16, Value),
    NetworkError,
}

/// Answers the model's API from a script and everything else from routes (longest prefix wins,
/// else 404), and keeps every request it saw.
#[derive(Default)]
struct Fake {
    api: Mutex<VecDeque<Api>>,
    routes: Mutex<Vec<(String, u16, String, Vec<u8>)>>,
    seen: Mutex<Vec<OutRequest>>,
    api_delay: Mutex<Duration>,
    /// When set, each answer from the model waits for a permit (to watch a run mid-way).
    gate: Mutex<Option<Arc<tokio::sync::Semaphore>>>,
}

impl Fake {
    fn new() -> Arc<Fake> {
        Arc::new(Fake::default())
    }

    fn api(&self, a: Api) {
        self.api.lock().unwrap().push_back(a);
    }

    fn answer(&self, v: Value) {
        self.api(Api::Answer(200, v));
    }

    fn route(&self, prefix: &str, status: u16, content_type: &str, body: Vec<u8>) {
        self.routes.lock().unwrap().push((prefix.to_string(), status, content_type.to_string(), body));
    }

    fn seen(&self) -> Vec<OutRequest> {
        self.seen.lock().unwrap().clone()
    }

    fn api_bodies(&self) -> Vec<Value> {
        self.seen().into_iter().filter(|r| r.url == API_URL).map(|r| serde_json::from_slice(&r.body.unwrap()).unwrap()).collect()
    }

    fn urls(&self) -> Vec<String> {
        self.seen().into_iter().map(|r| r.url).collect()
    }

    /// Open Library, Wikidata and the pages the verifier reads.
    fn catalogue(&self) {
        let j = "application/json";
        for (prefix, file) in [
            ("https://openlibrary.org/search.json", "ol-search.json"),
            ("https://openlibrary.org/works/OL1179009W.json", "ol-work-OL1179009W.json"),
            ("https://openlibrary.org/authors/OL115066A.json", "ol-author-OL115066A.json"),
            ("https://openlibrary.org/isbn/9780141439518.json", "ol-isbn-9780141439518.json"),
            ("https://openlibrary.org/authors/OL21594A.json", "ol-author-OL21594A.json"),
            ("https://openlibrary.org/isbn/9780691023069.json", "ol-isbn-9780691023069.json"),
            ("https://openlibrary.org/authors/OL2658173A.json", "ol-author-OL2658173A.json"),
            ("https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q20124", "wikidata-Q20124.json"),
            ("https://www.wikidata.org/w/api.php?action=wbsearchentities", "wikidata-search.json"),
            ("https://query.wikidata.org/sparql", "wikidata-sparql.json"),
        ] {
            self.route(prefix, 200, j, fx(file));
        }
        self.route("https://www.darwinproject.ac.uk/letters/darwins-works/origin", 200, "text/html; charset=utf-8", fx("page-darwinproject.html"));
        self.route("https://plato.stanford.edu/entries/darwinism/", 200, "text/html", fx("page-sep.html"));
        self.route("https://example.org/blog/darwin", 200, "text/html", fx("page-blog.html"));
    }

    /// The three answers of the happy path: research with a find_book call, a pause, the submission.
    fn script(&self) {
        self.answer(fxj("api-1-research.json"));
        self.answer(fxj("api-2-pause.json"));
        self.answer(fxj("api-3-submit.json"));
    }
}

impl Transport for Fake {
    fn send(&self, req: OutRequest) -> BoxFuture<'_, Result<OutResponse, OutError>> {
        Box::pin(async move {
            self.seen.lock().unwrap().push(req.clone());
            let respond = |status: u16, content_type: &str, body: Vec<u8>| OutResponse { status, url: req.url.clone(), content_type: content_type.to_string(), body, truncated: false };
            if req.url == API_URL {
                let gate = self.gate.lock().unwrap().clone();
                if let Some(g) = gate {
                    g.acquire().await.unwrap().forget();
                }
                let delay = *self.api_delay.lock().unwrap();
                if !delay.is_zero() {
                    tokio::time::sleep(delay).await;
                }
                let next = self.api.lock().unwrap().pop_front();
                return match next {
                    Some(Api::Answer(status, v)) => Ok(respond(status, "application/json", v.to_string().into_bytes())),
                    Some(Api::NetworkError) => Err(OutError::Network("connection refused".into())),
                    None => Ok(respond(500, "application/json", json!({ "type": "error", "error": { "type": "api_error", "message": "no more scripted answers" } }).to_string().into_bytes())),
                };
            }
            let routes = self.routes.lock().unwrap();
            let best = routes.iter().filter(|(p, ..)| req.url.starts_with(p.as_str())).max_by_key(|(p, ..)| p.len());
            Ok(match best {
                Some((_, status, ct, body)) => respond(*status, ct, body.clone()),
                None => respond(404, "text/plain", b"not found".to_vec()),
            })
        })
    }
}

fn limits() -> Limits {
    Limits { retry_delays: vec![], ..Limits::default() }
}

fn app_with(fake: &Arc<Fake>, key: bool, limits: Limits) -> TestApp {
    let transport: Arc<dyn Transport> = fake.clone();
    make_app_custom(Clock::fake("2026-11-05T12:00:00Z"), move |o| {
        o.briefing_transport = Some(transport);
        o.anthropic_key = if key { ApiKey::new(SENTINEL) } else { None };
        o.briefing_limits = Some(limits);
    })
}

/// A Markdown book long enough to be cut into sections: an introduction (front matter) and a chapter
/// (body text, which must never reach the model).
fn book_text(extra: &str) -> String {
    let filler = "The finches of the islands differ from one another in the shape of their beaks. ".repeat(450);
    format!(
        "---\ntitle: On the Origin of Species\nauthor: Charles Darwin\n---\n\n# Introduction\n\nWhen on board H.M.S. Beagle, as naturalist, I was much struck with certain facts in the distribution of the inhabitants of South America.\n\n# Chapter I. Variation under Domestication\n\nThe pigeon fanciers of London keep a {BODY_SENTENCE}.\n\n{filler}\n{extra}\n"
    )
}

async fn add_book(t: &TestApp) -> String {
    t.write("Darwin/Origin.md", &book_text(""));
    assert_eq!(t.get("/api/tree").await.status, 200);
    let docs = t.get("/api/documents").await;
    assert_eq!(docs.status, 200, "{}", docs.text);
    docs.body[0]["id"].as_str().unwrap().to_string()
}

async fn wait_run(t: &TestApp, id: &str) -> Value {
    for _ in 0..1000 {
        let r = t.get(&format!("/api/tools/context/runs/{id}")).await;
        assert_eq!(r.status, 200, "{}", r.text);
        if r.body["status"] != "running" {
            return r.body;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the run never finished");
}

async fn start(t: &TestApp, doc: &str, body: Value) -> Answer {
    t.json("POST", &format!("/api/tools/context/briefings/{doc}"), Some(body)).await
}

fn stored_text(t: &TestApp) -> String {
    let c = t.app.lock();
    let b: Vec<String> = c.all("SELECT briefing || ' ' || usage || ' ' || model FROM context_briefings", &[], |r| r.get(0)).unwrap();
    let r: Vec<String> = c.all("SELECT id || ' ' || status || ' ' || coalesce(error, '') || ' ' || coalesce(usage, '') FROM context_runs", &[], |r| r.get(0)).unwrap();
    format!("{}\n{}", b.join("\n"), r.join("\n"))
}

#[tokio::test]
async fn a_briefing_keeps_what_checks_out_and_drops_the_rest() {
    let fake = Fake::new();
    fake.catalogue();
    fake.script();
    let t = app_with(&fake, true, limits());
    let doc = add_book(&t).await;

    let started = start(&t, &doc, json!({})).await;
    assert_eq!(started.status, 202, "{}", started.text);
    assert!(started.body["briefing"].is_null());
    let run = wait_run(&t, started.body["run"]["id"].as_str().unwrap()).await;
    assert_eq!(run["status"], "done", "{run}");

    let got = t.get(&format!("/api/tools/context/briefings/{doc}")).await;
    assert_eq!(got.status, 200, "{}", got.text);
    assert_eq!(got.body["stale"], false);
    assert_eq!(got.body["cachedLevels"], json!(["general"]));
    let b: Briefing = serde_json::from_value(got.body["briefing"].clone()).unwrap();
    let kinds: Vec<SectionKind> = b.sections.iter().map(|s| s.kind).collect();
    assert_eq!(kinds, vec![SectionKind::Overview, SectionKind::ReadFirst, SectionKind::Moment, SectionKind::Situation, SectionKind::Conversation, SectionKind::FurtherReading], "terms held only a Wikipedia claim");
    assert!(!b.little_known);

    // The overview: a fetched page, a search snippet, the computer's own fetch, a Wikidata record.
    let overview = &b.sections[0].items[0].claims;
    assert_eq!(overview.len(), 4);
    assert!(overview[..3].iter().all(|c| c.citations[0].check == Some(Check::Quoted)));
    assert_eq!(overview[3].citations[0].check, Some(Check::Record));
    assert_eq!(overview[3].citations[0].url.as_deref(), Some("https://www.wikidata.org/wiki/Q20124"));

    // Read first: only Malthus survives (no work, a made-up DOI, a bad check digit and someone
    // else's ISBN are dropped).
    let read_first = &b.sections[1].items;
    assert_eq!(read_first.len(), 1);
    let w = read_first[0].work.as_ref().unwrap();
    assert_eq!(w.resolved_url.as_deref(), Some("https://openlibrary.org/works/OL1179009W"));
    assert!(read_first[0].claims[0].inferred);

    // The quote that isn't on its page is gone; so is the one-sided disagreement.
    assert_eq!(b.sections[2].items[0].claims.len(), 1);
    assert_eq!(b.sections[3].items[0].entity.as_deref(), Some("london"));
    assert!(b.sections[4].items[0].disagreement.is_none());
    assert_eq!(b.sections[4].items[0].relation.as_deref(), Some("borrows from"));
    let further = &b.sections[5].items[0];
    assert_eq!(further.work.as_ref().unwrap().resolved_url.as_deref(), Some("https://openlibrary.org/isbn/9780691023069"));
    assert!(further.claims.is_empty() && further.suits.is_some());

    // The connection map: Wikidata's dates and coordinates; a wrong ID and an unused node are gone.
    let ids: Vec<&str> = b.entities.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(ids, vec!["book", "author", "malthus", "london", "lyell"], "the unused node is pruned");
    let ent = |id: &str| b.entities.iter().find(|e| e.id == id).unwrap();
    let darwin = ent("author").facts.as_ref().unwrap();
    assert_eq!((darwin.start.as_deref(), darwin.end.as_deref()), (Some("1809"), Some("1882")));
    assert_eq!(darwin.source, "https://www.wikidata.org/wiki/Q1035");
    assert_eq!(ent("book").facts.as_ref().unwrap().start.as_deref(), Some("1859"));
    assert_eq!(ent("book").resolved_url.as_deref(), Some("https://www.wikidata.org/wiki/Q20124"), "a work's record is checked like any work");
    let london = ent("london").facts.as_ref().unwrap();
    assert_eq!(london.coordinates.map(|c| (c[0].round(), c[1].round())), Some((52.0, -0.0)));
    assert_eq!(london.start, None, "a place gets coordinates, not dates");
    assert!(darwin.coordinates.is_none(), "a person gets dates, not coordinates");
    assert!(ent("lyell").wikidata.is_none() && ent("lyell").facts.is_none(), "Q1035 isn't Lyell");
    assert_eq!(b.links.len(), 1);
    assert_eq!((b.links[0].from.as_str(), b.links[0].to.as_str(), b.links[0].relation.as_str()), ("author", "malthus", "read"));

    assert_eq!((b.stats.claims_kept, b.stats.claims_dropped, b.stats.works_kept, b.stats.works_dropped), (9, 9, 2, 3));
    assert_eq!((b.stats.links_kept, b.stats.links_dropped), (1, 2));
    assert_eq!((b.stats.api_calls, b.stats.searches, b.stats.fetches), (3, 1, 2));
    assert_eq!(b.stats.output_tokens, 3700);
    assert!(b.stats.cost_usd > 0.0);
    assert_eq!(b.model, "claude-sonnet-5-5");

    // The loop: find_book answered from Open Library, then the paused turn sent back as it was.
    let bodies = fake.api_bodies();
    assert_eq!(bodies.len(), 3);
    let second = bodies[1]["messages"].as_array().unwrap();
    let last = second.last().unwrap();
    assert_eq!(last["role"], "user");
    assert_eq!(last["content"][0]["type"], "tool_result");
    assert_eq!(last["content"][0]["tool_use_id"], "toolu_find1");
    assert!(last["content"][0]["content"].as_str().unwrap().contains("OL1179009W"));
    assert_eq!(bodies[2]["messages"].as_array().unwrap().last().unwrap()["role"], "assistant", "a paused turn is resumed as is");
    for body in &bodies {
        assert_eq!(body["model"], "claude-sonnet-5-5");
        assert_eq!(body["tool_choice"]["type"], "auto");
        assert_eq!(body["fallbacks"], "default");
        let names: Vec<&str> = body["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, vec!["web_search", "web_fetch", "find_book", "find_article", "find_entity", "submit_briefing"]);
    }

    // The model saw the front matter, never the body text.
    let first = bodies[0]["messages"][0]["content"].as_str().unwrap();
    assert!(first.contains("much struck with certain facts"), "front matter goes");
    for body in &bodies {
        assert!(!body.to_string().contains(BODY_SENTENCE), "body text never leaves the computer");
    }

    // A bad check digit is caught without asking anyone.
    let urls = fake.urls();
    assert!(!urls.iter().any(|u| u.contains("9780140439129")), "{urls:?}");
    assert!(urls.iter().any(|u| u.starts_with("https://api.crossref.org/works/10.9999%2Ffake.2004.001")), "{urls:?}");

    // The key: only in x-api-key, only to the model's API; never in a response or the database.
    for r in fake.seen() {
        let key_headers: Vec<&(String, String)> = r.headers.iter().filter(|(_, v)| v.contains(SENTINEL)).collect();
        if r.url == API_URL {
            assert_eq!(key_headers.len(), 1);
            assert_eq!(key_headers[0].0, "x-api-key");
        } else {
            assert!(key_headers.is_empty(), "the key went to {}", r.url);
            assert!(!r.headers.iter().any(|(k, _)| k == "x-api-key"));
        }
        assert!(!String::from_utf8_lossy(r.body.as_deref().unwrap_or(b"")).contains(SENTINEL));
    }
    for text in [&started.text, &got.text, &t.get("/api/tools/context/status").await.text, &t.get(&format!("/api/tools/context/runs/{}", run["id"].as_str().unwrap())).await.text] {
        assert!(!text.contains(SENTINEL));
    }
    let stored = stored_text(&t);
    assert!(stored.contains("claude-sonnet-5-5") && !stored.contains(SENTINEL));
}

#[tokio::test]
async fn the_verifier_rejects_a_made_up_citation() {
    let fake = Fake::new();
    fake.catalogue();
    let lookups = Lookups::new(fake.clone(), 50);
    let draft: Draft = serde_json::from_value(json!({
        "littleKnown": false,
        "sections": [{ "kind": "readFirst", "items": [
            { "heading": "A study that doesn't exist", "spoiler": false,
              "work": { "title": "The Hidden Darwin Letters", "authors": ["A. Nobody"], "year": "2004", "record": { "kind": "doi", "value": "10.9999/fake.2004.001" } },
              "claims": [{ "text": "It reveals Darwin's private doubts.", "inferred": false, "spoiler": false, "citations": [
                  { "kind": "page", "url": "https://plato.stanford.edu/entries/darwinism/", "title": "Darwinism", "quote": "Charles Darwin published On the Origin of Species in November 1859, presenting a theory" }] }] }
        ] }, { "kind": "moment", "items": [
            { "heading": "Malthus and Darwin", "spoiler": false,
              "claims": [{ "text": "They were close friends.", "inferred": false, "spoiler": false, "citations": [
                  { "kind": "page", "url": "https://plato.stanford.edu/entries/darwinism/", "title": "Darwinism", "quote": "Malthus was Darwin's closest friend and visited Down House every summer" },
                  { "kind": "page", "url": "https://example.org/nowhere", "title": "Nowhere", "quote": "Malthus was Darwin's closest friend and visited Down House every summer" },
                  { "kind": "record", "title": "Darwin's Notebooks", "record": { "kind": "isbn", "value": "9780140439129" } }] }] }
        ] }]
    }))
    .unwrap();
    let v = verify(draft, &Evidence::default(), &lookups).await;
    assert!(v.sections.is_empty(), "nothing survives");
    assert!(v.little_known);
    assert_eq!((v.report.works_dropped, v.report.claims_dropped, v.report.claims_kept), (1, 2, 0));
    let reasons: String = v.report.dropped.iter().map(|d| format!("{} — {}\n", d.what, d.reason)).collect();
    assert!(reasons.contains("(work) — no such record"), "{reasons}");
    assert!(reasons.contains("the quote isn't on the page"), "{reasons}");
    assert!(reasons.contains("the page is missing"), "{reasons}");
    assert!(reasons.contains("check digit is wrong"), "{reasons}");
    assert!(!fake.urls().iter().any(|u| u.contains("9780140439129")));
}

#[tokio::test]
async fn without_a_key_nothing_is_sent() {
    let fake = Fake::new();
    let t = app_with(&fake, false, limits());
    let doc = add_book(&t).await;
    let s = t.get("/api/tools/context/status").await;
    assert_eq!(s.status, 200);
    assert_eq!(s.body["ready"], false);
    assert_eq!(s.body["keyVariable"], "ANTHROPIC_API_KEY");
    assert_eq!(s.body["keyFile"], "~/.config/pager/secrets.env");
    let r = start(&t, &doc, json!({})).await;
    assert_eq!(r.status, 503, "{}", r.text);
    assert_eq!(r.body["error"]["code"], "not_configured");
    assert!(r.body["error"]["message"].as_str().unwrap().contains("ANTHROPIC_API_KEY"));
    let g = t.get(&format!("/api/tools/context/briefings/{doc}")).await;
    assert_eq!(g.status, 200);
    assert!(g.body["briefing"].is_null() && g.body["run"].is_null());
    assert!(fake.seen().is_empty(), "no request of any kind");
}

#[tokio::test]
async fn a_cached_briefing_costs_nothing_and_requests_share_a_run() {
    let fake = Fake::new();
    fake.catalogue();
    fake.script();
    *fake.api_delay.lock().unwrap() = Duration::from_millis(150);
    let t = app_with(&fake, true, limits());
    let doc = add_book(&t).await;

    let a = start(&t, &doc, json!({ "level": "general" })).await;
    let b = start(&t, &doc, json!({ "level": "general" })).await;
    assert_eq!((a.status, b.status), (202, 202));
    assert_eq!(a.body["run"]["id"], b.body["run"]["id"], "one run for both");
    let during = t.get(&format!("/api/tools/context/briefings/{doc}")).await;
    assert_eq!(during.body["run"]["id"], a.body["run"]["id"]);
    assert_eq!(wait_run(&t, a.body["run"]["id"].as_str().unwrap()).await["status"], "done");
    assert_eq!(fake.api_bodies().len(), 3);

    let cached = start(&t, &doc, json!({})).await;
    assert_eq!(cached.status, 200, "{}", cached.text);
    assert_eq!(cached.body["briefing"]["level"], "general");
    assert!(cached.body["run"].is_null());
    assert_eq!(fake.api_bodies().len(), 3, "a cache hit makes no call");

    // Another level is its own briefing.
    fake.script();
    let s = start(&t, &doc, json!({ "level": "scholar" })).await;
    assert_eq!(s.status, 202, "{}", s.text);
    assert_eq!(wait_run(&t, s.body["run"]["id"].as_str().unwrap()).await["status"], "done");
    let g = t.get(&format!("/api/tools/context/briefings/{doc}?level=scholar")).await;
    assert_eq!(g.body["briefing"]["level"], "scholar");
    assert_eq!(g.body["cachedLevels"], json!(["general", "scholar"]));
    assert_eq!(fake.api_bodies()[3]["messages"][0]["content"].as_str().unwrap().split('\n').next().unwrap().starts_with("Written for: a scholar"), true);

    // Refresh runs again even though one is cached.
    fake.script();
    let r = start(&t, &doc, json!({ "refresh": true })).await;
    assert_eq!(r.status, 202);
    assert_eq!(wait_run(&t, r.body["run"]["id"].as_str().unwrap()).await["status"], "done");
    assert_eq!(t.db_count("SELECT COUNT(*) FROM context_briefings"), 2, "a refresh replaces the old one");
    assert_eq!(t.db_count("SELECT COUNT(*) FROM context_runs"), 3);

    let bad = start(&t, &doc, json!({ "level": "expert" })).await;
    assert_eq!(bad.status, 400);
}

#[tokio::test]
async fn a_changed_file_keeps_showing_its_last_briefing() {
    let fake = Fake::new();
    fake.catalogue();
    fake.script();
    let t = app_with(&fake, true, limits());
    let doc = add_book(&t).await;
    let a = start(&t, &doc, json!({})).await;
    assert_eq!(wait_run(&t, a.body["run"]["id"].as_str().unwrap()).await["status"], "done");
    let before = t.get(&format!("/api/tools/context/briefings/{doc}")).await.body;
    assert_eq!(before["stale"], false);

    t.write("Darwin/Origin.md", &book_text("A sentence added later."));
    let after = t.get(&format!("/api/tools/context/briefings/{doc}")).await;
    assert_eq!(after.status, 200, "{}", after.text);
    assert_eq!(after.body["stale"], true);
    assert_eq!(after.body["briefing"]["generatedAt"], before["briefing"]["generatedAt"]);
    assert_ne!(after.body["briefing"]["contentHash"], json!(null));
    // Asking again makes a new one for the new version.
    let again = start(&t, &doc, json!({})).await;
    assert_eq!(again.status, 202, "{}", again.text);
}

#[tokio::test]
async fn a_run_that_hits_a_cap_saves_nothing() {
    let fake = Fake::new();
    fake.catalogue();
    for _ in 0..3 {
        fake.answer(fxj("api-2-pause.json"));
    }
    let t = app_with(&fake, true, Limits { max_calls: 2, ..limits() });
    let doc = add_book(&t).await;
    let a = start(&t, &doc, json!({})).await;
    let run = wait_run(&t, a.body["run"]["id"].as_str().unwrap()).await;
    assert_eq!(run["status"], "failed");
    assert!(run["error"].as_str().unwrap().contains("limit of 2 API calls"), "{run}");
    assert!(run["error"].as_str().unwrap().contains("Nothing was saved"));
    assert_eq!(fake.api_bodies().len(), 2);
    assert_eq!(t.db_count("SELECT COUNT(*) FROM context_briefings"), 0);
    assert!(t.get(&format!("/api/tools/context/briefings/{doc}")).await.body["briefing"].is_null());
}

#[tokio::test]
async fn refusals_silence_and_errors_fail_clearly() {
    let usage = json!({ "input_tokens": 100, "output_tokens": 10 });
    let cases: Vec<(Vec<Api>, &str)> = vec![
        (vec![Api::Answer(200, json!({ "model": "claude-sonnet-5-5", "content": [], "stop_reason": "refusal", "usage": usage }))], "declined"),
        (
            vec![
                Api::Answer(200, json!({ "model": "claude-sonnet-5-5", "content": [{ "type": "text", "text": "Done." }], "stop_reason": "end_turn", "usage": usage })),
                Api::Answer(200, json!({ "model": "claude-sonnet-5-5", "content": [{ "type": "text", "text": "Done." }], "stop_reason": "end_turn", "usage": usage })),
            ],
            "without handing in a briefing",
        ),
        (vec![Api::NetworkError], "Couldn't reach Anthropic's API"),
        (vec![Api::Answer(401, json!({ "type": "error", "error": { "type": "authentication_error", "message": "invalid x-api-key" } }))], "refused the API key"),
        (vec![Api::Answer(529, json!({ "type": "error", "error": { "type": "overloaded_error", "message": "Overloaded" } }))], "busy"),
        (vec![Api::Answer(200, json!({ "model": "claude-sonnet-5-5", "content": [], "stop_reason": "max_tokens", "usage": usage }))], "length limit"),
    ];
    for (script, expect) in cases {
        let fake = Fake::new();
        fake.catalogue();
        for a in script {
            fake.api(a);
        }
        let t = app_with(&fake, true, limits());
        let doc = add_book(&t).await;
        let a = start(&t, &doc, json!({})).await;
        let run = wait_run(&t, a.body["run"]["id"].as_str().unwrap()).await;
        assert_eq!(run["status"], "failed", "{expect}: {run}");
        assert!(run["error"].as_str().unwrap().contains(expect), "{expect}: {run}");
        assert_eq!(t.db_count("SELECT COUNT(*) FROM context_briefings"), 0);
        if expect.contains("handing in") {
            let bodies = fake.api_bodies();
            assert_eq!(bodies.len(), 2);
            assert!(bodies[1]["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().contains("call submit_briefing now"));
        }
    }
}

#[tokio::test]
async fn interrupted_runs_are_failed_at_startup() {
    let t = make_app();
    t.db_exec("INSERT INTO context_runs (id, document_id, content_hash, level, status, stage, started_at) VALUES ('r1', 'd1', 'h', 'general', 'running', 'researching', '2026-11-05T00:00:00Z')");
    assert_eq!(t.app.lock().briefing_interrupt_runs().unwrap(), 1);
    let r = t.get("/api/tools/context/runs/r1").await;
    assert_eq!(r.body["status"], "failed");
    assert!(r.body["error"].as_str().unwrap().contains("interrupted"));
    assert_eq!(t.get("/api/tools/context/runs/nope").await.status, 404);
}

#[tokio::test]
async fn tool_records_still_work_for_the_context_tool() {
    let t = make_app();
    let c = t.json("POST", "/api/tools/context/records", Some(json!({ "data": { "note": "kept" } }))).await;
    assert_eq!(c.status, 201, "{}", c.text);
    let l = t.get("/api/tools/context/records").await;
    assert_eq!(l.status, 200);
    assert_eq!(l.body.as_array().unwrap().len(), 1);
    let one = t.get(&format!("/api/tools/context/records/{}", c.body["id"].as_str().unwrap())).await;
    assert_eq!(one.status, 200, "{}", one.text);
}

/// Pairs a phone over the remote listener and returns its bearer token.
async fn pair_phone(t: &TestApp) -> String {
    let on = t.json("PATCH", "/api/settings/app", Some(json!({ "remote": { "enabled": true, "origin": "https://fedora.tail1234.ts.net" } }))).await;
    assert_eq!(on.status, 200, "{}", on.text);
    let w = t.json("POST", "/api/devices/pairing", None).await;
    let req = t.remote_call(Call::new("POST", "/api/pair").json(json!({ "code": w.body["code"], "name": "iPhone" }))).await;
    t.json("POST", "/api/devices/pairing/approve", Some(json!({ "requestId": req.body["requestId"] }))).await;
    let done = t.remote_call(Call::new("POST", "/api/pair/poll").json(req.body.clone())).await;
    done.body["token"].as_str().unwrap().to_string()
}

async fn phone_start(t: &TestApp, token: &str, doc: &str, body: Value) -> Answer {
    t.remote_call(Call::new("POST", &format!("/api/tools/context/briefings/{doc}")).token(token).json(body)).await
}

async fn phone_status(t: &TestApp, token: &str) -> Answer {
    t.remote_call(Call::get("/api/tools/context/status").token(token)).await
}

async fn phone_wait(t: &TestApp, token: &str, id: &str) -> Value {
    for _ in 0..1000 {
        let r = t.remote_call(Call::get(&format!("/api/tools/context/runs/{id}")).token(token)).await;
        assert_eq!(r.status, 200, "{}", r.text);
        if r.body["status"] != "running" {
            return r.body;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the run never finished");
}

#[tokio::test]
async fn a_phone_can_start_briefings_up_to_its_daily_limit() {
    let fake = Fake::new();
    fake.catalogue();
    let t = app_with(&fake, true, limits());
    let doc = add_book(&t).await;
    let token = pair_phone(&t).await;

    let s = phone_status(&t, &token).await;
    assert_eq!(s.status, 200, "{}", s.text);
    assert_eq!(s.body["ready"], true);
    assert_eq!(s.body["phone"], json!({ "used": 0, "limit": 10, "left": 10 }));
    assert!(t.get("/api/tools/context/status").await.body["phone"].is_null(), "the computer has no limit");

    // The first run, then a cache hit, which never counts.
    fake.script();
    let first = phone_start(&t, &token, &doc, json!({})).await;
    assert_eq!(first.status, 202, "{}", first.text);
    assert_eq!(phone_wait(&t, &token, first.body["run"]["id"].as_str().unwrap()).await["status"], "done");
    let cached = phone_start(&t, &token, &doc, json!({})).await;
    assert_eq!(cached.status, 200, "{}", cached.text);
    let got = t.remote_call(Call::get(&format!("/api/tools/context/briefings/{doc}")).token(&token)).await;
    assert_eq!(got.status, 200, "{}", got.text);
    assert_eq!(got.body["briefing"]["level"], "general");
    assert_eq!(phone_status(&t, &token).await.body["phone"]["used"], 1);

    // Nine Refreshes: each is a paid run.
    for _ in 0..9 {
        fake.script();
        let r = phone_start(&t, &token, &doc, json!({ "refresh": true })).await;
        assert_eq!(r.status, 202, "{}", r.text);
        assert_eq!(phone_wait(&t, &token, r.body["run"]["id"].as_str().unwrap()).await["status"], "done");
    }
    assert_eq!(phone_status(&t, &token).await.body["phone"], json!({ "used": 10, "limit": 10, "left": 0 }));
    let calls = fake.api_bodies().len();
    assert_eq!(calls, 30);

    // The 11th is refused before anything is sent or recorded, a new briefing and a Refresh alike.
    for body in [json!({ "refresh": true }), json!({ "level": "scholar" })] {
        let over = phone_start(&t, &token, &doc, body).await;
        assert_eq!(over.status, 429, "{}", over.text);
        assert_eq!(over.body["error"]["code"], "limit_reached");
        let msg = over.body["error"]["message"].as_str().unwrap();
        assert!(msg.contains("10 new briefings in the last 24 hours") && msg.contains("about 24 hours"), "{msg}");
    }
    assert_eq!(fake.api_bodies().len(), calls);
    assert_eq!(t.db_count("SELECT COUNT(*) FROM context_runs"), 10);
    assert_eq!(phone_start(&t, &token, &doc, json!({})).await.status, 200, "opening the cached briefing still works");

    // The computer is never limited.
    fake.script();
    let desk = start(&t, &doc, json!({ "refresh": true })).await;
    assert_eq!(desk.status, 202, "{}", desk.text);
    assert_eq!(wait_run(&t, desk.body["run"]["id"].as_str().unwrap()).await["status"], "done");

    // A rolling 24 hours: half a day later still none; just past a day, all ten are back.
    t.clock.advance(12 * 60 * 60 * 1000);
    let later = phone_start(&t, &token, &doc, json!({ "refresh": true })).await;
    assert_eq!(later.status, 429);
    assert!(later.body["error"]["message"].as_str().unwrap().contains("about 12 hours"), "{}", later.text);
    t.clock.advance(12 * 60 * 60 * 1000 + 1000);
    assert_eq!(phone_status(&t, &token).await.body["phone"]["left"], 10);
    fake.script();
    let again = phone_start(&t, &token, &doc, json!({ "refresh": true })).await;
    assert_eq!(again.status, 202, "{}", again.text);
    assert_eq!(phone_wait(&t, &token, again.body["run"]["id"].as_str().unwrap()).await["status"], "done");

    // The limit is the computer's setting; 0 leaves phones only the briefings already made.
    let zero = t.json("PATCH", "/api/settings/app", Some(json!({ "context": { "phoneDailyLimit": 0 } }))).await;
    assert_eq!(zero.status, 200, "{}", zero.text);
    let none = phone_start(&t, &token, &doc, json!({ "level": "student" })).await;
    assert_eq!(none.status, 429);
    assert!(none.body["error"]["message"].as_str().unwrap().contains("made on the computer"), "{}", none.text);
    assert_eq!(phone_status(&t, &token).await.body["phone"], json!({ "used": 1, "limit": 0, "left": 0 }));
    assert_eq!(phone_start(&t, &token, &doc, json!({})).await.status, 200);
    let phone_patch = t.remote_call(Call::new("PATCH", "/api/settings/app").token(&token).json(json!({ "context": { "phoneDailyLimit": 100 } }))).await;
    assert_eq!(phone_patch.status, 403, "a phone can't raise its own limit");
}

#[tokio::test]
async fn the_phone_limit_is_a_checked_app_setting() {
    let t = make_app();
    assert_eq!(t.get("/api/settings").await.body["app"]["context"], json!({ "phoneDailyLimit": 10 }));
    for bad in [json!(-1), json!(1.5), json!("10"), json!(101), json!(null), json!(true)] {
        let r = t.json("PATCH", "/api/settings/app", Some(json!({ "context": { "phoneDailyLimit": bad } }))).await;
        assert_eq!((bad.clone(), r.status), (bad.clone(), 400), "{}", r.text);
        assert!(r.body["error"]["message"].as_str().unwrap().contains("context.phoneDailyLimit is a whole number from 0 to 100"), "{}", r.text);
    }
    assert_eq!(t.json("PATCH", "/api/settings/app", Some(json!({ "context": 5 }))).await.status, 400);
    for good in [0, 25, 100] {
        let r = t.json("PATCH", "/api/settings/app", Some(json!({ "context": { "phoneDailyLimit": good } }))).await;
        assert_eq!(r.status, 200, "{}", r.text);
        assert_eq!(r.body["app"]["context"]["phoneDailyLimit"], good);
    }
    // Other groups leave it alone, and it survives a restart of the settings read.
    assert_eq!(t.json("PATCH", "/api/settings/app", Some(json!({ "idleShutdownMinutes": 30 }))).await.status, 200);
    assert_eq!(t.get("/api/settings").await.body["app"]["context"]["phoneDailyLimit"], 100);
    assert_eq!(t.app.lock().app_settings().context.phone_daily_limit, 100);
}

#[test]
fn the_key_comes_from_the_environment_or_a_private_file() {
    let dir = temp_dir("pager-secrets-");
    let file = dir.join("secrets.env");
    std::fs::write(&file, "# Pager\nANTHROPIC_API_KEY=sk-from-file\n").unwrap();
    let from_env = load_api_key(Some("sk-from-env"), &file);
    assert_eq!(from_env.source, Some(KeySource::Environment));
    assert_eq!(from_env.key.unwrap().expose(), "sk-from-env");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
        let open = load_api_key(None, &file);
        assert!(open.key.is_none(), "a file others can read is refused");
        let warning = open.warning.unwrap();
        assert!(warning.contains("chmod 600") && !warning.contains("sk-from-file"));
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let private = load_api_key(Some(""), &file);
    assert_eq!(private.source, Some(KeySource::File(file.clone())));
    assert_eq!(private.key.as_ref().unwrap().expose(), "sk-from-file");
    assert_eq!(format!("{:?}", private.key.unwrap()), "ApiKey(***)");
    assert!(load_api_key(None, &dir.join("missing.env")).key.is_none());
}

#[test]
fn extraction_sends_lists_and_front_matter_never_chapters() {
    let bytes = std::fs::read(fixtures().join("epub").join("pg1342.epub")).unwrap();
    let doc = pager_server::ingest::parse_file(&bytes, Format::Epub, &ingest_ctx(None, "pg1342.epub")).unwrap();
    let input = extract_lists(&doc);
    let names: Vec<&str> = input.names.iter().map(|c| c.text.as_str()).collect();
    for n in ["Elizabeth", "Darcy", "Bennet", "Bingley"] {
        assert!(names.contains(&n), "{n} in {names:?}");
    }
    assert!(!names.iter().any(|n| n.starts_with("But ") || *n == "I"), "{names:?}");
    assert!(input.names.len() <= 60 && input.works.len() <= 40 && input.terms.len() <= 30);
    let body = first_request(Level::General, &input, &json!({}), None).to_string();
    assert!(!body.contains("In vain have I struggled"), "no chapter text");
    assert!(body.len() < 60_000, "{} bytes", body.len());
    assert!(input.front_matter.iter().map(|f| f.text.chars().count()).sum::<usize>() <= 12_000);
}

#[tokio::test]
async fn a_long_briefing_is_trimmed_from_terms_first() {
    let sep = "https://plato.stanford.edu/entries/darwinism/";
    let text = "Charles Darwin published On the Origin of Species in November 1859, presenting a theory of descent with modification by means of natural selection.";
    let mut evidence = Evidence::default();
    evidence.fetched.insert(pager_server::briefing::verify::norm_url(sep), text.to_string());
    let claim = json!({ "text": "A sourced claim.", "inferred": false, "spoiler": false, "citations": [
        { "kind": "page", "url": sep, "title": "Darwinism", "quote": "published On the Origin of Species in November 1859" }] });
    let items = |n: usize, claims: usize| -> Value { json!((0..n).map(|i| json!({ "heading": format!("Item {i}"), "spoiler": false, "claims": vec![claim.clone(); claims] })).collect::<Vec<_>>()) };
    let draft: Draft = serde_json::from_value(json!({ "littleKnown": false, "sections": [
        { "kind": "overview", "items": items(1, 2) },
        { "kind": "moment", "items": items(4, 3) },
        { "kind": "situation", "items": items(4, 3) },
        { "kind": "conversation", "items": items(3, 1) },
        { "kind": "terms", "items": items(4, 1) },
    ] }))
    .unwrap();
    let fake = Fake::new();
    let v = verify(draft, &evidence, &Lookups::new(fake.clone(), 10)).await;
    let shape: Vec<(SectionKind, usize)> = v.sections.iter().map(|s| (s.kind, s.items.len())).collect();
    // 33 claims: terms 4 → 1 (30), conversation 3 → 1 (28), situation 4 → 2 (25, then 22). Moment and
    // the overview are untouched.
    assert_eq!(shape, vec![(SectionKind::Overview, 1), (SectionKind::Moment, 4), (SectionKind::Situation, 2), (SectionKind::Conversation, 1), (SectionKind::Terms, 1)]);
    let total: usize = v.sections.iter().flat_map(|s| s.items.iter()).map(|i| i.claims.len()).sum();
    assert_eq!(total, 22);
    assert_eq!((v.report.claims_kept, v.report.claims_dropped), (22, 11));
    assert!(fake.seen().is_empty(), "every quote was in what the run read");
}

#[tokio::test]
async fn the_books_own_front_matter_can_be_cited() {
    let mut evidence = Evidence::default();
    evidence.book = "INTRODUCTION BY MRS FORSTER-NIETZSCHE.\n“Zarathustra” is my brother’s most personal work; it is the history of his most individual experiences.".into();
    let cite = |q: &str| json!({ "kind": "book", "url": null, "title": "Introduction by Elisabeth Förster-Nietzsche", "quote": q });
    let draft: Draft = serde_json::from_value(json!({ "littleKnown": false, "sections": [{ "kind": "situation", "items": [
        { "heading": "The sister who introduces your edition", "spoiler": false, "claims": [
            { "text": "His sister's introduction calls it his most personal work.", "inferred": false, "spoiler": false, "citations": [cite("Zarathustra is my brother's most personal work; it is the history")] },
            { "text": "She says he dictated it.", "inferred": false, "spoiler": false, "citations": [cite("my brother dictated every word of it to me at Sils Maria")] }] }] }] }))
    .unwrap();
    let fake = Fake::new();
    let v = verify(draft, &evidence, &Lookups::new(fake.clone(), 10)).await;
    let claims = &v.sections[0].items[0].claims;
    assert_eq!(claims.len(), 1);
    assert_eq!(claims[0].citations[0].check, Some(Check::Quoted));
    assert!(v.report.dropped.iter().any(|d| d.reason.contains("isn't in the book's front matter")));
    assert!(fake.seen().is_empty(), "the book is checked on the computer");
}

/// The submission fixture, edited into a focused briefing on Malthus: a `focus` node, and an
/// `author → focus` link that reuses a claim that verifies.
fn focused_submit() -> Value {
    let mut v = fxj("api-3-submit.json");
    let input = v["content"].as_array_mut().unwrap().iter_mut().find(|b| b["name"] == "submit_briefing").unwrap()["input"].as_object_mut().unwrap();
    input["entities"].as_array_mut().unwrap().push(json!({ "id": "focus", "kind": "person", "name": "Thomas Robert Malthus", "wikidata": null, "record": null }));
    let claim = input["links"][0]["claim"].clone();
    input["links"].as_array_mut().unwrap().push(json!({ "from": "author", "to": "focus", "relation": "read", "claim": claim }));
    v
}

fn script_focused(fake: &Fake) {
    fake.answer(fxj("api-1-research.json"));
    fake.answer(fxj("api-2-pause.json"));
    fake.answer(focused_submit());
}

#[tokio::test]
async fn context_for_this_makes_a_short_briefing_cached_per_item() {
    let fake = Fake::new();
    fake.catalogue();
    script_focused(&fake);
    let t = app_with(&fake, true, limits());
    let doc = add_book(&t).await;

    let started = start(&t, &doc, json!({ "focus": "Malthus" })).await;
    assert_eq!(started.status, 202, "{}", started.text);
    let run = wait_run(&t, started.body["run"]["id"].as_str().unwrap()).await;
    assert_eq!(run["status"], "done", "{run}");

    // The model was told what the reader selected, as data.
    let first = fake.api_bodies()[0]["messages"][0]["content"].as_str().unwrap().to_string();
    assert!(first.starts_with("A focused briefing"), "{}", &first[..200]);
    assert!(first.contains("<focus>Malthus</focus>"));
    assert!(fake.api_bodies()[0]["system"].to_string().contains("# A focused briefing"), "one system prompt for both kinds of run");

    let got = t.get(&format!("/api/tools/context/briefings/{doc}?focus=malthus")).await;
    assert_eq!(got.status, 200, "{}", got.text);
    assert_eq!(got.body["cachedLevels"], json!(["general"]));
    let b: Briefing = serde_json::from_value(got.body["briefing"].clone()).unwrap();
    assert_eq!(b.focus.as_deref(), Some("Malthus"));
    let kinds: Vec<SectionKind> = b.sections.iter().map(|s| s.kind).collect();
    assert_eq!(kinds, vec![SectionKind::Overview, SectionKind::Moment, SectionKind::Situation, SectionKind::Conversation, SectionKind::FurtherReading], "no pre-reading in a focused briefing");
    let ids: Vec<&str> = b.entities.iter().map(|e| e.id.as_str()).collect();
    assert!(ids.contains(&"focus") && ids.contains(&"book") && ids.contains(&"author"), "{ids:?}");
    assert!(b.links.iter().any(|l| l.from == "author" && l.to == "focus"));
    assert!(b.stats.claims_kept <= 12);

    // Its own cache: the whole book has nothing yet, and the same name written differently hits it.
    let whole = t.get(&format!("/api/tools/context/briefings/{doc}")).await;
    assert!(whole.body["briefing"].is_null(), "{}", whole.text);
    assert_eq!(whole.body["cachedLevels"], json!([]));
    let calls = fake.api_bodies().len();
    for spelling in ["“Malthus’s”", "  malthus. "] {
        let again = start(&t, &doc, json!({ "focus": spelling })).await;
        assert_eq!(again.status, 200, "{spelling}: {}", again.text);
        assert_eq!(again.body["briefing"]["focus"], "Malthus");
    }
    let curly = t.get(&format!("/api/tools/context/briefings/{doc}?focus=%E2%80%9CMalthus%E2%80%99s%E2%80%9D")).await;
    assert_eq!(curly.body["briefing"]["focus"], "Malthus");
    assert_eq!(fake.api_bodies().len(), calls, "a cache hit makes no call");
    assert!(t.get(&format!("/api/tools/context/briefings/{doc}?focus=Lyell")).await.body["briefing"].is_null());
    let stored: Vec<String> = t.app.lock().all("SELECT focus FROM context_briefings", &[], |r| r.get(0)).unwrap();
    assert_eq!(stored, vec!["malthus".to_string()]);

    // What isn't a name or a title is refused before anything runs.
    for bad in [json!("x".repeat(121)), json!(5), json!(["Malthus"]), json!("1859")] {
        let r = start(&t, &doc, json!({ "focus": bad })).await;
        assert_eq!(r.status, 400, "{bad}: {}", r.text);
        assert_eq!(r.body["error"]["code"], "invalid_request");
        assert!(r.body["error"]["message"].as_str().unwrap().contains("Select a name or a title"), "{}", r.text);
    }
    let long = t.get(&format!("/api/tools/context/briefings/{doc}?focus={}", "x".repeat(121))).await;
    assert_eq!(long.status, 400, "{}", long.text);
    assert!(t.get(&format!("/api/tools/context/briefings/{doc}?focus={}", "x".repeat(120))).await.status == 200);
    assert_eq!(fake.api_bodies().len(), calls);
    assert_eq!(t.db_count("SELECT COUNT(*) FROM context_runs"), 1);
}

#[tokio::test]
async fn a_focused_briefing_keeps_its_focus_and_at_most_twelve_claims() {
    let sep = "https://plato.stanford.edu/entries/darwinism/";
    let text = "Charles Darwin published On the Origin of Species in November 1859, presenting a theory of descent with modification by means of natural selection.";
    let mut evidence = Evidence::default();
    evidence.fetched.insert(pager_server::briefing::verify::norm_url(sep), text.to_string());
    let claim = json!({ "text": "A sourced claim.", "inferred": false, "spoiler": false, "citations": [
        { "kind": "page", "url": sep, "title": "Darwinism", "quote": "published On the Origin of Species in November 1859" }] });
    let items = |n: usize, claims: usize| -> Value { json!((0..n).map(|i| json!({ "heading": format!("Item {i}"), "spoiler": false, "claims": vec![claim.clone(); claims] })).collect::<Vec<_>>()) };
    let essay = json!({ "title": "An Essay on the Principle of Population", "authors": ["Thomas Robert Malthus"], "year": "1798", "record": { "kind": "olid", "value": "OL1179009W" } });
    let draft = json!({ "littleKnown": false, "sections": [
        { "kind": "overview", "items": items(1, 2) },
        { "kind": "readFirst", "items": [{ "heading": "Malthus's Essay", "work": essay, "spoiler": false, "claims": [claim.clone()] }] },
        { "kind": "moment", "items": items(3, 2) },
        { "kind": "situation", "items": items(2, 2) },
        { "kind": "conversation", "items": items(4, 1) },
        { "kind": "terms", "items": items(2, 1) },
    ], "entities": [
        { "id": "book", "kind": "work", "name": "On the Origin of Species", "wikidata": null, "record": null },
        { "id": "author", "kind": "person", "name": "Charles Darwin", "wikidata": null, "record": null },
        { "id": "focus", "kind": "person", "name": "Thomas Robert Malthus", "wikidata": null, "record": null },
    ], "links": [] });
    let fake = Fake::new();
    fake.catalogue();
    let lookups = Lookups::new(fake.clone(), 20);

    let v = verify_shaped(serde_json::from_value(draft.clone()).unwrap(), &evidence, &lookups, Shape::Focus).await;
    let shape: Vec<(SectionKind, usize)> = v.sections.iter().map(|s| (s.kind, s.items.len())).collect();
    // 19 claims verify. The section limits drop the pre-reading (1), the third moment (2) and the
    // fourth conversation item (1); the length cap then takes a term and two conversation items (3).
    assert_eq!(shape, vec![(SectionKind::Overview, 1), (SectionKind::Moment, 2), (SectionKind::Situation, 2), (SectionKind::Conversation, 1), (SectionKind::Terms, 1)]);
    assert_eq!((v.report.claims_kept, v.report.claims_dropped), (12, 7));
    assert!(v.report.dropped.iter().any(|d| d.reason == "a focused briefing has no pre-reading"), "{:?}", v.report.dropped);
    assert!(v.report.dropped.iter().any(|d| d.reason.contains("length of 12 claims")));
    let ids: Vec<&str> = v.entities.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(ids, vec!["book", "author", "focus"], "the focus stays even with no link to it");

    // The same draft as a whole-book briefing: pre-reading allowed, and a node nothing points at goes.
    let whole = verify(serde_json::from_value(draft).unwrap(), &evidence, &lookups).await;
    assert!(whole.sections.iter().any(|s| s.kind == SectionKind::ReadFirst));
    assert!(!whole.entities.iter().any(|e| e.id == "focus"));
}

#[tokio::test]
async fn a_focused_run_from_a_phone_counts_toward_its_limit() {
    let fake = Fake::new();
    fake.catalogue();
    let t = app_with(&fake, true, limits());
    let doc = add_book(&t).await;
    let token = pair_phone(&t).await;

    script_focused(&fake);
    let r = phone_start(&t, &token, &doc, json!({ "focus": "Malthus" })).await;
    assert_eq!(r.status, 202, "{}", r.text);
    assert_eq!(phone_wait(&t, &token, r.body["run"]["id"].as_str().unwrap()).await["status"], "done");
    assert_eq!(phone_status(&t, &token).await.body["phone"]["used"], 1);
    let got = t.remote_call(Call::get(&format!("/api/tools/context/briefings/{doc}?focus=Malthus")).token(&token)).await;
    assert_eq!(got.status, 200, "{}", got.text);
    assert_eq!(got.body["briefing"]["focus"], "Malthus");
    // Opening it again is free.
    assert_eq!(phone_start(&t, &token, &doc, json!({ "focus": "malthus" })).await.status, 200);
    assert_eq!(phone_status(&t, &token).await.body["phone"]["used"], 1);

    // At the limit, a focused run is refused like any other.
    let zero = t.json("PATCH", "/api/settings/app", Some(json!({ "context": { "phoneDailyLimit": 1 } }))).await;
    assert_eq!(zero.status, 200, "{}", zero.text);
    let over = phone_start(&t, &token, &doc, json!({ "focus": "Lyell" })).await;
    assert_eq!(over.status, 429, "{}", over.text);
    assert_eq!(over.body["error"]["code"], "limit_reached");
    assert_eq!(fake.api_bodies().len(), 3);
}

// ---- Phase 4: the research as it happens, and where the time went ----

#[test]
fn a_response_s_searches_and_reads_become_steps() {
    let steps = steps_in(&fxj("api-1-research.json")["content"]);
    assert_eq!(
        steps,
        vec![
            RunStep::Search { query: "On the Origin of Species 1859 context Malthus".into(), ok: true },
            RunStep::Read { url: "https://plato.stanford.edu/entries/darwinism/".into(), title: steps_title(&fxj("api-1-research.json")), ok: true },
        ]
    );
    // A failed search or fetch is marked; a result not in this response (a paused turn) counts as ok.
    let content = json!([
        { "type": "server_tool_use", "id": "a", "name": "web_search", "input": { "query": "Malthus" } },
        { "type": "web_search_tool_result", "tool_use_id": "a", "content": { "type": "web_search_tool_result_error", "error_code": "max_uses_exceeded" } },
        { "type": "server_tool_use", "id": "b", "name": "web_fetch", "input": { "url": "https://example.org/x" } },
        { "type": "web_fetch_tool_result", "tool_use_id": "b", "content": { "type": "web_fetch_tool_error", "error_code": "url_not_accessible" } },
        { "type": "server_tool_use", "id": "c", "name": "web_fetch", "input": { "url": "https://example.org/y" } },
        { "type": "server_tool_use", "id": "d", "name": "code_execution", "input": { "code": "print(1)" } },
        { "type": "server_tool_use", "id": "e", "name": "web_search", "input": { "query": "  " } },
    ]);
    assert_eq!(
        steps_in(&content),
        vec![
            RunStep::Search { query: "Malthus".into(), ok: false },
            RunStep::Read { url: "https://example.org/x".into(), title: None, ok: false },
            RunStep::Read { url: "https://example.org/y".into(), title: None, ok: true },
        ]
    );
    assert_eq!(steps_in(&json!(null)), vec![]);
    // Serialized for the reader as tagged objects.
    assert_eq!(serde_json::to_value(RunStep::Lookup { source: "openLibrary", query: "Cecilia".into(), ok: true }).unwrap(), json!({ "kind": "lookup", "source": "openLibrary", "query": "Cecilia", "ok": true }));
    assert_eq!(serde_json::to_value(RunStep::Read { url: "https://a.org/".into(), title: None, ok: true }).unwrap(), json!({ "kind": "read", "url": "https://a.org/", "ok": true }));
}

/// The fetched page's title in a research answer, if the fixture gives one.
fn steps_title(resp: &Value) -> Option<String> {
    resp["content"].as_array().unwrap().iter().find(|b| b["type"] == "web_fetch_tool_result").and_then(|b| b["content"]["content"]["title"].as_str()).map(str::to_string)
}

#[test]
fn the_checker_counts_distinct_sources_and_claims() {
    let draft: Draft = serde_json::from_value(fxj("api-3-submit.json")["content"].as_array().unwrap().iter().find(|b| b["name"] == "submit_briefing").unwrap()["input"].clone()).unwrap();
    let c = draft_counts(&draft);
    let claims: usize = draft.sections.iter().flat_map(|s| s.items.iter()).map(|i| i.claims.len() + i.disagreement.as_ref().map(|d| d.sides.iter().map(|s| s.claims.len()).sum()).unwrap_or(0)).sum::<usize>() + draft.links.len();
    assert_eq!(c.claims as usize, claims);
    assert!(c.sources > 0 && (c.sources as usize) <= claims * 3 + draft.sections.iter().flat_map(|s| s.items.iter()).filter(|i| i.work.is_some()).count());
    // The same page cited twice, with and without "www." and a trailing slash, is one source.
    let one = |url: &str| json!({ "kind": "page", "url": url, "title": "T", "author": null, "year": null, "quote": "a quote long enough to check here", "record": null });
    let claim = |cits: Vec<Value>| json!({ "text": "x", "inferred": false, "spoiler": false, "citations": cits });
    let d: Draft = serde_json::from_value(json!({
        "littleKnown": false,
        "sections": [{ "kind": "moment", "items": [{ "heading": "h", "spoiler": false, "claims": [claim(vec![one("https://www.a.org/p/")]), claim(vec![one("https://a.org/p"), json!({ "kind": "book", "url": null, "title": "Introduction", "author": null, "year": null, "quote": "q q q q q q", "record": null })])] }] }],
        "entities": [], "links": []
    }))
    .unwrap();
    assert_eq!(draft_counts(&d), Checking { sources: 2, claims: 2 });
}

#[tokio::test]
async fn a_run_reports_each_stage_step_and_what_it_checks() {
    let fake = Fake::new();
    fake.catalogue();
    fake.script();
    let t = app_with(&fake, true, limits());
    let doc = add_book(&t).await;
    let seen: Arc<Mutex<Vec<Progress>>> = Arc::default();
    let s2 = seen.clone();
    let progress = move |p: Progress| s2.lock().unwrap().push(p);
    let g = match generate(&t.app, &doc, Level::General, None, &limits(), &progress).await {
        Ok(g) => g,
        Err((f, _)) => panic!("the run failed: {f:?}"),
    };
    let seen = seen.lock().unwrap().clone();
    let stages: Vec<Stage> = seen.iter().filter_map(|p| if let Progress::Stage(s) = p { Some(*s) } else { None }).collect();
    assert_eq!(stages, vec![Stage::Reading, Stage::Researching, Stage::Checking]);
    let steps: Vec<RunStep> = seen.iter().filter_map(|p| if let Progress::Step(s) = p { Some(s.clone()) } else { None }).collect();
    // The seed lookups first, then each answer's searches and reads, with the model's own lookups between.
    assert_eq!(steps[0], RunStep::Lookup { source: "openLibrary", query: "On the Origin of Species".into(), ok: true });
    assert_eq!(steps[1], RunStep::Lookup { source: "wikidata", query: "Charles Darwin".into(), ok: true });
    assert_eq!(steps[2], RunStep::Search { query: "On the Origin of Species 1859 context Malthus".into(), ok: true });
    assert!(matches!(&steps[3], RunStep::Read { url, ok: true, .. } if url == "https://plato.stanford.edu/entries/darwinism/"));
    assert_eq!(steps[4], RunStep::Lookup { source: "openLibrary", query: "An Essay on the Principle of Population".into(), ok: true });
    assert!(matches!(&steps[5], RunStep::Read { ok: true, .. }), "the paused turn's fetch: {:?}", steps[5]);
    assert_eq!(steps.len(), 6);
    // What the checker had, reported before the checking stage.
    let checking: Vec<Checking> = seen.iter().filter_map(|p| if let Progress::Checking(c) = p { Some(*c) } else { None }).collect();
    assert_eq!(checking.len(), 1);
    let at_checking = seen.iter().position(|p| matches!(p, Progress::Checking(_))).unwrap();
    assert_eq!(seen[at_checking + 1], Progress::Stage(Stage::Checking));
    assert!(checking[0].claims >= g.briefing.stats.claims_kept + g.briefing.stats.links_kept);
    // Where the time went: one entry per API call, and the rest measured.
    let tm = &g.usage.timings;
    assert_eq!(tm.calls_ms.len(), 3);
    assert_eq!(tm.total_ms(), tm.reading_ms + tm.seed_ms + tm.calls_ms.iter().sum::<u64>() + tm.tools_ms + tm.checking_ms);
    let sum = tm.summary();
    assert!(sum.starts_with("reading ") && sum.contains(", API calls ") && sum.contains(" + ") && sum.ends_with(" s"), "{sum}");
    assert_eq!(seed_steps(&pager_server::briefing::extract::BookInput { title: "Emma: A Novel".into(), ..Default::default() }, &json!({})), vec![RunStep::Lookup { source: "openLibrary", query: "Emma".into(), ok: false }]);
}

#[tokio::test]
async fn a_running_briefing_shows_its_steps_and_time_then_keeps_only_the_outcome() {
    let fake = Fake::new();
    fake.catalogue();
    fake.script();
    let gate = Arc::new(tokio::sync::Semaphore::new(0));
    *fake.gate.lock().unwrap() = Some(gate.clone());
    let t = app_with(&fake, true, limits());
    let doc = add_book(&t).await;
    let r = start(&t, &doc, json!({})).await;
    assert_eq!(r.status, 202, "{}", r.text);
    let id = r.body["run"]["id"].as_str().unwrap().to_string();
    assert!(r.body["run"].get("steps").is_none(), "nothing done yet: {}", r.body);

    // Held at the first call: the seed lookups are there, with the time since it started.
    let run = poll_run(&t, &id, |v| v["steps"].as_array().map(|a| a.len() >= 2).unwrap_or(false)).await;
    assert_eq!(run["stage"], "researching");
    assert_eq!(run["steps"], json!([
        { "kind": "lookup", "source": "openLibrary", "query": "On the Origin of Species", "ok": true },
        { "kind": "lookup", "source": "wikidata", "query": "Charles Darwin", "ok": true },
    ]));
    assert_eq!(run["elapsedMs"], 0);
    t.clock.advance(65_000);
    assert_eq!(t.get(&format!("/api/tools/context/runs/{id}")).await.body["elapsedMs"], 65_000);
    // The book's state carries the same live run.
    let state = t.get(&format!("/api/tools/context/briefings/{doc}")).await.body;
    assert_eq!(state["run"]["steps"].as_array().unwrap().len(), 2);
    assert_eq!(state["run"]["elapsedMs"], 65_000);

    // The first answer: its search, its read and the model's lookup.
    gate.add_permits(1);
    let run = poll_run(&t, &id, |v| v["steps"].as_array().map(|a| a.len() >= 5).unwrap_or(false)).await;
    let kinds: Vec<&str> = run["steps"].as_array().unwrap().iter().map(|s| s["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, vec!["lookup", "lookup", "search", "read", "lookup"]);
    assert_eq!(run["steps"][2]["query"], "On the Origin of Species 1859 context Malthus");
    assert_eq!(run["steps"][4], json!({ "kind": "lookup", "source": "openLibrary", "query": "An Essay on the Principle of Population", "ok": true }));
    assert!(run.get("checking").is_none());

    // The rest, then the stored outcome: no steps, no clock.
    gate.add_permits(2);
    let done = wait_run(&t, &id).await;
    assert_eq!(done["status"], "done", "{done}");
    assert!(done.get("steps").is_none() && done.get("checking").is_none() && done.get("elapsedMs").is_none(), "{done}");
    // The run's record keeps where the time went (the server log prints it too); the reader's stats don't.
    let usage: String = t.app.lock().one("SELECT usage FROM context_runs WHERE id = ?1", &[&id], |r| r.get(0)).unwrap().unwrap();
    let usage: Value = serde_json::from_str(&usage).unwrap();
    assert_eq!(usage["timings"]["callsMs"].as_array().unwrap().len(), 3);
    for k in ["readingMs", "seedMs", "toolsMs", "checkingMs", "totalMs"] {
        assert!(usage["timings"][k].is_u64(), "{k} in {usage}");
    }
    let state = t.get(&format!("/api/tools/context/briefings/{doc}")).await.body;
    assert!(state["briefing"]["stats"].get("timings").is_none());
}

#[tokio::test]
async fn a_failed_run_still_records_its_time() {
    let fake = Fake::new();
    fake.catalogue();
    fake.api(Api::Answer(401, json!({ "type": "error", "error": { "type": "authentication_error", "message": "invalid x-api-key" } })));
    let t = app_with(&fake, true, limits());
    let doc = add_book(&t).await;
    let id = start(&t, &doc, json!({})).await.body["run"]["id"].as_str().unwrap().to_string();
    let run = wait_run(&t, &id).await;
    assert_eq!(run["status"], "failed");
    assert!(run.get("steps").is_none());
    let usage: String = t.app.lock().one("SELECT usage FROM context_runs WHERE id = ?1", &[&id], |r| r.get(0)).unwrap().unwrap();
    let usage: Value = serde_json::from_str(&usage).unwrap();
    assert_eq!(usage["timings"]["callsMs"].as_array().unwrap().len(), 1, "{usage}");
}

async fn poll_run(t: &TestApp, id: &str, until: impl Fn(&Value) -> bool) -> Value {
    for _ in 0..1000 {
        let r = t.get(&format!("/api/tools/context/runs/{id}")).await;
        assert_eq!(r.status, 200, "{}", r.text);
        if until(&r.body) {
            return r.body;
        }
        assert_eq!(r.body["status"], "running", "the run ended early: {}", r.body);
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("the run never got there");
}

#[tokio::test]
async fn the_assistant_page_lists_every_book_with_a_briefing() {
    let fake = Fake::new();
    fake.catalogue();
    fake.script();
    let t = app_with(&fake, true, limits());
    assert_eq!(t.get("/api/tools/context/briefings").await.body, json!({ "briefings": [] }));
    let doc = add_book(&t).await;
    let id = start(&t, &doc, json!({})).await.body["run"]["id"].as_str().unwrap().to_string();
    assert_eq!(wait_run(&t, &id).await["status"], "done");
    t.clock.advance(60_000);
    script_focused(&fake);
    let id = start(&t, &doc, json!({ "focus": "“Malthus’s”" })).await.body["run"]["id"].as_str().unwrap().to_string();
    assert_eq!(wait_run(&t, &id).await["status"], "done");
    let list = t.get("/api/tools/context/briefings").await.body;
    assert_eq!(
        list,
        json!({ "briefings": [
            { "docId": doc, "level": "general", "focus": "Malthus", "generatedAt": "2026-11-05T12:01:00.000Z" },
            { "docId": doc, "level": "general", "focus": null, "generatedAt": "2026-11-05T12:00:00.000Z" },
        ] })
    );
    // A Refresh replaces its entry rather than adding one; a deleted book drops out.
    t.clock.advance(60_000);
    fake.script();
    let id = start(&t, &doc, json!({ "refresh": true })).await.body["run"]["id"].as_str().unwrap().to_string();
    assert_eq!(wait_run(&t, &id).await["status"], "done");
    let list = t.get("/api/tools/context/briefings").await.body;
    assert_eq!(list["briefings"].as_array().unwrap().len(), 2);
    assert_eq!(list["briefings"][0]["focus"], Value::Null);
    assert_eq!(list["briefings"][0]["generatedAt"], "2026-11-05T12:02:00.000Z");
    t.db_exec(&format!("UPDATE documents SET deleted_at = '2026-11-05T13:00:00Z' WHERE id = '{doc}'"));
    assert_eq!(t.get("/api/tools/context/briefings").await.body, json!({ "briefings": [] }));
}

// ---- Pictures and Wikipedia intros for the map (Phase 5) ----

/// A JPEG's first bytes (all the asset store sniffs), told apart by `tag`.
fn jpeg(tag: &str) -> Vec<u8> {
    let mut b = vec![0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, b'J', b'F', b'I', b'F', 0x00];
    b.extend_from_slice(tag.as_bytes());
    b.extend_from_slice(&[0xff, 0xd9]);
    b
}

const THUMBS: [(&str, &str); 4] = [
    ("https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2e/", "darwin"),
    ("https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d5/", "malthus"),
    ("https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6d/", "down"),
    ("https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cd/", "origin"),
];

/// Wikidata, Wikipedia and Commons as recorded on 2026-11-06 (trimmed), and the four thumbnails.
fn wikimedia(fake: &Fake) {
    let j = "application/json";
    fake.route("https://query.wikidata.org/sparql", 200, j, fx("media-sparql.json"));
    fake.route("https://en.wikipedia.org/w/api.php", 200, j, fx("media-wikipedia.json"));
    fake.route("https://commons.wikimedia.org/w/api.php", 200, j, fx("media-commons.json"));
    for (prefix, tag) in THUMBS {
        fake.route(prefix, 200, "image/jpeg", jpeg(tag));
    }
}

fn count(fake: &Fake, prefix: &str) -> usize {
    fake.urls().iter().filter(|u| u.starts_with(prefix)).count()
}

const MEDIA_IDS: &str = "Q1035,Q13526,Q3038318,Q20124,Q99999";

#[tokio::test]
async fn pictures_and_intros_come_from_wikimedia_once_then_from_the_cache() {
    let fake = Fake::new();
    wikimedia(&fake);
    // No API key: these lookups are free and don't need one.
    let t = app_with(&fake, false, limits());
    let r = t.get(&format!("/api/tools/context/media?ids={MEDIA_IDS}")).await;
    assert_eq!(r.status, 200, "{}", r.text);
    let m = &r.body["media"];

    // One request to each service, whatever the number of items, and a thumbnail each.
    assert_eq!(count(&fake, "https://query.wikidata.org/sparql"), 1);
    assert_eq!(count(&fake, "https://en.wikipedia.org/"), 1);
    assert_eq!(count(&fake, "https://commons.wikimedia.org/"), 1);
    assert_eq!(count(&fake, "https://thumb.wikimedia.org/"), 4);
    let sparql = fake.urls().into_iter().find(|u| u.starts_with("https://query.wikidata.org/")).unwrap();
    assert!(sparql.contains("wd%3AQ1035") && sparql.contains("wd%3AQ99999") && sparql.contains("P18"), "{sparql}");

    // The article's lead image wins over Wikidata's P18 ("Charles Darwin portrait.jpg").
    let darwin = &m["Q1035"];
    let img = &darwin["image"];
    assert!(img["url"].as_str().unwrap().starts_with("/api/assets/") && img["url"].as_str().unwrap().ends_with(".jpg"), "{img}");
    assert_eq!(img["width"], 480);
    assert_eq!(img["credit"]["artist"], "Henry Maull (1829–1914) and John Fox (1832–1907) (Maull & Fox)");
    assert_eq!(img["credit"]["license"], "Public domain");
    assert_eq!(img["credit"]["page"], "https://commons.wikimedia.org/wiki/File:Charles_Darwin_seated_crop.jpg");
    assert!(!fake.urls().iter().any(|u| u.contains("/f/f1/Charles_Darwin_portrait")), "only the chosen file is downloaded");
    let summary = &darwin["summary"];
    assert_eq!(summary["title"], "Charles Darwin");
    assert_eq!(summary["url"], "https://en.wikipedia.org/wiki/Charles_Darwin");
    let extract = summary["extract"].as_str().unwrap();
    assert!(extract.starts_with("Charles Robert Darwin (DAR-win; 12 February 1809 – 19 April 1882) was an English naturalist"), "{extract}");
    assert!(!extract.contains("  "));
    assert!(m["Q13526"]["summary"]["extract"].as_str().unwrap().starts_with("Thomas Robert Malthus (13/14 February 1766"));
    assert_eq!(m["Q3038318"]["image"]["credit"]["license"], "CC BY-SA 3.0");
    assert_eq!(m["Q3038318"]["image"]["credit"]["artist"], "Anthonyeatworld at English Wikipedia");
    // An item Wikimedia knows nothing more about.
    assert_eq!(m["Q99999"], json!({ "image": null, "summary": null }));

    // The thumbnail is served by the computer, as any other picture in the library.
    let asset = t.get(img["url"].as_str().unwrap()).await;
    assert_eq!(asset.status, 200);
    assert_eq!(asset.headers.get("content-type").unwrap(), "image/jpeg");
    let distinct: std::collections::HashSet<String> = ["Q1035", "Q13526", "Q3038318", "Q20124"].iter().map(|q| m[*q]["image"]["url"].as_str().unwrap().to_string()).collect();
    assert_eq!(distinct.len(), 4);

    // Again, or some of them: from the cache, with no request.
    let before = fake.seen().len();
    let again = t.get(&format!("/api/tools/context/media?ids={MEDIA_IDS}")).await;
    assert_eq!(again.body, r.body);
    let some = t.get("/api/tools/context/media?ids=Q99999,Q1035").await;
    assert_eq!(some.body["media"]["Q1035"], m["Q1035"]);
    assert_eq!(some.body["media"].as_object().unwrap().len(), 2);
    assert_eq!(fake.seen().len(), before);

    // After 30 days they are looked up again.
    t.app.clock.advance(31 * 24 * 3600 * 1000);
    t.get("/api/tools/context/media?ids=Q1035").await;
    assert_eq!(count(&fake, "https://query.wikidata.org/sparql"), 2);
}

#[tokio::test]
async fn a_failed_lookup_is_not_cached() {
    let fake = Fake::new();
    wikimedia(&fake);
    // Darwin's thumbnail fails (a 500, which isn't retried): the intro still shows, the picture is asked for again later.
    fake.route("https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2e/", 500, "text/plain", b"oops".to_vec());
    let t = app_with(&fake, false, limits());
    let r = t.get("/api/tools/context/media?ids=Q1035,Q3038318").await;
    assert_eq!(r.status, 200, "{}", r.text);
    assert_eq!(r.body["media"]["Q1035"]["image"], Value::Null);
    assert_eq!(r.body["media"]["Q1035"]["summary"]["title"], "Charles Darwin");
    assert!(r.body["media"]["Q3038318"]["image"]["url"].is_string());
    fake.route("https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2e/", 200, "image/jpeg", jpeg("darwin"));
    let sparql_before = count(&fake, "https://query.wikidata.org/sparql");
    let r = t.get("/api/tools/context/media?ids=Q1035,Q3038318").await;
    assert!(r.body["media"]["Q1035"]["image"]["url"].is_string(), "{}", r.text);
    // Down House came from the cache: only Darwin was looked up again.
    assert_eq!(count(&fake, "https://query.wikidata.org/sparql"), sparql_before + 1);
    let last = fake.urls().into_iter().filter(|u| u.starts_with("https://query.wikidata.org/")).last().unwrap();
    assert!(last.contains("wd%3AQ1035") && !last.contains("Q3038318"), "{last}");

    // Wikidata down: nothing to show and nothing kept.
    let fake = Fake::new();
    fake.route("https://query.wikidata.org/sparql", 500, "text/plain", b"busy".to_vec());
    let t = app_with(&fake, false, limits());
    let r = t.get("/api/tools/context/media?ids=Q1035").await;
    assert_eq!((r.status, r.body.clone()), (200, json!({ "media": {} })));
    let rows: Vec<String> = t.app.lock().all("SELECT wikidata FROM context_media", &[], |r| r.get(0)).unwrap();
    assert!(rows.is_empty());

    // No outbound requests at all (the default): the same.
    let t = make_app();
    let r = t.get("/api/tools/context/media?ids=Q1035").await;
    assert_eq!((r.status, r.body.clone()), (200, json!({ "media": {} })));
}

#[tokio::test]
async fn only_wikimedia_pictures_are_downloaded() {
    let fake = Fake::new();
    wikimedia(&fake);
    let mut commons = fxj("media-commons.json");
    for p in commons["query"]["pages"].as_array_mut().unwrap() {
        if let Some(ii) = p.get_mut("imageinfo").and_then(|a| a.get_mut(0)) {
            ii["thumburl"] = json!("http://192.168.1.1/router.jpg");
        }
    }
    fake.route("https://commons.wikimedia.org/w/api.php", 200, "application/json", commons.to_string().into_bytes());
    let t = app_with(&fake, false, limits());
    let r = t.get("/api/tools/context/media?ids=Q1035,Q3038318").await;
    assert_eq!(r.status, 200);
    assert_eq!(r.body["media"]["Q1035"]["image"], Value::Null);
    assert!(r.body["media"]["Q1035"]["summary"].is_object());
    assert!(!fake.urls().iter().any(|u| u.contains("192.168.")), "{:?}", fake.urls());

    let fake = Fake::new();
    wikimedia(&fake);
    fake.route("https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6d/", 200, "text/html", b"<html>not a picture</html>".to_vec());
    let t = app_with(&fake, false, limits());
    let r = t.get("/api/tools/context/media?ids=Q3038318").await;
    assert_eq!(r.body["media"]["Q3038318"]["image"], Value::Null);
    assert!(r.body["media"]["Q3038318"]["summary"].is_object());
}

#[tokio::test]
async fn media_ids_are_checked() {
    let t = make_app();
    for bad in ["Q1035,P18", "Q1035,../etc", "Q12345678901234"] {
        let r = t.get(&format!("/api/tools/context/media?ids={bad}")).await;
        assert_eq!((bad, r.status, r.body["error"]["code"].clone()), (bad, 400, json!("invalid_request")), "{}", r.text);
    }
    let many = (1..=41).map(|i| format!("Q{i}")).collect::<Vec<_>>().join(",");
    assert_eq!(t.get(&format!("/api/tools/context/media?ids={many}")).await.status, 400);
    let forty = (1..=40).map(|i| format!("Q{i}")).collect::<Vec<_>>().join(",");
    assert_eq!(t.get(&format!("/api/tools/context/media?ids={forty}")).await.status, 200);
    let none = t.get("/api/tools/context/media").await;
    assert_eq!((none.status, none.body), (200, json!({ "media": {} })));
}
