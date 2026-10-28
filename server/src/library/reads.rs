//! The library as a folder. Every path the API takes is relative to the reads root and is resolved
//! through `resolve()`, which refuses to leave the root. Documents are the library's business; this
//! module only moves bytes and tells the library what moved.

use super::folders::{is_readable, list_readable};
use super::library::{expand_path, path_str};
use crate::app::App;
use crate::clock::file_stamp;
use crate::config::{limits, welcome_file};
use crate::core::Core;
use crate::errors::{invalid, not_found, AppError};
use crate::ids::sha256_hex;
use crate::ingest::{check_format, detect_format};
use crate::journal::Emit;
use crate::model::*;
use crate::util::natural::natural_cmp;
use crate::Result;
use rusqlite::params;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const MAX_DEPTH: u32 = 6;
const MAX_FILES: usize = 2000;
/// Deleted files are moved here (inside the reads folder, so the move never crosses file systems).
pub const TRASH: &str = ".trash";

fn is_bad_char(c: char) -> bool {
    (c as u32) < 0x20 || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*' | '\\' | '/')
}

/// A name a file or folder may have inside the library: no path characters, no leading dot, not empty.
pub fn safe_name(raw: Option<&Value>, fallback: Option<&str>) -> Result<String> {
    let s = raw.and_then(Value::as_str).unwrap_or("");
    let cleaned: String = s.chars().map(|c| if is_bad_char(c) { ' ' } else { c }).collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let cleaned = cleaned.trim().trim_start_matches('.').trim_end_matches('.');
    let cleaned: String = cleaned.chars().take(120).collect();
    let cleaned = cleaned.trim().to_string();
    if !cleaned.is_empty() {
        return Ok(cleaned);
    }
    if let Some(f) = fallback {
        return Ok(f.to_string());
    }
    Err(invalid("That name can't be used."))
}

pub fn safe_name_str(s: &str, fallback: Option<&str>) -> Result<String> {
    safe_name(Some(&Value::String(s.to_string())), fallback)
}

/// `name`, or `name 2`, `name 3`… so nothing in `dir` is overwritten.
pub fn unique_name(dir: &Path, name: &str) -> Result<String> {
    if !dir.join(name).exists() {
        return Ok(name.to_string());
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 2..10_000 {
        let candidate = format!("{stem} {n}{ext}");
        if !dir.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    Err(AppError::new(409, "conflict", format!("There are too many files called {name} here.")))
}

fn format_of(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
        "epub" => "epub",
        "md" | "markdown" | "mdown" | "mkd" => "md",
        "txt" | "text" => "txt",
        "html" | "htm" | "xhtml" => "html",
        "docx" => "docx",
        _ => "file",
    }
}

pub fn write_atomic(abs: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = abs.with_file_name(format!("{}.{}.tmp", abs.file_name().unwrap_or_default().to_string_lossy(), std::process::id()));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, abs)?;
    Ok(())
}

/// A front-matter value the Markdown parser reads back exactly.
fn yaml(v: &str) -> String {
    let looks_quoted = (v.len() >= 2 && ((v.starts_with('"') && v.ends_with('"')) || (v.starts_with('\'') && v.ends_with('\'')))) || (v.starts_with('[') && v.ends_with(']'));
    let unsafe_ = looks_quoted || v.contains(" #") || v.contains("\t#") || v.starts_with(char::is_whitespace) || v.ends_with(char::is_whitespace);
    if !unsafe_ {
        return v.to_string();
    }
    if !v.contains('"') {
        return format!("\"{v}\"");
    }
    if !v.contains('\'') {
        return format!("'{v}'");
    }
    v.to_string()
}

pub struct Resolved {
    pub abs: PathBuf,
    pub rel: String,
}

pub enum ImportOutcome {
    Done(IngestJob),
    /// A folder: copied in the background by the caller.
    Folder { job: IngestJob, src: PathBuf, dest: PathBuf, source_id: String },
}

impl Core {
    /// The root with symlinks resolved, once the folder has been ensured.
    pub fn real_root(&self) -> Result<PathBuf> {
        self.reads_root.clone().ok_or_else(|| AppError::internal("the reads folder has not been ensured yet"))
    }

    pub fn reads_source(&self) -> Result<String> {
        self.reads_source_id.clone().ok_or_else(|| AppError::internal("the reads folder has not been ensured yet"))
    }

    /// Copy the welcome page into an empty folder, once.
    pub fn seed_welcome(&mut self) -> Result<()> {
        if self.exists("SELECT value FROM settings WHERE scope = 'internal:welcomed'", params![])? {
            return Ok(());
        }
        let root = self.real_root()?;
        let entries: Vec<_> = std::fs::read_dir(&root)?.filter_map(|e| e.ok()).filter(|e| !e.file_name().to_string_lossy().starts_with('.')).collect();
        if entries.is_empty() {
            if let Some(w) = welcome_file() {
                if let Err(e) = std::fs::copy(&w, root.join("Welcome to Pager.md")) {
                    eprintln!("Could not copy the welcome document: {e}");
                }
            }
        }
        self.exec("INSERT OR REPLACE INTO settings (scope, value, updated_at) VALUES ('internal:welcomed', 'true', ?1)", params![self.now()])?;
        Ok(())
    }

    /// Path inside the root (POSIX) for an absolute path under it.
    pub fn rel_of(&self, abs: &Path) -> Result<String> {
        let root = self.real_root()?;
        Ok(abs.strip_prefix(&root).map(|r| r.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/")).unwrap_or_default())
    }

    /// A relative POSIX path ("" is the root) → an absolute path inside the root. Rejects `..`, hidden
    /// segments, path characters and anything whose real location is outside the root.
    pub fn resolve(&self, rel: Option<&Value>, must_exist: bool) -> Result<Resolved> {
        let rel = rel.and_then(Value::as_str).ok_or_else(|| invalid("Say which file or folder."))?;
        let clean = rel.replace('\\', "/");
        let clean = clean.trim_matches('/');
        let segments: Vec<&str> = if clean.is_empty() { vec![] } else { clean.split('/').collect() };
        for s in &segments {
            if s.is_empty() || *s == "." || *s == ".." || s.starts_with('.') || s.chars().any(|c| (c as u32) < 0x20 || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*')) || s.chars().count() > 120 {
                return Err(invalid("That path can't be used."));
            }
        }
        let root = self.real_root()?;
        let mut abs = root.clone();
        for s in &segments {
            abs.push(s);
        }
        let mut probe = abs.clone();
        while !probe.exists() && probe != root {
            probe = probe.parent().map(Path::to_path_buf).unwrap_or_else(|| root.clone());
        }
        let real = std::fs::canonicalize(&probe)?;
        if real != root && !real.starts_with(&root) {
            return Err(AppError::new(403, "forbidden", "That path is outside your library."));
        }
        if must_exist && !abs.exists() {
            return Err(not_found("That file or folder"));
        }
        Ok(Resolved { abs, rel: segments.join("/") })
    }

    fn folder_at(&self, rel: Option<&Value>) -> Result<Resolved> {
        let empty = Value::String(String::new());
        let dir = self.resolve(Some(rel.filter(|v| !v.is_null()).unwrap_or(&empty)), true)?;
        if !dir.abs.is_dir() {
            return Err(invalid("That isn't a folder."));
        }
        Ok(dir)
    }

    pub fn tree_changed(&mut self, reason: &str, rel: Option<&str>) -> Result<()> {
        let mut payload = json!({ "reason": reason });
        if let Some(r) = rel {
            payload["path"] = Value::String(r.to_string());
        }
        self.emit("tree.changed", Emit::default(), payload)?;
        Ok(())
    }

    // -------------------------------------------------------------------------------------------
    // Browsing

    /// The whole folder tree, with each readable file's document. Files the library hasn't seen yet
    /// are read before answering, so a folder is never shown half indexed.
    pub fn tree(&mut self) -> Result<TreeResponse> {
        let source_id = self.reads_source()?;
        let root_dir = self.real_root()?;
        let known: HashMap<String, String> = self.all("SELECT p.path, p.document_id FROM document_paths p JOIN documents d ON d.id = p.document_id WHERE d.deleted_at IS NULL", params![], |r| Ok((r.get(0)?, r.get(1)?)))?.into_iter().collect();
        let mut count = 0usize;
        let mut truncated = false;
        let mut pending: Vec<(Vec<usize>, PathBuf)> = Vec::new();
        fn walk(dir: &Path, rel: &str, depth: u32, known: &HashMap<String, String>, count: &mut usize, truncated: &mut bool, pending: &mut Vec<(Vec<usize>, PathBuf)>, trail: &mut Vec<usize>) -> TreeFolder {
            let mut folder = TreeFolder { kind: "folder".into(), name: if rel.is_empty() { String::new() } else { dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() }, path: rel.to_string(), folders: vec![], files: vec![], file_count: 0 };
            let Ok(rd) = std::fs::read_dir(dir) else { return folder };
            let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
            entries.sort_by(|a, b| natural_cmp(&a.file_name().to_string_lossy(), &b.file_name().to_string_lossy()));
            for e in entries {
                let name = e.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') || name == "node_modules" {
                    continue;
                }
                let abs = dir.join(&name);
                let child_rel = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
                let Ok(ft) = e.file_type() else { continue };
                if ft.is_dir() {
                    if depth >= MAX_DEPTH {
                        continue;
                    }
                    trail.push(folder.folders.len());
                    let sub = walk(&abs, &child_rel, depth + 1, known, count, truncated, pending, trail);
                    trail.pop();
                    folder.file_count += sub.file_count;
                    folder.folders.push(sub);
                } else if ft.is_file() && is_readable(&name) {
                    if *count >= MAX_FILES {
                        *truncated = true;
                        continue;
                    }
                    let Ok(st) = std::fs::metadata(&abs) else { continue };
                    *count += 1;
                    let modified = st.modified().ok().and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| crate::clock::iso_ms(d.as_millis() as i64)).unwrap_or_default();
                    let mut file = TreeFile { kind: "file".into(), name: name.clone(), path: child_rel, format: format_of(&name).into(), size: st.len(), modified_at: modified, doc_id: None, doc: None, error: None };
                    match known.get(&path_str(&abs)) {
                        Some(id) => file.doc_id = Some(id.clone()),
                        None => {
                            let mut loc = trail.clone();
                            loc.push(folder.files.len());
                            pending.push((loc, abs));
                        }
                    }
                    folder.files.push(file);
                    folder.file_count += 1;
                }
            }
            folder
        }
        let mut trail = Vec::new();
        let mut root = walk(&root_dir, "", 0, &known, &mut count, &mut truncated, &mut pending, &mut trail);
        fn file_at<'a>(root: &'a mut TreeFolder, loc: &[usize]) -> &'a mut TreeFile {
            let mut f = root;
            for &i in &loc[..loc.len() - 1] {
                f = &mut f.folders[i];
            }
            &mut f.files[loc[loc.len() - 1]]
        }
        for (loc, abs) in pending {
            let result = std::fs::canonicalize(&abs).map_err(|e| AppError::new(500, "internal", crate::errors::io_message(&e, &abs))).and_then(|real| self.ingest_path(&real, &source_id));
            let file = file_at(&mut root, &loc);
            match result {
                Ok(id) => file.doc_id = Some(id),
                Err(e) => file.error = Some(e.message),
            }
        }
        fn attach(c: &Core, f: &mut TreeFolder) {
            for file in f.files.iter_mut() {
                if let Some(id) = file.doc_id.clone() {
                    match c.live_row(&id).and_then(|r| c.summary(&r)) {
                        Ok(s) => file.doc = Some(s),
                        Err(_) => file.doc_id = None,
                    }
                }
            }
            for sub in f.folders.iter_mut() {
                attach(c, sub);
            }
        }
        attach(self, &mut root);
        Ok(TreeResponse { root, truncated })
    }

    // -------------------------------------------------------------------------------------------
    // Making things

    /// A new Markdown file with front matter, read into the library straight away.
    pub fn create_file(&mut self, dir: Option<&Value>, title: Option<&Value>, author: Option<&Value>) -> Result<CreateFileResult> {
        let source_id = self.reads_source()?;
        let title = title.and_then(Value::as_str).map(|t| t.split_whitespace().collect::<Vec<_>>().join(" ")).unwrap_or_default();
        if title.is_empty() {
            return Err(invalid("Give the file a title."));
        }
        let author = author.and_then(Value::as_str).map(|t| t.split_whitespace().collect::<Vec<_>>().join(" ")).unwrap_or_default();
        let dir = self.folder_at(dir)?;
        let name = unique_name(&dir.abs, &format!("{}.md", safe_name_str(&title, Some("Untitled"))?))?;
        let abs = dir.abs.join(&name);
        let mut lines = vec!["---".to_string(), format!("title: {}", yaml(&title))];
        if !author.is_empty() {
            lines.push(format!("author: {}", yaml(&author)));
        }
        lines.push(format!("created: {}", self.now()));
        lines.extend(["---".into(), String::new(), format!("# {title}"), String::new(), String::new()]);
        std::fs::OpenOptions::new().write(true).create_new(true).open(&abs)?;
        std::fs::write(&abs, lines.join("\n"))?;
        let real = std::fs::canonicalize(&abs)?;
        let doc_id = self.ingest_path(&real, &source_id)?;
        let rel = self.rel_of(&abs)?;
        self.tree_changed("created", Some(&rel))?;
        let row = self.row(&doc_id)?;
        Ok(CreateFileResult { path: rel, document: self.summary(&row)? })
    }

    pub fn create_folder(&mut self, dir: Option<&Value>, name: Option<&Value>) -> Result<String> {
        self.reads_source()?;
        let name = safe_name(name, None)?;
        let dir = self.folder_at(dir)?;
        let abs = dir.abs.join(&name);
        if abs.exists() {
            return Err(AppError::new(409, "conflict", format!("There is already something called {name} here.")));
        }
        std::fs::create_dir(&abs)?;
        let rel = self.rel_of(&abs)?;
        self.tree_changed("created", Some(&rel))?;
        Ok(rel)
    }

    /// Rename or move a file or folder. `to` is the full new path.
    pub fn move_entry(&mut self, from: Option<&Value>, to: Option<&Value>) -> Result<MoveEntryResult> {
        self.reads_source()?;
        let from = self.resolve(from, true)?;
        let to = self.resolve(to, false)?;
        if from.rel.is_empty() {
            return Err(invalid("The library folder itself can't be moved."));
        }
        if to.rel.is_empty() {
            return Err(invalid("Say where to move it."));
        }
        let is_dir = from.abs.is_dir();
        if from.rel == to.rel {
            return self.move_result(&to, is_dir);
        }
        if to.rel.starts_with(&format!("{}/", from.rel)) {
            return Err(invalid("A folder can't be moved into itself."));
        }
        if to.abs.exists() {
            return Err(AppError::new(409, "conflict", "There is already something with that name there."));
        }
        let parent = to.abs.parent().map(Path::to_path_buf).unwrap_or_default();
        if !parent.is_dir() {
            return Err(not_found("That folder"));
        }
        let base = to.abs.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if safe_name_str(&base, None)? != base {
            return Err(invalid("That name can't be used."));
        }
        if !is_dir && !is_readable(&base) {
            return Err(invalid("Keep the file's extension so Pager can still open it."));
        }
        std::fs::rename(&from.abs, &to.abs)?;
        self.relocate(&from.abs, &to.abs)?;
        self.tree_changed("moved", Some(&to.rel))?;
        self.move_result(&to, is_dir)
    }

    fn move_result(&self, to: &Resolved, is_dir: bool) -> Result<MoveEntryResult> {
        let mut out = MoveEntryResult { path: to.rel.clone(), document: None };
        if !is_dir {
            if let Some(id) = self.documents_under(&to.abs)?.into_iter().next() {
                let row = self.row(&id)?;
                out.document = Some(self.summary(&row)?);
            }
        }
        Ok(out)
    }

    /// Move a file or folder into the trash and take its documents out of the library.
    pub fn remove_entry(&mut self, rel: Option<&Value>) -> Result<()> {
        self.reads_source()?;
        let target = self.resolve(rel, true)?;
        if target.rel.is_empty() {
            return Err(invalid("The library folder itself can't be deleted."));
        }
        let stamp = file_stamp(self.now_ms());
        let trash_dir = self.real_root()?.join(TRASH).join(stamp);
        std::fs::create_dir_all(&trash_dir)?;
        let base = target.abs.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let dest = trash_dir.join(unique_name(&trash_dir, &base)?);
        let ids = self.documents_under(&target.abs)?;
        std::fs::rename(&target.abs, &dest)?;
        for id in ids {
            let _ = self.remove_document(&id);
        }
        self.tree_changed("deleted", Some(&target.rel))
    }

    // -------------------------------------------------------------------------------------------
    // Bringing files in

    /// Bytes from the browser → a file in `dir`. The same bytes already in the library mean that document.
    pub fn import_bytes(&mut self, dir: Option<&Value>, bytes: &[u8], file_name: &str) -> Result<IngestJob> {
        let source_id = self.reads_source()?;
        if bytes.len() as u64 > limits::FILE_BYTES {
            return Err(AppError::new(413, "too_large", "This file is larger than Pager opens (200 MB)."));
        }
        let job = self.job_create();
        let r = (|| -> Result<()> {
            check_format(detect_format(bytes, file_name), file_name)?;
            if let Some(existing) = self.document_id_for_hash(&sha256_hex(bytes))? {
                self.job_finish(&job.id, &[existing])?;
                return Ok(());
            }
            let dir = self.folder_at(dir)?;
            let base = file_name.rsplit(['/', '\\']).next().unwrap_or(file_name);
            let name = unique_name(&dir.abs, &safe_name_str(base, Some("upload"))?)?;
            let abs = dir.abs.join(&name);
            write_atomic(&abs, bytes)?;
            let real = std::fs::canonicalize(&abs)?;
            let doc_id = self.ingest_path(&real, &source_id)?;
            self.job_finish(&job.id, &[doc_id])?;
            let rel = self.rel_of(&abs)?;
            self.tree_changed("created", Some(&rel))?;
            Ok(())
        })();
        if let Err(e) = r {
            self.job_fail(&job.id, &e.message)?;
            return Err(e);
        }
        Ok(self.jobs.get(&job.id).unwrap_or(job))
    }

    /// Copy a file, or a folder's readable files, from elsewhere on this machine into `dir`.
    pub fn import_path(&mut self, dir: Option<&Value>, raw: Option<&Value>) -> Result<ImportOutcome> {
        let source_id = self.reads_source()?;
        let raw = raw.and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| invalid("Type the path of a file or folder."))?;
        let abs = expand_path(raw)?;
        let real = std::fs::canonicalize(&abs).map_err(|_| AppError::new(404, "not_found", format!("Nothing was found at {raw}.")))?;
        let meta = std::fs::metadata(&real).map_err(|_| AppError::new(404, "not_found", format!("Nothing was found at {raw}.")))?;
        let root = self.real_root()?;
        if real == root || real.starts_with(&root) {
            return Err(invalid("That is already in your library."));
        }
        let dir = self.folder_at(dir)?;
        let job = self.job_create();
        if meta.is_file() {
            let r = (|| -> Result<()> {
                if meta.len() > limits::FILE_BYTES {
                    return Err(AppError::new(413, "too_large", "This file is larger than Pager opens (200 MB)."));
                }
                let bytes = std::fs::read(&real)?;
                let base = real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                check_format(detect_format(&bytes, &base), &base)?;
                if let Some(existing) = self.document_id_for_hash(&sha256_hex(&bytes))? {
                    self.job_finish(&job.id, &[existing])?;
                    return Ok(());
                }
                let dest = dir.abs.join(unique_name(&dir.abs, &safe_name_str(&base, Some("file"))?)?);
                std::fs::copy(&real, &dest)?;
                let dest_real = std::fs::canonicalize(&dest)?;
                let doc_id = self.ingest_path(&dest_real, &source_id)?;
                self.job_finish(&job.id, &[doc_id])?;
                let rel = self.rel_of(&dest)?;
                self.tree_changed("created", Some(&rel))?;
                Ok(())
            })();
            if let Err(e) = r {
                self.job_fail(&job.id, &e.message)?;
                return Err(e);
            }
            return Ok(ImportOutcome::Done(self.jobs.get(&job.id).unwrap_or(job)));
        }
        if !meta.is_dir() {
            return Err(AppError::new(422, "unsupported", format!("{raw} isn't a file Pager can open.")));
        }
        let base = real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let dest = dir.abs.join(unique_name(&dir.abs, &safe_name_str(&base, Some("Imported"))?)?);
        Ok(ImportOutcome::Folder { job, src: real, dest, source_id })
    }
}

/// The background half of a folder import: copy readable files in one by one, reading each.
pub fn copy_folder(app: &App, src: &Path, dest: &Path, source_id: &str, job_id: &str) {
    let (files, _) = list_readable(src);
    let mut ids: Vec<String> = Vec::new();
    let mut failed = 0;
    for f in files {
        let r = (|| -> Result<()> {
            let target = dest.join(f.strip_prefix(src).unwrap_or(&f));
            std::fs::create_dir_all(target.parent().unwrap())?;
            std::fs::copy(&f, &target)?;
            let real = std::fs::canonicalize(&target)?;
            let mut c = app.lock();
            let id = c.ingest_path(&real, source_id)?;
            ids.push(id);
            c.job_progress(job_id, &ids)?;
            Ok(())
        })();
        if r.is_err() {
            failed += 1;
        }
    }
    let mut c = app.lock();
    let _ = if ids.is_empty() {
        c.job_fail(job_id, &if failed > 0 { format!("{failed} file{} couldn't be read.", if failed == 1 { "" } else { "s" }) } else { "Nothing readable was found in that folder.".to_string() })
    } else {
        c.job_finish(job_id, &ids)
    };
    if dest.exists() {
        if let Ok(rel) = c.rel_of(dest) {
            let _ = c.tree_changed("created", Some(&rel));
        }
    }
}
