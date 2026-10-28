//! Live reload for files people edit (Markdown, text, HTML, Word). Watches each file's parent
//! directory, since atomic saves replace the file (and its inode). On a settled change it asks the
//! library to refresh the document, which re-parses, re-anchors and announces the new revision.
//! Folder sources are watched recursively: files are added as they appear, dropped as they vanish.
//! The watcher is a convenience: GET /documents/:id checks freshness too, so a missed event heals.

use super::folders::{is_readable, list_readable};
use crate::app::App;
use crate::core::Notice;
use crate::journal::Emit;
use notify::{RecursiveMode, Watcher as _};
use rusqlite::params;
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug)]
pub struct WatcherOptions {
    /// Wait this long after the last change event before reading (editors write in bursts).
    pub debounce_ms: u64,
    /// A file that vanishes (atomic save) or empties is only believed after this long.
    pub grace_ms: u64,
    /// Watch documents opened or added within this many days.
    pub recent_days: i64,
    pub max_dirs: usize,
}

impl Default for WatcherOptions {
    fn default() -> Self {
        WatcherOptions { debounce_ms: 300, grace_ms: 2000, recent_days: 30, max_dirs: 256 }
    }
}

enum Msg {
    Fs(notify::Result<notify::Event>),
    Notice(Notice),
    Close,
}

#[derive(Clone)]
enum Pending {
    Doc { full: PathBuf, doc_id: String },
    Folder { full: PathBuf, source_id: String },
    Announce,
}

struct State {
    dirs: HashMap<PathBuf, HashMap<String, String>>,
    folders: HashMap<PathBuf, String>,
    timers: HashMap<String, (Instant, Pending)>,
}

pub struct Watcher {
    tx: mpsc::Sender<Msg>,
    closed: Arc<AtomicBool>,
    dirs: Arc<Mutex<Vec<PathBuf>>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Watcher {
    pub fn start(app: Arc<App>, o: WatcherOptions) -> Watcher {
        let (tx, rx) = mpsc::channel::<Msg>();
        let closed = Arc::new(AtomicBool::new(false));
        let dirs_out = Arc::new(Mutex::new(Vec::new()));
        let notices = app.notices.subscribe_sync();
        let tx_notice = tx.clone();
        std::thread::spawn(move || {
            while let Ok(n) = notices.recv() {
                if tx_notice.send(Msg::Notice(n)).is_err() {
                    break;
                }
            }
        });
        let tx_fs = tx.clone();
        let closed2 = closed.clone();
        let dirs2 = dirs_out.clone();
        let (ready_tx, ready_rx) = mpsc::channel::<()>();
        let thread = std::thread::spawn(move || run(app, o, rx, tx_fs, closed2, dirs2, ready_tx));
        // The watches are in place before this returns, as the original's synchronous start was.
        let _ = ready_rx.recv_timeout(Duration::from_secs(5));
        Watcher { tx, closed, dirs: dirs_out, thread: Some(thread) }
    }

    pub fn close(&mut self) {
        self.closed.store(true, Ordering::SeqCst);
        let _ = self.tx.send(Msg::Close);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }

    pub fn watched_dirs(&self) -> Vec<PathBuf> {
        self.dirs.lock().unwrap().clone()
    }
}

impl Drop for Watcher {
    fn drop(&mut self) {
        self.close();
    }
}

fn run(app: Arc<App>, o: WatcherOptions, rx: mpsc::Receiver<Msg>, tx: mpsc::Sender<Msg>, closed: Arc<AtomicBool>, dirs_out: Arc<Mutex<Vec<PathBuf>>>, ready: mpsc::Sender<()>) {
    let mut watcher = match notify::recommended_watcher(move |res| {
        let _ = tx.send(Msg::Fs(res));
    }) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("watcher: {e}");
            return;
        }
    };
    let mut st = State { dirs: HashMap::new(), folders: HashMap::new(), timers: HashMap::new() };
    sync(&app, &o, &mut st, &mut watcher, &dirs_out);
    let _ = ready.send(());
    loop {
        let next = st.timers.values().map(|(t, _)| *t).min();
        let wait = next.map(|t| t.saturating_duration_since(Instant::now())).unwrap_or(Duration::from_secs(3600));
        match rx.recv_timeout(wait) {
            Ok(Msg::Close) => break,
            Ok(Msg::Notice(n)) => match n {
                Notice::DocumentAdded(_) | Notice::DocumentsRemoved(_) | Notice::DocumentOpened(_) | Notice::FolderScanned(_) => sync(&app, &o, &mut st, &mut watcher, &dirs_out),
                Notice::Closing | Notice::Shutdown => break,
                _ => {}
            },
            Ok(Msg::Fs(Ok(event))) => {
                // inotify also reports opens and reads (which Node's fs.watch never did): serving a
                // book must not look like a change to it.
                if matches!(event.kind, notify::EventKind::Access(_)) {
                    continue;
                }
                for path in event.paths {
                    on_path(&o, &mut st, &path);
                }
            }
            Ok(Msg::Fs(Err(_))) => {}
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if closed.load(Ordering::SeqCst) {
            break;
        }
        let now = Instant::now();
        let due: Vec<String> = st.timers.iter().filter(|(_, (t, _))| *t <= now).map(|(k, _)| k.clone()).collect();
        for k in due {
            let (_, p) = st.timers.remove(&k).unwrap();
            let app2 = app.clone();
            let closed2 = closed.clone();
            std::thread::spawn(move || act(app2, o, p, closed2));
        }
    }
}

fn on_path(o: &WatcherOptions, st: &mut State, path: &Path) {
    let now = Instant::now();
    // A document's own folder: the file we watch changed?
    if let Some(dir) = path.parent() {
        if let Some(files) = st.dirs.get(dir) {
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            if let Some(doc_id) = files.get(&name) {
                st.timers.insert(format!("doc:{}", path.display()), (now + Duration::from_millis(o.debounce_ms), Pending::Doc { full: path.to_path_buf(), doc_id: doc_id.clone() }));
            }
        }
    }
    // A folder source: anything under it (hidden segments excluded).
    for (dir, source_id) in &st.folders {
        if let Ok(rel) = path.strip_prefix(dir) {
            if rel.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.')) {
                continue;
            }
            st.timers.insert("announce".into(), (now + Duration::from_millis(500), Pending::Announce));
            st.timers.insert(format!("folder:{}", path.display()), (now + Duration::from_millis(o.debounce_ms), Pending::Folder { full: path.to_path_buf(), source_id: source_id.clone() }));
        }
    }
}

/// The set of watched directories follows the library.
fn sync(app: &App, o: &WatcherOptions, st: &mut State, watcher: &mut notify::RecommendedWatcher, dirs_out: &Mutex<Vec<PathBuf>>) {
    let c = app.lock();
    // Folder sources.
    let folders: Vec<(String, String)> = c.all("SELECT id, path FROM sources WHERE kind = 'folder' AND removed_at IS NULL", params![], |r| Ok((r.get(0)?, r.get(1)?))).unwrap_or_default();
    let want: HashMap<PathBuf, String> = folders.into_iter().map(|(id, p)| (PathBuf::from(p), id)).collect();
    let stale: Vec<PathBuf> = st.folders.iter().filter(|(d, id)| want.get(*d) != Some(id)).map(|(d, _)| d.clone()).collect();
    for d in stale {
        let _ = watcher.unwatch(&d);
        st.folders.remove(&d);
    }
    for (dir, id) in want {
        if st.folders.contains_key(&dir) {
            continue;
        }
        if watcher.watch(&dir, RecursiveMode::Recursive).is_ok() {
            st.folders.insert(dir, id);
        }
    }
    // Recently used live documents: their parent folders.
    let since = crate::clock::iso_ms(c.now_ms() - o.recent_days * 86_400_000);
    let rows: Vec<(String, String)> = c
        .all("SELECT id, path FROM documents WHERE watch = 1 AND deleted_at IS NULL AND (coalesce(last_opened_at, added_at) >= ?1) ORDER BY coalesce(last_opened_at, added_at) DESC", params![since], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap_or_default();
    drop(c);
    let mut want: HashMap<PathBuf, HashMap<String, String>> = HashMap::new();
    for (id, p) in rows {
        let p = PathBuf::from(p);
        let Some(dir) = p.parent() else { continue };
        if !want.contains_key(dir) && want.len() >= o.max_dirs {
            continue;
        }
        want.entry(dir.to_path_buf()).or_default().insert(p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), id);
    }
    let gone: Vec<PathBuf> = st.dirs.keys().filter(|d| !want.contains_key(*d)).cloned().collect();
    for d in gone {
        if !st.folders.keys().any(|f| d.starts_with(f)) {
            let _ = watcher.unwatch(&d);
        }
        st.dirs.remove(&d);
    }
    for (dir, files) in want {
        if let Some(cur) = st.dirs.get_mut(&dir) {
            *cur = files;
            continue;
        }
        // Inside a recursively watched folder source the events already arrive.
        let covered = st.folders.keys().any(|f| dir.starts_with(f));
        if covered || watcher.watch(&dir, RecursiveMode::NonRecursive).is_ok() {
            st.dirs.insert(dir, files);
        }
    }
    *dirs_out.lock().unwrap() = st.dirs.keys().cloned().collect();
}

fn stat(p: &Path) -> Option<(u64, u128)> {
    let m = std::fs::metadata(p).ok()?;
    let mt = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos();
    Some((m.len(), mt))
}

fn act(app: Arc<App>, o: WatcherOptions, p: Pending, closed: Arc<AtomicBool>) {
    let sleep = |ms: u64| std::thread::sleep(Duration::from_millis(ms));
    match p {
        Pending::Announce => {
            if closed.load(Ordering::SeqCst) {
                return;
            }
            let mut c = app.lock();
            let _ = c.emit("tree.changed", Emit::default(), json!({ "reason": "external" }));
        }
        Pending::Doc { full, doc_id } => {
            let mut s = stat(&full);
            // Missing or empty: often the middle of a save. Believe it only if it stays that way.
            if s.map(|(size, _)| size == 0).unwrap_or(true) {
                sleep(o.grace_ms);
                if closed.load(Ordering::SeqCst) {
                    return;
                }
                s = stat(&full);
            }
            // Read only once the file has stopped changing.
            for _ in 0..20 {
                if s.is_none() {
                    break;
                }
                sleep(50);
                let again = stat(&full);
                if again == s {
                    break;
                }
                s = again;
            }
            if closed.load(Ordering::SeqCst) {
                return;
            }
            let mut c = app.lock();
            let _ = c.fresh(&doc_id);
        }
        Pending::Folder { full, source_id } => {
            sleep(o.debounce_ms);
            if closed.load(Ordering::SeqCst) {
                return;
            }
            let mut exists = full.exists();
            // Missing: often the middle of a save or a rename. Believe it only if it stays that way.
            if !exists {
                sleep(o.grace_ms);
                if closed.load(Ordering::SeqCst) {
                    return;
                }
                exists = full.exists();
            }
            let mut c = app.lock();
            if !exists {
                vanished(&mut c, &full);
                return;
            }
            if full.is_dir() {
                // A folder moved in with its contents: the watcher may only have seen the folder.
                for f in list_readable(&full).0 {
                    if let Ok(real) = std::fs::canonicalize(&f) {
                        ingest_if_new(&mut c, &real, &source_id);
                    }
                }
            } else if full.is_file() && is_readable(&full.to_string_lossy()) {
                if let Ok(real) = std::fs::canonicalize(&full) {
                    ingest_if_new(&mut c, &real, &source_id);
                }
            }
        }
    }
}

/// Read a file the library doesn't know, or knows only as deleted or missing (it came back).
fn ingest_if_new(c: &mut crate::core::Core, real: &Path, source_id: &str) {
    let known: Option<(Option<String>, String)> = c
        .one("SELECT d.deleted_at, d.path_status FROM document_paths p JOIN documents d ON d.id = p.document_id WHERE p.path = ?1", params![real.to_string_lossy().into_owned()], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap_or(None);
    let fresh = match known {
        None => true,
        Some((deleted, status)) => deleted.is_some() || status == "missing",
    };
    if fresh {
        let _ = c.ingest_path(real, source_id);
    }
}

/// A file or folder is gone for good: its documents leave the library (they return if it does).
fn vanished(c: &mut crate::core::Core, full: &Path) {
    for id in c.documents_under(full).unwrap_or_default() {
        let _ = c.remove_document(&id);
    }
    // A path the library only remembers (the file moved on): forget the stale mapping.
    let p = full.to_string_lossy().into_owned();
    let _ = c.exec("DELETE FROM document_paths WHERE path = ?1 AND document_id NOT IN (SELECT id FROM documents WHERE path = ?1)", params![p]);
}
