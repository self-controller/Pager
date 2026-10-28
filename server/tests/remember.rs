mod common;

use common::*;
use serde_json::{json, Value};

const MD: &str = "# Field Notes\n\nThe heron stood in the shallows, perfectly still, waiting for the light to change.\n\nNobody else on the path noticed it, and that seemed right somehow.\n\n## Later\n\nWhen it finally moved, it moved all at once, like a decision.\n";

struct Setup {
    t: TestApp,
    doc_id: String,
    section: Value,
}

impl Setup {
    fn block_of(&self, text: &str) -> (String, String) {
        let b = self.section["blocks"].as_array().unwrap().iter().find(|b| b["text"].as_str().map(|t| t.contains(text)).unwrap_or(false)).unwrap();
        (b["id"].as_str().unwrap().to_string(), b["text"].as_str().unwrap().to_string())
    }
}

async fn setup() -> Setup {
    let t = make_app();
    let file = write_temp("notes.md", MD.as_bytes());
    let doc_id = t.add_file(&file).await;
    let detail = t.get(&format!("/api/documents/{doc_id}")).await.body;
    let section = t.get(&format!("/api/documents/{doc_id}/sections/{}?include=blocks", detail["toc"][0]["id"].as_str().unwrap())).await.body;
    Setup { t, doc_id, section }
}

/// The UI's way: offsets into the section's textContent, as useSelection measures them.
fn text_content_offsets(html: &str, needle: &str) -> (usize, usize) {
    let mut text = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => text.push(c),
            _ => {}
        }
    }
    let text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"");
    let t16: Vec<u16> = text.encode_utf16().collect();
    let n16: Vec<u16> = needle.encode_utf16().collect();
    let start = (0..=t16.len() - n16.len()).find(|&i| t16[i..i + n16.len()] == n16[..]).unwrap();
    (start, start + n16.len())
}

#[tokio::test(flavor = "multi_thread")]
async fn creates_a_highlight_from_section_offsets() {
    let s = setup().await;
    let (start, end) = text_content_offsets(s.section["html"].as_str().unwrap(), "perfectly still");
    let res = s.t.json("POST", &format!("/api/documents/{}/annotations", s.doc_id), Some(json!({ "revisionId": s.section["revisionId"], "sectionRange": { "sectionId": s.section["id"], "start": start, "end": end }, "selectedText": "perfectly still" }))).await;
    assert_eq!(res.status, 201, "{}", res.text);
    let a = &res.body;
    assert_eq!(a["docId"], s.doc_id);
    assert_eq!(a["kind"], "highlight");
    assert_eq!(a["color"], "yellow");
    assert_eq!(a["style"], "highlight");
    assert_eq!(a["body"], Value::Null);
    assert_eq!(a["tags"], json!([]));
    assert_eq!(a["deletedAt"], Value::Null);
    assert_eq!(a["anchor"]["status"], "anchored");
    assert_eq!(a["anchor"]["confidence"], 1.0);
    assert_eq!(a["anchor"]["quote"], "perfectly still");
    assert_eq!(a["anchor"]["originalQuote"], "perfectly still");
    assert_eq!(a["anchor"]["sectionId"], s.section["id"]);
    let (bid, text) = s.block_of("The heron");
    let off = text.find("perfectly").unwrap();
    assert_eq!(a["anchor"]["range"], json!({ "start": { "blockId": bid, "offset": off }, "end": { "blockId": bid, "offset": off + 15 } }));
    assert_eq!(a["anchor"]["segments"], json!([{ "sectionId": s.section["id"], "start": start, "end": end }]));
}

#[tokio::test(flavor = "multi_thread")]
async fn creates_from_block_points_across_blocks_and_bookmarks() {
    let s = setup().await;
    let (a, atext) = s.block_of("The heron");
    let (b, _) = s.block_of("Nobody else");
    let cross = s.t.json("POST", &format!("/api/documents/{}/annotations", s.doc_id), Some(json!({ "range": { "start": { "blockId": a, "offset": atext.find("waiting").unwrap() }, "end": { "blockId": b, "offset": 6 } }, "body": "Two paragraphs." }))).await;
    assert_eq!(cross.status, 201, "{}", cross.text);
    assert_eq!(cross.body["kind"], "note");
    assert_eq!(cross.body["anchor"]["quote"], "waiting for the light to change.\nNobody");
    let mark = s.t.json("POST", &format!("/api/documents/{}/annotations", s.doc_id), Some(json!({ "range": { "start": { "blockId": b, "offset": 0 }, "end": { "blockId": b, "offset": 0 } } }))).await;
    assert_eq!(mark.body["kind"], "bookmark");
    assert_eq!(mark.body["color"], Value::Null);
    assert_eq!(mark.body["style"], "none");
    assert_eq!(mark.body["anchor"]["quote"], "");
    let list = s.t.get(&format!("/api/documents/{}/annotations", s.doc_id)).await.body;
    let kinds: Vec<&str> = list.as_array().unwrap().iter().map(|x| x["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, vec!["note", "bookmark"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn checks_selected_text_and_refuses_bad_coordinates() {
    let s = setup().await;
    let (start, end) = text_content_offsets(s.section["html"].as_str().unwrap(), "perfectly still");
    let mismatch = s.t.json("POST", &format!("/api/documents/{}/annotations", s.doc_id), Some(json!({ "sectionRange": { "sectionId": s.section["id"], "start": start, "end": end }, "selectedText": "something else" }))).await;
    assert_eq!(mismatch.status, 409);
    assert_eq!(mismatch.body["error"]["code"], "selection_mismatch");
    let unknown = s.t.json("POST", &format!("/api/documents/{}/annotations", s.doc_id), Some(json!({ "range": { "start": { "blockId": "bnope", "offset": 0 }, "end": { "blockId": "bnope", "offset": 2 } } }))).await;
    assert_eq!(unknown.body["error"]["code"], "stale_revision");
    assert_eq!(s.t.json("POST", &format!("/api/documents/{}/annotations", s.doc_id), Some(json!({}))).await.status, 400);
}

#[tokio::test(flavor = "multi_thread")]
async fn client_ids_are_idempotent() {
    let s = setup().await;
    let (b, _) = s.block_of("Nobody else");
    let body = json!({ "id": "client-id-0001", "range": { "start": { "blockId": b, "offset": 0 }, "end": { "blockId": b, "offset": 6 } }, "color": "green" });
    let first = s.t.json("POST", &format!("/api/documents/{}/annotations", s.doc_id), Some(body.clone())).await;
    let again = s.t.json("POST", &format!("/api/documents/{}/annotations", s.doc_id), Some(body.clone())).await;
    assert_eq!(first.status, 201);
    assert_eq!(again.status, 200);
    assert_eq!(again.body["id"], "client-id-0001");
    let mut clash = body.clone();
    clash["color"] = json!("pink");
    assert_eq!(s.t.json("POST", &format!("/api/documents/{}/annotations", s.doc_id), Some(clash)).await.body["error"]["code"], "conflict");
}

#[tokio::test(flavor = "multi_thread")]
async fn updates_deletes_restores_and_lists() {
    let s = setup().await;
    let (b, _) = s.block_of("When it finally");
    let a = s.t.json("POST", &format!("/api/documents/{}/annotations", s.doc_id), Some(json!({ "range": { "start": { "blockId": b, "offset": 0 }, "end": { "blockId": b, "offset": 4 } } }))).await.body;
    let aid = a["id"].as_str().unwrap().to_string();
    let upd = s.t.json("PATCH", &format!("/api/annotations/{aid}"), Some(json!({ "color": "blue", "body": "Like a decision.", "tags": ["birds", "#birds", " stillness "] }))).await;
    assert_eq!(upd.body["color"], "blue");
    assert_eq!(upd.body["body"], "Like a decision.");
    assert_eq!(upd.body["tags"], json!(["birds", "stillness"]));
    let sec = s.t.get(&format!("/api/documents/{}/sections/{}?include=annotations", s.doc_id, s.section["id"].as_str().unwrap())).await.body;
    assert_eq!(sec["annotations"].as_array().unwrap().len(), 1);
    assert_eq!(sec["annotations"][0]["id"], aid);
    let hl = s.t.get("/api/highlights").await.body;
    assert_eq!(hl[0]["id"], aid);
    assert_eq!(hl[0]["docTitle"], "Field Notes");
    assert_eq!(hl[0]["sectionTitle"], "Field Notes");
    assert_eq!(hl[0]["href"], format!("/read/{}/{}#{}", s.doc_id, s.section["id"].as_str().unwrap(), b));
    assert_eq!(s.t.get("/api/highlights?tag=birds").await.body.as_array().unwrap().len(), 1);
    assert_eq!(s.t.get("/api/highlights?q=decision").await.body.as_array().unwrap().len(), 1);
    assert_eq!(s.t.get("/api/tags").await.body, json!([{ "tag": "birds", "count": 1 }, { "tag": "stillness", "count": 1 }]));
    assert_eq!(s.t.json("DELETE", &format!("/api/annotations/{aid}"), None).await.status, 204);
    assert_eq!(s.t.get(&format!("/api/documents/{}/annotations", s.doc_id)).await.body, json!([]));
    assert!(!s.t.get(&format!("/api/documents/{}/annotations?include=deleted", s.doc_id)).await.body[0]["deletedAt"].is_null());
    let back = s.t.json("POST", &format!("/api/annotations/{aid}/restore"), None).await;
    assert_eq!(back.body["deletedAt"], Value::Null);
    let events: Vec<String> = s.t.get(&format!("/api/events?docId={}&type=annotation.*", s.doc_id)).await.body.as_array().unwrap().iter().map(|e| e["type"].as_str().unwrap().to_string()).collect();
    assert_eq!(events, vec!["annotation.restored", "annotation.deleted", "annotation.updated", "annotation.created"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn rejects_bad_fields() {
    let s = setup().await;
    let (b, _) = s.block_of("Nobody else");
    let range = json!({ "start": { "blockId": b, "offset": 0 }, "end": { "blockId": b, "offset": 6 } });
    for bad in [json!({ "color": "red" }), json!({ "kind": "doodle" }), json!({ "style": "glow" }), json!({ "tags": "x" }), json!({ "id": "short" })] {
        let mut body = json!({ "range": range });
        for (k, v) in bad.as_object().unwrap() {
            body[k] = v.clone();
        }
        assert_eq!(s.t.json("POST", &format!("/api/documents/{}/annotations", s.doc_id), Some(body)).await.status, 400, "{bad}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn progress_with_a_place_in_the_text() {
    let s = setup().await;
    let (b, _) = s.block_of("Nobody else");
    let p = s.t.json("PUT", &format!("/api/documents/{}/progress", s.doc_id), Some(json!({ "sectionId": s.section["id"], "offset": 0.4, "percent": 0.4, "point": { "blockId": b, "offset": 0 }, "revisionId": s.section["revisionId"], "reason": "jump" }))).await;
    assert_eq!(p.status, 200, "{}", p.text);
    assert_eq!(p.body["sectionId"], s.section["id"]);
    assert_eq!(p.body["offset"], 0.4);
    assert_eq!(p.body["point"], json!({ "blockId": b, "offset": 0 }));
    assert_eq!(p.body["anchor"], "anchored");
    assert_eq!(s.t.get(&format!("/api/events?docId={}&type=progress.jumped", s.doc_id)).await.body.as_array().unwrap().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn tool_records() {
    let s = setup().await;
    let (b, _) = s.block_of("The heron");
    let plain = s.t.json("POST", "/api/tools/vocab/records", Some(json!({ "data": { "word": "heron", "seen": 1 } }))).await;
    assert_eq!(plain.status, 201, "{}", plain.text);
    assert_eq!(plain.body["toolId"], "vocab");
    assert_eq!(plain.body["docId"], Value::Null);
    assert_eq!(plain.body["anchor"], Value::Null);
    assert_eq!(plain.body["data"], json!({ "word": "heron", "seen": 1 }));
    let anchored = s.t.json("POST", "/api/tools/vocab/records", Some(json!({ "docId": s.doc_id, "anchor": { "range": { "start": { "blockId": b, "offset": 4 }, "end": { "blockId": b, "offset": 9 } } }, "data": { "word": "heron" } }))).await;
    assert_eq!(anchored.body["anchor"]["status"], "anchored");
    assert_eq!(anchored.body["anchor"]["quote"], "heron");
    let pid = plain.body["id"].as_str().unwrap();
    let upd = s.t.json("PATCH", &format!("/api/tools/vocab/records/{pid}"), Some(json!({ "data": { "word": "heron", "seen": 2 } }))).await;
    assert_eq!(upd.body["data"], json!({ "word": "heron", "seen": 2 }));
    let ids: Vec<Value> = s.t.get(&format!("/api/tools/vocab/records?docId={}", s.doc_id)).await.body.as_array().unwrap().iter().map(|r| r["id"].clone()).collect();
    assert_eq!(ids, vec![anchored.body["id"].clone()]);
    assert_eq!(s.t.json("DELETE", &format!("/api/tools/vocab/records/{pid}"), None).await.status, 204);
    assert_eq!(s.t.get("/api/tools/vocab/records").await.body.as_array().unwrap().len(), 1);
    assert_eq!(s.t.get("/api/tools/Bad%20Tool/records").await.status, 400);
    let aid = anchored.body["id"].as_str().unwrap();
    assert_eq!(s.t.get(&format!("/api/tools/vocab/records/{aid}")).await.status, 200);
    assert_eq!(s.t.get(&format!("/api/tools/other/records/{aid}")).await.status, 404);
    let big = s.t.json("POST", "/api/tools/vocab/records", Some(json!({ "data": "x".repeat(70_000) }))).await;
    assert_eq!(big.status, 413);
}

#[tokio::test(flavor = "multi_thread")]
async fn settings_merge_and_validate() {
    let s = setup().await;
    s.t.json("PATCH", "/api/settings/global", Some(json!({ "theme": "sepia", "fontOffset": 2, "layout": "scroll" }))).await;
    let doc = s.t.json("PATCH", &format!("/api/settings/documents/{}", s.doc_id), Some(json!({ "fontOffset": 4, "customCss": "p { color: navy }" }))).await;
    assert_eq!(doc.body["effective"], json!({ "theme": "sepia", "fontOffset": 4, "layout": "scroll", "customCss": "p { color: navy }" }));
    let cleared = s.t.json("PATCH", &format!("/api/settings/documents/{}", s.doc_id), Some(json!({ "fontOffset": null }))).await;
    assert_eq!(cleared.body["effective"]["fontOffset"], 2);
    assert_eq!(s.t.json("DELETE", &format!("/api/settings/documents/{}", s.doc_id), None).await.status, 204);
    assert_eq!(s.t.get(&format!("/api/settings?docId={}", s.doc_id)).await.body["document"], json!({}));
    let app = s.t.json("PATCH", "/api/settings/app", Some(json!({ "record": { "search": false }, "mirror": { "dir": "/tmp/x" } }))).await;
    assert_eq!(app.body["app"]["record"]["search"], false);
    assert_eq!(app.body["app"]["record"]["navigation"], true);
    assert_eq!(app.body["app"]["mirror"], json!({ "enabled": true, "dir": "/tmp/x" }));
    assert_eq!(app.body["app"]["idleShutdownMinutes"], 360);
    assert_eq!(s.t.json("PATCH", "/api/settings/app", Some(json!({ "record": { "telepathy": true } }))).await.status, 400);
    assert_eq!(s.t.json("PATCH", "/api/settings/global", Some(json!([1, 2]))).await.status, 400);
}

#[tokio::test(flavor = "multi_thread")]
async fn presets() {
    let s = setup().await;
    let p = s.t.json("POST", "/api/presets", Some(json!({ "name": "Night", "values": { "theme": "dark", "fontOffset": 3 } }))).await;
    assert_eq!(p.status, 201);
    let pid = p.body["id"].as_str().unwrap();
    s.t.json("PATCH", &format!("/api/presets/{pid}"), Some(json!({ "name": "Late night" }))).await;
    let list = s.t.get("/api/presets").await.body;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["name"], "Late night");
    assert_eq!(list[0]["values"], json!({ "theme": "dark", "fontOffset": 3 }));
    assert_eq!(s.t.json("DELETE", &format!("/api/presets/{pid}"), None).await.status, 204);
    assert_eq!(s.t.json("DELETE", &format!("/api/presets/{pid}"), None).await.status, 404);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_journal_records_and_forgets() {
    let s = setup().await;
    s.t.json("PATCH", "/api/settings/app", Some(json!({ "record": { "lookups": false } }))).await;
    let res = s.t.json("POST", "/api/events", Some(json!([
        { "type": "nav.section_opened", "docId": s.doc_id, "payload": { "sectionId": s.section["id"] } },
        { "type": "lookup.word", "docId": s.doc_id, "payload": { "word": "heron" } },
        { "type": "search.query", "payload": { "q": "light" } }
    ]))).await;
    assert_eq!(res.body["accepted"], 2);
    let mine = s.t.get(&format!("/api/events?docId={}&type=nav.*", s.doc_id)).await.body;
    assert_eq!(mine[0]["origin"], "client");
    assert_eq!(mine[0]["type"], "nav.section_opened");
    assert_eq!(mine[0]["payload"], json!({ "sectionId": s.section["id"] }));
    assert_eq!(s.t.get("/api/events?type=lookup.word").await.body, json!([]));
    assert_eq!(s.t.json("POST", "/api/events", Some(json!([{ "type": "annotation.created" }]))).await.status, 400);
    assert_eq!(s.t.json("POST", "/api/events", Some(json!([{ "type": "Bad Type" }]))).await.status, 400);
    assert_eq!(s.t.json("POST", "/api/events", Some(json!([{ "type": "x.y", "payload": { "big": "x".repeat(5000) } }]))).await.status, 400);
    assert_eq!(s.t.json("DELETE", "/api/events?category=navigation", None).await.status, 204);
    assert_eq!(s.t.get("/api/events?type=nav.*").await.body, json!([]));
    assert_eq!(s.t.get("/api/events?type=search.*").await.body.as_array().unwrap().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_failed_transaction_rolls_back_state_and_event() {
    let s = setup().await;
    let before = s.t.db_count("SELECT COUNT(*) FROM events");
    let doc = s.doc_id.clone();
    let r = s.t.app.lock().tx(|c| {
        c.exec("UPDATE documents SET saved = 1 WHERE id = ?1", &[&doc])?;
        c.emit("document.updated", pager_server::journal::Emit::doc(&doc), json!({ "fields": ["saved"] }))?;
        Err::<(), _>(pager_server::AppError::internal("boom"))
    });
    assert!(r.is_err());
    assert_eq!(s.t.db_count("SELECT COUNT(*) FROM events"), before);
    assert_eq!(s.t.app.lock().count("SELECT saved FROM documents WHERE id = ?1", &[&doc]).unwrap(), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn streams_events_and_resumes() {
    let s = setup().await;
    let (t, doc_id) = (&s.t, s.doc_id.clone());
    // A live stream: open it, make changes, read two events.
    let res = t.stream(&t.local, "localhost:3006", Call::get("/api/stream")).await;
    assert!(res.headers().get("content-type").unwrap().to_str().unwrap().contains("text/event-stream"));
    t.json("PATCH", &format!("/api/documents/{doc_id}"), Some(json!({ "saved": true }))).await;
    t.json("POST", "/api/events", Some(json!([{ "type": "nav.toc_used", "docId": doc_id }]))).await;
    fn want(text: &str) -> bool {
        sse_types(text).len() >= 2
    }
    let (text, _) = read_stream(res, 3000, Some(want)).await;
    let types = sse_types(&text);
    assert_eq!(types, vec!["document.updated", "nav.toc_used"]);
    let last_seen: i64 = text.lines().filter_map(|l| l.strip_prefix("id: ")).last().unwrap().parse().unwrap();
    // While disconnected:
    t.json("PATCH", &format!("/api/documents/{doc_id}"), Some(json!({ "saved": false }))).await;
    t.json("PATCH", "/api/settings/global", Some(json!({ "theme": "dark" }))).await;
    let res = t.stream(&t.local, "localhost:3006", Call::get("/api/stream").header("Last-Event-ID", last_seen.to_string())).await;
    let (text, _) = read_stream(res, 3000, Some(want)).await;
    assert_eq!(sse_types(&text), vec!["document.updated", "settings.changed"]);
    let first_id: i64 = text.lines().filter_map(|l| l.strip_prefix("id: ")).next().unwrap().parse().unwrap();
    assert!(first_id > last_seen);
}
