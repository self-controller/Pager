//! A Context briefing for one book, by hand: the real pipeline, the real API, the user's key.
//!
//!   cargo run --release --example context-live -- <book.epub> [--level general|student|scholar]
//!       [--out FILE] [--record DIR] [--dry-run]
//!
//! It reads the book into a temporary library, runs the pipeline, prints the counts and the
//! estimated cost, what was kept and dropped and why, and a plain-text rendering, and writes the
//! briefing as JSON (to --out, else ./context-<book>-<level>.json).
//!
//! --dry-run prints the first request exactly as it would be sent, without the seed lookups. It
//! needs no key, makes no network calls and costs nothing.
//! --record DIR saves every outbound request (never its headers, so never the key) and its answer,
//! to refresh the test fixtures.

use futures::future::BoxFuture;
use pager_server::app::{App, AppOptions};
use pager_server::briefing::run::{first_request, generate, Limits, Stage};
use pager_server::briefing::schema::{Briefing, CitationKind, Level};
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
}

fn usage() -> ! {
    eprintln!("usage: context-live <book.epub> [--level general|student|scholar] [--out FILE] [--record DIR] [--dry-run]");
    std::process::exit(2);
}

fn parse_args() -> Args {
    let mut it = std::env::args().skip(1);
    let mut a = Args { book: PathBuf::new(), level: Level::General, out: None, record: None, dry_run: false };
    while let Some(x) = it.next() {
        match x.as_str() {
            "--level" => a.level = it.next().and_then(|l| Level::parse(&l)).unwrap_or_else(|| usage()),
            "--out" => a.out = Some(it.next().map(PathBuf::from).unwrap_or_else(|| usage())),
            "--record" => a.record = Some(it.next().map(PathBuf::from).unwrap_or_else(|| usage())),
            "--dry-run" => a.dry_run = true,
            "-h" | "--help" => usage(),
            _ if a.book.as_os_str().is_empty() => a.book = PathBuf::from(x),
            _ => usage(),
        }
    }
    if a.book.as_os_str().is_empty() {
        usage();
    }
    a
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
            if let Some(t) = it.tier {
                head.push_str(&format!(" [{t:?}]"));
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
                    };
                    s.push_str(&format!("        – {} {} <{}> {}\n", cit.title, cit.year.clone().unwrap_or_default(), cit.url.clone().unwrap_or_default(), src));
                }
            }
        }
        s.push('\n');
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
    if !args.dry_run {
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

    if args.dry_run {
        let d = doc_id.clone();
        let ex = app.run(move |c| c.briefing_extract(&d)).await.expect("extract");
        let seed = json!({ "note": "Looked up from Open Library and Wikidata when a run starts; a dry run makes no network calls." });
        let body = first_request(args.level, &ex.input, &seed);
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

    let progress = |s: Stage| eprintln!("… {}", s.as_str());
    match generate(&app, &doc_id, args.level, &Limits::default(), &progress).await {
        Ok(g) => {
            let b = &g.briefing;
            println!("{}", render(b));
            println!("Kept {} claims and {} works; dropped {} claims and {} works.", b.stats.claims_kept, b.stats.works_kept, b.stats.claims_dropped, b.stats.works_dropped);
            if !g.report.dropped.is_empty() {
                println!("\nDropped:");
                for d in &g.report.dropped {
                    println!("  - {} — {}", d.what, d.reason);
                }
            }
            println!("\nModel: {}. Usage: {}. Lookups: {}. Time: {} s.", b.model, g.usage.summary(), b.stats.lookups, b.stats.duration_ms / 1000);
            let out = args.out.clone().unwrap_or_else(|| PathBuf::from(format!("context-{}-{}.json", slug(&book), args.level.as_str())));
            std::fs::write(&out, serde_json::to_vec_pretty(&json!({ "briefing": b, "dropped": g.report.dropped, "usage": g.usage.to_json() })).unwrap()).expect("write the JSON");
            println!("Wrote {}.", out.display());
        }
        Err((f, usage)) => {
            eprintln!("Failed: {}\nUsage so far: {}", f.message(), usage.summary());
            std::process::exit(1);
        }
    }
}
