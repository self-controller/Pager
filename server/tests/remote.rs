mod common;

use common::*;
use pager_server::clock::Clock;
use pager_server::http::remote::{redact_paths, remote_allows, REMOTE_ALLOW, REMOTE_DENY, REMOTE_REPLACED};
use serde_json::{json, Value};
use std::time::Duration;

const ORIGIN: &str = "https://fedora.tail1234.ts.net";
const DAY: i64 = 24 * 60 * 60 * 1000;
const NOVEL: &str = "# The Lighthouse\n\nThe keeper climbed the stairs at dusk, as he had every night for thirty years.\n\n## Morning\n\nBy morning the fog had lifted and the boats were out.\n";

struct Paired {
    token: String,
    device: Value,
    set_cookie: String,
}

async fn remote_setup(web: Option<std::path::PathBuf>, enable: bool) -> TestApp {
    let t = make_app_with(Clock::fake("2026-10-26T12:00:00Z"), web, None);
    if enable {
        let on = t.json("PATCH", "/api/settings/app", Some(json!({ "remote": { "enabled": true, "origin": ORIGIN } }))).await;
        assert_eq!(on.status, 200, "{}", on.text);
    }
    t
}

/// The whole pairing ceremony over HTTP: open on the desktop, ask from the phone, allow, collect.
async fn pair(t: &TestApp, name: &str) -> Paired {
    let w = t.json("POST", "/api/devices/pairing", None).await;
    assert_eq!(w.status, 201, "{}", w.text);
    let req = t.remote_call(Call::new("POST", "/api/pair").json(json!({ "code": w.body["code"], "name": name }))).await;
    assert_eq!(req.status, 201, "{}", req.text);
    let state = t.get("/api/devices/pairing").await.body;
    assert_eq!(state["pending"]["name"], name);
    let ok = t.json("POST", "/api/devices/pairing/approve", Some(json!({ "requestId": req.body["requestId"] }))).await;
    assert_eq!(ok.status, 201, "{}", ok.text);
    let done = t.remote_call(Call::new("POST", "/api/pair/poll").json(req.body.clone())).await;
    assert_eq!(done.status, 200, "{}", done.text);
    Paired { token: done.body["token"].as_str().unwrap().to_string(), device: done.body["device"].clone(), set_cookie: done.headers.get("set-cookie").map(|v| v.to_str().unwrap().to_string()).unwrap_or_default() }
}

async fn seed(t: &TestApp, files: &[(&str, &str)]) {
    for (rel, content) in files {
        t.write(rel, content);
    }
    assert_eq!(t.get("/api/tree").await.status, 200);
}

struct Lib {
    doc: Value,
    other: Value,
    section: Value,
    block: Value,
    annotation: Value,
    record: Value,
    preset: Value,
    asset: String,
}

async fn library(t: &TestApp) -> Lib {
    seed(t, &[("Novels/Classics/lighthouse.md", NOVEL), ("Welcome.md", "# Welcome\n\nHello.")]).await;
    let docs = t.get("/api/documents").await.body;
    let doc = docs.as_array().unwrap().iter().find(|d| d["relPath"] == "Novels/Classics/lighthouse.md").unwrap().clone();
    let other = docs.as_array().unwrap().iter().find(|d| d["relPath"] == "Welcome.md").unwrap().clone();
    let id = doc["id"].as_str().unwrap();
    let detail = t.get(&format!("/api/documents/{id}")).await.body;
    let section = t.get(&format!("/api/documents/{id}/sections/{}?include=blocks", detail["toc"][0]["id"].as_str().unwrap())).await.body;
    let block = section["blocks"].as_array().unwrap().iter().find(|b| b["text"].as_str().map(|s| s.starts_with("The keeper")).unwrap_or(false)).unwrap().clone();
    let annotation = t.json("POST", &format!("/api/documents/{id}/annotations"), Some(json!({ "revisionId": section["revisionId"], "range": { "start": { "blockId": block["id"], "offset": 4 }, "end": { "blockId": block["id"], "offset": 10 } }, "body": "Who keeps him?", "tags": ["sea"] }))).await.body;
    let record = t.json("POST", "/api/tools/lookup/records", Some(json!({ "docId": id, "data": { "word": "keeper" } }))).await.body;
    let preset = t.json("POST", "/api/presets", Some(json!({ "name": "Night", "values": { "theme": "dark" } }))).await.body;
    t.json("PUT", &format!("/api/documents/{id}/progress"), Some(json!({ "sectionId": section["id"], "offset": 0.5, "percent": 0.2, "reason": "jump" }))).await;
    let asset = t.app.lock().assets.put(&png_1px()).unwrap();
    Lib { doc, other, section, block, annotation, record, preset, asset }
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_without_a_credential_but_serves_health_and_the_shell() {
    let web = temp_dir("pager-web-");
    std::fs::write(web.join("index.html"), "<!doctype html><title>Pager</title>").unwrap();
    let t = remote_setup(Some(web), true).await;
    let none = t.remote_call(Call::get("/api/documents")).await;
    assert_eq!(none.status, 401);
    assert_eq!(none.body, json!({ "error": { "code": "unauthorized", "message": "Pair this phone with Pager to read your library." } }));
    assert_eq!(t.remote_call(Call::get("/api/stream")).await.status, 401);
    assert_eq!(t.remote_call(Call::get("/api/nothing-here")).await.status, 401);
    assert_eq!(t.remote_call(Call::get("/api/documents").token("made-up")).await.status, 401);
    assert_eq!(t.remote_call(Call::get("/api/documents").cookie("made-up")).await.status, 401);
    let shell = t.remote_call(Call::get("/read/abc")).await;
    assert_eq!(shell.status, 200);
    assert!(shell.text.contains("<title>Pager</title>"));
    assert_eq!(t.remote_call(Call::get("/pair")).await.status, 200);
    let health = t.remote_call(Call::get("/api/health")).await;
    assert_eq!(health.status, 200);
    assert_eq!(health.body["app"], "pager");
    assert_eq!(health.body["apiVersion"], 1);
    assert_eq!(health.body["remote"], Value::Null);
    assert!(health.body["version"].is_string());
}

#[tokio::test(flavor = "multi_thread")]
async fn answers_a_paired_device_by_cookie_or_bearer() {
    let t = remote_setup(None, true).await;
    let p = pair(&t, "David's iPhone").await;
    assert_eq!(p.set_cookie, format!("pager_device={}; Max-Age=7776000; Path=/; HttpOnly; Secure; SameSite=Strict", p.token));
    assert_eq!(t.remote_call(Call::get("/api/documents").token(&p.token)).await.status, 200);
    let by_cookie = t.remote_call(Call::get("/api/documents").cookie(&p.token)).await;
    assert_eq!(by_cookie.status, 200);
    assert_eq!(by_cookie.headers.get("set-cookie").unwrap().to_str().unwrap(), p.set_cookie);
    assert!(t.remote_call(Call::get("/api/documents").token(&p.token)).await.headers.get("set-cookie").is_none());
    let health = t.remote_call(Call::get("/api/health").cookie(&p.token)).await.body;
    assert_eq!(health["remote"], json!({ "device": { "id": p.device["id"], "name": "David's iPhone" } }));
    for k in ["pid", "port", "dataDir", "readsDir", "startedAt"] {
        assert!(health.get(k).is_none(), "{k}");
    }
    // An explicit Authorization header wins over the cookie, even a bad one.
    assert_eq!(t.remote_call(Call::get("/api/documents").cookie(&p.token).header("Authorization", "Basic eDp5")).await.status, 401);
    assert_eq!(t.remote_call(Call::get("/api/documents").cookie(&p.token).token("wrong")).await.status, 401);
}

#[tokio::test(flavor = "multi_thread")]
async fn revoked_and_expired_devices_are_refused() {
    let t = remote_setup(None, true).await;
    let a = pair(&t, "Old phone").await;
    let b = pair(&t, "New phone").await;
    assert_eq!(t.json("DELETE", &format!("/api/devices/{}", a.device["id"].as_str().unwrap()), None).await.status, 204);
    assert_eq!(t.remote_call(Call::get("/api/documents").token(&a.token)).await.status, 401);
    assert_eq!(t.remote_call(Call::get("/api/health").token(&a.token)).await.body["remote"], Value::Null);
    t.clock.advance(91 * DAY);
    assert_eq!(t.remote_call(Call::get("/api/documents").token(&b.token)).await.status, 401);
    let list: Vec<(Value, Value)> = t.get("/api/devices").await.body.as_array().unwrap().iter().map(|d| (d["name"].clone(), d["status"].clone())).collect();
    assert_eq!(list, vec![(json!("New phone"), json!("expired")), (json!("Old phone"), json!("revoked"))]);
}

#[tokio::test(flavor = "multi_thread")]
async fn csrf_for_cookie_changes() {
    let t = remote_setup(None, true).await;
    let p = pair(&t, "iPhone").await;
    seed(&t, &[("a.md", "# A\n\nText.")]).await;
    let doc = t.get("/api/documents").await.body[0].clone();
    let path = format!("/api/documents/{}", doc["id"].as_str().unwrap());
    fn evil(c: Call<'_>) -> Call<'_> {
        c.header("Origin", "https://evil.example").header("Sec-Fetch-Site", "cross-site")
    }
    async fn save(t: &TestApp, c: Call<'_>) -> Answer {
        t.remote_call(c.json(json!({ "saved": true }))).await
    }
    let r = save(&t, evil(Call::new("PATCH", &path).cookie(&p.token))).await;
    assert_eq!(r.status, 403);
    assert_eq!(r.body["error"]["code"], "forbidden");
    assert_eq!(save(&t, Call::new("PATCH", &path).cookie(&p.token)).await.status, 403);
    assert_eq!(save(&t, Call::new("PATCH", &path).cookie(&p.token).header("Sec-Fetch-Site", "same-site").header("Origin", "https://other.tail1234.ts.net")).await.status, 403);
    assert_eq!(save(&t, Call::new("PATCH", &path).cookie(&p.token).header("Sec-Fetch-Site", "cross-site").header("Origin", ORIGIN)).await.status, 403);
    assert_eq!(save(&t, Call::new("PATCH", &path).cookie(&p.token).header("Origin", "https://evil.example")).await.status, 403);
    assert_eq!(save(&t, Call::new("PATCH", &path).cookie(&p.token).header("Sec-Fetch-Site", "same-origin")).await.status, 200);
    assert_eq!(save(&t, Call::new("PATCH", &path).cookie(&p.token).header("Origin", ORIGIN)).await.status, 200);
    assert_eq!(save(&t, evil(Call::new("PATCH", &path).token(&p.token))).await.status, 200);
    assert_eq!(t.remote_call(Call::get(&path).cookie(&p.token)).await.status, 200);
    assert_eq!(t.get(&path).await.body["saved"], true);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_allowlist_classifies_every_route() {
    let t = remote_setup(None, true).await;
    let registered = pager_server::http::api_route_names(&t.app);
    let known: Vec<&str> = REMOTE_ALLOW.iter().chain(REMOTE_DENY).chain(REMOTE_REPLACED).copied().collect();
    let unknown: Vec<&String> = registered.iter().filter(|r| !known.contains(&r.as_str())).collect();
    assert_eq!(unknown, Vec::<&String>::new(), "a route added later must be put in REMOTE_ALLOW or REMOTE_DENY on purpose");
    let missing: Vec<&&str> = known.iter().filter(|k| !registered.contains(&k.to_string())).collect();
    assert_eq!(missing, Vec::<&&str>::new(), "the lists name only routes that exist");
    assert!(REMOTE_ALLOW.iter().all(|r| !REMOTE_DENY.contains(r)));
    assert!(!registered.iter().any(|r| r.contains("/devices")));
    // Device routes exist on the local listener only.
    assert_eq!(t.json("POST", "/api/devices/pairing", None).await.status, 201);
    assert!(remote_allows("GET", "/documents/abc"));
    assert!(remote_allows("HEAD", "/documents/abc"));
    assert!(!remote_allows("GET", "/documents/abc/export"));
    assert!(!remote_allows("GET", "/documents/"));
    assert!(!remote_allows("GET", "//documents"));
    assert!(!remote_allows("GET", "/documents/a/../../export"));
    assert!(!remote_allows("DELETE", "/documents/abc"));
    assert!(!remote_allows("POST", "/documents"));
    assert!(!remote_allows("OPTIONS", "/documents"));
    assert!(!remote_allows("GET", "/Documents"));
}

#[tokio::test(flavor = "multi_thread")]
async fn denied_routes_are_refused_before_their_handlers() {
    let t = remote_setup(None, true).await;
    let p = pair(&t, "iPhone").await;
    let lib = library(&t).await;
    let outside = write_temp("outside.md", b"# Outside\n\nNot in the reads folder.");
    let mirror_dir = temp_dir("pager-x-").join("vault");
    let source_id = t.get("/api/sources").await.body[0]["id"].as_str().unwrap().to_string();
    t.json("POST", "/api/events", Some(json!([{ "type": "nav.toc_used", "docId": lib.doc["id"] }]))).await;
    let tables = ["sources", "documents", "revisions", "anchors", "annotations", "tool_records", "progress", "settings", "presets", "events", "devices", "import_queue"];
    let snapshot = |t: &TestApp| -> Vec<i64> { tables.iter().map(|n| t.db_count(&format!("SELECT COUNT(*) FROM {n}"))).collect() };
    let files = |t: &TestApp| -> Vec<String> {
        let mut v = Vec::new();
        fn walk(d: &std::path::Path, v: &mut Vec<String>) {
            for e in std::fs::read_dir(d).unwrap() {
                let e = e.unwrap();
                v.push(e.path().to_string_lossy().into_owned());
                if e.path().is_dir() {
                    walk(&e.path(), v);
                }
            }
        }
        walk(&t.reads_dir, &mut v);
        v.sort();
        v
    };
    let before = (snapshot(&t), files(&t), t.db_count("SELECT COUNT(*) FROM events"));
    let shutdowns_before = t.app.lock().events_since(0, 100000).unwrap().len();
    let mut bodies: std::collections::HashMap<&str, Value> = std::collections::HashMap::new();
    bodies.insert("PATCH /settings/app", json!({ "mirror": { "dir": mirror_dir.to_string_lossy() }, "remote": { "enabled": false } }));
    bodies.insert("POST /presets", json!({ "name": "Evil", "values": {} }));
    bodies.insert("PATCH /presets/:pid", json!({ "name": "Evil" }));
    bodies.insert("POST /sources", json!({ "path": outside.to_string_lossy() }));
    bodies.insert("POST /uploads", json!({}));
    bodies.insert("POST /files", json!({ "dir": "", "title": "Evil" }));
    bodies.insert("POST /folders", json!({ "dir": "", "name": "Evil" }));
    bodies.insert("POST /files/move", json!({ "from": "Welcome.md", "to": "Moved.md" }));
    bodies.insert("POST /files/import", json!({ "dir": "", "path": outside.to_string_lossy() }));
    bodies.insert("POST /documents/:id/merge", json!({ "intoId": lib.other["id"] }));
    bodies.insert("POST /import", json!({ "format": "pager-export", "version": 1, "documents": [], "annotations": [], "records": [], "progress": [], "presets": [], "settings": {} }));
    let queries = |route: &str| match route {
        "DELETE /files" => "?path=Welcome.md",
        "DELETE /events" => "?category=all",
        "GET /documents/:id/export" => "?format=json",
        _ => "",
    };
    for route in REMOTE_DENY {
        let (method, pattern) = route.split_once(' ').unwrap();
        let path = pattern.replace(":id", if route.contains("/sources/") { &source_id } else { lib.doc["id"].as_str().unwrap() }).replace(":pid", lib.preset["id"].as_str().unwrap());
        let url = format!("/api{path}{}", queries(route));
        let mut c = Call::new(method, &url).token(&p.token);
        if let Some(b) = bodies.get(route) {
            c = c.json(b.clone());
        }
        let res = t.remote_call(c).await;
        assert_eq!((route, res.status, res.body.clone()), (route, 403, json!({ "error": { "code": "forbidden", "message": "That isn't available from a phone." } })));
    }
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(snapshot(&t), before.0);
    assert_eq!(files(&t), before.1);
    assert_eq!(t.db_count("SELECT COUNT(*) FROM events"), before.2);
    assert_eq!(t.app.lock().events_since(0, 100000).unwrap().len(), shutdowns_before);
    assert!(!mirror_dir.exists());
    for pth in ["/api//shutdown", "/api/documents/", &format!("/api/documents/{}/", lib.doc["id"].as_str().unwrap()), "/api/devices", "/api/devices/pairing", "/api"] {
        assert_eq!((pth, t.remote_call(Call::get(pth).token(&p.token)).await.status), (pth, 403));
    }
    assert_eq!(t.remote_call(Call::new("POST", "/api/devices/pairing").token(&p.token)).await.status, 403);
    assert_eq!(t.remote_call(Call::new("POST", "/api/shutdown").cookie(&p.token).header("Sec-Fetch-Site", "same-origin")).await.status, 403);
}

#[tokio::test(flavor = "multi_thread")]
async fn no_path_on_this_computer_leaves_it() {
    let t = remote_setup(None, true).await;
    let lib = library(&t).await;
    let mirror_dir = temp_dir("pager-vault-").join("Obsidian Vault");
    assert_eq!(t.json("PATCH", "/api/settings/app", Some(json!({ "mirror": { "dir": mirror_dir.to_string_lossy() } }))).await.status, 200);
    let outside = write_temp("elsewhere.md", b"# Elsewhere\n\nA file outside the reads folder.");
    assert_eq!(t.json("POST", "/api/sources", Some(json!({ "path": outside.to_string_lossy() }))).await.status, 201);
    let locked = t.reads_dir.join("Novels/locked.md");
    std::fs::write(&locked, "# Locked").unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
    let p = pair(&t, "iPhone").await;
    let did = lib.doc["id"].as_str().unwrap();
    let sid = lib.section["id"].as_str().unwrap();
    let urls: Vec<(&str, Vec<String>)> = vec![
        ("GET /documents", vec!["/documents".into(), "/documents?sort=title".into(), "/documents?history=true".into()]),
        ("GET /documents/:id", vec![format!("/documents/{did}")]),
        ("GET /documents/:id/sections/:sid", vec![format!("/documents/{did}/sections/{sid}?include=blocks,annotations")]),
        ("GET /documents/:id/locate", vec![format!("/documents/{did}/locate?blockId={}", lib.block["id"].as_str().unwrap())]),
        ("GET /documents/:id/history", vec![format!("/documents/{did}/history")]),
        ("GET /documents/:id/sessions", vec![format!("/documents/{did}/sessions")]),
        ("GET /documents/:id/annotations", vec![format!("/documents/{did}/annotations?include=deleted")]),
        ("GET /annotations/:aid", vec![format!("/annotations/{}", lib.annotation["id"].as_str().unwrap())]),
        ("GET /annotations", vec!["/annotations".into()]),
        ("GET /highlights", vec!["/highlights".into()]),
        ("GET /tags", vec!["/tags".into()]),
        ("GET /tools/:tool/records", vec![format!("/tools/lookup/records?docId={did}")]),
        ("GET /tools/:tool/records/:rid", vec![format!("/tools/lookup/records/{}", lib.record["id"].as_str().unwrap())]),
        ("GET /search", vec!["/search?q=keeper".into(), "/search?q=keeps&in=annotations".into()]),
        ("GET /search/documents", vec!["/search/documents?q=lighthouse".into(), "/search/documents?q=elsewhere".into()]),
        ("GET /settings", vec!["/settings".into(), format!("/settings?docId={did}")]),
        ("GET /presets", vec!["/presets".into()]),
        ("GET /stream", vec!["/stream?after=0".into()]),
        ("GET /assets/:file", vec![format!("/assets/{}", lib.asset)]),
        ("GET /tree", vec!["/tree".into()]),
        ("GET /sync/manifest", vec!["/sync/manifest".into(), "/sync/manifest?after=0".into()]),
    ];
    let mut covered: Vec<&str> = urls.iter().map(|(r, _)| *r).collect();
    covered.sort();
    let mut gets: Vec<&str> = REMOTE_ALLOW.iter().copied().filter(|r| r.starts_with("GET ")).collect();
    gets.sort();
    assert_eq!(covered, gets, "every allowed GET route is checked here; a new one has to be added");
    let home = std::env::var("HOME").unwrap();
    let forbidden: Vec<String> = vec![t.data_dir.to_string_lossy().into_owned(), t.reads_dir.to_string_lossy().into_owned(), t.app.lock().reads_root.clone().unwrap().to_string_lossy().into_owned(), mirror_dir.to_string_lossy().into_owned(), outside.parent().unwrap().to_string_lossy().into_owned(), home, "/home/".into()];
    let mut bodies: Vec<String> = Vec::new();
    for (route, list) in &urls {
        for u in list {
            if *route == "GET /stream" {
                let res = t.stream(&t.remote, "127.0.0.1:3007", Call::get(&format!("/api{u}")).token(&p.token)).await;
                assert_eq!(res.status(), 200);
                let (text, _) = read_stream(res, 600, None).await;
                assert!(sse_types(&text).contains(&"document.added".to_string()));
                assert!(sse_types(&text).iter().all(|x| !x.starts_with("source.")));
                bodies.push(text);
                continue;
            }
            let res = t.remote_call(Call::get(&format!("/api{u}")).token(&p.token)).await;
            assert_eq!((u.as_str(), res.status), (u.as_str(), 200), "{}", res.text);
            bodies.push(res.text);
        }
    }
    bodies.push(t.remote_call(Call::get("/api/health").token(&p.token)).await.text);
    for body in &bodies {
        for f in &forbidden {
            assert!(!body.contains(f.as_str()), "{f} leaked in {body}");
        }
    }
    // What changed, so the absence above means something: the local listener does send these.
    assert!(t.get(&format!("/api/documents/{did}")).await.body["path"].as_str().unwrap().contains(&*t.reads_dir.to_string_lossy()));
    assert_eq!(t.get("/api/settings").await.body["app"]["mirror"]["dir"], mirror_dir.to_string_lossy().as_ref());
    let tree = t.remote_call(Call::get("/api/tree").token(&p.token)).await.body;
    let novels = tree["root"]["folders"].as_array().unwrap().iter().find(|f| f["name"] == "Novels").unwrap();
    let locked_file = novels["files"].as_array().unwrap().iter().find(|f| f["name"] == "locked.md").unwrap();
    if unsafe { libc_getuid() } != 0 {
        assert_eq!(locked_file["error"], "EACCES: permission denied, open 'locked.md'");
    }
    let detail = t.remote_call(Call::get(&format!("/api/documents/{did}")).token(&p.token)).await.body;
    assert!(detail.get("path").is_none());
    assert_eq!(detail["relPath"], "Novels/Classics/lighthouse.md");
    let settings = t.remote_call(Call::get("/api/settings").token(&p.token)).await.body;
    assert!(settings.get("app").is_none());
    let patched = t.remote_call(Call::new("PATCH", "/api/settings/global").token(&p.token).json(json!({ "theme": "sepia" }))).await;
    assert_eq!(patched.status, 200);
    assert!(patched.body.get("app").is_none());
    assert_eq!(patched.body["global"], json!({ "theme": "sepia" }));
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o644)).unwrap();
}

extern "C" {
    #[link_name = "getuid"]
    fn libc_getuid() -> u32;
}

#[test]
fn takes_paths_out_of_messages() {
    assert_eq!(redact_paths("EACCES: permission denied, open '/home/david/reads/Novels/locked.md'"), "EACCES: permission denied, open 'locked.md'");
    assert_eq!(redact_paths("Something went wrong (ENOENT /tmp/x/y.json)"), "Something went wrong (ENOENT y.json)");
    assert_eq!(redact_paths("That isn't available from a phone."), "That isn't available from a phone.");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_remote_stream_leaves_out_sources_and_closes_on_revoke() {
    let t = remote_setup(None, true).await;
    let p = pair(&t, "iPhone").await;
    let res = t.stream(&t.remote, "127.0.0.1:3007", Call::get("/api/stream").token(&p.token)).await;
    assert_eq!(res.status(), 200);
    let reading = tokio::spawn(read_stream(res, 3000, Some(|text: &str| text.contains("tree.changed"))));
    t.json("POST", "/api/sources", Some(json!({ "path": write_temp("x.md", b"# X\n\nText.").to_string_lossy() }))).await;
    t.json("POST", "/api/files", Some(json!({ "dir": "", "title": "Fresh" }))).await;
    let (text, _) = reading.await.unwrap();
    assert!(sse_types(&text).contains(&"tree.changed".to_string()));
    assert!(!sse_types(&text).contains(&"source.added".to_string()));
    let (local, _) = read_stream(t.stream(&t.local, "localhost:3006", Call::get("/api/stream?after=0")).await, 500, None).await;
    assert!(sse_types(&local).contains(&"source.added".to_string()));

    let live = t.stream(&t.remote, "127.0.0.1:3007", Call::get("/api/stream").token(&p.token)).await;
    let closing = tokio::spawn(read_stream(live, 3000, None));
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(t.json("DELETE", &format!("/api/devices/{}", p.device["id"].as_str().unwrap()), None).await.status, 204);
    let (_, ended) = closing.await.unwrap();
    assert!(ended);
    assert_eq!(t.remote_call(Call::get("/api/stream").token(&p.token)).await.status, 401);

    // Closing the remote listener ends device streams and leaves the desktop's open.
    let p2 = pair(&t, "Other").await;
    let phone = tokio::spawn(read_stream(t.stream(&t.remote, "127.0.0.1:3007", Call::get("/api/stream").token(&p2.token)).await, 3000, None));
    let desk = tokio::spawn(read_stream(t.stream(&t.local, "localhost:3006", Call::get("/api/stream")).await, 400, None));
    tokio::time::sleep(Duration::from_millis(50)).await;
    t.app.notify(pager_server::core::Notice::RemoteClosing);
    assert!(phone.await.unwrap().1);
    assert!(!desk.await.unwrap().1);
}

// ---- Remote access settings and pairing over HTTP ----

#[tokio::test(flavor = "multi_thread")]
async fn remote_access_is_off_by_default_and_needs_an_origin() {
    let t = remote_setup(None, false).await;
    assert_eq!(t.get("/api/settings").await.body["app"]["remote"], json!({ "enabled": false, "origin": null, "relay": null }));
    let refused = t.json("PATCH", "/api/settings/app", Some(json!({ "remote": { "enabled": true } }))).await;
    assert_eq!(refused.status, 400);
    assert_eq!(refused.body["error"]["message"], "Set the address your phone will use (remote.origin) before turning on remote access.");
    for origin in ["http://fedora.tail1234.ts.net", "https://fedora.tail1234.ts.net/pair", "https://fedora.tail1234.ts.net/?x=1", "not a url", ""] {
        assert_eq!((origin, t.json("PATCH", "/api/settings/app", Some(json!({ "remote": { "origin": origin } }))).await.status), (origin, 400));
    }
    let on = t.json("PATCH", "/api/settings/app", Some(json!({ "remote": { "enabled": true, "origin": format!("{}/", ORIGIN.to_uppercase()) } }))).await;
    assert_eq!(on.body["app"]["remote"], json!({ "enabled": true, "origin": ORIGIN, "relay": null }));
    assert_eq!(t.json("PATCH", "/api/settings/app", Some(json!({ "remote": { "origin": "http://localhost:3007" } }))).await.status, 200);
    assert_eq!(t.json("PATCH", "/api/settings/app", Some(json!({ "remote": { "origin": null } }))).await.status, 400);
    assert_eq!(t.json("PATCH", "/api/settings/app", Some(json!({ "remote": { "enabled": false, "origin": null } }))).await.body["app"]["remote"], json!({ "enabled": false, "origin": null, "relay": null }));
    // The tailnet origin is suggested in local health when Tailscale knows one.
    let s = make_app_with(Clock::fake("2026-10-26T12:00:00Z"), None, Some("https://fedora.tail1234.ts.net".into()));
    assert_eq!(s.get("/api/health").await.body["remote"], json!({ "suggestedOrigin": "https://fedora.tail1234.ts.net" }));
    let none = make_app();
    let h = none.get("/api/health").await.body;
    assert!(h.get("remote").is_none());
    assert_eq!(h["app"], "pager");
    assert_eq!(h["dataDir"], none.data_dir.to_string_lossy().as_ref());
    assert_eq!(h["pid"], std::process::id());
}

#[tokio::test(flavor = "multi_thread")]
async fn pairing_over_http() {
    let off = remote_setup(None, false).await;
    assert_eq!(off.json("POST", "/api/devices/pairing", None).await.status, 400);
    let t = remote_setup(None, true).await;
    assert_eq!(t.remote_call(Call::new("POST", "/api/pair").json(json!({ "code": "BBBB-BBBB", "name": "x" }))).await.status, 404);
    let w = t.json("POST", "/api/devices/pairing", None).await;
    assert_eq!(w.status, 201);
    assert_eq!(w.body["url"], format!("{ORIGIN}/pair#code={}", w.body["code"].as_str().unwrap()));
    assert_eq!(w.body["expiresAt"], "2026-10-26T12:05:00.000Z");
    assert_eq!(t.json("POST", "/api/devices/pairing", None).await.status, 409);
    assert_eq!(t.get("/api/devices/pairing").await.body, json!({ "open": true, "code": w.body["code"], "url": w.body["url"], "expiresAt": w.body["expiresAt"], "attempts": 0, "pending": null }));
    assert_eq!(t.json("DELETE", "/api/devices/pairing", None).await.status, 204);
    assert_eq!(t.get("/api/devices/pairing").await.body["open"], false);

    // request, pending polls, approval on the desktop, then the credential exactly once
    let w = t.json("POST", "/api/devices/pairing", None).await.body;
    let req = t.remote_call(Call::new("POST", "/api/pair").json(json!({ "code": w["code"].as_str().unwrap().to_lowercase(), "name": "  David's iPhone " })).header("X-Forwarded-For", "100.101.102.103, 127.0.0.1")).await;
    assert_eq!(req.status, 201, "{}", req.text);
    assert_eq!(t.remote_call(Call::new("POST", "/api/pair/poll").json(req.body.clone())).await.status, 202);
    assert_eq!(t.remote_call(Call::new("POST", "/api/pair/poll").json(req.body.clone())).await.body, json!({ "status": "pending" }));
    assert_eq!(t.get("/api/devices/pairing").await.body["pending"], json!({ "requestId": req.body["requestId"], "name": "David's iPhone", "ip": "100.101.102.103", "at": "2026-10-26T12:00:00.000Z" }));
    let approved = t.json("POST", "/api/devices/pairing/approve", Some(json!({ "requestId": req.body["requestId"] }))).await;
    assert_eq!(approved.status, 201);
    assert_eq!(approved.body["name"], "David's iPhone");
    assert_eq!(approved.body["status"], "active");
    assert_eq!(approved.body["lastIp"], "100.101.102.103");
    let done = t.remote_call(Call::new("POST", "/api/pair/poll").json(req.body.clone())).await;
    assert_eq!(done.status, 200);
    assert_eq!(done.body["device"], json!({ "id": approved.body["id"], "name": "David's iPhone" }));
    assert_eq!(done.headers.get("set-cookie").unwrap().to_str().unwrap(), format!("pager_device={}; Max-Age=7776000; Path=/; HttpOnly; Secure; SameSite=Strict", done.body["token"].as_str().unwrap()));
    assert_eq!(t.remote_call(Call::new("POST", "/api/pair/poll").json(req.body.clone())).await.status, 410);
    let token = done.body["token"].as_str().unwrap().to_string();
    assert_eq!(t.remote_call(Call::get("/api/documents").cookie(&token)).await.status, 200);
    assert_eq!(t.remote_call(Call::get("/api/documents").token(&token)).await.status, 200);
    assert_eq!(t.get("/api/devices").await.body.as_array().unwrap().iter().map(|d| d["name"].clone()).collect::<Vec<_>>(), vec![json!("David's iPhone")]);
}

#[tokio::test(flavor = "multi_thread")]
async fn pairing_limits_and_denials() {
    // five wrong codes: the sixth try is gone
    let t = remote_setup(None, true).await;
    let w = t.json("POST", "/api/devices/pairing", None).await.body;
    let wrong = if w["code"] == "BBBB-BBBB" { "CCCC-CCCC" } else { "BBBB-BBBB" };
    let mut statuses = Vec::new();
    for i in 0..6 {
        let code = if i == 5 { w["code"].as_str().unwrap().to_string() } else { wrong.to_string() };
        statuses.push(t.remote_call(Call::new("POST", "/api/pair").json(json!({ "code": code, "name": "Guesser" }))).await.status);
    }
    assert_eq!(statuses, vec![400, 400, 400, 400, 400, 410]);
    assert_eq!(t.get("/api/devices/pairing").await.body, json!({ "open": false, "attempts": 5, "pending": null }));
    assert_eq!(t.json("POST", "/api/devices/pairing", None).await.status, 201);

    // expires after five minutes
    let t = remote_setup(None, true).await;
    let w = t.json("POST", "/api/devices/pairing", None).await.body;
    let req = t.remote_call(Call::new("POST", "/api/pair").json(json!({ "code": w["code"], "name": "iPhone" }))).await.body;
    t.clock.advance(5 * 60_000);
    assert_eq!(t.remote_call(Call::new("POST", "/api/pair/poll").json(req.clone())).await.status, 410);
    assert_eq!(t.json("POST", "/api/devices/pairing/approve", Some(json!({ "requestId": req["requestId"] }))).await.status, 404);

    // denies one phone and lets the next one try with the same code
    let t = remote_setup(None, true).await;
    let w = t.json("POST", "/api/devices/pairing", None).await.body;
    let stranger = t.remote_call(Call::new("POST", "/api/pair").json(json!({ "code": w["code"], "name": "Stranger" }))).await.body;
    assert_eq!(t.remote_call(Call::new("POST", "/api/pair").json(json!({ "code": w["code"], "name": "Mine" }))).await.status, 410);
    let mut bad = stranger.clone();
    bad["pollSecret"] = json!("nope");
    assert_eq!(t.remote_call(Call::new("POST", "/api/pair/poll").json(bad)).await.status, 410);
    assert_eq!(t.json("POST", "/api/devices/pairing/deny", Some(json!({ "requestId": stranger["requestId"] }))).await.status, 204);
    assert_eq!(t.remote_call(Call::new("POST", "/api/pair/poll").json(stranger.clone())).await.status, 410);
    assert_eq!(t.get("/api/devices/pairing").await.body["open"], true);
    let mine = t.remote_call(Call::new("POST", "/api/pair").json(json!({ "code": w["code"], "name": "Mine" }))).await.body;
    assert_eq!(t.json("POST", "/api/devices/pairing/approve", Some(json!({ "requestId": mine["requestId"] }))).await.status, 201);
    assert_eq!(t.remote_call(Call::new("POST", "/api/pair/poll").json(mine)).await.status, 200);

    // refuses pairing requests sent from another site; a bad name doesn't count as a wrong code
    let t = remote_setup(None, true).await;
    let w = t.json("POST", "/api/devices/pairing", None).await.body;
    assert_eq!(t.remote_call(Call::new("POST", "/api/pair").json(json!({ "code": "BBBB-BBBB", "name": "x" })).header("Sec-Fetch-Site", "cross-site")).await.status, 403);
    assert_eq!(t.remote_call(Call::new("POST", "/api/pair").json(json!({ "code": "BBBB-BBBB", "name": "x" })).header("Origin", "https://evil.example")).await.status, 403);
    assert_eq!(t.get("/api/devices/pairing").await.body["attempts"], 0);
    assert_eq!(t.remote_call(Call::new("POST", "/api/pair").json(json!({ "code": w["code"], "name": "   " }))).await.status, 400);
    assert_eq!(t.remote_call(Call::new("POST", "/api/pair").json(json!({ "code": w["code"], "name": "x".repeat(65) }))).await.status, 400);
    assert_eq!(t.remote_call(Call::new("POST", "/api/pair").json(json!({ "code": w["code"] }))).await.status, 400);
    assert_eq!(t.get("/api/devices/pairing").await.body["attempts"], 0);
    assert_eq!(t.remote_call(Call::new("POST", "/api/pair").json(json!({ "code": w["code"], "name": "Mine" })).header("Sec-Fetch-Site", "same-origin").header("Origin", ORIGIN)).await.status, 201);
}

#[tokio::test(flavor = "multi_thread")]
async fn renames_and_revokes_from_the_desktop() {
    let t = remote_setup(None, true).await;
    let p = pair(&t, "iPhone").await;
    let id = p.device["id"].as_str().unwrap();
    let renamed = t.json("PATCH", &format!("/api/devices/{id}"), Some(json!({ "name": "Reading phone" }))).await;
    assert_eq!(renamed.body["name"], "Reading phone");
    assert_eq!(renamed.body["status"], "active");
    assert_eq!(t.json("PATCH", &format!("/api/devices/{id}"), Some(json!({ "name": "" }))).await.status, 400);
    assert_eq!(t.json("DELETE", &format!("/api/devices/{id}"), None).await.status, 204);
    assert_eq!(t.remote_call(Call::get("/api/documents").token(&p.token)).await.status, 401);
    let list = t.get("/api/devices").await.body;
    assert_eq!(list[0]["name"], "Reading phone");
    assert_eq!(list[0]["status"], "revoked");
    assert_eq!(t.json("DELETE", &format!("/api/devices/{id}"), None).await.status, 204);
    assert_eq!(t.get("/api/devices").await.body, json!([]));
    assert_eq!(t.json("DELETE", &format!("/api/devices/{id}"), None).await.status, 404);
    let (desk, _) = read_stream(t.stream(&t.local, "localhost:3006", Call::get("/api/stream?after=0")).await, 400, None).await;
    let devs: Vec<String> = sse_types(&desk).into_iter().filter(|x| x.starts_with("device.")).collect();
    assert_eq!(devs, vec!["device.paired", "device.renamed", "device.revoked", "device.removed"]);
    // Device management stays on this computer: the Host guard applies to it.
    assert_eq!(t.call(Call::get("/api/devices").header("Host", "fedora.tail1234.ts.net")).await.status, 403);
    assert_eq!(t.call(Call::new("POST", "/api/devices/pairing").header("Origin", "https://evil.example")).await.status, 403);
}

#[tokio::test(flavor = "multi_thread")]
async fn device_service_details() {
    let t = remote_setup(None, false).await;
    let (device, token) = t.app.lock().device_create("  David's iPhone  ", Some("100.64.0.2"), None).unwrap();
    assert_eq!(token.len(), 43);
    assert!(token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'));
    assert_eq!(device.name, "David's iPhone");
    assert_eq!(device.status, "active");
    assert_eq!(device.last_ip.as_deref(), Some("100.64.0.2"));
    assert_eq!(device.created_at, "2026-10-26T12:00:00.000Z");
    let hash: String = t.app.lock().one("SELECT token_hash FROM devices WHERE id = ?1", &[&device.id], |r| r.get(0)).unwrap().unwrap();
    assert_eq!(hash, pager_server::ids::sha256_hex(token.as_bytes()));
    assert!(t.app.lock().device_create("   ", None, None).is_err());
    assert!(t.app.lock().device_create(&"x".repeat(65), None, None).is_err());
    // last_seen_at is written at most once a minute
    t.clock.advance(30_000);
    t.app.lock().device_authenticate(&token, Some("100.64.0.9"), None).unwrap();
    assert_eq!(t.app.lock().device_get(&device.id).unwrap().last_seen_at, "2026-10-26T12:00:00.000Z");
    t.clock.advance(31_000);
    t.app.lock().device_authenticate(&token, Some("100.64.0.9"), None).unwrap();
    let d = t.app.lock().device_get(&device.id).unwrap();
    assert_eq!(d.last_seen_at, "2026-10-26T12:01:01.000Z");
    assert_eq!(d.last_ip.as_deref(), Some("100.64.0.9"));
    // expires after 90 idle days, kept listed
    t.clock.advance(89 * DAY);
    assert!(t.app.lock().device_authenticate(&token, None, None).unwrap().is_some());
    t.clock.advance(89 * DAY);
    assert!(t.app.lock().device_authenticate(&token, None, None).unwrap().is_some());
    t.clock.advance(91 * DAY);
    assert!(t.app.lock().device_authenticate(&token, None, None).unwrap().is_none());
    assert_eq!(t.app.lock().device_list().unwrap()[0].status, "expired");
    assert!(t.app.lock().device_authenticate(&format!("{token}x"), None, None).unwrap().is_none());
    assert!(t.app.lock().device_authenticate("", None, None).unwrap().is_none());
    assert!(pager_server::ids::same_hash(&pager_server::ids::sha256_hex(b"a"), &pager_server::ids::sha256_hex(b"a")));
    assert!(!pager_server::ids::same_hash(&pager_server::ids::sha256_hex(b"a"), "abcd"));
    assert!(!pager_server::ids::same_hash("", ""));
}
