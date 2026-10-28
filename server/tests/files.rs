mod common;

use common::*;
use pager_server::library::watcher::{Watcher, WatcherOptions};
use serde_json::{json, Value};
use std::time::Duration;

fn seed(t: &TestApp) {
    t.write("Welcome.md", "# Welcome\n\nThe first page of the library.");
    t.write("Novels/jane-eyre.txt", "JANE EYRE\n\nThere was no possibility of taking a walk that day.");
    t.write("Novels/Brontë/villette.md", "---\ntitle: Villette\nauthor: Charlotte Brontë\n---\n\n# Villette\n\nMy godmother lived in a handsome house.");
    t.write("Essays/of-studies.md", "# Of Studies\n\nStudies serve for delight, for ornament, and for ability.");
    std::fs::create_dir_all(t.reads_dir.join("Empty")).unwrap();
    t.write(".hidden/secret.md", "# Secret");
    t.write("node_modules/pkg/readme.md", "# Package");
    std::fs::write(t.reads_dir.join("Novels/cover.jpg"), [0xff, 0xd8, 0xff, 0x00]).unwrap();
}

fn folder<'a>(tree: &'a Value, rel: &str) -> Option<&'a Value> {
    let mut cur = tree;
    if rel.is_empty() {
        return Some(cur);
    }
    for part in rel.split('/') {
        cur = cur["folders"].as_array()?.iter().find(|f| f["name"] == part)?;
    }
    Some(cur)
}

fn names(v: &Value, key: &str) -> Vec<String> {
    v[key].as_array().unwrap().iter().map(|f| f["name"].as_str().unwrap().to_string()).collect()
}

async fn tree(t: &TestApp) -> Value {
    let r = t.get("/api/tree").await;
    assert_eq!(r.status, 200, "{}", r.text);
    r.body
}

fn titles(docs: &Value) -> Vec<String> {
    docs.as_array().unwrap().iter().map(|d| d["title"].as_str().unwrap().to_string()).collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn lists_folders_and_files_with_their_documents() {
    let t = make_app();
    seed(&t);
    let tr = tree(&t).await;
    assert_eq!(tr["truncated"], false);
    let root = &tr["root"];
    assert_eq!(root["path"], "");
    assert_eq!(names(root, "folders"), vec!["Empty", "Essays", "Novels"]);
    assert_eq!(names(root, "files"), vec!["Welcome.md"]);
    assert_eq!(root["fileCount"], 4);
    let empty = folder(root, "Empty").unwrap();
    assert_eq!(empty["fileCount"], 0);
    assert!(empty["files"].as_array().unwrap().is_empty());
    let novels = folder(root, "Novels").unwrap();
    assert_eq!(names(novels, "files"), vec!["jane-eyre.txt"]);
    assert_eq!(novels["fileCount"], 2);
    let villette = &folder(root, "Novels/Brontë").unwrap()["files"][0];
    assert_eq!(villette["kind"], "file");
    assert_eq!(villette["path"], "Novels/Brontë/villette.md");
    assert_eq!(villette["format"], "md");
    assert!(villette["docId"].is_string());
    assert_eq!(villette["doc"]["title"], "Villette");
    assert_eq!(villette["doc"]["author"], "Charlotte Brontë");
    assert_eq!(villette["doc"]["relPath"], "Novels/Brontë/villette.md");
    let docs = t.get("/api/documents?sort=title").await.body;
    assert_eq!(titles(&docs), vec!["Jane Eyre", "Of Studies", "Villette", "Welcome"]);
    assert!(docs.as_array().unwrap().iter().all(|d| d["sourceName"] == "Reads"));
}

#[tokio::test(flavor = "multi_thread")]
async fn creates_markdown_files_with_front_matter() {
    let t = make_app();
    seed(&t);
    let res = t.json("POST", "/api/files", Some(json!({ "dir": "Essays", "title": "On Walking", "author": "A. Writer" }))).await;
    assert_eq!(res.status, 201, "{}", res.text);
    assert_eq!(res.body["path"], "Essays/On Walking.md");
    assert_eq!(res.body["document"]["title"], "On Walking");
    assert_eq!(res.body["document"]["author"], "A. Writer");
    assert_eq!(res.body["document"]["format"], "md");
    assert_eq!(res.body["document"]["relPath"], "Essays/On Walking.md");
    let text = std::fs::read_to_string(t.reads_dir.join("Essays/On Walking.md")).unwrap();
    assert!(text.starts_with("---\ntitle: On Walking\nauthor: A. Writer\ncreated: 2026-10-24T12:00:00.000Z\n---\n\n# On Walking\n"), "{text}");
    let id = res.body["document"]["id"].as_str().unwrap();
    let detail = t.get(&format!("/api/documents/{id}")).await.body;
    assert_eq!(detail["live"], true);
    assert_eq!(detail["toc"].as_array().unwrap().len(), 1);
    let again = t.json("POST", "/api/files", Some(json!({ "dir": "Essays", "title": "On Walking" }))).await.body;
    assert_eq!(again["path"], "Essays/On Walking 2.md");
    assert_ne!(again["document"]["id"], res.body["document"]["id"]);
    let odd = t.json("POST", "/api/files", Some(json!({ "dir": "", "title": "Notes: \"quoted\" / slashed?" }))).await.body;
    assert_eq!(odd["path"], "Notes quoted slashed.md");
    assert_eq!(odd["document"]["title"], "Notes: \"quoted\" / slashed?");
    let reasons: Vec<String> = t.events("tree.changed").iter().map(|e| e["payload"]["reason"].as_str().unwrap().to_string()).collect();
    assert_eq!(reasons, vec!["created", "created", "created"]);
    assert_eq!(t.json("POST", "/api/files", Some(json!({ "dir": "", "title": "   " }))).await.status, 400);
    assert_eq!(t.json("POST", "/api/files", Some(json!({ "dir": "Nowhere", "title": "x" }))).await.status, 404);
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_paths_that_leave_the_library() {
    let t = make_app();
    seed(&t);
    for dir in ["../outside", "/etc", ".hidden", "Novels/../../x", "a\u{0}b"] {
        let res = t.json("POST", "/api/folders", Some(json!({ "dir": dir, "name": "x" }))).await;
        assert!([400, 403, 404].contains(&res.status), "{dir}: {}", res.status);
    }
    let outside = temp_dir("pager-outside-");
    std::os::unix::fs::symlink(&outside, t.reads_dir.join("Link")).unwrap();
    assert_eq!(t.json("POST", "/api/folders", Some(json!({ "dir": "Link", "name": "x" }))).await.status, 403);
    assert!(!outside.join("x").exists());
    assert_eq!(t.json("POST", "/api/folders", Some(json!({ "dir": "", "name": "../escape" }))).await.body["path"], "escape");
}

#[tokio::test(flavor = "multi_thread")]
async fn makes_folders_and_refuses_duplicates() {
    let t = make_app();
    seed(&t);
    let res = t.json("POST", "/api/folders", Some(json!({ "dir": "Novels", "name": "Austen" }))).await;
    assert_eq!(res.status, 201);
    assert_eq!(res.body, json!({ "path": "Novels/Austen" }));
    assert!(t.reads_dir.join("Novels/Austen").is_dir());
    assert_eq!(t.json("POST", "/api/folders", Some(json!({ "dir": "Novels", "name": "Austen" }))).await.status, 409);
    assert_eq!(t.json("POST", "/api/folders", Some(json!({ "dir": "", "name": "" }))).await.status, 400);
    assert!(folder(&tree(&t).await["root"], "Novels/Austen").is_some());
}

#[tokio::test(flavor = "multi_thread")]
async fn renames_and_moves_files_keeping_documents() {
    let t = make_app();
    seed(&t);
    let before = tree(&t).await;
    let jane = folder(&before["root"], "Novels").unwrap()["files"][0].clone();
    let res = t.json("POST", "/api/files/move", Some(json!({ "from": "Novels/jane-eyre.txt", "to": "Novels/Brontë/jane-eyre.txt" }))).await;
    assert_eq!(res.status, 200, "{}", res.text);
    assert_eq!(res.body["path"], "Novels/Brontë/jane-eyre.txt");
    assert_eq!(res.body["document"]["id"], jane["docId"]);
    assert_eq!(res.body["document"]["title"], "Jane Eyre");
    assert_eq!(res.body["document"]["relPath"], "Novels/Brontë/jane-eyre.txt");
    assert!(!t.reads_dir.join("Novels/jane-eyre.txt").exists());
    // A title that was only the file name follows a rename.
    let notes = t.json("POST", "/api/files", Some(json!({ "dir": "", "title": "Draft" }))).await.body;
    std::fs::write(t.reads_dir.join("Draft.md"), "Just a line, no heading.").unwrap();
    let nid = notes["document"]["id"].as_str().unwrap().to_string();
    t.json("POST", &format!("/api/documents/{nid}/reload"), None).await;
    assert_eq!(t.get(&format!("/api/documents/{nid}")).await.body["title"], "Draft");
    let res = t.json("POST", "/api/files/move", Some(json!({ "from": "Draft.md", "to": "Final draft.md" }))).await;
    assert_eq!(res.body["document"]["id"], nid);
    assert_eq!(res.body["document"]["title"], "Final draft");
    // Folders move with everything in them.
    let res = t.json("POST", "/api/files/move", Some(json!({ "from": "Novels", "to": "Fiction" }))).await;
    assert_eq!(res.status, 200, "{}", res.text);
    let docs = t.get("/api/documents").await.body;
    let find = |pred: &dyn Fn(&Value) -> bool| docs.as_array().unwrap().iter().find(|d| pred(d)).cloned().unwrap();
    assert_eq!(find(&|d| d["id"] == jane["docId"])["relPath"], "Fiction/Brontë/jane-eyre.txt");
    assert_eq!(find(&|d| d["title"] == "Villette")["relPath"], "Fiction/Brontë/villette.md");
    assert_eq!(docs.as_array().unwrap().len(), 5);
    let jid = jane["docId"].as_str().unwrap();
    let detail = t.get(&format!("/api/documents/{jid}")).await.body;
    assert_eq!(detail["pathStatus"], "ok");
    let sid = detail["toc"][0]["id"].as_str().unwrap();
    assert_eq!(t.get(&format!("/api/documents/{jid}/sections/{sid}")).await.status, 200);
    assert_eq!(t.json("POST", "/api/files/move", Some(json!({ "from": "Fiction", "to": "Fiction/Inside" }))).await.status, 400);
    assert_eq!(t.json("POST", "/api/files/move", Some(json!({ "from": "Essays", "to": "Fiction" }))).await.status, 409);
    assert_eq!(t.json("POST", "/api/files/move", Some(json!({ "from": "Welcome.md", "to": "Welcome" }))).await.status, 400);
    assert_eq!(t.json("POST", "/api/files/move", Some(json!({ "from": "Nope.md", "to": "Yep.md" }))).await.status, 404);
}

#[tokio::test(flavor = "multi_thread")]
async fn deletes_into_the_trash() {
    let t = make_app();
    seed(&t);
    tree(&t).await;
    let docs = t.get("/api/documents").await.body;
    let essay = docs.as_array().unwrap().iter().find(|d| d["title"] == "Of Studies").unwrap().clone();
    assert_eq!(t.json("DELETE", "/api/files?path=Essays/of-studies.md", None).await.status, 204);
    let mut left = titles(&t.get("/api/documents").await.body);
    left.sort();
    assert_eq!(left, vec!["Jane Eyre", "Villette", "Welcome"]);
    assert_eq!(t.get(&format!("/api/documents/{}", essay["id"].as_str().unwrap())).await.status, 404);
    let trash = t.reads_dir.join(".trash");
    let stamps: Vec<_> = std::fs::read_dir(&trash).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(stamps.len(), 1);
    let inside: Vec<String> = std::fs::read_dir(trash.join(&stamps[0])).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    assert_eq!(inside, vec!["of-studies.md"]);
    assert!(folder(&tree(&t).await["root"], "Essays").unwrap()["files"].as_array().unwrap().is_empty());
    assert_eq!(t.json("DELETE", "/api/files?path=Novels", None).await.status, 204);
    assert_eq!(titles(&t.get("/api/documents").await.body), vec!["Welcome"]);
    assert_eq!(names(&tree(&t).await["root"], "folders"), vec!["Empty", "Essays"]);
    assert_eq!(t.json("DELETE", "/api/files?path=", None).await.status, 400);
    assert_eq!(t.json("DELETE", "/api/files?path=.trash", None).await.status, 400);
    assert_eq!(t.events("tree.changed").iter().filter(|e| e["payload"]["reason"] == "deleted").count(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn uploads_go_into_a_folder() {
    let t = make_app();
    seed(&t);
    let (ct, body) = multipart("file", "dropped.md", b"# Dropped\n\nFrom the browser.");
    let mut c = Call::new("POST", "/api/uploads?dir=Essays");
    c.raw = Some((ct, body));
    let res = t.call(c).await;
    assert_eq!(res.status, 201, "{}", res.text);
    assert_eq!(res.body["status"], "done");
    let doc_id = res.body["documentIds"][0].as_str().unwrap().to_string();
    assert!(t.reads_dir.join("Essays/dropped.md").exists());
    let doc = t.get(&format!("/api/documents/{doc_id}")).await.body;
    assert_eq!(doc["title"], "Dropped");
    assert_eq!(doc["sourceName"], "Reads");
    assert_eq!(doc["relPath"], "Essays/dropped.md");
    assert_eq!(doc["live"], true);
    let (ct, body) = multipart("file", "copy.md", b"# Dropped\n\nFrom the browser.");
    let mut c = Call::new("POST", "/api/uploads");
    c.raw = Some((ct, body));
    assert_eq!(t.call(c).await.body["documentIds"], json!([doc_id]));
    assert!(!t.reads_dir.join("copy.md").exists());
    let (ct, body) = multipart("file", "dropped.md", b"# Other\n\nDifferent bytes.");
    let mut c = Call::new("POST", "/api/uploads?dir=Essays");
    c.raw = Some((ct, body));
    let second = t.call(c).await.body;
    let sid = second["documentIds"][0].as_str().unwrap();
    assert_eq!(t.get(&format!("/api/documents/{sid}")).await.body["relPath"], "Essays/dropped 2.md");
    let (ct, body) = multipart("file", "paper.pdf", b"%PDF-1.4 nothing");
    let mut c = Call::new("POST", "/api/uploads");
    c.raw = Some((ct, body));
    assert_eq!(t.call(c).await.status, 422);
}

#[tokio::test(flavor = "multi_thread")]
async fn copies_files_and_folders_in() {
    let t = make_app();
    seed(&t);
    let elsewhere = temp_dir("pager-elsewhere-");
    std::fs::write(elsewhere.join("persuasion.txt"), "Persuasion\n\nSir Walter Elliot, of Kellynch Hall.").unwrap();
    std::fs::create_dir_all(elsewhere.join("Shelf/deeper")).unwrap();
    std::fs::write(elsewhere.join("Shelf/emma.md"), "# Emma\n\nEmma Woodhouse, handsome, clever, and rich.").unwrap();
    std::fs::write(elsewhere.join("Shelf/deeper/notes.txt"), "Notes\n\nSome notes.").unwrap();
    std::fs::write(elsewhere.join("Shelf/photo.jpg"), [0xff, 0xd8, 0xff]).unwrap();
    let one = t.json("POST", "/api/files/import", Some(json!({ "dir": "Novels", "path": elsewhere.join("persuasion.txt").to_string_lossy() }))).await;
    assert_eq!(one.status, 201, "{}", one.text);
    assert_eq!(one.body["status"], "done");
    assert!(elsewhere.join("persuasion.txt").exists());
    let id = one.body["documentIds"][0].as_str().unwrap();
    assert_eq!(t.get(&format!("/api/documents/{id}")).await.body["relPath"], "Novels/persuasion.txt");
    let many = t.json("POST", "/api/files/import", Some(json!({ "dir": "", "path": elsewhere.join("Shelf").to_string_lossy() }))).await;
    assert_eq!(many.status, 201);
    let job = t.wait_job(many.body["id"].as_str().unwrap()).await;
    assert_eq!(job["status"], "done");
    assert_eq!(job["documentIds"].as_array().unwrap().len(), 2);
    assert!(t.reads_dir.join("Shelf/deeper/notes.txt").exists());
    assert!(!t.reads_dir.join("Shelf/photo.jpg").exists());
    assert_eq!(t.json("POST", "/api/files/import", Some(json!({ "dir": "", "path": "/definitely/not/here.md" }))).await.status, 404);
    assert_eq!(t.json("POST", "/api/files/import", Some(json!({ "dir": "", "path": t.reads_dir.join("Welcome.md").to_string_lossy() }))).await.status, 400);
}

#[tokio::test(flavor = "multi_thread")]
async fn searches_every_file_grouped_by_document() {
    let t = make_app();
    seed(&t);
    tree(&t).await;
    let res = t.get("/api/search/documents?q=walk").await;
    assert_eq!(res.status, 200, "{}", res.text);
    let arr = res.body.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["doc"]["title"], "Jane Eyre");
    assert_eq!(arr[0]["hits"].as_array().unwrap().len(), 1);
    assert_eq!(arr[0]["totalHits"], 1);
    let (a, b) = (arr[0]["hits"][0]["ranges"][0][0].as_u64().unwrap() as usize, arr[0]["hits"][0]["ranges"][0][1].as_u64().unwrap() as usize);
    let snippet: Vec<u16> = arr[0]["hits"][0]["snippet"].as_str().unwrap().encode_utf16().collect();
    assert_eq!(String::from_utf16_lossy(&snippet[a..b]).to_lowercase(), "walk");
    let res = t.get("/api/search/documents?q=villette").await.body;
    assert_eq!(res[0]["matched"], json!(["title"]));
    assert_eq!(res[0]["totalHits"], 1);
    let res = t.get("/api/search/documents?q=bront").await.body;
    assert_eq!(res.as_array().unwrap().len(), 1);
    assert_eq!(res[0]["doc"]["title"], "Villette");
    assert_eq!(res[0]["matched"], json!(["author"]));
    assert_eq!(t.get("/api/search/documents?q=").await.body, json!([]));
    assert_eq!(t.get("/api/search/documents?q=%22%2A").await.body, json!([]));
    assert_eq!(t.get("/api/search/documents?q=secret").await.body, json!([]));
}

#[tokio::test(flavor = "multi_thread")]
async fn follows_the_folder() {
    let t = make_app();
    seed(&t);
    tree(&t).await;
    let mut watcher = Watcher::start(t.app.clone(), WatcherOptions { debounce_ms: 40, grace_ms: 150, ..Default::default() });
    let seq_before = t.last_seq();
    std::fs::remove_file(t.reads_dir.join("Essays/of-studies.md")).unwrap();
    std::fs::create_dir(t.reads_dir.join("Poetry")).unwrap();
    let mut gone = false;
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(30)).await;
        gone = !titles(&t.get("/api/documents").await.body).contains(&"Of Studies".to_string());
        if gone {
            break;
        }
    }
    assert!(gone);
    let mut announced = false;
    for _ in 0..50 {
        announced = t.app.lock().events_since(seq_before, 1000).unwrap().iter().any(|e| e.kind == "tree.changed");
        if announced {
            break;
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    assert!(announced);
    // The file comes back: so does the document, with the same id.
    let docs = t.get("/api/documents").await.body;
    let villette = docs.as_array().unwrap().iter().find(|d| d["title"] == "Villette").unwrap()["id"].clone();
    std::fs::remove_file(t.reads_dir.join("Novels/Brontë/villette.md")).unwrap();
    for _ in 0..100 {
        if !t.get("/api/documents").await.body.as_array().unwrap().iter().any(|d| d["id"] == villette) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    t.write("Novels/Brontë/villette.md", "---\ntitle: Villette\nauthor: Charlotte Brontë\n---\n\n# Villette\n\nMy godmother lived in a handsome house.");
    let mut back = false;
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(30)).await;
        back = t.get("/api/documents").await.body.as_array().unwrap().iter().any(|d| d["id"] == villette);
        if back {
            break;
        }
    }
    assert!(back);
    watcher.close();
}

// ---- Folder sources (deprecated /sources) and search ----

fn library() -> std::path::PathBuf {
    let dir = temp_dir("pager-folder-");
    let w = |rel: &str, content: &[u8]| {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, content).unwrap();
    };
    w("one.md", b"# One\n\nThe caf\xc3\xa9 on the corner opened at dawn.");
    w("nested/two.txt", b"Two\n\nA plain text story about herons.");
    w("nested/deeper/three.html", b"<html><head><title>Three</title></head><body><p>An HTML page about rivers.</p></body></html>");
    w(".hidden/secret.md", b"# Secret\n\nnot to be read");
    w("node_modules/pkg/readme.md", b"# Package\n\nnot a book");
    w("photo.jpg", &[0xff, 0xd8, 0xff, 0x00]);
    w("broken.epub", b"this is not a zip");
    dir
}

#[tokio::test(flavor = "multi_thread")]
async fn scans_a_folder_source_as_a_job() {
    let t = make_app();
    let dir = library();
    let res = t.json("POST", "/api/sources", Some(json!({ "path": dir.to_string_lossy() }))).await;
    assert_eq!(res.status, 201, "{}", res.text);
    assert_eq!(res.body["source"]["kind"], "folder");
    assert_eq!(res.body["source"]["name"].as_str().unwrap(), dir.file_name().unwrap().to_string_lossy());
    let job = t.wait_job(res.body["job"]["id"].as_str().unwrap()).await;
    assert_eq!(job["status"], "done");
    assert_eq!(job["documentIds"].as_array().unwrap().len(), 3);
    let sid = res.body["source"]["id"].as_str().unwrap();
    let docs = t.get(&format!("/api/documents?sourceId={sid}&sort=title")).await.body;
    assert_eq!(titles(&docs), vec!["One", "Three", "Two"]);
    let src = &t.get("/api/sources").await.body[0];
    assert_eq!(src["status"], "ready");
    assert_eq!(src["documentCount"], 3);
    assert_eq!(src["error"], "1 file couldn't be read.");
    let again = t.json("POST", "/api/sources", Some(json!({ "path": dir.to_string_lossy() }))).await;
    assert_eq!(again.body["source"]["id"], res.body["source"]["id"]);
    t.wait_job(again.body["job"]["id"].as_str().unwrap()).await;
    assert_eq!(t.get("/api/documents").await.body.as_array().unwrap().len(), 3);
    // Removing the source takes documents out of the library, not off the disk.
    assert_eq!(t.json("DELETE", &format!("/api/sources/{sid}"), None).await.status, 204);
    assert_eq!(t.get("/api/documents").await.body, json!([]));
    assert!(dir.join("one.md").exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn adds_files_that_appear_in_a_watched_folder() {
    let t = make_app();
    let dir = library();
    let res = t.json("POST", "/api/sources", Some(json!({ "path": dir.to_string_lossy() }))).await;
    t.wait_job(res.body["job"]["id"].as_str().unwrap()).await;
    let mut watcher = Watcher::start(t.app.clone(), WatcherOptions { debounce_ms: 40, grace_ms: 200, ..Default::default() });
    std::fs::write(dir.join("nested/four.md"), "# Four\n\nArrived later.").unwrap();
    let mut found = false;
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(30)).await;
        found = titles(&t.get("/api/documents").await.body).contains(&"Four".to_string());
        if found {
            break;
        }
    }
    assert!(found);
    watcher.close();
}

async fn setup_search() -> (TestApp, std::path::PathBuf, Value) {
    let t = make_app();
    let dir = library();
    let res = t.json("POST", "/api/sources", Some(json!({ "path": dir.to_string_lossy() }))).await;
    t.wait_job(res.body["job"]["id"].as_str().unwrap()).await;
    let docs = t.get("/api/documents").await.body;
    (t, dir, docs)
}

fn doc_id(docs: &Value, title: &str) -> String {
    docs.as_array().unwrap().iter().find(|d| d["title"] == title).unwrap()["id"].as_str().unwrap().to_string()
}

#[tokio::test(flavor = "multi_thread")]
async fn finds_words_accent_insensitively_and_by_prefix() {
    let (t, _, docs) = setup_search().await;
    let hits = t.get("/api/search?q=cafe").await.body;
    assert_eq!(hits.as_array().unwrap().len(), 1);
    assert_eq!(hits[0]["docTitle"], "One");
    let (a, b) = (hits[0]["ranges"][0][0].as_u64().unwrap() as usize, hits[0]["ranges"][0][1].as_u64().unwrap() as usize);
    let snippet: Vec<u16> = hits[0]["snippet"].as_str().unwrap().encode_utf16().collect();
    assert_eq!(String::from_utf16_lossy(&snippet[a..b]), "café");
    let t2: Vec<String> = t.get("/api/search?q=hero").await.body.as_array().unwrap().iter().map(|h| h["docTitle"].as_str().unwrap().to_string()).collect();
    assert_eq!(t2, vec!["Two"]);
    let t3: Vec<String> = t.get("/api/search?q=page%20rivers").await.body.as_array().unwrap().iter().map(|h| h["docTitle"].as_str().unwrap().to_string()).collect();
    assert_eq!(t3, vec!["Three"]);
    assert_eq!(t.get("/api/search?q=secret").await.body, json!([]));
    assert_eq!(t.get("/api/search?q=%22%2A").await.status, 400);
    let two = doc_id(&docs, "Two");
    assert_eq!(t.get(&format!("/api/search?q=story&docId={two}")).await.body.as_array().unwrap().len(), 1);
    assert_eq!(t.get(&format!("/api/search?q=cafe&docId={two}")).await.body, json!([]));
}

#[tokio::test(flavor = "multi_thread")]
async fn search_follows_edits_and_deletions() {
    let (t, dir, docs) = setup_search().await;
    let one = doc_id(&docs, "One");
    let hit = t.get("/api/search?q=dawn").await.body[0].clone();
    let sec = t.get(&format!("/api/documents/{one}/sections/{}?include=blocks", hit["sectionId"].as_str().unwrap())).await.body;
    assert!(sec["blocks"].as_array().unwrap().iter().any(|b| b["id"] == hit["blockId"]));
    let file = dir.join("one.md");
    std::fs::write(&file, "# One\n\nThe café on the corner opened at dusk.").unwrap();
    touch_later(&file);
    t.get(&format!("/api/documents/{one}")).await;
    assert_eq!(t.get("/api/search?q=dawn").await.body, json!([]));
    assert_eq!(t.get("/api/search?q=dusk").await.body.as_array().unwrap().len(), 1);
    t.json("DELETE", &format!("/api/documents/{one}"), None).await;
    assert_eq!(t.get("/api/search?q=dusk").await.body, json!([]));
}

pub fn touch_later(file: &std::path::Path) {
    let later = std::time::SystemTime::now() + Duration::from_secs(5);
    let f = std::fs::OpenOptions::new().write(true).open(file).unwrap();
    f.set_modified(later).unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn searches_notes_and_highlighted_words() {
    let (t, _, docs) = setup_search().await;
    let two = doc_id(&docs, "Two");
    let d = t.get(&format!("/api/documents/{two}")).await.body;
    let sec = t.get(&format!("/api/documents/{two}/sections/{}?include=blocks", d["toc"][0]["id"].as_str().unwrap())).await.body;
    let b = sec["blocks"].as_array().unwrap().iter().find(|x| x["text"].as_str().map(|t| t.contains("herons")).unwrap_or(false)).unwrap();
    let a = t.json("POST", &format!("/api/documents/{two}/annotations"), Some(json!({ "range": { "start": { "blockId": b["id"], "offset": 0 }, "end": { "blockId": b["id"], "offset": 12 } }, "body": "Remember the egrets too.", "tags": ["birds"] }))).await;
    assert_eq!(a.status, 201, "{}", a.text);
    let hits = t.get("/api/search?q=egrets&in=annotations").await.body;
    assert_eq!(hits.as_array().unwrap().len(), 1);
    assert_eq!(hits[0]["annotationId"], a.body["id"]);
    assert_eq!(hits[0]["docId"], two);
    assert_eq!(hits[0]["blockId"], b["id"]);
    assert_eq!(t.get("/api/search?q=birds&in=annotations").await.body.as_array().unwrap().len(), 1);
    t.json("DELETE", &format!("/api/annotations/{}", a.body["id"].as_str().unwrap()), None).await;
    assert_eq!(t.get("/api/search?q=egrets&in=annotations").await.body, json!([]));
}

#[tokio::test(flavor = "multi_thread")]
async fn reading_a_book_is_not_a_change() {
    let t = make_app();
    seed(&t);
    tree(&t).await;
    let _watcher = Watcher::start(t.app.clone(), WatcherOptions { debounce_ms: 40, grace_ms: 150, ..Default::default() });
    let seq_before = t.last_seq();
    // Serving a book opens and reads its file; inotify reports those, a change they are not.
    for d in t.get("/api/documents").await.body.as_array().unwrap() {
        let id = d["id"].as_str().unwrap();
        let detail = t.get(&format!("/api/documents/{id}")).await.body;
        t.get(&format!("/api/documents/{id}/sections/{}", detail["toc"][0]["id"].as_str().unwrap())).await;
        std::fs::read(t.reads_dir.join(d["relPath"].as_str().unwrap())).unwrap();
    }
    tokio::time::sleep(Duration::from_millis(900)).await;
    let kinds: Vec<String> = t.app.lock().events_since(seq_before, 1000).unwrap().iter().map(|e| e.kind.clone()).collect();
    assert!(!kinds.iter().any(|k| k == "tree.changed" || k == "revision.created"), "{kinds:?}");
}
