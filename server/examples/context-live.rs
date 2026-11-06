//! A Context briefing for one book, by hand: the real pipeline, the real API, the user's key.
//!
//!   cargo run --release --example context-live -- <book.epub> [--level general|student|scholar]
//!       [--focus "Malthus"] [--out FILE] [--record DIR] [--dry-run]
//!
//! --focus TEXT narrows the briefing to one name or work in the book ("Context for this").
//!
//! It reads the book into a temporary library, runs the pipeline, prints the counts and the
//! estimated cost, what was kept and dropped and why, and a plain-text rendering, and writes the
//! briefing as JSON (to --out, else ./context-<book>-<level>.json).
//!
//! --dry-run prints the first request exactly as it would be sent, without the seed lookups. It
//! needs no key, makes no network calls and costs nothing.
//! --record DIR saves every outbound request (never its headers, so never the key) and its answer,
//! to refresh the test fixtures.
//!
//! Without the API (no key, no cost), for drafts written by Claude Code agents standing in for the
//! model (see prompts/book-context.md, "Testing with Claude Code agents"):
//! --prompt-dir DIR writes what the model would get: system.md, user.md (with the seed lookups),
//!   schema.json (submit_briefing's input) and tools.md.
//! --draft FILE runs a draft (submit_briefing's input, as JSON) through the real verifier, with
//!   live catalogue lookups and page fetches, and reports it like a run.
//!
//! Dev only, to see real briefings in the UI without the API (never part of the server's API):
//! --store DATA_DIR saves the result into that Pager data folder (e.g. server/.data-dev) for the
//!   library document whose file matches <book.epub>, as the server would after a run. The data
//!   folder's reads folder is PAGER_READS_DIR or the repository's reads/, as for the dev server.
//!   With --draft, the draft is verified first; with --briefing FILE, a briefing already verified
//!   (a sample in tests/fixtures/context/samples, or a file --out wrote) is stored as it is, with
//!   no network at all.

use futures::future::BoxFuture;
use pager_server::app::{App, AppOptions};
use pager_server::config::default_reads_dir;
use pager_server::briefing::focus::parse_focus;
use pager_server::briefing::lookup::Lookups;
use pager_server::briefing::prompt::{system_prompt, tools, user_message};
use pager_server::briefing::run::{finish, first_request, generate, seed, Limits, Progress, Research, Stage, Usage};
use pager_server::briefing::verify::draft_counts;
use pager_server::briefing::RunStep;
use pager_server::briefing::schema::{draft_schema, Briefing, CitationKind, Draft, Level};
use pager_server::briefing::verify::Evidence;
use pager_server::briefing::secrets::{load_api_key, secrets_path, KEY_VAR};
use pager_server::briefing::transport::{LiveTransport, OutError, OutRequest, OutResponse, Transport};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

struct Args {
    book: PathBuf,
    level: Level,
    out: Option<PathBuf>,
    record: Option<PathBuf>,
    dry_run: bool,
    prompt_dir: Option<PathBuf>,
    draft: Option<PathBuf>,
    briefing: Option<PathBuf>,
    store: Option<PathBuf>,
    focus: Option<String>,
}

fn usage() -> ! {
    eprintln!("usage: context-live <book.epub> [--level general|student|scholar] [--out FILE] [--record DIR] [--focus TEXT] [--dry-run | --prompt-dir DIR | --draft FILE | --briefing FILE] [--store DATA_DIR]");
    std::process::exit(2);
}

fn parse_args() -> Args {
    let mut it = std::env::args().skip(1);
    let mut a = Args { book: PathBuf::new(), level: Level::General, out: None, record: None, dry_run: false, prompt_dir: None, draft: None, briefing: None, store: None, focus: None };
    while let Some(x) = it.next() {
        match x.as_str() {
            "--level" => a.level = it.next().and_then(|l| Level::parse(&l)).unwrap_or_else(|| usage()),
            "--out" => a.out = Some(it.next().map(PathBuf::from).unwrap_or_else(|| usage())),
            "--record" => a.record = Some(it.next().map(PathBuf::from).unwrap_or_else(|| usage())),
            "--dry-run" => a.dry_run = true,
            "--prompt-dir" => a.prompt_dir = Some(it.next().map(PathBuf::from).unwrap_or_else(|| usage())),
            "--draft" => a.draft = Some(it.next().map(PathBuf::from).unwrap_or_else(|| usage())),
            "--briefing" => a.briefing = Some(it.next().map(PathBuf::from).unwrap_or_else(|| usage())),
            "--store" => a.store = Some(it.next().map(PathBuf::from).unwrap_or_else(|| usage())),
            "--focus" => {
                let raw = it.next().unwrap_or_else(|| usage());
                match parse_focus(Some(&raw)) {
                    Ok(Some(f)) => a.focus = Some(f.text),
                    Ok(None) => {}
                    Err(m) => {
                        eprintln!("{m}");
                        std::process::exit(2);
                    }
                }
            }
            "-h" | "--help" => usage(),
            _ if a.book.as_os_str().is_empty() => a.book = PathBuf::from(x),
            _ => usage(),
        }
    }
    if a.book.as_os_str().is_empty() || (a.briefing.is_some() && (a.store.is_none() || a.draft.is_some())) {
        usage();
    }
    a
}

/// Dev only: saves a verified briefing into another Pager data folder (the dev server's), for the
/// document there whose current file has the same content hash, as a finished run would.
async fn store_into(data_dir: &Path, mut b: Briefing, usage: Value) {
    let data_dir = std::fs::canonicalize(data_dir).unwrap_or_else(|_| {
        eprintln!("No Pager data folder at {}.", data_dir.display());
        std::process::exit(1);
    });
    let mut o = AppOptions::new(data_dir.clone());
    o.reads_dir = Some(default_reads_dir());
    o.mirror_delay_ms = 60_000;
    let app = App::new(o).expect("the data folder's app");
    let a = app.clone();
    eprintln!("Reading the library in {} (its reads folder: {}) …", data_dir.display(), app.reads_dir.display());
    tokio::task::spawn_blocking(move || a.ensure()).await.unwrap().expect("read the library");
    let hash = b.content_hash.clone();
    let docs: Vec<(String, String)> = app
        .run(move |c| {
            c.all(
                "SELECT d.id, d.title FROM documents d JOIN revisions r ON r.id = d.current_revision_id WHERE r.content_hash = ?1 AND d.deleted_at IS NULL",
                &[&hash as &dyn rusqlite::ToSql],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
        })
        .await
        .expect("look up the document");
    if docs.is_empty() {
        eprintln!("No document in that library has this file's content. Put the book in its reads folder first.");
        std::process::exit(1);
    }
    for (id, title) in docs {
        b.doc_id = id.clone();
        let one = b.clone();
        let u = usage.clone();
        app.run(move |c| c.briefing_save(&one, &u)).await.expect("save the briefing");
        println!("Stored the {} briefing for “{title}” ({id}) in {}.", b.level.as_str(), data_dir.display());
    }
}

/// Saves each request (URL and body, never headers) and its answer as NNN.json in a folder.
struct Recording {
    inner: Arc<dyn Transport>,
    dir: PathBuf,
    n: AtomicU32,
}

impl Transport for Recording {
    fn send(&self, req: OutRequest) -> BoxFuture<'_, Result<OutResponse, OutError>> {
        Box::pin(async move {
            let n = self.n.fetch_add(1, Ordering::SeqCst);
            let url = req.url.clone();
            let body: Value = req.body.as_ref().and_then(|b| serde_json::from_slice(b).ok()).unwrap_or(Value::Null);
            let out = self.inner.send(req).await;
            let answer = match &out {
                Ok(r) => json!({
                    "status": r.status, "url": r.url, "contentType": r.content_type,
                    "body": serde_json::from_slice::<Value>(&r.body).unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&r.body).into_owned())),
                }),
                Err(e) => json!({ "error": e.to_string() }),
            };
            let file = self.dir.join(format!("{n:03}.json"));
            let _ = std::fs::write(file, serde_json::to_vec_pretty(&json!({ "request": { "url": url, "body": body }, "response": answer })).unwrap_or_default());
            out
        })
    }
}

fn slug(p: &Path) -> String {
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    let s: String = stem.chars().map(|c| if c.is_alphanumeric() { c } else { '-' }).collect();
    s.split('-').filter(|x| !x.is_empty()).take(5).collect::<Vec<_>>().join("-")
}

fn render(b: &Briefing) -> String {
    let mut s = String::new();
    if b.little_known {
        s.push_str("Not much is known about this book's context.\n\n");
    }
    for sec in &b.sections {
        s.push_str(&format!("## {}\n", sec.kind.as_str()));
        for it in &sec.items {
            let mut head = format!("- {}", it.heading);
            if let Some(r) = &it.relation {
                head.push_str(&format!(" [{r}]"));
            }
            if let Some(e) = &it.entity {
                head.push_str(&format!(" (#{e})"));
            }
            if it.spoiler {
                head.push_str(" [spoiler]");
            }
            s.push_str(&head);
            s.push('\n');
            if let Some(w) = &it.work {
                s.push_str(&format!("    work: {} ({}) {} → {}\n", w.title, w.authors.join(", "), w.year.clone().unwrap_or_default(), w.resolved_url.clone().unwrap_or_default()));
            }
            for note in [&it.read_note, &it.time_estimate, &it.suits].into_iter().flatten() {
                s.push_str(&format!("    {note}\n"));
            }
            let mut claims: Vec<(String, &pager_server::briefing::schema::Claim)> = it.claims.iter().map(|c| (String::new(), c)).collect();
            if let Some(d) = &it.disagreement {
                s.push_str(&format!("    Scholars disagree: {}\n", d.summary));
                for side in &d.sides {
                    for c in &side.claims {
                        claims.push((format!("[{}] ", side.position), c));
                    }
                }
            }
            for (prefix, c) in claims {
                s.push_str(&format!("    • {prefix}{}{}{}\n", c.text, if c.inferred { " (inferred)" } else { "" }, if c.spoiler { " (spoiler)" } else { "" }));
                for cit in &c.citations {
                    let src = match cit.kind {
                        CitationKind::Page => format!("“{}”", cit.quote.clone().unwrap_or_default()),
                        CitationKind::Record => format!("record {:?}", cit.record.as_ref().map(|r| &r.value)),
                        CitationKind::Book => format!("(the book) “{}”", cit.quote.clone().unwrap_or_default()),
                    };
                    s.push_str(&format!("        – {} {} <{}> {}\n", cit.title, cit.year.clone().unwrap_or_default(), cit.url.clone().unwrap_or_default(), src));
                }
            }
        }
        s.push('\n');
    }
    if !b.entities.is_empty() {
        s.push_str("## connection map\n");
        for e in &b.entities {
            let f = e.facts.as_ref();
            let dates = match (f.and_then(|f| f.start.clone()), f.and_then(|f| f.end.clone())) {
                (Some(a), Some(z)) => format!(" {a}–{z}"),
                (Some(a), None) => format!(" {a}"),
                _ => String::new(),
            };
            let place = f.and_then(|f| f.coordinates).map(|c| format!(" @{:.2},{:.2}", c[0], c[1])).unwrap_or_default();
            let wd = e.wikidata.clone().map(|q| format!(" [{q}]")).unwrap_or_default();
            s.push_str(&format!("- {} ({:?}): {}{dates}{place}{wd}\n", e.id, e.kind, e.name));
        }
        for l in &b.links {
            let cite = l.claim.citations.first().map(|c| c.title.clone()).unwrap_or_default();
            s.push_str(&format!("  {} —{}→ {}: {} [{}]\n", l.from, l.relation, l.to, l.claim.text, cite));
        }
    }
    s
}

#[tokio::main]
async fn main() {
    let args = parse_args();
    let book = std::fs::canonicalize(&args.book).unwrap_or_else(|_| {
        eprintln!("No file at {}.", args.book.display());
        std::process::exit(1);
    });
    let data_dir = tempfile::Builder::new().prefix("pager-context-live-").tempdir().expect("a temporary folder").keep();
    let reads = data_dir.join("reads");
    std::fs::create_dir_all(&reads).unwrap();
    std::fs::copy(&book, reads.join(book.file_name().unwrap())).expect("copy the book");

    let mut o = AppOptions::new(data_dir.clone());
    o.reads_dir = Some(reads);
    o.mirror_delay_ms = 60_000;
    let no_api = args.dry_run || args.prompt_dir.is_some() || args.draft.is_some() || args.briefing.is_some();
    if args.prompt_dir.is_some() || args.draft.is_some() {
        // Catalogue lookups and page fetches only: no key, nothing sent to the model's API.
        o.briefing_transport = Some(Arc::new(LiveTransport::new().expect("HTTPS")));
    }
    if !no_api {
        let loaded = load_api_key(std::env::var(KEY_VAR).ok().as_deref(), &secrets_path());
        if let Some(w) = loaded.warning {
            eprintln!("{w}");
        }
        if loaded.key.is_none() {
            eprintln!("No API key: set {KEY_VAR}, or put it in {} (chmod 600).", secrets_path().display());
            std::process::exit(1);
        }
        o.anthropic_key = loaded.key;
        let live: Arc<dyn Transport> = Arc::new(LiveTransport::new().expect("HTTPS"));
        o.briefing_transport = Some(match &args.record {
            Some(dir) => {
                std::fs::create_dir_all(dir).expect("the --record folder");
                Arc::new(Recording { inner: live, dir: dir.clone(), n: AtomicU32::new(0) })
            }
            None => live,
        });
    }
    let app = App::new(o).expect("the app");
    let a = app.clone();
    tokio::task::spawn_blocking(move || a.ensure()).await.unwrap().expect("read the book");
    let ids: Vec<String> = app.run(|c| c.all("SELECT id FROM documents WHERE deleted_at IS NULL", &[], |r| r.get(0))).await.unwrap();
    let Some(doc_id) = ids.into_iter().next() else {
        eprintln!("Pager couldn't read {}.", book.display());
        std::process::exit(1);
    };

    if let (Some(file), Some(store)) = (&args.briefing, &args.store) {
        let raw: Value = serde_json::from_slice(&std::fs::read(file).expect("read the briefing")).expect("the briefing is JSON");
        // A sample is the briefing itself; a file --out wrote has it under "briefing".
        let mut b: Briefing = serde_json::from_value(raw.get("briefing").cloned().unwrap_or(raw)).unwrap_or_else(|e| {
            eprintln!("That isn't a briefing: {e}");
            std::process::exit(1);
        });
        let d = doc_id.clone();
        b.content_hash = app.run(move |c| c.briefing_content_hash(&d)).await.expect("the book's content hash");
        store_into(store, b, json!({ "note": "stored by context-live --briefing (dev)" })).await;
        return;
    }

    if args.dry_run {
        let d = doc_id.clone();
        let ex = app.run(move |c| c.briefing_extract(&d)).await.expect("extract");
        let seed = json!({ "note": "Looked up from Open Library and Wikidata when a run starts; a dry run makes no network calls." });
        let body = first_request(args.level, &ex.input, &seed, args.focus.as_deref());
        let user = body["messages"][0]["content"].as_str().unwrap_or("");
        println!("{}", serde_json::to_string_pretty(&body).unwrap());
        eprintln!(
            "\n{}: {} names, {} works, {} terms, {} bibliography lines, {} front-matter parts ({} chars); first user message {} chars.",
            ex.input.title,
            ex.input.names.len(),
            ex.input.works.len(),
            ex.input.terms.len(),
            ex.input.bibliography.len(),
            ex.input.front_matter.len(),
            ex.input.front_matter.iter().map(|f| f.text.chars().count()).sum::<usize>(),
            user.chars().count()
        );
        return;
    }

    if let Some(dir) = &args.prompt_dir {
        std::fs::create_dir_all(dir).expect("the --prompt-dir folder");
        let d = doc_id.clone();
        let ex = app.run(move |c| c.briefing_extract(&d)).await.expect("extract");
        let lookups = Lookups::new(app.briefing.transport.clone(), 20);
        let seed_records = seed(&lookups, &ex.input).await;
        std::fs::write(dir.join("system.md"), system_prompt()).unwrap();
        std::fs::write(dir.join("user.md"), user_message(args.level, &ex.input, &seed_records, args.focus.as_deref())).unwrap();
        std::fs::write(dir.join("schema.json"), serde_json::to_vec_pretty(&draft_schema()).unwrap()).unwrap();
        let tool_list: Vec<String> = tools().as_array().unwrap().iter().map(|t| format!("- {}: {}", t["name"].as_str().unwrap_or(""), t["description"].as_str().unwrap_or("(Anthropic's server tool)"))).collect();
        std::fs::write(dir.join("tools.md"), tool_list.join("\n")).unwrap();
        println!("Wrote system.md, user.md, schema.json and tools.md to {}.", dir.display());
        return;
    }

    // The same progress the reader's panel shows, on stderr.
    let progress = |p: Progress| match p {
        Progress::Stage(s) => eprintln!("… {}", s.as_str()),
        Progress::Step(RunStep::Search { query, ok }) => eprintln!("    searched “{query}”{}", if ok { "" } else { " (failed)" }),
        Progress::Step(RunStep::Read { url, ok, .. }) => eprintln!("    read {url}{}", if ok { "" } else { " (failed)" }),
        Progress::Step(RunStep::Lookup { source, query, ok }) => eprintln!("    looked up “{query}” in {source}{}", if ok { "" } else { " (failed)" }),
        Progress::Checking(c) => eprintln!("    checking {} sources behind {} claims", c.sources, c.claims),
    };
    let result = match &args.draft {
        Some(path) => {
            let draft: Draft = match serde_json::from_slice(&std::fs::read(path).expect("read the draft")) {
                Ok(d) => d,
                Err(e) => {
                    eprintln!("The draft doesn't match the schema: {e}");
                    std::process::exit(1);
                }
            };
            let d = doc_id.clone();
            let ex = app.run(move |c| c.briefing_extract(&d)).await.expect("extract");
            progress(Progress::Checking(draft_counts(&draft)));
            progress(Progress::Stage(Stage::Checking));
            let research = Research { draft, evidence: Evidence::default(), model: "draft (Claude Code agent)".into() };
            Ok(finish(&app, ex, args.level, args.focus.clone(), research, Usage::default(), 0, &Limits::default(), std::time::Instant::now()).await)
        }
        None => generate(&app, &doc_id, args.level, args.focus.as_deref(), &Limits::default(), &progress).await,
    };
    match result {
        Ok(g) => {
            let b = &g.briefing;
            println!("{}", render(b));
            println!(
                "Kept {} claims, {} works and {} links; dropped {} claims, {} works and {} links.",
                b.stats.claims_kept, b.stats.works_kept, b.stats.links_kept, b.stats.claims_dropped, b.stats.works_dropped, b.stats.links_dropped
            );
            if !g.report.dropped.is_empty() {
                println!("\nDropped:");
                for d in &g.report.dropped {
                    println!("  - {} — {}", d.what, d.reason);
                }
            }
            println!("\nModel: {}. Usage: {}. Lookups: {}. Time: {} s ({}).", b.model, g.usage.summary(), b.stats.lookups, b.stats.duration_ms / 1000, g.usage.timings.summary());
            let focus_part = args.focus.as_deref().map(|f| format!("-{}", slug(Path::new(f)))).unwrap_or_default();
            let out = args.out.clone().unwrap_or_else(|| PathBuf::from(format!("context-{}{focus_part}-{}.json", slug(&book), args.level.as_str())));
            std::fs::write(&out, serde_json::to_vec_pretty(&json!({ "briefing": b, "dropped": g.report.dropped, "usage": g.usage.to_json() })).unwrap()).expect("write the JSON");
            println!("Wrote {}.", out.display());
            if let Some(store) = &args.store {
                store_into(store, g.briefing.clone(), g.usage.to_json()).await;
            }
        }
        Err((f, usage)) => {
            eprintln!("Failed: {}\nUsage so far: {}. Time: {}.", f.message(), usage.summary(), usage.timings.summary());
            std::process::exit(1);
        }
    }
}
