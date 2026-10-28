mod common;

use common::*;
use pager_server::library::watcher::{Watcher, WatcherOptions};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;

const P1: &str = "The heron stood in the shallows, perfectly still, waiting for the light to change.";
const P2: &str = "Nobody else on the path noticed it, and that seemed right somehow.";
const P3: &str = "When it finally moved, it moved all at once, like a decision made long before.";

fn md(ps: &[&str]) -> String {
    format!("# Field Notes\n\n{}\n", ps.join("\n\n"))
}

fn atomic_write(file: &Path, content: &str) {
    let tmp = file.with_file_name(format!("{}.tmp~", file.file_name().unwrap().to_string_lossy()));
    std::fs::write(&tmp, content).unwrap();
    std::fs::rename(&tmp, file).unwrap();
}

/// Make the next read see a change even within the same mtime tick.
fn touch_later(file: &Path, content: &str, atomic: bool) {
    if atomic {
        atomic_write(file, content);
    } else {
        std::fs::write(file, content).unwrap();
    }
    let later = std::time::SystemTime::now() + Duration::from_secs(5);
    std::fs::OpenOptions::new().write(true).open(file).unwrap().set_modified(later).unwrap();
}

struct S {
    t: TestApp,
    file: PathBuf,
    doc_id: String,
    section: Value,
}

impl S {
    async fn detail(&self) -> Value {
        self.t.get(&format!("/api/documents/{}", self.doc_id)).await.body
    }

    async fn highlight(&self, block_text: &str, quote: &str) -> Value {
        let b = self.section["blocks"].as_array().unwrap().iter().find(|x| x["text"] == block_text).unwrap();
        let o = b["text"].as_str().unwrap().find(quote).unwrap();
        let r = self.t.json("POST", &format!("/api/documents/{}/annotations", self.doc_id), Some(json!({ "revisionId": self.section["revisionId"], "range": { "start": { "blockId": b["id"], "offset": o }, "end": { "blockId": b["id"], "offset": o + quote.len() } } }))).await;
        assert_eq!(r.status, 201, "{}", r.text);
        r.body
    }

    async fn annotations(&self) -> Vec<Value> {
        self.t.get(&format!("/api/documents/{}/annotations", self.doc_id)).await.body.as_array().unwrap().clone()
    }
}

async fn setup(content: &str) -> S {
    let t = make_app();
    let dir = temp_dir("pager-live-");
    let file = dir.join("notes.md");
    std::fs::write(&file, content).unwrap();
    let doc_id = t.add_file(&file).await;
    let d = t.get(&format!("/api/documents/{doc_id}")).await.body;
    let section = t.get(&format!("/api/documents/{doc_id}/sections/{}?include=blocks", d["toc"][0]["id"].as_str().unwrap())).await.body;
    S { t, file, doc_id, section }
}

fn status_of(list: &[Value], id: &Value) -> String {
    list.iter().find(|a| a["id"] == *id).unwrap()["anchor"]["status"].as_str().unwrap().to_string()
}

#[tokio::test(flavor = "multi_thread")]
async fn edits_reanchor_what_the_reader_attached() {
    let s = setup(&md(&[P1, P2, P3])).await;
    let still = s.highlight(P1, "perfectly still, waiting for the light").await;
    let nobody = s.highlight(P2, "noticed it").await;
    let decision = s.highlight(P3, "it moved all at once, like a decision").await;

    // 1. A paragraph inserted above: the same words, somewhere else.
    touch_later(&s.file, &md(&["A new opening paragraph, written later.", P1, P2, P3]), false);
    let d1 = s.detail().await;
    assert_ne!(d1["revisionId"], s.section["revisionId"]);
    let list = s.annotations().await;
    let statuses: Vec<(Value, String)> = list.iter().map(|a| (a["id"].clone(), a["anchor"]["status"].as_str().unwrap().to_string())).collect();
    assert_eq!(statuses, vec![(still["id"].clone(), "anchored".into()), (nobody["id"].clone(), "anchored".into()), (decision["id"].clone(), "anchored".into())]);

    // 2. A word changed inside one highlight; another paragraph edited around its highlight.
    let p1b = P1.replace("waiting for the light", "waiting for the evening light");
    let p2b = "Strangely, nobody else on the path noticed it, and that seemed right somehow.";
    touch_later(&s.file, &md(&["A new opening paragraph, written later.", &p1b, p2b, P3]), false);
    s.detail().await;
    let list = s.annotations().await;
    let by = |id: &Value| list.iter().find(|a| a["id"] == *id).unwrap().clone();
    let st = by(&still["id"]);
    assert_eq!(st["anchor"]["status"], "fuzzy");
    assert_eq!(st["anchor"]["quote"], "perfectly still, waiting for the evening light");
    assert_eq!(st["anchor"]["originalQuote"], "perfectly still, waiting for the light");
    assert!(st["anchor"]["confidence"].as_f64().unwrap() > 0.65);
    let nb = by(&nobody["id"]);
    assert_eq!(nb["anchor"]["status"], "moved");
    assert_eq!(nb["anchor"]["quote"], "noticed it");
    assert_eq!(by(&decision["id"])["anchor"]["status"], "anchored");

    // 3. The highlighted paragraph deleted: orphaned, never deleted, listed last.
    touch_later(&s.file, &md(&["A new opening paragraph, written later.", &p1b, p2b]), false);
    s.detail().await;
    let list = s.annotations().await;
    let last = list.last().unwrap();
    assert_eq!(last["id"], decision["id"]);
    assert_eq!(last["anchor"]["status"], "orphaned");
    assert_eq!(last["anchor"]["range"], Value::Null);
    assert_eq!(last["anchor"]["segments"], json!([]));
    assert_eq!(last["anchor"]["originalQuote"], "it moved all at once, like a decision");

    // 4. Undone: it comes back by itself.
    touch_later(&s.file, &md(&["A new opening paragraph, written later.", &p1b, p2b, P3]), false);
    s.detail().await;
    let list = s.annotations().await;
    assert_ne!(status_of(&list, &decision["id"]), "orphaned");

    // The journal tells the story.
    let events = s.t.get(&format!("/api/events?docId={}&type=annotations.reanchored", s.doc_id)).await.body;
    assert!(events.as_array().unwrap().len() >= 3);
    let revs = s.t.get(&format!("/api/events?docId={}&type=revision.created", s.doc_id)).await.body;
    assert_eq!(revs[0]["payload"]["reason"], "source-changed");
}

#[tokio::test(flavor = "multi_thread")]
async fn reattach_an_orphan() {
    let s = setup(&md(&[P1, P2, P3])).await;
    let a = s.highlight(P3, "like a decision").await;
    touch_later(&s.file, &md(&[P1, P2]), false);
    s.detail().await;
    assert_eq!(s.annotations().await[0]["anchor"]["status"], "orphaned");
    let d = s.detail().await;
    let sec = s.t.get(&format!("/api/documents/{}/sections/{}?include=blocks", s.doc_id, d["toc"][0]["id"].as_str().unwrap())).await.body;
    let b = sec["blocks"].as_array().unwrap().iter().find(|x| x["text"] == P2).unwrap();
    let re = s.t.json("PATCH", &format!("/api/annotations/{}", a["id"].as_str().unwrap()), Some(json!({ "reattach": { "revisionId": sec["revisionId"], "range": { "start": { "blockId": b["id"], "offset": 0 }, "end": { "blockId": b["id"], "offset": 6 } } } }))).await;
    assert_eq!(re.body["anchor"]["status"], "anchored");
    assert_eq!(re.body["anchor"]["quote"], "Nobody");
    assert_eq!(re.body["anchor"]["originalQuote"], "like a decision");
}

#[tokio::test(flavor = "multi_thread")]
async fn translates_coordinates_from_an_older_page() {
    let s = setup(&md(&[P1, P2, P3])).await;
    let old_revision = s.section["revisionId"].clone();
    let b = s.section["blocks"].as_array().unwrap().iter().find(|x| x["text"] == P2).unwrap().clone();
    touch_later(&s.file, &md(&["Inserted first.", P1, P2, P3]), false);
    s.detail().await;
    let res = s.t.json("POST", &format!("/api/documents/{}/annotations", s.doc_id), Some(json!({ "revisionId": old_revision, "range": { "start": { "blockId": b["id"], "offset": 0 }, "end": { "blockId": b["id"], "offset": 6 } } }))).await;
    assert_eq!(res.status, 201, "{}", res.text);
    assert_eq!(res.body["anchor"]["status"], "anchored");
    assert_eq!(res.body["anchor"]["quote"], "Nobody");
    assert_ne!(res.body["anchor"]["revisionId"], old_revision);
}

#[tokio::test(flavor = "multi_thread")]
async fn resolves_an_old_section_id() {
    let s = setup(&md(&[P1, P2, P3])).await;
    let old_section = s.section["id"].as_str().unwrap().to_string();
    touch_later(&s.file, &format!("# Renamed Notes\n\n{P1}\n\n{P2}\n"), false);
    let d = s.detail().await;
    let res = s.t.get(&format!("/api/documents/{}/sections/{old_section}", s.doc_id)).await;
    assert_eq!(res.status, 200);
    assert_eq!(res.body["id"], d["toc"][0]["id"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn document_identity() {
    let s = setup(&md(&[P1, P2, P3])).await;
    let rev = s.section["revisionId"].clone();
    let again = s.t.json("POST", "/api/sources", Some(json!({ "path": s.file.to_string_lossy() }))).await;
    assert_eq!(again.body["job"]["documentIds"], json!([s.doc_id]));
    assert_eq!(s.detail().await["revisionId"], rev);
    touch_later(&s.file, &md(&[P1, P2]), false);
    assert_ne!(s.detail().await["revisionId"], rev);

    // A moved file (old path gone) is the same document, annotations included.
    let s = setup(&md(&[P1, P2, P3])).await;
    let a = s.highlight(P2, "noticed it").await;
    let moved = temp_dir("pager-moved-").join("renamed.md");
    std::fs::rename(&s.file, &moved).unwrap();
    let res = s.t.json("POST", "/api/sources", Some(json!({ "path": moved.to_string_lossy() }))).await;
    assert_eq!(res.body["job"]["documentIds"], json!([s.doc_id]));
    let d = s.detail().await;
    assert_eq!(d["path"], std::fs::canonicalize(&moved).unwrap().to_string_lossy().as_ref());
    assert_eq!(s.annotations().await.iter().map(|x| x["id"].clone()).collect::<Vec<_>>(), vec![a["id"].clone()]);

    // A copy of a live file is a new document; a second copy of a book is the same book.
    let copy = temp_dir("pager-copy-").join("notes.md");
    std::fs::copy(&moved, &copy).unwrap();
    let res = s.t.json("POST", "/api/sources", Some(json!({ "path": copy.to_string_lossy() }))).await;
    assert_ne!(res.body["job"]["documentIds"][0], s.doc_id);
    let epub = make_epub(EpubSpec { title: "A Book".into(), files: vec![file("a.xhtml", "<h1>One</h1><p>Text of the book.</p>")], ..Default::default() });
    let e1 = write_temp("book.epub", &epub);
    let e2 = write_temp("book-copy.epub", &epub);
    let r1 = s.t.json("POST", "/api/sources", Some(json!({ "path": e1.to_string_lossy() }))).await;
    let r2 = s.t.json("POST", "/api/sources", Some(json!({ "path": e2.to_string_lossy() }))).await;
    assert_eq!(r2.body["job"]["documentIds"], r1.body["job"]["documentIds"]);
    let (ct, body) = multipart("file", "dropped.epub", &epub);
    let mut c = Call::new("POST", "/api/uploads");
    c.raw = Some((ct, body));
    assert_eq!(s.t.call(c).await.body["documentIds"], r1.body["job"]["documentIds"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn parser_upgrade_and_cache_rebuild() {
    let s = setup(&md(&[P1, P2, P3])).await;
    let a = s.highlight(P2, "noticed it").await;
    let before = s.detail().await["revisionId"].as_str().unwrap().to_string();
    s.t.db_exec(&format!("UPDATE revisions SET parser_version = 0 WHERE id = '{before}'"));
    let after = s.detail().await["revisionId"].as_str().unwrap().to_string();
    assert_ne!(after, before);
    let reason: String = s.t.app.lock().one("SELECT reason FROM revisions WHERE id = ?1", &[&after], |r| r.get(0)).unwrap().unwrap();
    assert_eq!(reason, "parser-upgraded");
    let list = s.annotations().await;
    assert_eq!(list[0]["id"], a["id"]);
    assert_eq!(list[0]["anchor"]["status"], "anchored");

    // Rebuilds a deleted cache in place, and serves a book whose file went missing from its cache.
    let rev = s.detail().await["revisionId"].as_str().unwrap().to_string();
    std::fs::remove_file(s.t.data_dir.join("cache").join(format!("{rev}.json"))).unwrap();
    s.t.app.lock().cache.drop_revision(&rev);
    assert_eq!(s.detail().await["revisionId"], rev);
    let epub = make_epub(EpubSpec { title: "Gone Book".into(), files: vec![file("a.xhtml", "<p>Still readable.</p>")], ..Default::default() });
    let e = write_temp("gone.epub", &epub);
    let id = s.t.add_file(&e).await;
    std::fs::remove_file(&e).unwrap();
    let d = s.t.get(&format!("/api/documents/{id}")).await.body;
    assert_eq!(d["pathStatus"], "missing");
    assert_eq!(s.t.get(&format!("/api/documents/{id}/sections/{}", d["toc"][0]["id"].as_str().unwrap())).await.status, 200);
    assert_eq!(s.t.get(&format!("/api/events?docId={id}&type=source.missing")).await.body.as_array().unwrap().len(), 1);

    // Reload re-reads on request.
    let rev = s.detail().await["revisionId"].clone();
    std::fs::write(&s.file, md(&[P1])).unwrap();
    let res = s.t.json("POST", &format!("/api/documents/{}/reload", s.doc_id), None).await;
    assert_ne!(res.body["revisionId"], rev);
    assert_eq!(s.t.get(&format!("/api/documents/{}/locate?blockId=nope", s.doc_id)).await.status, 404);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_watcher_picks_up_saves() {
    let s = setup(&md(&[P1, P2, P3])).await;
    let a = s.highlight(P2, "noticed it").await;
    let mut watcher = Watcher::start(s.t.app.clone(), WatcherOptions { debounce_ms: 50, grace_ms: 300, ..Default::default() });
    assert_eq!(watcher.watched_dirs(), vec![std::fs::canonicalize(&s.file).unwrap().parent().unwrap().to_path_buf()]);
    let revisions = |t: &TestApp| t.events("revision.created").len();
    let base = revisions(&s.t);
    async fn wait_for(t: &TestApp, want: usize) -> bool {
        for _ in 0..160 {
            if t.events("revision.created").len() >= want {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        false
    }
    touch_later(&s.file, &md(&["Atomically saved opening.", P1, P2, P3]), true);
    assert!(wait_for(&s.t, base + 1).await);
    let mut seen = false;
    for _ in 0..100 {
        if !s.t.events("annotations.reanchored").is_empty() {
            seen = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert!(seen);
    let ev = &s.t.events("revision.created")[base];
    assert_eq!(ev["payload"]["reason"], "source-changed");
    assert_eq!(ev["payload"]["changedSectionIds"].as_array().unwrap().len(), 1);
    touch_later(&s.file, &md(&["Saved in place.", P1, P2, P3]), false);
    assert!(wait_for(&s.t, base + 2).await);
    // Deleted and recreated quickly (some editors): no "missing", just a new revision.
    std::fs::remove_file(&s.file).unwrap();
    tokio::time::sleep(Duration::from_millis(60)).await;
    touch_later(&s.file, &md(&["Recreated.", P1, P2, P3]), false);
    assert!(wait_for(&s.t, base + 3).await);
    assert!(s.t.events("source.missing").is_empty());
    let list = s.annotations().await;
    assert_eq!(list[0]["id"], a["id"]);
    assert_eq!(list[0]["anchor"]["quote"], "noticed it");
    watcher.close();
}
