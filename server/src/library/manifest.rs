//! What an offline mirror needs to know: every document's current revision, its file hash and size.

use crate::core::Core;
use crate::model::*;
use crate::Result;
use rusqlite::{params, Row};
use std::collections::BTreeSet;

struct ManifestRow {
    id: String,
    title: String,
    title_override: Option<String>,
    authors: String,
    author_override: Option<String>,
    format: String,
    path: String,
    section_count: i64,
    updated_at: String,
    deleted_at: Option<String>,
    revision_id: String,
    content_hash: String,
    bytes: i64,
}

fn from_row(r: &Row) -> rusqlite::Result<ManifestRow> {
    Ok(ManifestRow {
        id: r.get("id")?,
        title: r.get("title")?,
        title_override: r.get("title_override")?,
        authors: r.get("authors")?,
        author_override: r.get("author_override")?,
        format: r.get("format")?,
        path: r.get("path")?,
        section_count: r.get("section_count")?,
        updated_at: r.get("updated_at")?,
        deleted_at: r.get("deleted_at")?,
        revision_id: r.get("revision_id")?,
        content_hash: r.get("content_hash")?,
        bytes: r.get("bytes")?,
    })
}

const SELECT: &str = "SELECT d.id, d.title, d.title_override, d.authors, d.author_override, d.format, d.path, d.section_count, d.updated_at, d.deleted_at,
    r.id AS revision_id, r.content_hash, r.bytes FROM documents d JOIN revisions r ON r.id = d.current_revision_id";

impl Core {
    /// With `after` (a journal seq), only the documents touched since then, and the ones deleted. When
    /// the journal no longer reaches back to `after`, the answer is the whole library with `full: true`.
    pub fn sync_manifest(&self, after: Option<i64>) -> Result<SyncManifest> {
        let cursor: i64 = self.one("SELECT seq FROM sqlite_sequence WHERE name = 'events'", params![], |r| r.get(0))?.unwrap_or(0);
        let oldest: Option<i64> = self.one("SELECT MIN(seq) FROM events", params![], |r| r.get(0))?;
        let first_kept = oldest.unwrap_or(cursor + 1);
        let full = match after {
            None => true,
            Some(a) => a > cursor || a < first_kept - 1,
        };
        let rows: Vec<ManifestRow> = if full {
            self.all(&format!("{SELECT} WHERE d.deleted_at IS NULL ORDER BY d.id"), params![], from_row)?
        } else {
            let after = after.unwrap();
            let touched: Vec<(Option<String>, Option<String>, String)> = self.all(
                "SELECT document_id, subject_id, type FROM events WHERE seq > ?1 AND (type LIKE 'document.%' OR type IN ('revision.created', 'import.applied'))",
                params![after],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )?;
            let mut ids: BTreeSet<String> = BTreeSet::new();
            for (doc, subject, kind) in touched {
                if let Some(d) = doc {
                    ids.insert(d);
                }
                if kind == "document.merged" {
                    if let Some(s) = subject {
                        ids.insert(s);
                    }
                }
            }
            let mut out = Vec::new();
            for id in ids {
                if let Some(r) = self.one(&format!("{SELECT} WHERE d.id = ?1"), params![id], from_row)? {
                    out.push(r);
                }
            }
            out
        };
        let mut documents = Vec::new();
        let mut deleted = Vec::new();
        for r in rows {
            if let Some(d) = r.deleted_at {
                deleted.push(DeletedDocument { id: r.id, deleted_at: d });
                continue;
            }
            let authors: Vec<String> = crate::db::from_json(Some(&r.authors), vec![]);
            let author = r.author_override.clone().or_else(|| if authors.is_empty() { None } else { Some(authors.join(", ")) });
            documents.push(ManifestDocument {
                rel_path: self.rel_path_of(&r.path),
                id: r.id,
                title: r.title_override.unwrap_or(r.title),
                author,
                format: r.format,
                revision_id: r.revision_id,
                content_hash: r.content_hash,
                size: r.bytes,
                section_count: r.section_count,
                updated_at: r.updated_at,
            });
        }
        Ok(SyncManifest { cursor, full, documents, deleted })
    }
}
