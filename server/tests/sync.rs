mod common;

use common::*;
use pager_server::clock::Clock;
use serde_json::{json, Value};

const ORIGIN: &str = "https://fedora.tail1234.ts.net";

fn chapter(n: &str) -> String {
    let paras: Vec<String> = (1..=120).map(|i| format!("Paragraph {i} of chapter {n}, with enough words in it to fill part of a page at an easy pace.")).collect();
    format!("# {n}\n\n{}\n\n", paras.join("\n\n"))
}

fn book_text() -> String {
    format!("---\ntitle: A Book\n---\n\n{}{}{}", chapter("One"), chapter("Two"), chapter("Three"))
}

async fn remote_setup(enable: bool) -> TestApp {
    let t = make_app_with(Clock::fake("2026-10-26T12:00:00Z"), None, None);
    if enable {
        assert_eq!(t.json("PATCH", "/api/settings/app", Some(json!({ "remote": { "enabled": true, "origin": ORIGIN } }))).await.status, 200);
    }
    t
}

async fn pair(t: &TestApp) -> (String, Value) {
    let w = t.json("POST", "/api/devices/pairing", None).await.body;
    let req = t.remote_call(Call::new("POST", "/api/pair").json(json!({ "code": w["code"], "name": "iPhone" }))).await.body;
    t.json("POST", "/api/devices/pairing/approve", Some(json!({ "requestId": req["requestId"] }))).await;
    let done = t.remote_call(Call::new("POST", "/api/pair/poll").json(req)).await.body;
    (done["token"].as_str().unwrap().to_string(), done["device"].clone())
}

async fn book(t: &TestApp) -> (Value, Value, Value) {
    t.write("Shelf/book.md", &book_text());
    t.write("note.md", "# Note\n\nShort.");
    assert_eq!(t.get("/api/tree").await.status, 200);
    let docs = t.get("/api/documents").await.body;
    let doc = docs.as_array().unwrap().iter().find(|d| d["relPath"] == "Shelf/book.md").unwrap().clone();
    let note = docs.as_array().unwrap().iter().find(|d| d["relPath"] == "note.md").unwrap().clone();
    let detail = t.get(&format!("/api/documents/{}", doc["id"].as_str().unwrap())).await.body;
    (doc, note, detail["toc"].clone())
}

fn progress_events(t: &TestApp) -> Vec<Value> {
    t.events("progress.updated").into_iter().map(|e| e["payload"].clone()).collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn records_who_wrote_the_place() {
    let t = remote_setup(true).await;
    let (token, device) = pair(&t).await;
    let (doc, _, toc) = book(&t).await;
    let url = format!("/api/documents/{}/progress", doc["id"].as_str().unwrap());
    let desk = t.json("PUT", &url, Some(json!({ "sectionId": toc[0]["id"], "offset": 0, "percent": 0 }))).await;
    assert_eq!(desk.status, 200, "{}", desk.text);
    assert_eq!(desk.body["deviceId"], Value::Null);
    t.json("PUT", &url, Some(json!({ "sectionId": toc[0]["id"], "offset": 0.5, "percent": 0.1 }))).await;
    t.json("PUT", &url, Some(json!({ "sectionId": toc[1]["id"], "offset": 0, "percent": 0.4 }))).await;
    let phone = t.remote_call(Call::new("PUT", &url).token(&token).json(json!({ "sectionId": toc[1]["id"], "offset": 0.5, "percent": 0.5 }))).await;
    assert_eq!(phone.status, 200, "{}", phone.text);
    assert_eq!(phone.body["deviceId"], device["id"]);
    t.remote_call(Call::new("PUT", &url).token(&token).json(json!({ "sectionId": toc[1]["id"], "offset": 0.7, "percent": 0.6 }))).await;
    let ev: Vec<(Value, Value)> = progress_events(&t).iter().map(|p| (p["sectionId"].clone(), p["deviceId"].clone())).collect();
    assert_eq!(ev, vec![(toc[0]["id"].clone(), Value::Null), (toc[1]["id"].clone(), Value::Null), (toc[1]["id"].clone(), device["id"].clone())]);
    let summary = t.get("/api/documents").await.body.as_array().unwrap().iter().find(|d| d["id"] == doc["id"]).unwrap().clone();
    assert_eq!(summary["progress"]["sectionId"], toc[1]["id"]);
    assert_eq!(summary["progress"]["deviceId"], device["id"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_an_older_place_with_409() {
    let t = remote_setup(true).await;
    let (token, _) = pair(&t).await;
    let (doc, _, toc) = book(&t).await;
    let url = format!("/api/documents/{}/progress", doc["id"].as_str().unwrap());
    t.clock.set("2026-10-26T12:30:00Z");
    t.json("PUT", &url, Some(json!({ "sectionId": toc[2]["id"], "offset": 0.2, "percent": 0.8 }))).await;
    let before = t.db_count("SELECT COUNT(*) FROM events");
    let stale = t.remote_call(Call::new("PUT", &url).token(&token).json(json!({ "sectionId": toc[0]["id"], "offset": 0.1, "percent": 0.05, "updatedAt": "2026-10-26T12:10:00Z" }))).await;
    assert_eq!(stale.status, 409);
    assert_eq!(stale.body["error"], json!({ "code": "progress_conflict", "message": "A newer reading place was saved for this book, so this one was not." }));
    assert_eq!(stale.body["progress"]["docId"], doc["id"]);
    assert_eq!(stale.body["progress"]["sectionId"], toc[2]["id"]);
    assert_eq!(stale.body["progress"]["updatedAt"], "2026-10-26T12:30:00.000Z");
    assert_eq!(stale.body["progress"]["deviceId"], Value::Null);
    assert_eq!(t.db_count("SELECT COUNT(*) FROM events"), before);
    assert_eq!(t.get(&format!("/api/documents/{}", doc["id"].as_str().unwrap())).await.body["progress"]["sectionId"], toc[2]["id"]);
    let later = t.remote_call(Call::new("PUT", &url).token(&token).json(json!({ "sectionId": toc[1]["id"], "offset": 0, "percent": 0.4, "updatedAt": "2026-10-26T12:40:00Z" }))).await;
    assert_eq!(later.status, 200);
    assert_eq!(later.body["updatedAt"], "2026-10-26T12:30:00.000Z");
    t.clock.set("2026-10-26T13:00:00Z");
    let offline = t.remote_call(Call::new("PUT", &url).token(&token).json(json!({ "sectionId": toc[2]["id"], "offset": 0.9, "percent": 0.95, "updatedAt": "2026-10-26T12:45:00Z" }))).await;
    assert_eq!(offline.body["sectionId"], toc[2]["id"]);
    assert_eq!(offline.body["updatedAt"], "2026-10-26T12:45:00.000Z");
    assert_eq!(t.remote_call(Call::new("PUT", &url).token(&token).json(json!({ "sectionId": toc[0]["id"], "offset": 0, "percent": 0, "updatedAt": "yesterday" }))).await.status, 400);
    assert_eq!(t.json("PUT", &url, Some(json!({ "sectionId": toc[0]["id"], "offset": 0, "percent": 0 }))).await.status, 200);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_manifest_lists_the_library() {
    let t = remote_setup(true).await;
    let (doc, note, _) = book(&t).await;
    let m = t.get("/api/sync/manifest").await.body;
    assert_eq!(m["cursor"], t.last_seq());
    assert_eq!(m["full"], true);
    assert_eq!(m["deleted"], json!([]));
    let bytes = std::fs::read(t.reads_dir.join("Shelf/book.md")).unwrap();
    let entry = m["documents"].as_array().unwrap().iter().find(|d| d["id"] == doc["id"]).unwrap();
    assert_eq!(entry["title"], "A Book");
    assert_eq!(entry["format"], "md");
    assert_eq!(entry["relPath"], "Shelf/book.md");
    assert!(entry["revisionId"].is_string());
    assert_eq!(entry["contentHash"], pager_server::ids::sha256_hex(&bytes));
    assert_eq!(entry["size"], bytes.len());
    assert_eq!(entry["sectionCount"], 3);
    assert!(entry["updatedAt"].is_string());
    assert!(entry.get("author").is_none());
    let mut ids: Vec<Value> = m["documents"].as_array().unwrap().iter().map(|d| d["id"].clone()).collect();
    ids.sort_by_key(|v| v.as_str().unwrap().to_string());
    let mut want = vec![doc["id"].clone(), note["id"].clone()];
    want.sort_by_key(|v| v.as_str().unwrap().to_string());
    assert_eq!(ids, want);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_manifest_lists_only_what_changed() {
    let t = remote_setup(true).await;
    let (doc, note, _) = book(&t).await;
    t.write("other.md", "# Other\n\nSomething else.");
    t.get("/api/tree").await;
    let other = t.get("/api/documents").await.body.as_array().unwrap().iter().find(|d| d["relPath"] == "other.md").unwrap().clone();
    let cursor = t.get("/api/sync/manifest").await.body["cursor"].as_i64().unwrap();
    assert_eq!(t.get(&format!("/api/sync/manifest?after={cursor}")).await.body, json!({ "cursor": cursor, "full": false, "documents": [], "deleted": [] }));
    t.json("PUT", &format!("/api/documents/{}/progress", doc["id"].as_str().unwrap()), Some(json!({ "sectionId": "x", "offset": 0, "percent": 0 }))).await;
    t.write("fresh.md", "# Fresh\n\nNew today.");
    t.get("/api/tree").await;
    let fresh = t.get("/api/documents").await.body.as_array().unwrap().iter().find(|d| d["relPath"] == "fresh.md").unwrap().clone();
    t.json("PATCH", &format!("/api/documents/{}", doc["id"].as_str().unwrap()), Some(json!({ "title": "A Better Title" }))).await;
    assert_eq!(t.json("DELETE", "/api/files?path=note.md", None).await.status, 204);
    t.json("POST", &format!("/api/documents/{}/merge", other["id"].as_str().unwrap()), Some(json!({ "intoId": doc["id"] }))).await;
    let delta = t.get(&format!("/api/sync/manifest?after={cursor}")).await.body;
    assert_eq!(delta["full"], false);
    assert!(delta["cursor"].as_i64().unwrap() > cursor);
    let mut docs: Vec<(String, String)> = delta["documents"].as_array().unwrap().iter().map(|d| (d["id"].as_str().unwrap().to_string(), d["title"].as_str().unwrap().to_string())).collect();
    docs.sort();
    let mut want = vec![(doc["id"].as_str().unwrap().to_string(), "A Better Title".to_string()), (fresh["id"].as_str().unwrap().to_string(), "Fresh".to_string())];
    want.sort();
    assert_eq!(docs, want);
    let mut deleted: Vec<String> = delta["deleted"].as_array().unwrap().iter().map(|d| d["id"].as_str().unwrap().to_string()).collect();
    deleted.sort();
    let mut want_del = vec![note["id"].as_str().unwrap().to_string(), other["id"].as_str().unwrap().to_string()];
    want_del.sort();
    assert_eq!(deleted, want_del);
    assert!(delta["deleted"].as_array().unwrap().iter().all(|d| d["deletedAt"].is_string()));
    assert_eq!(t.get(&format!("/api/sync/manifest?after={}", delta["cursor"])).await.body["documents"], json!([]));
}

#[tokio::test(flavor = "multi_thread")]
async fn the_manifest_answers_in_full_when_the_journal_was_purged() {
    let t = remote_setup(false).await;
    t.json("POST", "/api/events", Some(json!([{ "type": "nav.a_b" }, { "type": "nav.c_d" }, { "type": "lookup.word" }]))).await;
    book(&t).await;
    assert_eq!(t.get("/api/sync/manifest?after=1").await.body["full"], false);
    assert_eq!(t.json("DELETE", "/api/events?category=all", None).await.status, 204);
    let oldest: i64 = t.app.lock().one("SELECT MIN(seq) FROM events", &[], |r| r.get(0)).unwrap().unwrap();
    assert_eq!(oldest, 4);
    let gap = t.get("/api/sync/manifest?after=1").await.body;
    assert_eq!(gap["full"], true);
    assert_eq!(gap["documents"].as_array().unwrap().len(), 2);
    assert_eq!(t.get("/api/sync/manifest?after=3").await.body["full"], false);
    assert_eq!(t.get("/api/sync/manifest?after=99999").await.body["full"], true);
    assert_eq!(t.get("/api/sync/manifest?after=-1").await.status, 400);
    assert_eq!(t.get("/api/sync/manifest?after=abc").await.status, 400);
    let t = remote_setup(true).await;
    let (token, _) = pair(&t).await;
    book(&t).await;
    let m = t.remote_call(Call::get("/api/sync/manifest").token(&token)).await;
    assert_eq!(m.status, 200);
    assert_eq!(m.body["documents"].as_array().unwrap().len(), 2);
    assert_eq!(t.get("/api/events?type=progress.*").await.body, json!([]));
}
