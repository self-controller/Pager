mod common;

use common::*;
use pager_server::cli::{parse_args, run_cli, Answer, Deps};
use pager_server::clock::Clock;
use pager_server::db::migrations::MIGRATIONS;
use pager_server::db::{open_db, user_version};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;

#[test]
fn database_migrates_and_backs_up() {
    let dir = temp_dir("pager-db-");
    let file = dir.join("pager.db");
    let db = open_db(&file, Some(&dir.join("backups"))).unwrap();
    assert_eq!(user_version(&db).unwrap(), MIGRATIONS.len() as i64);
    drop(db);
    let again = open_db(&file, Some(&dir.join("backups"))).unwrap();
    assert_eq!(user_version(&again).unwrap(), MIGRATIONS.len() as i64);
    drop(again);
    // Refuses a database written by a newer version.
    let dir = temp_dir("pager-db-");
    let file = dir.join("pager.db");
    let raw = rusqlite::Connection::open(&file).unwrap();
    raw.execute_batch(&format!("PRAGMA user_version = {}", MIGRATIONS.len() + 5)).unwrap();
    drop(raw);
    assert!(open_db(&file, None).unwrap_err().message.contains("newer version"));
    // Backs up before upgrading an older database.
    let dir = temp_dir("pager-db-");
    let file = dir.join("pager.db");
    let raw = rusqlite::Connection::open(&file).unwrap();
    raw.execute_batch(MIGRATIONS[0]).unwrap();
    raw.execute_batch("PRAGMA user_version = 1").unwrap();
    drop(raw);
    open_db(&file, Some(&dir.join("backups"))).unwrap();
    assert_eq!(std::fs::read_dir(dir.join("backups")).unwrap().count(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn local_only_access() {
    let t = make_app();
    let res = t.call(Call::get("/api/health").header("Host", "evil.example")).await;
    assert_eq!(res.status, 403);
    assert_eq!(res.body["error"]["code"], "forbidden");
    assert_eq!(t.call(Call::get("/api/health").header("Host", "localhost:3006")).await.status, 200);
    assert_eq!(t.call(Call::get("/api/health").header("Host", "127.0.0.1:3006")).await.status, 200);
    let post = |headers: Vec<(&'static str, &'static str)>| {
        let t = &t;
        async move {
            let mut c = Call::new("POST", "/api/sources").json(json!({ "path": "/nope" }));
            for (k, v) in headers {
                c = c.header(k, v);
            }
            t.call(c).await.status
        }
    };
    assert_eq!(post(vec![("Origin", "https://evil.example")]).await, 403);
    assert_eq!(post(vec![("Origin", "null")]).await, 403);
    assert_eq!(post(vec![("Sec-Fetch-Site", "cross-site")]).await, 403);
    assert_eq!(post(vec![("Origin", "http://localhost:5176"), ("Sec-Fetch-Site", "same-origin")]).await, 404);
    assert_eq!(post(vec![]).await, 404);
    let res = t.call(Call::get("/api/health").header("Origin", "https://evil.example")).await;
    assert!(res.headers.get("access-control-allow-origin").is_none());
    // Serves only asset names it made, with protective headers.
    let file = t.app.lock().assets.put(&png_1px()).unwrap();
    let res = t.get(&format!("/api/assets/{file}")).await;
    assert_eq!(res.status, 200);
    assert_eq!(res.headers.get("content-type").unwrap(), "image/png");
    assert_eq!(res.headers.get("x-content-type-options").unwrap(), "nosniff");
    assert!(res.headers.get("content-security-policy").unwrap().to_str().unwrap().contains("sandbox"));
    assert_eq!(t.get("/api/assets/..%2F..%2Fpager.db").await.status, 404);
    assert_eq!(t.get("/api/assets/pager.db").await.status, 404);
    assert!(t.app.lock().assets.put(b"not an image").is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn the_ui_contract_basics() {
    let t = make_app_with(Clock::fake("2026-10-24T12:00:00Z"), None, None);
    let md = "---\ntitle: Notes on Things\nauthor: A. Writer\n---\n\n# Notes on Things\n\nThe first paragraph of my notes.\n\n## Part two\n\nMore text here.\n";
    t.write("Essays/notes.md", md);
    std::fs::create_dir(t.reads_dir.join("Empty")).unwrap();
    let tree = t.get("/api/tree").await.body;
    assert_eq!(tree["truncated"], false);
    let folders: Vec<&str> = tree["root"]["folders"].as_array().unwrap().iter().map(|f| f["name"].as_str().unwrap()).collect();
    assert_eq!(folders, vec!["Empty", "Essays"]);
    let file = &tree["root"]["folders"][1]["files"][0];
    assert_eq!(file["path"], "Essays/notes.md");
    let doc_id = file["docId"].as_str().unwrap().to_string();
    assert_eq!(file["doc"]["title"], "Notes on Things");
    let docs = t.get("/api/documents").await.body;
    assert_eq!(docs.as_array().unwrap().len(), 1);
    let d = &docs[0];
    assert_eq!(d["kind"], "article");
    assert_eq!(d["format"], "md");
    assert_eq!(d["author"], "A. Writer");
    assert_eq!(d["sourceName"], "Reads");
    assert_eq!(d["sectionCount"], 1);
    assert_eq!(d["saved"], false);
    assert_eq!(d["excerpt"], "The first paragraph of my notes. More text here.");
    assert!(d["wordCount"].as_i64().unwrap() > 5);
    let detail = t.get(&format!("/api/documents/{doc_id}")).await.body;
    assert_eq!(detail["toc"].as_array().unwrap().len(), 1);
    assert_eq!(detail["toc"][0]["index"], 0);
    assert_eq!(detail["toc"][0]["depth"], 0);
    assert_eq!(detail["toc"][0]["title"], "Notes on Things");
    assert_eq!(detail["live"], true);
    assert_eq!(detail["pathStatus"], "ok");
    assert_eq!(detail["outline"].as_array().unwrap().len(), 2);
    let section = t.get(&format!("/api/documents/{doc_id}/sections/{}", detail["toc"][0]["id"].as_str().unwrap())).await.body;
    assert_eq!(section["index"], 0);
    assert_eq!(section["title"], "Notes on Things");
    assert!(section["html"].as_str().unwrap().contains("data-b="));
    assert!(section["html"].as_str().unwrap().contains("<h2"));
    assert!(section.get("prevId").is_none());
    assert!(section.get("nextId").is_none());
    assert_eq!(t.get("/api/tree").await.body["root"]["folders"][1]["files"][0]["docId"], doc_id);

    // Progress (clamped), lastOpenedAt, history and sorting.
    let t = make_app_with(Clock::fake("2026-10-24T12:00:00Z"), None, None);
    t.write("a.md", "# A\n\ntext a");
    t.get("/api/tree").await;
    let a = t.get("/api/documents").await.body[0]["id"].as_str().unwrap().to_string();
    t.clock.advance(60_000);
    t.write("b.md", "# B\n\ntext b");
    t.get("/api/tree").await;
    let b = t.get("/api/documents").await.body.as_array().unwrap().iter().find(|d| d["id"] != a).unwrap()["id"].as_str().unwrap().to_string();
    assert_eq!(t.get("/api/documents?history=true").await.body.as_array().unwrap().len(), 0);
    let ids = |v: &Value| v.as_array().unwrap().iter().map(|d| d["id"].as_str().unwrap().to_string()).collect::<Vec<_>>();
    assert_eq!(ids(&t.get("/api/documents?sort=recent").await.body), vec![b.clone(), a.clone()]);
    t.clock.advance(60_000);
    let detail = t.get(&format!("/api/documents/{a}")).await.body;
    let p = t.json("PUT", &format!("/api/documents/{a}/progress"), Some(json!({ "sectionId": detail["toc"][0]["id"], "offset": 1.7, "percent": -2 }))).await.body;
    assert_eq!(p["offset"], 1.0);
    assert_eq!(p["updatedAt"], "2026-10-24T12:02:00.000Z");
    assert!(p["percent"].as_f64().unwrap() >= 0.0 && p["percent"].as_f64().unwrap() <= 1.0);
    let history = t.get("/api/documents?history=true").await.body;
    assert_eq!(ids(&history), vec![a.clone()]);
    assert_eq!(history[0]["lastOpenedAt"], "2026-10-24T12:02:00.000Z");
    assert_eq!(history[0]["progress"]["offset"], 1.0);
    assert_eq!(ids(&t.get("/api/documents?sort=recent").await.body), vec![a.clone(), b.clone()]);
    assert_eq!(ids(&t.get("/api/documents?sort=added").await.body), vec![b.clone(), a.clone()]);
    let by_title = t.get("/api/documents?sort=title").await.body;
    let titles: Vec<&str> = by_title.as_array().unwrap().iter().map(|d| d["title"].as_str().unwrap()).collect();
    assert_eq!(titles, vec!["A", "B"]);
    assert_eq!(t.get("/api/tree").await.body["root"]["files"].as_array().unwrap().iter().find(|f| f["docId"] == a).unwrap()["doc"]["progress"]["offset"], 1.0);

    // Filters.
    let t = make_app();
    t.write("one.md", "# Persuasion\n\nby Austen");
    t.write("two.txt", "Emma\n\nA plain story.");
    t.get("/api/tree").await;
    let docs = t.get("/api/documents?sort=title").await.body;
    let id1 = docs.as_array().unwrap().iter().find(|d| d["title"] == "Persuasion").unwrap()["id"].as_str().unwrap().to_string();
    let id2 = docs.as_array().unwrap().iter().find(|d| d["id"] != id1).unwrap()["id"].as_str().unwrap().to_string();
    assert_eq!(t.json("PATCH", &format!("/api/documents/{id1}"), Some(json!({ "saved": true }))).await.body["saved"], true);
    assert_eq!(ids(&t.get("/api/documents?saved=true").await.body), vec![id1.clone()]);
    assert_eq!(ids(&t.get("/api/documents?saved=false").await.body), vec![id2.clone()]);
    assert_eq!(ids(&t.get("/api/documents?q=persua").await.body), vec![id1.clone()]);
    assert_eq!(ids(&t.get("/api/documents?q=two.txt").await.body), vec![id2.clone()]);
    assert_eq!(t.get("/api/documents?kind=book").await.body, json!([]));
    assert_eq!(t.get("/api/documents?kind=article").await.body.as_array().unwrap().len(), 2);
    assert_eq!(t.get("/api/documents?q=100%25_").await.body, json!([]));

    // Errors the way the UI expects.
    let t = make_app();
    let missing = t.json("POST", "/api/files/import", Some(json!({ "dir": "", "path": "/definitely/not/here.md" }))).await;
    assert_eq!(missing.status, 404);
    assert_eq!(missing.body["error"]["code"], "not_found");
    let pdf = t.json("POST", "/api/files/import", Some(json!({ "dir": "", "path": write_temp("paper.pdf", b"%PDF-1.4 nothing").to_string_lossy() }))).await;
    assert_eq!(pdf.body["error"]["code"], "unsupported");
    assert!(pdf.body["error"]["message"].as_str().unwrap().contains("PDF"));
    assert_eq!(t.get("/api/documents/nope").await.body["error"]["code"], "not_found");
    assert_eq!(t.get("/api/documents/nope/sections/x").await.body["error"]["code"], "not_found");
    assert_eq!(t.get("/api/jobs/nope").await.body["error"]["code"], "not_found");
    assert_eq!(t.json("POST", "/api/files", Some(json!({ "dir": "../up", "title": "x" }))).await.body["error"]["code"], "invalid_request");
    assert_eq!(t.json("POST", "/api/files/move", Some(json!({ "from": "Nope.md", "to": "Yep.md" }))).await.body["error"]["code"], "not_found");
    assert_eq!(t.json("DELETE", "/api/files?path=", None).await.body["error"]["code"], "invalid_request");
    assert_eq!(t.get("/api/nothing").await.body["error"]["code"], "not_found");
    assert_eq!(t.json("POST", "/api/files", Some(json!([1]))).await.body["error"]["message"], "The request body should be a JSON object.");

    // Creates a file, renames it, deletes it into the trash, and takes it back.
    let t = make_app();
    let made = t.json("POST", "/api/files", Some(json!({ "dir": "", "title": "Keep", "author": "Me" }))).await.body;
    assert_eq!(made["path"], "Keep.md");
    let id = made["document"]["id"].as_str().unwrap().to_string();
    assert!(std::fs::read_to_string(t.reads_dir.join("Keep.md")).unwrap().contains("title: Keep"));
    let moved = t.json("POST", "/api/files/move", Some(json!({ "from": "Keep.md", "to": "Kept.md" }))).await.body;
    assert_eq!(moved["document"]["id"], id);
    assert_eq!(moved["document"]["relPath"], "Kept.md");
    assert_eq!(moved["document"]["title"], "Keep");
    t.json("DELETE", "/api/files?path=Kept.md", None).await;
    assert_eq!(t.get("/api/documents").await.body, json!([]));
    assert_eq!(t.get(&format!("/api/documents/{id}")).await.status, 404);
    let stamp = std::fs::read_dir(t.reads_dir.join(".trash")).unwrap().next().unwrap().unwrap().file_name();
    std::fs::rename(t.reads_dir.join(".trash").join(&stamp).join("Kept.md"), t.reads_dir.join("Kept.md")).unwrap();
    let back = &t.get("/api/tree").await.body["root"]["files"][0];
    assert_eq!(back["name"], "Kept.md");
    assert_eq!(back["docId"], id);
    assert_eq!(ids(&t.get("/api/documents").await.body), vec![id]);
}

#[tokio::test(flavor = "multi_thread")]
async fn serves_the_web_app_with_a_spa_fallback() {
    let web = temp_dir("pager-web-");
    std::fs::create_dir(web.join("assets")).unwrap();
    std::fs::write(web.join("index.html"), "<!doctype html><title>Pager</title>").unwrap();
    std::fs::write(web.join("assets/app.js"), "console.log(1)").unwrap();
    let t = make_app_with(Clock::fake("2026-10-24T12:00:00Z"), Some(web), None);
    let r = t.get("/read/abc").await;
    assert_eq!(r.status, 200);
    assert!(r.text.contains("<title>Pager</title>"));
    let js = t.get("/assets/app.js").await;
    assert_eq!(js.status, 200);
    assert_eq!(js.headers.get("cache-control").unwrap(), "public, max-age=31536000, immutable");
    assert_eq!(t.get("/assets/missing.js").await.status, 404);
    assert_eq!(t.get("/..%2F..%2Fetc%2Fpasswd").await.status, 200); // the shell, never a file outside
    assert_eq!(t.get("/api/nope").await.status, 404);
}

// ---- The pager command ----

struct FakeDeps {
    up: &'static str,
    starts_ok: bool,
    add_ok: bool,
    vite: bool,
    calls: Vec<String>,
    out: Vec<String>,
    errs: Vec<String>,
}

impl FakeDeps {
    fn new(up: &'static str) -> FakeDeps {
        FakeDeps { up, starts_ok: true, add_ok: true, vite: false, calls: vec![], out: vec![], errs: vec![] }
    }
}

impl Deps for FakeDeps {
    fn fetch(&mut self, method: &str, port: u16, path: &str, body: Option<&Value>, _timeout: Duration) -> Option<Answer> {
        if port == 5176 {
            return if self.vite { Some(Answer { status: 200, body: Value::Null, text: "<html>".into() }) } else { None };
        }
        if path == "/api/health" {
            return match self.up {
                "down" => None,
                "other" => Some(Answer { status: 200, body: Value::Null, text: "<h1>hi</h1>".into() }),
                _ => Some(Answer { status: 200, body: json!({ "app": "pager", "apiVersion": 1, "version": "0.1.0", "pid": 1, "port": 3006, "dataDir": "/tmp/pager-cli-test", "startedAt": "" }), text: String::new() }),
            };
        }
        if path == "/api/files/import" {
            self.calls.push(format!("add {}", body.unwrap()["path"].as_str().unwrap()));
            if !self.add_ok {
                return Some(Answer { status: 422, body: json!({ "error": { "code": "unsupported", "message": "PDFs can't be opened yet." } }), text: String::new() });
            }
            return Some(Answer { status: 201, body: json!({ "id": "j", "status": "done", "documentIds": ["doc1"] }), text: String::new() });
        }
        if path == "/api/shutdown" {
            self.calls.push("shutdown".into());
            return Some(Answer { status: 204, body: Value::Null, text: String::new() });
        }
        panic!("unexpected {method} {path}");
    }
    fn spawn_server(&mut self, port: u16, _data_dir: &Path) {
        self.calls.push(format!("spawn {port}"));
        if self.starts_ok {
            self.up = "pager";
        }
    }
    fn open_url(&mut self, url: &str) {
        self.calls.push(format!("open {url}"));
    }
    fn log(&mut self, s: &str) {
        self.out.push(s.to_string());
    }
    fn error(&mut self, s: &str) {
        self.errs.push(s.to_string());
    }
    fn sleep(&mut self, _ms: u64) {}
    fn cwd(&self) -> PathBuf {
        PathBuf::from("/home/someone/books")
    }
    fn data_dir(&self) -> PathBuf {
        PathBuf::from("/tmp/pager-cli-test")
    }
    fn port(&self) -> u16 {
        3006
    }
}

fn args(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
fn the_pager_command() {
    let a = parse_args(&args(&["book.epub", "--no-open", "--port", "4000"]));
    assert_eq!(a.file.as_deref(), Some("book.epub"));
    assert!(!a.open);
    assert_eq!(a.port, Some(4000));
    let a = parse_args(&args(&["--status"]));
    assert!(a.status && a.open);

    let mut d = FakeDeps::new("down");
    assert_eq!(run_cli(&args(&["persuasion.epub"]), &mut d), 0);
    assert_eq!(d.calls, vec!["spawn 3006", "add /home/someone/books/persuasion.epub", "open http://localhost:3006/read/doc1"]);

    let mut d = FakeDeps::new("pager");
    d.vite = true;
    assert_eq!(run_cli(&args(&["~/Books/emma.epub", "--no-open"]), &mut d), 0);
    assert_eq!(d.calls, vec!["add ~/Books/emma.epub"]);
    assert!(d.out.contains(&"http://localhost:5176/read/doc1".to_string()));

    let mut other = FakeDeps::new("other");
    assert_eq!(run_cli(&args(&["a.md"]), &mut other), 1);
    assert!(other.errs[0].contains("Something else is using port 3006"));
    let mut bad = FakeDeps::new("pager");
    bad.add_ok = false;
    assert_eq!(run_cli(&args(&["paper.pdf"]), &mut bad), 1);
    assert_eq!(bad.errs, vec!["PDFs can't be opened yet."]);
    let mut dead = FakeDeps::new("down");
    dead.starts_ok = false;
    assert_eq!(run_cli(&args(&["a.md"]), &mut dead), 1);
    assert!(dead.errs[0].contains("didn't start"));

    let mut d = FakeDeps::new("pager");
    run_cli(&args(&[]), &mut d);
    assert_eq!(d.calls, vec!["open http://localhost:3006/"]);
    let mut s = FakeDeps::new("down");
    run_cli(&args(&["--status"]), &mut s);
    assert_eq!(s.out, vec!["Pager isn't running."]);
    let mut stop = FakeDeps::new("pager");
    run_cli(&args(&["--stop"]), &mut stop);
    assert_eq!(stop.calls, vec!["shutdown"]);
}
