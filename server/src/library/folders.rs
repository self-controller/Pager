//! Folder scans: every readable file in a folder, four levels deep, at most 2,000 files.

use crate::app::App;
use crate::core::Notice;
use crate::model::AddSourceResult;
use crate::util::natural::locale_cmp;
use crate::Result;
use regex::Regex;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub fn readable_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\.(epub|md|markdown|mdown|mkd|txt|text|html?|xhtml|docx)$").unwrap())
}

pub fn is_readable(name: &str) -> bool {
    readable_re().is_match(name)
}

const MAX_DEPTH: u32 = 4;
const MAX_FILES: usize = 2000;

pub fn list_readable(dir: &Path) -> (Vec<PathBuf>, bool) {
    let mut files = Vec::new();
    let mut truncated = false;
    fn walk(d: &Path, depth: u32, files: &mut Vec<PathBuf>, truncated: &mut bool) {
        if depth > MAX_DEPTH || *truncated {
            return;
        }
        let Ok(rd) = std::fs::read_dir(d) else { return };
        let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
        entries.sort_by(|a, b| locale_cmp(&a.file_name().to_string_lossy(), &b.file_name().to_string_lossy()));
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name == "node_modules" {
                continue;
            }
            let full = e.path();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                walk(&full, depth + 1, files, truncated);
            } else if ft.is_file() && is_readable(&name) {
                if files.len() >= MAX_FILES {
                    *truncated = true;
                    return;
                }
                files.push(full);
            }
        }
    }
    walk(dir, 0, &mut files, &mut truncated);
    (files, truncated)
}

/// Scan a folder source: files that can't be read are skipped and counted in the source's error note.
/// The core lock is taken per file, so requests get in between.
pub fn scan_folder(app: &App, source_id: &str, dir: &Path, job_id: Option<&str>) -> Result<Vec<String>> {
    let (files, truncated) = list_readable(dir);
    let mut ids: Vec<String> = Vec::new();
    let mut failed = 0;
    for f in files {
        let mut c = app.lock();
        let r = std::fs::canonicalize(&f).map_err(|e| e.into()).and_then(|real| c.ingest_path(&real, source_id));
        match r {
            Ok(id) => {
                ids.push(id);
                if let Some(j) = job_id {
                    c.job_progress(j, &ids)?;
                }
            }
            Err(_) => failed += 1,
        }
    }
    let mut notes: Vec<String> = Vec::new();
    if failed > 0 {
        notes.push(format!("{failed} file{} couldn't be read.", if failed == 1 { "" } else { "s" }));
    }
    if truncated {
        notes.push(format!("Only the first {MAX_FILES} files were added."));
    }
    let mut c = app.lock();
    let note = notes.join(" ");
    c.set_source_status(source_id, "ready", if notes.is_empty() { None } else { Some(note.as_str()) })?;
    if let Some(j) = job_id {
        c.job_finish(j, &ids)?;
    }
    c.notify(Notice::FolderScanned(source_id.to_string()));
    Ok(ids)
}

/// A folder source: the scan runs as a job in the background; the UI polls it.
pub fn add_folder(app: &std::sync::Arc<App>, dir: &Path) -> Result<AddSourceResult> {
    let (source, job) = {
        let mut c = app.lock();
        let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).filter(|n| !n.is_empty()).unwrap_or_else(|| dir.to_string_lossy().into_owned());
        let source = c.ensure_source("folder", &dir.to_string_lossy(), &name)?;
        let job = c.job_create();
        c.set_source_status(&source.id, "indexing", None)?;
        (c.get_source(&source.id)?, job)
    };
    let app2 = app.clone();
    let (sid, d, jid) = (source.id.clone(), dir.to_path_buf(), job.id.clone());
    std::thread::spawn(move || {
        if let Err(e) = scan_folder(&app2, &sid, &d, Some(&jid)) {
            eprintln!("scan: {e}");
        }
    });
    let job = app.lock().jobs.get(&job.id).unwrap_or(job);
    Ok(AddSourceResult { source, job })
}
