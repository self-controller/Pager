//! Keeps `<mirror dir>/<slug>--<id8>.md` in step with each document's annotations: debounced, atomic,
//! skipped when nothing changed. The mirror never overwrites a file the reader edited: if the file on
//! disk isn't what the mirror last wrote, it is moved aside to `<name>.edited-<time>.md` first.

use super::format::{mirror_markdown, slug, MirrorDoc};
use crate::clock::file_stamp;
use crate::core::Core;
use crate::ids::sha256_hex;
use crate::Result;
use rusqlite::params;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

impl Core {
    pub fn mirror_dir(&self) -> PathBuf {
        match self.app_settings().mirror.dir {
            Some(d) => {
                let home = std::env::var("HOME").unwrap_or_else(|_| "~".into());
                let d = if d == "~" { home } else if let Some(rest) = d.strip_prefix("~/") { format!("{home}/{rest}") } else { d };
                crate::config::absolute(PathBuf::from(d))
            }
            None => self.data_dir.join("notes"),
        }
    }

    pub fn mirror_schedule(&mut self, doc_id: &str) {
        if !self.app_settings().mirror.enabled {
            return;
        }
        let due = Instant::now() + Duration::from_millis(self.mirror_delay_ms);
        self.mirror_pending.insert(doc_id.to_string(), due);
    }

    /// Write everything that is due (the background flusher calls this every so often).
    pub fn mirror_flush_due(&mut self) -> Result<usize> {
        let now = Instant::now();
        let due: Vec<String> = self.mirror_pending.iter().filter(|(_, t)| **t <= now).map(|(id, _)| id.clone()).collect();
        for id in &due {
            self.mirror_pending.remove(id);
        }
        let mut n = 0;
        for id in due {
            match self.mirror_write(&id) {
                Ok(true) => n += 1,
                Ok(false) => {}
                Err(e) => eprintln!("mirror: {e}"),
            }
        }
        Ok(n)
    }

    /// Write everything still pending (shutdown, tests).
    pub fn mirror_flush(&mut self) -> Result<()> {
        let ids: Vec<String> = self.mirror_pending.keys().cloned().collect();
        self.mirror_pending.clear();
        for id in ids {
            let _ = self.mirror_write(&id);
        }
        Ok(())
    }

    /// Rewrite every document's mirror (POST /mirror/rebuild).
    pub fn mirror_rebuild(&mut self) -> Result<usize> {
        let ids: Vec<String> = self.all("SELECT DISTINCT document_id FROM annotations", params![], |r| r.get(0))?;
        let mut n = 0;
        for id in ids {
            if self.mirror_write(&id)? {
                n += 1;
            }
        }
        Ok(n)
    }

    /// Returns true if a file was written.
    pub fn mirror_write(&mut self, doc_id: &str) -> Result<bool> {
        if !self.app_settings().mirror.enabled {
            return Ok(false);
        }
        let Some(row) = self.one("SELECT * FROM documents WHERE id = ?1", params![doc_id], crate::library::library::DocumentRow::from_row)? else { return Ok(false) };
        // Not in the library any more: the notes file stays as it is (it's the reader's portable copy).
        if row.deleted_at.is_some() {
            return Ok(false);
        }
        let prev: Option<(String, String)> = self.one("SELECT path, content_hash FROM mirror_files WHERE document_id = ?1", params![doc_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let annotations = self.list_annotations(doc_id, false).unwrap_or_default();
        let title = row.title_override.clone().unwrap_or_else(|| row.title.clone());
        let file = self.mirror_dir().join(format!("{}--{}.md", slug(&title), &doc_id[doc_id.len().saturating_sub(8)..]));
        let ours = |p: &str| -> bool {
            match std::fs::read(p) {
                Ok(bytes) => Some(sha256_hex(&bytes)) == prev.as_ref().map(|(_, h)| h.clone()),
                Err(_) => true, // gone: nothing of the reader's to protect
            }
        };
        // No annotations left: remove our file (only if it's still ours).
        if annotations.is_empty() {
            if let Some((p, _)) = &prev {
                if ours(p) {
                    let _ = std::fs::remove_file(p);
                }
                self.exec("DELETE FROM mirror_files WHERE document_id = ?1", params![doc_id])?;
            }
            return Ok(false);
        }
        let sections: Vec<(String, String)> = self.index(doc_id).map(|idx| idx.doc.sections.iter().map(|s| (s.id.clone(), s.title.clone())).collect()).unwrap_or_default();
        let source_kind: Option<String> = self.one("SELECT kind FROM sources WHERE id = ?1", params![row.source_id], |r| r.get(0))?;
        let content = mirror_markdown(
            &MirrorDoc {
                id: doc_id.to_string(),
                title,
                authors: row.authors(),
                format: row.format.clone(),
                path: if source_kind.as_deref() == Some("upload") { String::new() } else { row.path.clone() },
                section_titles: sections.iter().cloned().collect(),
                section_order: sections.iter().map(|(id, _)| id.clone()).collect(),
            },
            &annotations,
            &format!("http://localhost:{}", self.port),
        );
        let hash = sha256_hex(content.as_bytes());
        let file_s = file.to_string_lossy().into_owned();
        if let Some((p, h)) = &prev {
            if *p == file_s && *h == hash && file.exists() {
                return Ok(false);
            }
        }
        std::fs::create_dir_all(file.parent().unwrap())?;
        // The title changed: move our old file out of the way (if the reader edited it, keep it as is).
        if let Some((p, _)) = &prev {
            if *p != file_s && ours(p) {
                let _ = std::fs::remove_file(p);
            }
        }
        if file.exists() && (prev.as_ref().map(|(p, _)| *p != file_s).unwrap_or(true) || !ours(&file_s)) {
            let stamp = file_stamp(self.now_ms());
            let aside = file.with_file_name(format!("{}.edited-{stamp}.md", file.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()));
            let _ = std::fs::rename(&file, aside);
        }
        let tmp = file.with_file_name(format!("{}.{}.tmp", file.file_name().unwrap().to_string_lossy(), std::process::id()));
        std::fs::write(&tmp, &content)?;
        std::fs::rename(&tmp, &file)?;
        self.exec("INSERT OR REPLACE INTO mirror_files (document_id, path, content_hash, written_at) VALUES (?1, ?2, ?3, ?4)", params![doc_id, file_s, hash, self.now()])?;
        Ok(true)
    }

    /// Mirror files not written yet (for tests).
    pub fn mirror_pending_ids(&self) -> Vec<String> {
        self.mirror_pending.keys().cloned().collect()
    }

    pub fn mirror_pending_map(&self) -> &HashMap<String, Instant> {
        &self.mirror_pending
    }
}
