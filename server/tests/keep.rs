mod common;

use common::*;
use pager_server::clock::Clock;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;

const P1: &str = "The heron stood in the shallows, perfectly still, waiting for the light to change.";
const P2: &str = "Nobody else on the path noticed it, and that seemed right somehow.";
const P3: &str = "When it finally moved, it moved all at once, like a decision made long before.";

fn md() -> String {
    format!("# Field Notes\n\n{P1}\n\n{P2}\n\n## Later\n\n{P3}\n")
}

struct S {
    t: TestApp,
    file: PathBuf,
    doc_id: String,
    section: Value,
}

impl S {
    async fn mark(&self, block_text: &str, quote: &str, extra: Value) -> Value {
        let b = self.section["blocks"].as_array().unwrap().iter().find(|x| x["text"] == block_text).unwrap();
        let off = b["text"].as_str().unwrap().find(quote).unwrap();
        let mut body = json!({ "range": { "start": { "blockId": b["id"], "offset": off }, "end": { "blockId": b["id"], "offset": off + quote.len() } } });
        for (k, v) in extra.as_object().unwrap() {
            body[k] = v.clone();
        }
        let r = self.t.json("POST", &format!("/api/documents/{}/annotations", self.doc_id), Some(body)).await;
        assert_eq!(r.status, 201, "{}", r.text);
        r.body
    }

    fn flush(&self) {
        self.t.app.lock().mirror_flush().unwrap();
    }
}

async fn setup_with(clock: Option<Clock>, file: Option<PathBuf>) -> S {
    let t = match clock {
        Some(c) => make_app_with(c, None, None),
        None => make_app(),
    };
    let file = file.unwrap_or_else(|| temp_dir("pager-keep-").join("notes.md"));
    if !file.exists() {
        std::fs::write(&file, md()).unwrap();
    }
    let doc_id = t.add_file(&file).await;
    let d = t.get(&format!("/api/documents/{doc_id}")).await.body;
    let section = t.get(&format!("/api/documents/{doc_id}/sections/{}?include=blocks", d["toc"][0]["id"].as_str().unwrap())).await.body;
    S { t, file, doc_id, section }
}

async fn setup() -> S {
    setup_with(None, None).await
}

fn mirror_files(dir: &Path) -> Vec<String> {
    if !dir.exists() {
        return vec![];
    }
    let mut v: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    v.sort();
    v
}

#[tokio::test(flavor = "multi_thread")]
async fn the_mirror_writes_an_obsidian_friendly_file() {
    let s = setup().await;
    let a = s.mark(P1, "perfectly still", json!({ "body": "Stillness as attention.", "tags": ["birds", "attention"], "color": "green" })).await;
    s.mark(P3, "like a decision", json!({})).await;
    s.flush();
    let dir = s.t.data_dir.join("notes");
    let files = mirror_files(&dir);
    assert_eq!(files, vec![format!("field-notes--{}.md", &s.doc_id[s.doc_id.len() - 8..])]);
    let file = dir.join(&files[0]);
    let text = std::fs::read_to_string(&file).unwrap();
    assert!(text.contains("title: Field Notes\n"));
    assert!(text.contains(&format!("pager-document: {}\n", s.doc_id)));
    assert!(text.contains("## Field Notes\n\n> perfectly still\n\nStillness as attention.\n\n- kind: note\n- color: green\n- tags: #birds #attention\n"), "{text}");
    assert!(text.contains(&format!("- link: http://localhost:3006/read/{}/", s.doc_id)));
    assert!(text.contains(&format!("^r-{}", a["id"].as_str().unwrap())));
    assert!(text.contains("> like a decision"));
    // Nothing changed → nothing written.
    assert!(!s.t.app.lock().mirror_write(&s.doc_id).unwrap());
    s.t.json("PATCH", &format!("/api/annotations/{}", a["id"].as_str().unwrap()), Some(json!({ "color": "blue" }))).await;
    s.flush();
    assert!(std::fs::read_to_string(&file).unwrap().contains("- color: blue"));
}

#[tokio::test(flavor = "multi_thread")]
async fn the_mirror_never_overwrites_an_edited_file() {
    let s = setup().await;
    let a = s.mark(P2, "noticed it", json!({})).await;
    s.flush();
    let dir = s.t.data_dir.join("notes");
    let file = dir.join(&mirror_files(&dir)[0]);
    let mut text = std::fs::read_to_string(&file).unwrap();
    text.push_str("\nMy own thoughts, added by hand.\n");
    std::fs::write(&file, text).unwrap();
    s.t.json("PATCH", &format!("/api/annotations/{}", a["id"].as_str().unwrap()), Some(json!({ "body": "A note." }))).await;
    s.flush();
    let files = mirror_files(&dir);
    assert_eq!(files.len(), 2, "{files:?}");
    let aside = files.iter().find(|f| f.contains(".edited-")).unwrap();
    assert!(std::fs::read_to_string(dir.join(aside)).unwrap().contains("My own thoughts"));
    assert!(std::fs::read_to_string(&file).unwrap().contains("A note."));
}

#[tokio::test(flavor = "multi_thread")]
async fn the_mirror_lists_orphans_and_can_be_moved_or_switched_off() {
    let s = setup().await;
    let a = s.mark(P3, "like a decision", json!({})).await;
    std::fs::write(&s.file, format!("# Field Notes\n\n{P1}\n\n{P2}\n")).unwrap();
    let later = std::time::SystemTime::now() + Duration::from_secs(5);
    std::fs::OpenOptions::new().write(true).open(&s.file).unwrap().set_modified(later).unwrap();
    s.t.get(&format!("/api/documents/{}", s.doc_id)).await;
    s.flush();
    let dir = s.t.data_dir.join("notes");
    let text = std::fs::read_to_string(dir.join(&mirror_files(&dir)[0])).unwrap();
    assert!(text.contains("## Orphaned"));
    assert!(text.contains("- place: not found in the current file"));
    s.t.json("DELETE", &format!("/api/annotations/{}", a["id"].as_str().unwrap()), None).await;
    s.flush();
    assert_eq!(mirror_files(&dir), Vec::<String>::new());

    let vault = temp_dir("pager-vault-");
    s.t.json("PATCH", "/api/settings/app", Some(json!({ "mirror": { "dir": vault.to_string_lossy() } }))).await;
    s.mark(P1, "perfectly still", json!({})).await;
    s.flush();
    assert_eq!(mirror_files(&vault).len(), 1);
    s.t.json("PATCH", "/api/settings/app", Some(json!({ "mirror": { "enabled": false } }))).await;
    s.mark(P2, "noticed it", json!({})).await;
    s.flush();
    assert!(!std::fs::read_to_string(vault.join(&mirror_files(&vault)[0])).unwrap().contains("noticed it"));
    let rebuilt = s.t.json("POST", "/api/mirror/rebuild", None).await;
    assert_eq!(rebuilt.body["written"], 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn exports_one_documents_notes() {
    let s = setup().await;
    s.mark(P1, "perfectly still", json!({ "body": "Stillness." })).await;
    let md = s.t.get(&format!("/api/documents/{}/export?format=md", s.doc_id)).await;
    assert!(md.headers.get("content-type").unwrap().to_str().unwrap().contains("text/markdown"));
    assert!(md.headers.get("content-disposition").unwrap().to_str().unwrap().contains("field-notes-notes.md"));
    assert!(md.text.contains("> perfectly still"));
    let js = s.t.get(&format!("/api/documents/{}/export?format=json", s.doc_id)).await.body;
    assert_eq!(js["documents"].as_array().unwrap().len(), 1);
    assert_eq!(js["annotations"].as_array().unwrap().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn export_import_round_trip() {
    let s = setup().await;
    s.mark(P1, "perfectly still", json!({ "body": "Stillness.", "tags": ["birds"] })).await;
    s.mark(P3, "like a decision", json!({ "color": "pink" })).await;
    s.t.json("POST", "/api/tools/vocab/records", Some(json!({ "data": { "word": "heron" } }))).await;
    s.t.json("PATCH", &format!("/api/settings/documents/{}", s.doc_id), Some(json!({ "fontOffset": 3 }))).await;
    s.t.json("PATCH", "/api/settings/global", Some(json!({ "theme": "sepia" }))).await;
    s.t.json("POST", "/api/presets", Some(json!({ "name": "Night", "values": { "theme": "dark" } }))).await;
    s.t.json("PUT", &format!("/api/documents/{}/progress", s.doc_id), Some(json!({ "sectionId": s.section["id"], "offset": 0.5, "percent": 0.5, "point": { "blockId": s.section["blocks"][1]["id"], "offset": 0 } }))).await;
    let exported = s.t.get("/api/export").await.body;
    assert_eq!(exported["format"], "pager-export");
    assert_eq!(exported["version"], 1);
    assert!(exported["annotations"][0]["anchor"].get("start").is_none());

    // Another machine: the same file at another path.
    let copy = temp_dir("pager-other-").join("field-notes.md");
    std::fs::copy(&s.file, &copy).unwrap();
    let u = setup_with(None, Some(copy)).await;
    let res = u.t.json("POST", "/api/import", Some(exported.clone())).await;
    assert_eq!(res.body, json!({ "documents": { "matched": 1, "waiting": 0 }, "annotations": { "added": 2, "updated": 0, "unchanged": 0 }, "records": { "added": 1, "updated": 0, "unchanged": 0 } }));
    let list = u.t.get(&format!("/api/documents/{}/annotations", u.doc_id)).await.body;
    let got: Vec<(Value, Value, Value)> = list.as_array().unwrap().iter().map(|a| (a["anchor"]["quote"].clone(), a["anchor"]["status"].clone(), a["body"].clone())).collect();
    assert_eq!(got, vec![(json!("perfectly still"), json!("moved"), json!("Stillness.")), (json!("like a decision"), json!("moved"), Value::Null)]);
    let settings = u.t.get(&format!("/api/settings?docId={}", u.doc_id)).await.body;
    assert_eq!(settings["effective"]["theme"], "sepia");
    assert_eq!(settings["effective"]["fontOffset"], 3);
    let progress = &u.t.get(&format!("/api/documents/{}", u.doc_id)).await.body["progress"];
    assert_eq!(progress["offset"], 0.5);
    assert_eq!(progress["anchor"], "moved");
    let again = u.t.json("POST", "/api/import", Some(exported.clone())).await;
    assert_eq!(again.body["annotations"], json!({ "added": 0, "updated": 0, "unchanged": 2 }));
    let back = u.t.get("/api/export").await.body;
    let strip = |x: &Value| -> Vec<Value> { x["annotations"].as_array().unwrap().iter().map(|a| json!([a["id"], a["kind"], a["color"], a["body"], a["tags"], a["anchor"]["exact"], a["createdAt"]])).collect() };
    assert_eq!(strip(&back), strip(&exported));
    assert_eq!(back["presets"].as_array().unwrap().iter().map(|p| p["name"].clone()).collect::<Vec<_>>(), vec![json!("Night")]);
}

#[tokio::test(flavor = "multi_thread")]
async fn imports_wait_for_their_file() {
    let s = setup().await;
    s.mark(P2, "noticed it", json!({ "body": "Waiting for me." })).await;
    let exported = s.t.get("/api/export").await.body;
    let u = make_app();
    let res = u.json("POST", "/api/import", Some(exported)).await;
    assert_eq!(res.body["documents"], json!({ "matched": 0, "waiting": 1 }));
    let copy = temp_dir("pager-later-").join("notes.md");
    std::fs::copy(&s.file, &copy).unwrap();
    let id = u.add_file(&copy).await;
    let mut list = json!([]);
    for _ in 0..50 {
        list = u.get(&format!("/api/documents/{id}/annotations")).await.body;
        if !list.as_array().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["anchor"]["quote"], "noticed it");
    assert_eq!(list[0]["body"], "Waiting for me.");
    let t = make_app();
    assert_eq!(t.json("POST", "/api/import", Some(json!({ "format": "other" }))).await.status, 400);
    assert_eq!(t.json("POST", "/api/import", Some(json!({ "format": "pager-export", "version": 9 }))).await.status, 400);
}

#[tokio::test(flavor = "multi_thread")]
async fn sessions_and_history() {
    let clock = Clock::fake("2026-10-24T20:00:00Z");
    let s = setup_with(Some(clock.clone()), None).await;
    let put = |offset: f64, reason: Option<&'static str>| {
        let s = &s;
        async move {
            let mut body = json!({ "sectionId": s.section["id"], "offset": offset, "percent": offset });
            if let Some(r) = reason {
                body["reason"] = json!(r);
            }
            s.t.json("PUT", &format!("/api/documents/{}/progress", s.doc_id), Some(body)).await
        }
    };
    put(0.1, None).await;
    clock.advance(2 * 60_000);
    put(0.2, None).await;
    clock.advance(4 * 60_000);
    put(0.4, Some("jump")).await;
    clock.advance(45 * 60_000);
    put(0.5, None).await;
    let sessions = s.t.get(&format!("/api/documents/{}/sessions", s.doc_id)).await.body;
    assert_eq!(sessions.as_array().unwrap().len(), 2);
    assert_eq!(sessions[1]["startedAt"], "2026-10-24T20:00:00.000Z");
    assert_eq!(sessions[1]["endedAt"], "2026-10-24T20:06:00.000Z");
    assert_eq!(sessions[1]["activeMs"], 6 * 60_000);
    assert!(sessions[1]["fromPercent"].as_f64().unwrap() < sessions[1]["toPercent"].as_f64().unwrap());
    let history = s.t.get(&format!("/api/documents/{}/history", s.doc_id)).await.body;
    assert!(history.as_array().unwrap().iter().any(|h| h["type"] == "reading.session"));
    let jump = history.as_array().unwrap().iter().find(|h| h["type"] == "progress.jumped").unwrap();
    assert_eq!(jump["sectionId"], s.section["id"]);

    let s2 = setup().await;
    s2.t.json("PATCH", "/api/settings/app", Some(json!({ "record": { "sessions": false } }))).await;
    s2.t.json("PUT", &format!("/api/documents/{}/progress", s2.doc_id), Some(json!({ "sectionId": s2.section["id"], "offset": 0.1, "percent": 0.1 }))).await;
    assert_eq!(s2.t.get(&format!("/api/documents/{}/sessions", s2.doc_id)).await.body, json!([]));
}

#[tokio::test(flavor = "multi_thread")]
async fn merging_editions() {
    let s = setup().await;
    let a = s.mark(P1, "perfectly still, waiting for the light", json!({})).await;
    let b = s.mark(P3, "like a decision made long before", json!({})).await;
    let other = temp_dir("pager-ed2-").join("notes-2nd-edition.md");
    std::fs::write(&other, format!("# Field Notes (Second Edition)\n\nA preface for the new edition.\n\n{}\n\n{P2}\n", P1.replace("the light", "the morning light"))).unwrap();
    let into = s.t.add_file(&other).await;
    let res = s.t.json("POST", &format!("/api/documents/{}/merge", s.doc_id), Some(json!({ "intoId": into }))).await;
    assert_eq!(res.status, 200, "{}", res.text);
    assert_eq!(res.body["moved"], 1);
    assert_eq!(res.body["orphaned"], 1);
    let list = s.t.get(&format!("/api/documents/{into}/annotations")).await.body;
    let got: Vec<(Value, Value)> = list.as_array().unwrap().iter().map(|x| (x["id"].clone(), x["anchor"]["status"].clone())).collect();
    assert_eq!(got, vec![(a["id"].clone(), json!("fuzzy")), (b["id"].clone(), json!("orphaned"))]);
    assert_eq!(s.t.get(&format!("/api/documents/{}", s.doc_id)).await.status, 404);
    assert_eq!(s.t.json("POST", &format!("/api/documents/{into}/merge"), Some(json!({ "intoId": into }))).await.status, 400);
}

#[tokio::test(flavor = "multi_thread")]
async fn limits() {
    assert!(pager_server::ingest::epub::guard_zip(1, 2 * 1024 * 1024 * 1024).unwrap_err().message.contains("unpacks to more"));
    assert!(pager_server::ingest::epub::guard_zip(5001, 0).unwrap_err().message.contains("too many parts"));
    let big = vec![b'a'; 21 * 1024 * 1024];
    let e = pager_server::ingest::parse_file(&big, pager_server::ingest::Format::Txt, &ingest_ctx(None, "big.txt")).unwrap_err();
    assert_eq!(e.code, "too_large");
    assert_eq!(e.status, 413);
}
