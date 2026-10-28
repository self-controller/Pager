//! Documents, sources, revisions and reading progress: the library proper.

use crate::anchoring::doctext::DocIndex;
use crate::anchoring::selectors::selectors_for;
use crate::clock::{iso_ms, parse_iso};
use crate::config::limits;
use crate::core::{Core, Notice};
use crate::db::{from_json, to_json};
use crate::errors::{invalid, not_found, AppError};
use crate::ids::sha256_hex;
use crate::ingest::title::title_from_file_name;
use crate::ingest::{check_format, detect_format, parse_file, Format, IngestContext};
use crate::journal::Emit;
use crate::library::assets::asset_url;
use crate::model::*;
use crate::render::html::excerpt_of;
use crate::Result;
use rusqlite::{params, params_from_iter, Row};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

const SNAPSHOT_MAX: usize = 5 * 1024 * 1024;
const MISSING_RECHECK_MS: u64 = 500;

#[derive(Clone, Debug)]
pub struct DocumentRow {
    pub id: String,
    pub source_id: String,
    pub format: String,
    pub path: String,
    pub file_name: String,
    pub path_status: String,
    pub watch: i64,
    pub current_revision_id: Option<String>,
    pub src_mtime_ms: Option<i64>,
    pub src_size: Option<i64>,
    pub title: String,
    pub subtitle: Option<String>,
    pub authors: String,
    pub language: Option<String>,
    pub identifier: Option<String>,
    pub published_at: Option<String>,
    pub cover_asset: Option<String>,
    pub excerpt: Option<String>,
    pub word_count: i64,
    pub section_count: i64,
    pub title_override: Option<String>,
    pub author_override: Option<String>,
    pub saved: i64,
    pub added_at: String,
    pub last_opened_at: Option<String>,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

impl DocumentRow {
    pub fn from_row(r: &Row) -> rusqlite::Result<DocumentRow> {
        Ok(DocumentRow {
            id: r.get("id")?,
            source_id: r.get("source_id")?,
            format: r.get("format")?,
            path: r.get("path")?,
            file_name: r.get("file_name")?,
            path_status: r.get("path_status")?,
            watch: r.get("watch")?,
            current_revision_id: r.get("current_revision_id")?,
            src_mtime_ms: r.get("src_mtime_ms")?,
            src_size: r.get("src_size")?,
            title: r.get("title")?,
            subtitle: r.get("subtitle")?,
            authors: r.get("authors")?,
            language: r.get("language")?,
            identifier: r.get("identifier")?,
            published_at: r.get("published_at")?,
            cover_asset: r.get("cover_asset")?,
            excerpt: r.get("excerpt")?,
            word_count: r.get("word_count")?,
            section_count: r.get("section_count")?,
            title_override: r.get("title_override")?,
            author_override: r.get("author_override")?,
            saved: r.get("saved")?,
            added_at: r.get("added_at")?,
            last_opened_at: r.get("last_opened_at")?,
            updated_at: r.get("updated_at")?,
            deleted_at: r.get("deleted_at")?,
        })
    }

    pub fn format(&self) -> Format {
        Format::parse(&self.format).unwrap_or(Format::Txt)
    }

    pub fn authors(&self) -> Vec<String> {
        from_json(Some(&self.authors), Vec::new())
    }
}

#[derive(Clone, Debug)]
pub struct SourceRow {
    pub id: String,
    pub kind: String,
    pub path: String,
    pub name: String,
    pub status: String,
    pub error: Option<String>,
    pub added_at: String,
    pub removed_at: Option<String>,
}

impl SourceRow {
    fn from_row(r: &Row) -> rusqlite::Result<SourceRow> {
        Ok(SourceRow { id: r.get("id")?, kind: r.get("kind")?, path: r.get("path")?, name: r.get("name")?, status: r.get("status")?, error: r.get("error")?, added_at: r.get("added_at")?, removed_at: r.get("removed_at")? })
    }
}

#[derive(Clone, Debug)]
pub struct RevisionRow {
    pub id: String,
    pub document_id: String,
    pub content_hash: String,
    pub parser_version: i64,
    pub snapshot: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug)]
pub struct ProgressRow {
    pub document_id: String,
    pub section_id: String,
    pub scroll_offset: f64,
    pub percent: f64,
    pub anchor_id: Option<String>,
    pub updated_at: String,
    pub device_id: Option<String>,
}

impl ProgressRow {
    fn from_row(r: &Row) -> rusqlite::Result<ProgressRow> {
        Ok(ProgressRow { document_id: r.get("document_id")?, section_id: r.get("section_id")?, scroll_offset: r.get("scroll_offset")?, percent: r.get("percent")?, anchor_id: r.get("anchor_id")?, updated_at: r.get("updated_at")?, device_id: r.get("device_id")? })
    }
}

pub struct FileStat {
    pub mtime_ms: i64,
    pub size: u64,
}

pub fn stat(p: &Path) -> Option<FileStat> {
    let m = std::fs::metadata(p).ok()?;
    let mtime = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(FileStat { mtime_ms: mtime.as_millis() as i64, size: m.len() })
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

/// What the user typed → an absolute path. `~` and file:// URLs are understood.
pub fn expand_path(raw: &str) -> Result<PathBuf> {
    let mut p = raw.trim().to_string();
    if p.len() >= 2 && ((p.starts_with('"') && p.ends_with('"')) || (p.starts_with('\'') && p.ends_with('\''))) {
        p = p[1..p.len() - 1].to_string();
    }
    if p.is_empty() {
        return Err(invalid("Type the path of a file or folder."));
    }
    if let Some(rest) = p.strip_prefix("file://") {
        p = percent_encoding::percent_decode_str(rest).decode_utf8_lossy().into_owned();
    }
    let path = if p == "~" {
        home_dir()
    } else if let Some(rest) = p.strip_prefix("~/") {
        home_dir().join(rest)
    } else {
        PathBuf::from(&p)
    };
    Ok(if path.is_absolute() { normalize(&path) } else { normalize(&home_dir().join(path)) })
}

/// `path.resolve`: lexical normalisation of `.` and `..` without touching the file system.
pub fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

pub fn clamp01(v: Option<&Value>) -> f64 {
    v.and_then(Value::as_f64).filter(|f| f.is_finite()).map(|f| f.clamp(0.0, 1.0)).unwrap_or(0.0)
}

/// A cheap signature of a section's content: its block ids in order.
fn section_signature(blocks: &[Block]) -> String {
    fn walk(bs: &[Block], ids: &mut Vec<String>) {
        for b in bs {
            ids.push(b.id().to_string());
            match b {
                Block::List(l) => {
                    for it in &l.items {
                        walk(&it.blocks, ids);
                    }
                }
                Block::Blockquote(q) => walk(&q.blocks, ids),
                Block::Aside(a) => walk(&a.blocks, ids),
                _ => {}
            }
        }
    }
    let mut ids = Vec::new();
    walk(blocks, &mut ids);
    ids.join(",")
}

pub fn path_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

impl Core {
    // -------------------------------------------------------------------------------------------
    // Jobs (journalled)

    fn flush_jobs(&mut self) -> Result<()> {
        let changed = std::mem::take(&mut self.jobs.changed);
        for j in changed {
            self.emit("job.updated", Emit::subject(&j.id), json!({ "jobId": j.id, "status": j.status, "documentIds": j.document_ids }))?;
        }
        Ok(())
    }

    pub fn job_create(&mut self) -> IngestJob {
        let now = self.now_ms();
        self.jobs.create(now)
    }

    pub fn job_progress(&mut self, id: &str, ids: &[String]) -> Result<()> {
        self.jobs.progress(id, ids);
        self.flush_jobs()
    }

    pub fn job_finish(&mut self, id: &str, ids: &[String]) -> Result<()> {
        self.jobs.finish(id, ids);
        self.flush_jobs()
    }

    pub fn job_fail(&mut self, id: &str, error: &str) -> Result<()> {
        self.jobs.fail(id, error);
        self.flush_jobs()
    }

    // -------------------------------------------------------------------------------------------
    // Sources

    pub fn ensure_source(&mut self, kind: &str, p: &str, name: &str) -> Result<SourceRow> {
        if let Some(existing) = self.one("SELECT * FROM sources WHERE kind = ?1 AND path = ?2 AND removed_at IS NULL", params![kind, p], SourceRow::from_row)? {
            return Ok(existing);
        }
        let row = SourceRow { id: self.new_id(), kind: kind.into(), path: p.into(), name: name.into(), status: "ready".into(), error: None, added_at: self.now(), removed_at: None };
        let r = row.clone();
        self.tx(move |c| {
            c.exec("INSERT INTO sources (id, kind, path, name, status, added_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params![r.id, r.kind, r.path, r.name, r.status, r.added_at])?;
            c.emit("source.added", Emit::subject(&r.id), json!({ "kind": r.kind, "path": r.path }))?;
            Ok(())
        })?;
        Ok(row)
    }

    pub fn set_source_status(&mut self, id: &str, status: &str, error: Option<&str>) -> Result<()> {
        self.exec("UPDATE sources SET status = ?1, error = ?2 WHERE id = ?3", params![status, error, id])?;
        Ok(())
    }

    fn count_documents(&self, source_id: &str) -> Result<i64> {
        self.count("SELECT COUNT(*) FROM documents WHERE source_id = ?1 AND deleted_at IS NULL", params![source_id])
    }

    fn source_view(&self, r: &SourceRow) -> Result<Source> {
        Ok(Source {
            id: r.id.clone(),
            kind: r.kind.clone(),
            path: if r.kind == "upload" { String::new() } else { r.path.clone() },
            name: r.name.clone(),
            document_count: self.count_documents(&r.id)?,
            added_at: r.added_at.clone(),
            status: r.status.clone(),
            error: r.error.clone(),
        })
    }

    pub fn get_source(&self, id: &str) -> Result<Source> {
        let r = self.one("SELECT * FROM sources WHERE id = ?1 AND removed_at IS NULL", params![id], SourceRow::from_row)?.ok_or_else(|| not_found("That source"))?;
        self.source_view(&r)
    }

    pub fn source_row(&self, id: &str) -> Result<Option<SourceRow>> {
        self.one("SELECT * FROM sources WHERE id = ?1", params![id], SourceRow::from_row)
    }

    pub fn list_sources(&self) -> Result<Vec<Source>> {
        let rows = self.all("SELECT * FROM sources WHERE removed_at IS NULL ORDER BY added_at DESC", params![], SourceRow::from_row)?;
        rows.iter().map(|r| self.source_view(r)).collect()
    }

    pub fn remove_source(&mut self, id: &str) -> Result<()> {
        let r = self.one("SELECT * FROM sources WHERE id = ?1 AND removed_at IS NULL", params![id], SourceRow::from_row)?.ok_or_else(|| not_found("That source"))?;
        let now = self.now();
        self.tx(|c| {
            let docs: Vec<String> = c.all("SELECT id FROM documents WHERE source_id = ?1 AND deleted_at IS NULL", params![r.id], |row| row.get(0))?;
            for d in docs {
                c.exec("UPDATE documents SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2", params![now, d])?;
                c.emit("document.removed", Emit::doc(&d), json!({}))?;
            }
            c.exec("UPDATE sources SET removed_at = ?1 WHERE id = ?2", params![now, r.id])?;
            c.emit("source.removed", Emit::subject(&r.id), json!({}))?;
            Ok(())
        })?;
        self.notify(Notice::DocumentsRemoved(id.to_string()));
        Ok(())
    }

    // -------------------------------------------------------------------------------------------
    // Ingest and identity

    /// A live document whose file is still there and whose current bytes hash to `hash`.
    pub fn document_id_for_hash(&self, hash: &str) -> Result<Option<String>> {
        let r = self.one(
            "SELECT d.id, d.path FROM revisions r JOIN documents d ON d.id = r.document_id WHERE r.content_hash = ?1 AND d.deleted_at IS NULL ORDER BY r.created_at DESC LIMIT 1",
            params![hash],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )?;
        Ok(r.filter(|(_, p)| Path::new(p).exists()).map(|(id, _)| id))
    }

    /// Live documents whose file is `real` or lies under it.
    pub fn documents_under(&self, real: &Path) -> Result<Vec<String>> {
        let real = path_str(real);
        let esc = real.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        self.all("SELECT id FROM documents WHERE deleted_at IS NULL AND (path = ?1 OR path LIKE ?2 ESCAPE '\\') ORDER BY path", params![real, format!("{esc}/%")], |r| r.get(0))
    }

    /// A file or folder was renamed or moved: point its documents at their new paths. A title that
    /// came from the file name follows the name (the file's own metadata is read again to tell).
    /// No new revision is made, so anchors are untouched.
    pub fn relocate(&mut self, old_real: &Path, new_real: &Path) -> Result<Vec<String>> {
        let ids = self.documents_under(old_real)?;
        if ids.is_empty() {
            return Ok(ids);
        }
        let now = self.now();
        let mut moves: Vec<(String, PathBuf, String, Option<String>)> = Vec::new();
        for id in &ids {
            let r = self.row(id)?;
            let next = if Path::new(&r.path) == old_real { new_real.to_path_buf() } else { new_real.join(Path::new(&r.path).strip_prefix(old_real).unwrap_or(Path::new(""))) };
            let name = next.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let mut title: Option<String> = None;
            // Only a title that looks file-name-derived is worth a second look; the parser knows for sure.
            if name != r.file_name && r.title_override.is_none() && r.format != "epub" && r.title == title_from_file_name(&r.file_name) {
                if let Ok(bytes) = std::fs::read(&next) {
                    let ctx = IngestContext::new(&name, next.parent(), self.assets.clone());
                    if let Ok(parsed) = parse_file(&bytes, r.format(), &ctx) {
                        if !parsed.meta.title.is_empty() && parsed.meta.title != r.title {
                            title = Some(parsed.meta.title);
                        }
                    }
                }
            }
            moves.push((id.clone(), next, name, title));
        }
        self.tx(|c| {
            for (id, next, name, title) in &moves {
                let r = c.row(id)?;
                c.exec("DELETE FROM document_paths WHERE path = ?1", params![r.path])?;
                c.exec("INSERT OR REPLACE INTO document_paths (path, document_id, first_seen_at, last_seen_at) VALUES (?1, ?2, ?3, ?3)", params![path_str(next), id, now])?;
                c.exec(
                    "UPDATE documents SET path = ?1, file_name = ?2, title = ?3, path_status = 'ok', updated_at = ?4 WHERE id = ?5",
                    params![path_str(next), name, title.clone().unwrap_or(r.title), now, id],
                )?;
                let fields = if title.is_some() { vec!["path", "title"] } else { vec!["path"] };
                c.emit("document.updated", Emit::doc(id), json!({ "fields": fields }))?;
            }
            Ok(())
        })?;
        self.on_document_added(&ids[0])?;
        Ok(ids)
    }

    /// Add (or re-read) the file at an absolute real path. Identity:
    ///  1. path known: same document; a new revision if the bytes or the parser changed;
    ///  2. path unknown, bytes known: a move (old path gone) or a second copy of a book → same document;
    ///     a copy of a live (editable) file → a new document, since the two will diverge;
    ///  3. otherwise a new document.
    pub fn ingest_path(&mut self, real: &Path, source_id: &str) -> Result<String> {
        let st = stat(real).ok_or_else(|| AppError::new(404, "not_found", format!("Nothing was found at {}.", real.display())))?;
        if st.size > limits::FILE_BYTES {
            return Err(AppError::new(413, "too_large", "This file is larger than Pager opens (200 MB)."));
        }
        let bytes = std::fs::read(real).map_err(|e| AppError::new(500, "internal", crate::errors::io_message(&e, real)))?;
        let file_name = real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let format = check_format(detect_format(&bytes, &file_name), &file_name)?;
        let hash = sha256_hex(&bytes);
        let now = self.now();
        let real_s = path_str(real);

        if let Some(by_path) = self.one("SELECT d.* FROM document_paths p JOIN documents d ON d.id = p.document_id WHERE p.path = ?1", params![real_s], DocumentRow::from_row)? {
            self.exec("UPDATE document_paths SET last_seen_at = ?1 WHERE path = ?2", params![now, real_s])?;
            self.undelete(&by_path.id)?;
            if by_path.path != real_s || by_path.path_status != "ok" {
                self.exec("UPDATE documents SET path = ?1, path_status = 'ok', updated_at = ?2 WHERE id = ?3", params![real_s, now, by_path.id])?;
            }
            let src = self.source_row(&by_path.source_id)?;
            if src.map(|s| s.removed_at.is_some()).unwrap_or(true) {
                self.exec("UPDATE documents SET source_id = ?1 WHERE id = ?2", params![source_id, by_path.id])?;
            }
            self.refresh_from_bytes(&by_path.id, &bytes, &hash, format, Some(&st), "source-changed")?;
            return Ok(by_path.id);
        }

        let by_hash = self.one(
            "SELECT d.* FROM revisions r JOIN documents d ON d.id = r.document_id WHERE r.content_hash = ?1 ORDER BY d.deleted_at IS NOT NULL, r.created_at DESC LIMIT 1",
            params![hash],
            DocumentRow::from_row,
        )?;
        if let Some(by_hash) = by_hash {
            let old_missing = by_hash.watch == 0 || !Path::new(&by_hash.path).exists() || by_hash.path_status == "missing";
            if old_missing || !format.is_live() {
                let id = by_hash.id.clone();
                let sid = source_id.to_string();
                let (fname, rs, nowc) = (file_name.clone(), real_s.clone(), now.clone());
                let (mtime, size) = (st.mtime_ms, st.size as i64);
                let live = format.is_live() as i64;
                self.tx(|c| {
                    c.exec("INSERT OR REPLACE INTO document_paths (path, document_id, first_seen_at, last_seen_at) VALUES (?1, ?2, ?3, ?3)", params![rs, id, nowc])?;
                    c.exec(
                        "UPDATE documents SET path = ?1, file_name = ?2, path_status = 'ok', watch = ?3, src_mtime_ms = ?4, src_size = ?5, updated_at = ?6 WHERE id = ?7",
                        params![rs, fname, live, mtime, size, nowc, id],
                    )?;
                    let src = c.source_row(&by_hash.source_id)?;
                    if src.as_ref().map(|s| s.removed_at.is_some() || s.kind == "upload").unwrap_or(true) {
                        c.exec("UPDATE documents SET source_id = ?1 WHERE id = ?2", params![sid, id])?;
                    }
                    Ok(())
                })?;
                self.undelete(&by_hash.id)?;
                self.refresh_from_bytes(&by_hash.id, &bytes, &hash, format, Some(&st), "source-changed")?;
                return Ok(by_hash.id);
            }
        }

        let ctx = IngestContext::new(&file_name, real.parent(), self.assets.clone());
        let parsed = parse_file(&bytes, format, &ctx)?;
        self.create_document(source_id, format, real, &file_name, parsed, &hash, &bytes, format.is_live(), Some(&st))
    }

    fn undelete(&mut self, id: &str) -> Result<()> {
        let deleted: Option<Option<String>> = self.one("SELECT deleted_at FROM documents WHERE id = ?1", params![id], |r| r.get(0))?;
        if deleted.flatten().is_some() {
            let now = self.now();
            self.tx(|c| {
                c.exec("UPDATE documents SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2", params![now, id])?;
                c.emit("document.added", Emit::doc(id), json!({ "title": "", "format": "", "sourceId": "" }))?;
                Ok(())
            })?;
            self.on_document_added(id)?;
        }
        Ok(())
    }

    /// After a document arrives (or returns): attach waiting imports, tell the watcher.
    pub fn on_document_added(&mut self, id: &str) -> Result<()> {
        if let Err(e) = self.apply_waiting_imports(id) {
            eprintln!("import: {e}");
        }
        self.notify(Notice::DocumentAdded(id.to_string()));
        Ok(())
    }

    fn snapshot(&self, format: Format, bytes: &[u8], hash: &str) -> Option<String> {
        if !format.is_snapshotted() || bytes.len() > SNAPSHOT_MAX {
            return None;
        }
        let rel = format!("files/{hash}.{}", format.as_str());
        let full = self.data_dir.join(&rel);
        if !full.exists() {
            let _ = std::fs::create_dir_all(full.parent().unwrap());
            let tmp = self.data_dir.join(format!("{rel}.{}.tmp", std::process::id()));
            if std::fs::write(&tmp, bytes).is_ok() {
                let _ = std::fs::rename(&tmp, &full);
            }
        }
        Some(rel)
    }

    #[allow(clippy::too_many_arguments)]
    fn create_document(&mut self, source_id: &str, format: Format, path: &Path, file_name: &str, parsed: ParsedDocument, hash: &str, bytes: &[u8], watch: bool, st: Option<&FileStat>) -> Result<String> {
        let id = self.new_id();
        let now = self.now();
        let revision_id = self.new_id();
        let snapshot = self.snapshot(format, bytes, hash);
        let meta_title = parsed.meta.title.clone();
        let section_ids: Vec<String> = parsed.sections.iter().map(|s| s.id.clone()).collect();
        let idx = self.cache.save(&revision_id, parsed);
        let path_s = path_str(path);
        self.tx(|c| {
            c.exec(
                "INSERT INTO documents (id, source_id, format, path, file_name, watch, current_revision_id, src_mtime_ms, src_size, title, authors, added_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, '[]', ?11, ?11)",
                params![id, source_id, format.as_str(), path_s, file_name, watch as i64, revision_id, st.map(|s| s.mtime_ms), st.map(|s| s.size as i64), meta_title, now],
            )?;
            if st.is_some() {
                c.exec("INSERT OR REPLACE INTO document_paths (path, document_id, first_seen_at, last_seen_at) VALUES (?1, ?2, ?3, ?3)", params![path_s, id, now])?;
            }
            c.insert_revision(&id, &revision_id, &idx.doc, hash, bytes.len(), "added", snapshot.as_deref())?;
            c.apply_meta(&id, &idx.doc)?;
            c.emit("document.added", Emit::doc(&id), json!({ "title": meta_title, "format": format.as_str(), "sourceId": source_id }))?;
            c.emit(
                "revision.created",
                Emit::doc_subject(&id, &revision_id),
                json!({ "revisionId": revision_id, "previousRevisionId": null, "reason": "added", "changedSectionIds": section_ids, "removedSectionIds": [] }),
            )?;
            c.on_revision(&id, None, &idx)?;
            Ok(())
        })?;
        self.on_document_added(&id)?;
        Ok(id)
    }

    fn insert_revision(&mut self, doc_id: &str, revision_id: &str, parsed: &ParsedDocument, hash: &str, bytes: usize, reason: &str, snapshot: Option<&str>) -> Result<()> {
        self.exec(
            "INSERT INTO revisions (id, document_id, content_hash, parser_version, model_version, bytes, doc_chars, reason, snapshot, stats, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                revision_id,
                doc_id,
                hash,
                parsed.parser_version as i64,
                parsed.model_version as i64,
                bytes as i64,
                parsed.doc_chars as i64,
                reason,
                snapshot,
                to_json(&json!({ "sections": parsed.sections.len(), "words": parsed.word_count, "warnings": parsed.warnings })),
                self.now()
            ],
        )?;
        Ok(())
    }

    fn apply_meta(&mut self, doc_id: &str, p: &ParsedDocument) -> Result<()> {
        let m = &p.meta;
        self.exec(
            "UPDATE documents SET title = ?1, subtitle = ?2, authors = ?3, language = ?4, identifier = ?5, published_at = ?6, cover_asset = ?7,
             excerpt = ?8, word_count = ?9, section_count = ?10, updated_at = ?11 WHERE id = ?12",
            params![
                if m.title.is_empty() { "Untitled" } else { m.title.as_str() },
                m.subtitle,
                to_json(&m.authors),
                m.language,
                m.identifier,
                m.published_at,
                m.cover.as_ref().map(|c| c.trim_start_matches("/api/assets/").to_string()),
                excerpt_of(&p.sections, 200),
                p.word_count as i64,
                p.sections.len() as i64,
                self.now(),
                doc_id
            ],
        )?;
        Ok(())
    }

    /// Re-read bytes for a known document; a new revision only if the bytes or parser changed.
    pub fn refresh_from_bytes(&mut self, doc_id: &str, bytes: &[u8], hash: &str, format: Format, st: Option<&FileStat>, reason: &str) -> Result<bool> {
        let doc = self.row(doc_id)?;
        let cur = match &doc.current_revision_id {
            Some(r) => self.revision_row(r)?,
            None => None,
        };
        if let Some(st) = st {
            self.exec("UPDATE documents SET src_mtime_ms = ?1, src_size = ?2, path_status = 'ok' WHERE id = ?3", params![st.mtime_ms, st.size as i64, doc_id])?;
        }
        if let Some(c) = &cur {
            if c.content_hash == hash && c.parser_version == format.parser_version() as i64 && self.cache.load(&c.id).is_some() {
                return Ok(false);
            }
        }
        let base_dir = if doc.watch != 0 || st.is_some() { Path::new(&doc.path).parent().map(Path::to_path_buf) } else { None };
        let ctx = IngestContext::new(&doc.file_name, base_dir.as_deref(), self.assets.clone());
        let parsed = parse_file(bytes, format, &ctx)?;
        let why = if cur.as_ref().map(|c| c.content_hash == hash).unwrap_or(false) { "parser-upgraded" } else { reason };
        self.add_revision(doc_id, parsed, hash, bytes, why, format)?;
        Ok(true)
    }

    fn add_revision(&mut self, doc_id: &str, parsed: ParsedDocument, hash: &str, bytes: &[u8], reason: &str, format: Format) -> Result<()> {
        let doc = self.row(doc_id)?;
        let previous = match &doc.current_revision_id {
            Some(r) => self.cache.load(r),
            None => None,
        };
        let revision_id = self.new_id();
        let snapshot = self.snapshot(format, bytes, hash);
        let prev_sections: std::collections::HashMap<String, String> = previous.as_ref().map(|p| p.doc.sections.iter().map(|s| (s.id.clone(), section_signature(&s.blocks))).collect()).unwrap_or_default();
        let changed: Vec<String> = parsed.sections.iter().filter(|s| prev_sections.get(&s.id) != Some(&section_signature(&s.blocks))).map(|s| s.id.clone()).collect();
        let removed: Vec<String> = prev_sections.keys().filter(|id| !parsed.sections.iter().any(|s| &s.id == *id)).cloned().collect();
        let idx = self.cache.save(&revision_id, parsed);
        let previous_id = previous.as_ref().map(|p| p.revision_id.clone());
        self.tx(|c| {
            c.insert_revision(doc_id, &revision_id, &idx.doc, hash, bytes.len(), reason, snapshot.as_deref())?;
            c.exec("UPDATE documents SET current_revision_id = ?1, format = ?2 WHERE id = ?3", params![revision_id, format.as_str(), doc_id])?;
            c.apply_meta(doc_id, &idx.doc)?;
            c.emit(
                "revision.created",
                Emit::doc_subject(doc_id, &revision_id),
                json!({ "revisionId": revision_id, "previousRevisionId": previous_id, "reason": reason, "changedSectionIds": changed, "removedSectionIds": removed }),
            )?;
            c.on_revision(doc_id, previous.as_deref(), &idx)?;
            Ok(())
        })?;
        self.prune_revisions(doc_id)?;
        Ok(())
    }

    /// Every new revision re-attaches every anchor of its document and reindexes its text, inside the
    /// revision transaction.
    fn on_revision(&mut self, doc_id: &str, _previous: Option<&DocIndex>, next: &Arc<DocIndex>) -> Result<()> {
        let results = self.reanchor_document(doc_id, next)?;
        if !results.is_empty() {
            self.emit("annotations.reanchored", Emit::doc(doc_id), json!({ "revisionId": next.revision_id, "results": results }))?;
        }
        self.index_revision(doc_id, next)?;
        self.index_annotations(doc_id)?;
        if !results.is_empty() {
            self.mirror_schedule(doc_id);
        }
        Ok(())
    }

    /// Keep the current revision and two before it cached; older caches and snapshots go.
    fn prune_revisions(&mut self, doc_id: &str) -> Result<()> {
        let revs: Vec<(String, Option<String>)> = self.all("SELECT id, snapshot FROM revisions WHERE document_id = ?1 ORDER BY created_at DESC, rowid DESC", params![doc_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let keep: Vec<String> = revs.iter().take(3).map(|(id, _)| id.clone()).collect();
        let keep_snapshots: Vec<String> = revs.iter().take(3).filter_map(|(_, s)| s.clone()).collect();
        for (id, snapshot) in revs.iter().skip(3) {
            self.cache.drop_revision(id);
            if let Some(s) = snapshot {
                if !keep_snapshots.contains(s) {
                    let placeholders = keep.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                    let mut args: Vec<Value> = vec![Value::String(s.clone())];
                    args.extend(keep.iter().map(|k| Value::String(k.clone())));
                    let sql = format!("SELECT COUNT(*) FROM revisions WHERE snapshot = ? AND id IN ({placeholders})");
                    let mut stmt = self.db.prepare(&sql)?;
                    let still: i64 = stmt.query_row(params_from_iter(args.iter().map(crate::core::sql_value)), |r| r.get(0))?;
                    if still == 0 {
                        let _ = std::fs::remove_file(self.data_dir.join(s));
                    }
                }
            }
        }
        Ok(())
    }

    // -------------------------------------------------------------------------------------------
    // Reading

    pub fn row(&self, id: &str) -> Result<DocumentRow> {
        self.one("SELECT * FROM documents WHERE id = ?1", params![id], DocumentRow::from_row)?.ok_or_else(|| not_found("That document"))
    }

    pub fn live_row(&self, id: &str) -> Result<DocumentRow> {
        let r = self.row(id)?;
        if r.deleted_at.is_some() {
            return Err(not_found("That document"));
        }
        Ok(r)
    }

    pub fn revision_row(&self, id: &str) -> Result<Option<RevisionRow>> {
        self.one("SELECT id, document_id, content_hash, parser_version, snapshot, created_at FROM revisions WHERE id = ?1", params![id], |r| {
            Ok(RevisionRow { id: r.get(0)?, document_id: r.get(1)?, content_hash: r.get(2)?, parser_version: r.get(3)?, snapshot: r.get(4)?, created_at: r.get(5)? })
        })
    }

    /// Make sure the document reflects its file: re-read when the file changed (or the parser did),
    /// mark it missing when it is gone. Returns the current revision's index.
    pub fn fresh(&mut self, id: &str) -> Result<Arc<DocIndex>> {
        let doc = self.live_row(id)?;
        if doc.watch != 0 || doc.format == "epub" || doc.format == "docx" {
            let path = PathBuf::from(&doc.path);
            let mut st = stat(&path);
            // Editors save by delete-and-recreate or rename: look again before calling a file missing.
            if st.is_none() && doc.path_status == "ok" {
                std::thread::sleep(Duration::from_millis(MISSING_RECHECK_MS));
                st = stat(&path);
            }
            match st {
                None => {
                    if doc.path_status != "missing" && !path.starts_with(self.data_dir.join("files")) {
                        let p = doc.path.clone();
                        self.tx(|c| {
                            c.exec("UPDATE documents SET path_status = 'missing' WHERE id = ?1", params![id])?;
                            c.emit("source.missing", Emit::doc(id), json!({ "path": p }))?;
                            Ok(())
                        })?;
                    }
                }
                Some(st) => {
                    if doc.path_status == "missing" {
                        let p = doc.path.clone();
                        self.tx(|c| {
                            c.exec("UPDATE documents SET path_status = 'ok' WHERE id = ?1", params![id])?;
                            c.emit("source.restored", Emit::doc(id), json!({ "path": p }))?;
                            Ok(())
                        })?;
                    }
                    let changed = Some(st.mtime_ms) != doc.src_mtime_ms || Some(st.size as i64) != doc.src_size;
                    let cur = match &doc.current_revision_id {
                        Some(r) => self.revision_row(r)?,
                        None => None,
                    };
                    let stale = cur.map(|c| c.parser_version != doc.format().parser_version() as i64).unwrap_or(true);
                    if changed || stale {
                        let bytes = std::fs::read(&path)?;
                        let format = check_format(detect_format(&bytes, &doc.file_name), &doc.file_name)?;
                        self.refresh_from_bytes(id, &bytes, &sha256_hex(&bytes), format, Some(&st), "source-changed")?;
                    }
                }
            }
        }
        self.index(id)
    }

    /// The current revision's index; rebuilt from the file or a snapshot if the cache is gone.
    pub fn index(&mut self, id: &str) -> Result<Arc<DocIndex>> {
        let doc = self.row(id)?;
        if let Some(rev) = &doc.current_revision_id {
            if let Some(idx) = self.cache.load(rev) {
                if idx.doc.parser_version == doc.format().parser_version() {
                    return Ok(idx);
                }
            }
        }
        let cur = match &doc.current_revision_id {
            Some(r) => self.revision_row(r)?,
            None => None,
        };
        let mut candidates: Vec<PathBuf> = vec![PathBuf::from(&doc.path)];
        if let Some(s) = cur.as_ref().and_then(|c| c.snapshot.clone()) {
            candidates.push(self.data_dir.join(s));
        }
        for p in candidates {
            let Ok(bytes) = std::fs::read(&p) else { continue };
            let hash = sha256_hex(&bytes);
            let format = check_format(detect_format(&bytes, &doc.file_name), &doc.file_name)?;
            if let Some(c) = &cur {
                if hash == c.content_hash && c.parser_version == format.parser_version() as i64 {
                    // Same bytes, same parser: rebuild the cache in place (same revision id, ids unchanged).
                    let base = if doc.watch != 0 { Path::new(&doc.path).parent().map(Path::to_path_buf) } else { None };
                    let ctx = IngestContext::new(&doc.file_name, base.as_deref(), self.assets.clone());
                    let parsed = parse_file(&bytes, format, &ctx)?;
                    return Ok(self.cache.save(&c.id, parsed));
                }
            }
            let reason = if cur.as_ref().map(|c| hash == c.content_hash).unwrap_or(false) { "parser-upgraded" } else { "source-changed" };
            self.refresh_from_bytes(id, &bytes, &hash, format, None, reason)?;
            let fresh = self.row(id)?;
            if let Some(rev) = &fresh.current_revision_id {
                if let Some(idx) = self.cache.load(rev) {
                    return Ok(idx);
                }
            }
        }
        Err(AppError::new(410, "source_missing", "The file for this document has moved or been deleted, and there is no saved copy. Add it again from its new place."))
    }

    /// A specific revision's index if it is still cached (or can be rebuilt from its snapshot).
    pub fn revision_index(&mut self, doc_id: &str, revision_id: &str) -> Result<Option<Arc<DocIndex>>> {
        if let Some(hit) = self.cache.load(revision_id) {
            return Ok(Some(hit));
        }
        let Some(rev) = self.revision_row(revision_id)? else { return Ok(None) };
        if rev.document_id != doc_id {
            return Ok(None);
        }
        let Some(snapshot) = rev.snapshot else { return Ok(None) };
        let Ok(bytes) = std::fs::read(self.data_dir.join(snapshot)) else { return Ok(None) };
        if sha256_hex(&bytes) != rev.content_hash {
            return Ok(None);
        }
        let doc = self.row(doc_id)?;
        let Ok(format) = check_format(detect_format(&bytes, &doc.file_name), &doc.file_name) else { return Ok(None) };
        if format.parser_version() as i64 != rev.parser_version {
            return Ok(None);
        }
        let base = if doc.watch != 0 { Path::new(&doc.path).parent().map(Path::to_path_buf) } else { None };
        let ctx = IngestContext::new(&doc.file_name, base.as_deref(), self.assets.clone());
        let Ok(parsed) = parse_file(&bytes, format, &ctx) else { return Ok(None) };
        Ok(Some(self.cache.save(&rev.id, parsed)))
    }

    /// Re-read the file now (POST /documents/:id/reload).
    pub fn reload(&mut self, id: &str) -> Result<DocumentDetail> {
        let doc = self.live_row(id)?;
        let path = PathBuf::from(&doc.path);
        let (Some(st), Ok(bytes)) = (stat(&path), std::fs::read(&path)) else {
            return Err(AppError::new(410, "source_missing", "The file for this document has moved or been deleted. Add it again from its new place."));
        };
        let format = check_format(detect_format(&bytes, &doc.file_name), &doc.file_name)?;
        self.refresh_from_bytes(id, &bytes, &sha256_hex(&bytes), format, Some(&st), "reload")?;
        self.detail(id)
    }

    pub fn rel_path_of(&self, path: &str) -> Option<String> {
        let root = self.reads_root.as_ref()?;
        let p = Path::new(path);
        let rel = p.strip_prefix(root).ok()?;
        if rel.as_os_str().is_empty() {
            return None;
        }
        Some(rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/"))
    }

    pub fn summary(&self, r: &DocumentRow) -> Result<DocumentSummary> {
        let authors = r.authors();
        let source = self.source_row(&r.source_id)?;
        let author = r.author_override.clone().or_else(|| if authors.is_empty() { None } else { Some(authors.join(", ")) });
        let progress = self.one("SELECT * FROM progress WHERE document_id = ?1", params![r.id], ProgressRow::from_row)?;
        Ok(DocumentSummary {
            id: r.id.clone(),
            kind: if r.format == "epub" || r.section_count > 1 { "book".into() } else { "article".into() },
            format: r.format.clone(),
            title: r.title_override.clone().unwrap_or_else(|| r.title.clone()),
            subtitle: r.subtitle.clone(),
            author,
            source_id: r.source_id.clone(),
            source_name: source.map(|s| if s.kind == "upload" { "Uploads".to_string() } else { s.name }).unwrap_or_default(),
            cover_url: r.cover_asset.as_deref().map(asset_url),
            excerpt: r.excerpt.clone().filter(|e| !e.is_empty()),
            word_count: r.word_count,
            estimated_minutes: ((r.word_count as f64 / 238.0).ceil() as i64).max(1),
            section_count: r.section_count,
            added_at: r.added_at.clone(),
            published_at: r.published_at.clone(),
            last_opened_at: r.last_opened_at.clone(),
            saved: r.saved != 0,
            progress: progress.map(|p| self.progress_view(&p)).transpose()?,
            rel_path: self.rel_path_of(&r.path),
        })
    }

    pub fn progress_view(&self, p: &ProgressRow) -> Result<ReadingProgress> {
        let mut out = ReadingProgress { doc_id: p.document_id.clone(), section_id: p.section_id.clone(), offset: p.scroll_offset, percent: p.percent, updated_at: p.updated_at.clone(), point: None, anchor: None, device_id: p.device_id.clone() };
        if let Some((point, status)) = self.progress_point(p.anchor_id.as_deref())? {
            out.point = point;
            out.anchor = Some(status);
        }
        Ok(out)
    }

    pub fn list_documents(&self, q: &DocumentQuery) -> Result<Vec<DocumentSummary>> {
        let mut where_: Vec<String> = vec!["d.deleted_at IS NULL".into()];
        let mut args: Vec<Value> = Vec::new();
        match q.kind.as_deref() {
            Some("book") => where_.push("(d.format = 'epub' OR d.section_count > 1)".into()),
            Some("article") => where_.push("(d.format != 'epub' AND d.section_count <= 1)".into()),
            _ => {}
        }
        if let Some(saved) = q.saved {
            where_.push("d.saved = ?".into());
            args.push(Value::from(saved as i64));
        }
        if let Some(s) = &q.source_id {
            where_.push("d.source_id = ?".into());
            args.push(Value::String(s.clone()));
        }
        if let Some(text) = &q.q {
            where_.push("(lower(coalesce(d.title_override, d.title)) LIKE ? ESCAPE '\\' OR lower(coalesce(d.author_override, d.authors)) LIKE ? ESCAPE '\\' OR lower(s.name) LIKE ? ESCAPE '\\' OR lower(d.file_name) LIKE ? ESCAPE '\\')".into());
            let like = format!("%{}%", text.to_lowercase().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
            for _ in 0..4 {
                args.push(Value::String(like.clone()));
            }
        }
        let order = if q.history {
            where_.push("d.last_opened_at IS NOT NULL".into());
            "d.last_opened_at DESC"
        } else {
            match q.sort.as_deref() {
                Some("title") => "lower(coalesce(d.title_override, d.title)) ASC, d.added_at DESC",
                Some("added") => "d.added_at DESC",
                _ => "max(coalesce(d.last_opened_at, d.added_at), d.added_at) DESC",
            }
        };
        let sql = format!("SELECT d.* FROM documents d LEFT JOIN sources s ON s.id = d.source_id WHERE {} ORDER BY {order}", where_.join(" AND "));
        let mut st = self.db.prepare(&sql)?;
        let rows: Vec<DocumentRow> = st.query_map(params_from_iter(args.iter().map(crate::core::sql_value)), DocumentRow::from_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        rows.iter().map(|r| self.summary(r)).collect()
    }

    pub fn detail(&mut self, id: &str) -> Result<DocumentDetail> {
        let idx = self.fresh(id)?;
        let r = self.live_row(id)?;
        let toc: Vec<TocEntry> = idx.doc.sections.iter().enumerate().map(|(i, s)| TocEntry { id: s.id.clone(), title: s.title.clone(), index: i, depth: s.depth, block_id: first_leaf(&s.blocks).map(|l| l.id.clone()) }).collect();
        let source = self.source_row(&r.source_id)?;
        Ok(DocumentDetail {
            summary: self.summary(&r)?,
            toc,
            revision_id: idx.revision_id.clone(),
            live: r.watch != 0 && r.path_status == "ok",
            authors: r.authors(),
            language: r.language.clone(),
            path: Some(if source.map(|s| s.kind == "upload").unwrap_or(false) { String::new() } else { r.path.clone() }),
            path_status: r.path_status.clone(),
            warnings: idx.doc.warnings.clone(),
            outline: idx.doc.outline.clone(),
        })
    }

    /// A section of the current revision. An id from an older revision resolves to the section that
    /// now holds that section's first block.
    pub fn section_index_for(&mut self, doc_id: &str, section_id: &str, idx: &DocIndex) -> Result<usize> {
        if let Some(&si) = idx.section_by_id.get(section_id) {
            return Ok(si);
        }
        let revs: Vec<String> = self.all("SELECT id FROM revisions WHERE document_id = ?1 AND id != ?2 ORDER BY created_at DESC LIMIT 5", params![doc_id, idx.revision_id], |r| r.get(0))?;
        for r in revs {
            if let Some(old) = self.cache.load(&r) {
                if let Some(&osi) = old.section_by_id.get(section_id) {
                    for l in all_leaves(&old.doc.sections[osi].blocks) {
                        if let Some(e) = idx.leaf(&l.id) {
                            return Ok(e.section_index);
                        }
                    }
                }
            }
        }
        Err(not_found("That section"))
    }

    pub fn section(&mut self, doc_id: &str, section_id: &str, include: &[String]) -> Result<Section> {
        let idx = self.fresh(doc_id)?;
        let si = self.section_index_for(doc_id, section_id, &idx)?;
        let s = &idx.doc.sections[si];
        let rendered = idx.render(si);
        let mut out = Section {
            id: s.id.clone(),
            doc_id: doc_id.to_string(),
            index: si,
            title: s.title.clone(),
            html: rendered.html.clone(),
            prev_id: si.checked_sub(1).and_then(|i| idx.doc.sections.get(i)).map(|p| p.id.clone()),
            next_id: idx.doc.sections.get(si + 1).map(|n| n.id.clone()),
            revision_id: idx.revision_id.clone(),
            blocks: None,
            notes: None,
            annotations: None,
        };
        if include.iter().any(|i| i == "blocks") {
            out.blocks = Some(s.blocks.clone());
            out.notes = Some(s.notes.clone());
        }
        if include.iter().any(|i| i == "annotations") {
            out.annotations = Some(self.annotations_for_section(doc_id, &idx, &s.id)?);
        }
        Ok(out)
    }

    pub fn patch_document(&mut self, id: &str, saved: Option<bool>, title: Option<Option<String>>, author: Option<Option<String>>) -> Result<DocumentSummary> {
        self.live_row(id)?;
        let mut fields: Vec<&str> = Vec::new();
        let now = self.now();
        self.tx(|c| {
            if let Some(s) = saved {
                c.exec("UPDATE documents SET saved = ?1 WHERE id = ?2", params![s as i64, id])?;
                fields.push("saved");
            }
            if let Some(t) = &title {
                let v = t.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty());
                c.exec("UPDATE documents SET title_override = ?1 WHERE id = ?2", params![v, id])?;
                fields.push("title");
            }
            if let Some(a) = &author {
                let v = a.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty());
                c.exec("UPDATE documents SET author_override = ?1 WHERE id = ?2", params![v, id])?;
                fields.push("author");
            }
            if !fields.is_empty() {
                c.exec("UPDATE documents SET updated_at = ?1 WHERE id = ?2", params![now, id])?;
                c.emit("document.updated", Emit::doc(id), json!({ "fields": fields }))?;
            }
            Ok(())
        })?;
        if fields.contains(&"title") || fields.contains(&"author") {
            self.mirror_schedule(id);
        }
        let r = self.row(id)?;
        self.summary(&r)
    }

    pub fn remove_document(&mut self, id: &str) -> Result<()> {
        self.live_row(id)?;
        let now = self.now();
        self.tx(|c| {
            c.exec("UPDATE documents SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2", params![now, id])?;
            c.emit("document.removed", Emit::doc(id), json!({}))?;
            Ok(())
        })?;
        self.notify(Notice::DocumentsRemoved(id.to_string()));
        Ok(())
    }

    /// Save the reading place. `device_id` is the paired device writing it (None: the desktop). With
    /// `updatedAt`, an older place than the stored one is refused (409 progress_conflict) and nothing
    /// is written; that is how an offline device avoids moving you back.
    pub fn save_progress(&mut self, id: &str, u: &Value, device_id: Option<&str>) -> Result<ReadingProgress> {
        self.live_row(id)?;
        let o = u.as_object().ok_or_else(|| invalid("Progress needs a sectionId."))?;
        let section_id_in = o.get("sectionId").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or_else(|| invalid("Progress needs a sectionId."))?.to_string();
        let client_at: Option<i64> = match o.get("updatedAt") {
            None => None,
            Some(Value::String(s)) => Some(parse_iso(s).ok_or_else(|| invalid("updatedAt should be an ISO-8601 time."))?),
            Some(_) => return Err(invalid("updatedAt should be an ISO-8601 time.")),
        };
        let idx = self.index(id)?;
        let offset = clamp01(o.get("offset"));
        let mut section_id = section_id_in.clone();
        let mut percent = clamp01(o.get("percent"));
        let si = match idx.section_by_id.get(&section_id) {
            Some(&si) => Some(si),
            None => self.section_index_for(id, &section_id, &idx).ok(),
        };
        if let Some(si) = si {
            section_id = idx.doc.sections[si].id.clone();
            percent = idx.percent_at(si, offset);
        }
        let now = self.now();
        let prev = self.one("SELECT * FROM progress WHERE document_id = ?1", params![id], ProgressRow::from_row)?;
        if let (Some(ca), Some(p)) = (client_at, &prev) {
            if parse_iso(&p.updated_at).map(|t| ca < t).unwrap_or(false) {
                let current = self.progress_view(p)?;
                return Err(AppError::new(409, "progress_conflict", "A newer reading place was saved for this book, so this one was not.").with_extra("progress", serde_json::to_value(current)?));
            }
        }
        // The place is as old as the client says (never in the future), so the next comparison is fair.
        let at = match client_at {
            None => now.clone(),
            Some(ca) => iso_ms(ca.min(self.now_ms())),
        };
        let point: Option<BlockPoint> = o.get("point").and_then(|p| serde_json::from_value(p.clone()).ok());
        let revision_id = o.get("revisionId").and_then(Value::as_str).map(str::to_string);
        let reason_jump = o.get("reason").and_then(Value::as_str) == Some("jump");
        let dev = device_id.map(str::to_string);
        let prev_c = prev.clone();
        self.tx(|c| {
            let mut anchor_id = prev_c.as_ref().and_then(|p| p.anchor_id.clone());
            if let Some(pt) = &point {
                anchor_id = c.set_progress_point(id, &idx, anchor_id.as_deref(), pt, revision_id.as_deref())?;
            }
            c.exec(
                "INSERT INTO progress (document_id, section_id, scroll_offset, percent, anchor_id, updated_at, device_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(document_id) DO UPDATE SET section_id = excluded.section_id, scroll_offset = excluded.scroll_offset,
                 percent = excluded.percent, anchor_id = excluded.anchor_id, updated_at = excluded.updated_at, device_id = excluded.device_id",
                params![id, section_id, offset, percent, anchor_id, at, dev],
            )?;
            c.exec("UPDATE documents SET last_opened_at = ?1 WHERE id = ?2", params![now, id])?;
            if reason_jump {
                c.emit("progress.jumped", Emit::doc(id), json!({ "fromSectionId": prev_c.as_ref().map(|p| p.section_id.clone()), "toSectionId": section_id }))?;
            }
            // Not one event per page turn: only a new section, or a different device taking over.
            let same = prev_c.as_ref().map(|p| p.section_id == section_id && p.device_id == dev).unwrap_or(false);
            if !same {
                c.emit("progress.updated", Emit::doc(id), json!({ "sectionId": section_id, "percent": percent, "deviceId": dev }))?;
            }
            Ok(())
        })?;
        if prev.is_none() {
            self.notify(Notice::DocumentOpened(id.to_string()));
        }
        self.session_touch(id, percent)?;
        let row = self.one("SELECT * FROM progress WHERE document_id = ?1", params![id], ProgressRow::from_row)?.ok_or_else(|| not_found("That document"))?;
        self.progress_view(&row)
    }

    /// Selectors for a point in the current revision (used when the reading place is set).
    pub fn selectors_for_point(&self, idx: &DocIndex, point: &BlockPoint) -> Result<crate::anchoring::selectors::StoredSelectors> {
        selectors_for(idx, &TextRange { start: point.clone(), end: point.clone() })
    }
}
