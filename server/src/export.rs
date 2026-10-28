//! `pager-export/1`: everything the app keeps, as one JSON file. Anchors travel as words and
//! context (not block ids), so an import finds the places again in any copy of the file. Documents
//! are matched by the hashes of every version Pager has seen; ones not in the library yet wait and
//! attach as soon as the file is added.

use crate::anchoring::doctext::DocIndex;
use crate::anchoring::matcher::locate;
use crate::anchoring::selectors::{selectors_for_span, StoredSelectors};
use crate::anchoring::store::AnchorRow;
use crate::config::VERSION;
use crate::core::Core;
use crate::db::{from_json, to_json};
use crate::errors::invalid;
use crate::journal::Emit;
use crate::model::*;
use crate::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::sync::Arc;

fn export_anchor(r: &AnchorRow) -> ExportedAnchor {
    ExportedAnchor { exact: r.exact.clone(), prefix: r.prefix.clone(), suffix: r.suffix.clone(), position: Position { start: r.doc_start.max(0) as usize, end: r.doc_end.max(0) as usize }, status: r.status(), original_quote: r.original_quote.clone() }
}

#[derive(Serialize, Deserialize)]
struct Waiting {
    document: ExportedDocument,
    annotations: Vec<ExportedAnnotation>,
    records: Vec<ExportedRecord>,
    progress: Vec<ExportedProgress>,
    settings: Option<Map<String, Value>>,
}

impl Core {
    pub fn export(&self, doc_id: Option<&str>) -> Result<PagerExport> {
        let doc_rows = match doc_id {
            Some(d) => self.all("SELECT * FROM documents d WHERE d.id = ?1 ORDER BY d.added_at", params![d], crate::library::library::DocumentRow::from_row)?,
            None => self.all("SELECT * FROM documents d WHERE (d.deleted_at IS NULL OR EXISTS (SELECT 1 FROM annotations a WHERE a.document_id = d.id)) ORDER BY d.added_at", params![], crate::library::library::DocumentRow::from_row)?,
        };
        let ids: Vec<String> = doc_rows.iter().map(|d| d.id.clone()).collect();
        let mut documents = Vec::new();
        for d in &doc_rows {
            let hashes: Vec<String> = self.all("SELECT DISTINCT content_hash FROM revisions WHERE document_id = ?1 ORDER BY created_at", params![d.id], |r| r.get(0))?;
            documents.push(ExportedDocument {
                id: d.id.clone(),
                title: d.title.clone(),
                authors: d.authors(),
                format: d.format.clone(),
                path: d.path.clone(),
                file_name: d.file_name.clone(),
                content_hashes: hashes,
                identifier: d.identifier.clone(),
                added_at: d.added_at.clone(),
                last_opened_at: d.last_opened_at.clone(),
                saved: d.saved != 0,
                title_override: d.title_override.clone(),
                author_override: d.author_override.clone(),
            });
        }
        let anchor_of = |id: Option<&str>| -> Result<Option<AnchorRow>> {
            match id {
                Some(i) => self.anchor_row(i),
                None => Ok(None),
            }
        };
        let ann_rows: Vec<(String, String, String, String, Option<String>, String, Option<String>, String, String, String, Option<String>)> = self.all(
            "SELECT id, document_id, anchor_id, kind, color, style, body, tags, created_at, updated_at, deleted_at FROM annotations ORDER BY created_at, id",
            params![],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?)),
        )?;
        let mut annotations = Vec::new();
        for (id, document_id, anchor_id, kind, color, style, body, tags, created_at, updated_at, deleted_at) in ann_rows {
            if !ids.contains(&document_id) {
                continue;
            }
            let Some(a) = anchor_of(Some(&anchor_id))? else { continue };
            annotations.push(ExportedAnnotation { id, doc_id: document_id, kind, color, style, body, tags: from_json(Some(&tags), vec![]), created_at, updated_at, deleted_at, anchor: export_anchor(&a) });
        }
        let rec_rows: Vec<(String, String, Option<String>, Option<String>, String, String, String, Option<String>)> = self.all(
            "SELECT id, tool_id, document_id, anchor_id, data, created_at, updated_at, deleted_at FROM tool_records ORDER BY created_at, id",
            params![],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)),
        )?;
        let mut records = Vec::new();
        for (id, tool_id, document_id, anchor_id, data, created_at, updated_at, deleted_at) in rec_rows {
            let keep = match doc_id {
                Some(d) => document_id.as_deref() == Some(d),
                None => document_id.as_ref().map(|x| ids.contains(x)).unwrap_or(true),
            };
            if !keep {
                continue;
            }
            let a = anchor_of(anchor_id.as_deref())?;
            records.push(ExportedRecord { id, tool_id, doc_id: document_id, data: from_json(Some(&data), Value::Null), created_at, updated_at, deleted_at, anchor: a.as_ref().map(export_anchor) });
        }
        let prog_rows: Vec<(String, String, f64, f64, Option<String>, String)> = self.all("SELECT document_id, section_id, scroll_offset, percent, anchor_id, updated_at FROM progress", params![], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?;
        let mut progress = Vec::new();
        for (document_id, section_id, offset, percent, anchor_id, updated_at) in prog_rows {
            if !ids.contains(&document_id) {
                continue;
            }
            let a = anchor_of(anchor_id.as_deref())?;
            progress.push(ExportedProgress { doc_id: document_id, section_id, offset, percent, updated_at, place: a.as_ref().map(export_anchor) });
        }
        let mut doc_settings = Map::new();
        for id in &ids {
            let v = self.settings_raw(&format!("doc:{id}"))?;
            if !v.is_empty() {
                doc_settings.insert(id.clone(), Value::Object(v));
            }
        }
        let presets: Vec<ExportedPreset> = self.presets()?.into_iter().map(|p| ExportedPreset { id: p.id, name: p.name, values: p.values, created_at: p.created_at, updated_at: p.updated_at }).collect();
        Ok(PagerExport {
            format: "pager-export".into(),
            version: 1,
            exported_at: self.now(),
            app: ExportApp { version: VERSION.into() },
            documents,
            annotations,
            records,
            progress,
            settings: ExportedSettings { global: if doc_id.is_some() { Map::new() } else { self.settings_raw("global")? }, documents: doc_settings, app: if doc_id.is_some() { Map::new() } else { self.settings_raw("app")? } },
            presets: if doc_id.is_some() { vec![] } else { presets },
        })
    }

    /// A local document for these hashes (any version), or for the same identifier and format.
    fn match_export(&self, d: &ExportedDocument) -> Result<Option<String>> {
        for h in &d.content_hashes {
            if let Some(id) = self.one("SELECT r.document_id FROM revisions r JOIN documents x ON x.id = r.document_id WHERE r.content_hash = ?1 ORDER BY x.deleted_at IS NOT NULL LIMIT 1", params![h], |r| r.get::<_, String>(0))? {
                return Ok(Some(id));
            }
        }
        if let Some(ident) = &d.identifier {
            if let Some(id) = self.one("SELECT id FROM documents WHERE identifier = ?1 AND format = ?2 AND deleted_at IS NULL LIMIT 1", params![ident, d.format], |r| r.get::<_, String>(0))? {
                return Ok(Some(id));
            }
        }
        Ok(None)
    }

    pub fn import(&mut self, data: &Value) -> Result<ImportResult> {
        let o = data.as_object().ok_or_else(|| invalid("This isn't a Pager export (format should be \"pager-export\")."))?;
        if o.get("format").and_then(Value::as_str) != Some("pager-export") {
            return Err(invalid("This isn't a Pager export (format should be \"pager-export\")."));
        }
        if o.get("version").and_then(Value::as_i64) != Some(1) {
            return Err(invalid(format!("This export is version {}; this Pager reads version 1.", o.get("version").map(|v| v.to_string()).unwrap_or_else(|| "undefined".into()))));
        }
        for k in ["documents", "annotations", "records", "progress", "presets"] {
            if !o.get(k).map(Value::is_array).unwrap_or(false) {
                return Err(invalid(format!("The export's {k} should be a list.")));
            }
        }
        let x: PagerExport = serde_json::from_value(data.clone()).map_err(|e| invalid(format!("This export can't be read ({e}).")))?;
        let mut result = ImportResult::default();
        let now = self.now();
        // Library-wide settings fill in what isn't set here; local choices win.
        self.fill_scope("global", &x.settings.global)?;
        self.fill_scope("app", &x.settings.app)?;
        for p in &x.presets {
            if !self.exists("SELECT 1 FROM presets WHERE id = ?1", params![p.id])? {
                self.exec("INSERT INTO presets (id, name, value, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![p.id, p.name, to_json(&p.values), p.created_at, p.updated_at])?;
            }
        }
        for d in &x.documents {
            let items = Waiting {
                document: d.clone(),
                annotations: x.annotations.iter().filter(|a| a.doc_id == d.id).cloned().collect(),
                records: x.records.iter().filter(|r| r.doc_id.as_deref() == Some(&d.id)).cloned().collect(),
                progress: x.progress.iter().filter(|p| p.doc_id == d.id).cloned().collect(),
                settings: x.settings.documents.get(&d.id).and_then(Value::as_object).cloned(),
            };
            match self.match_export(d)? {
                Some(local) => {
                    result.documents.matched += 1;
                    self.apply_import(&local, &items, &mut result)?;
                }
                None => {
                    result.documents.waiting += 1;
                    self.exec("INSERT OR REPLACE INTO import_queue (id, content_hashes, identifier, payload, created_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![d.id, to_json(&d.content_hashes), d.identifier, to_json(&items), now])?;
                }
            }
        }
        // Records not tied to a document.
        for r in x.records.iter().filter(|r| r.doc_id.is_none()) {
            self.apply_record(None, None, r, &mut result)?;
        }
        Ok(result)
    }

    fn fill_scope(&mut self, scope: &str, values: &Map<String, Value>) -> Result<()> {
        if values.is_empty() {
            return Ok(());
        }
        let cur = self.settings_raw(scope)?;
        let mut merged = values.clone();
        for (k, v) in cur {
            merged.insert(k, v);
        }
        self.exec("INSERT INTO settings (scope, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(scope) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", params![scope, to_json(&Value::Object(merged)), self.now()])?;
        Ok(())
    }

    /// When a file arrives, attach anything that was waiting for it.
    pub fn apply_waiting_imports(&mut self, doc_id: &str) -> Result<usize> {
        let hashes: Vec<String> = self.all("SELECT content_hash FROM revisions WHERE document_id = ?1", params![doc_id], |r| r.get(0))?;
        let identifier: Option<String> = self.one("SELECT identifier FROM documents WHERE id = ?1", params![doc_id], |r| r.get::<_, Option<String>>(0))?.flatten();
        let queue: Vec<(String, String, Option<String>, String)> = self.all("SELECT id, content_hashes, identifier, payload FROM import_queue", params![], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
        let mut applied = 0;
        for (id, content_hashes, ident, payload) in queue {
            let qh: Vec<String> = from_json(Some(&content_hashes), vec![]);
            if !qh.iter().any(|h| hashes.contains(h)) && !(identifier.is_some() && ident == identifier) {
                continue;
            }
            let Some(w): Option<Waiting> = serde_json::from_str(&payload).ok() else { continue };
            let mut result = ImportResult { documents: DocCounts { matched: 1, waiting: 0 }, ..Default::default() };
            self.apply_import(doc_id, &w, &mut result)?;
            self.exec("DELETE FROM import_queue WHERE id = ?1", params![id])?;
            applied += 1;
        }
        Ok(applied)
    }

    fn place_in(&self, idx: &DocIndex, a: &ExportedAnchor) -> Option<(StoredSelectors, AnchorStatus, f64)> {
        let probe = StoredSelectors {
            revision_id: String::new(),
            section_id: String::new(),
            start: BlockPoint { block_id: String::new(), offset: 0 },
            end: BlockPoint { block_id: String::new(), offset: 0 },
            doc_start: a.position.start,
            doc_end: a.position.end,
            exact: a.exact.clone(),
            prefix: a.prefix.clone(),
            suffix: a.suffix.clone(),
            ambiguous: false,
        };
        let found = locate(&probe, idx.length(), idx)?;
        let sel = selectors_for_span(idx, found.doc_start, found.doc_end).ok()?;
        // Found by its words in a copy of the file: exact text is "moved" at most, never "anchored" by id.
        let status = if found.status == AnchorStatus::Anchored { AnchorStatus::Moved } else { found.status };
        Some((sel, status, found.confidence))
    }

    fn insert_exported_anchor(&mut self, doc_id: &str, owner: &str, idx: &DocIndex, a: &ExportedAnchor) -> Result<String> {
        if let Some((sel, status, confidence)) = self.place_in(idx, a) {
            let id = self.anchor_insert(doc_id, owner, &sel)?;
            self.exec("UPDATE anchors SET status = ?1, confidence = ?2, original_quote = ?3 WHERE id = ?4", params![status.as_str(), confidence, a.original_quote, id])?;
            return Ok(id);
        }
        let id = self.new_id();
        let now = self.now();
        self.exec(
            "INSERT INTO anchors (id, document_id, owner, revision_id, section_id, start_block, start_offset, end_block, end_offset, doc_start, doc_end,
             exact, prefix, suffix, status, confidence, original_quote, checked_revision_id, ambiguous, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, '', '', 0, '', 0, ?5, ?6, ?7, ?8, ?9, 'orphaned', 0, ?10, ?4, 0, ?11, ?11)",
            params![id, doc_id, owner, idx.revision_id, a.position.start as i64, a.position.end as i64, a.exact, a.prefix, a.suffix, a.original_quote, now],
        )?;
        Ok(id)
    }

    fn apply_import(&mut self, doc_id: &str, w: &Waiting, result: &mut ImportResult) -> Result<()> {
        let idx: Arc<DocIndex> = self.index(doc_id)?;
        self.tx(|c| {
            let d = &w.document;
            if d.saved {
                c.exec("UPDATE documents SET saved = 1 WHERE id = ?1", params![doc_id])?;
            }
            if let Some(t) = &d.title_override {
                c.exec("UPDATE documents SET title_override = coalesce(title_override, ?1) WHERE id = ?2", params![t, doc_id])?;
            }
            if let Some(a) = &d.author_override {
                c.exec("UPDATE documents SET author_override = coalesce(author_override, ?1) WHERE id = ?2", params![a, doc_id])?;
            }
            if let Some(l) = &d.last_opened_at {
                c.exec("UPDATE documents SET last_opened_at = max(coalesce(last_opened_at, ''), ?1) WHERE id = ?2", params![l, doc_id])?;
            }
            if let Some(s) = &w.settings {
                c.fill_scope(&format!("doc:{doc_id}"), s)?;
            }
            for a in &w.annotations {
                let cur: Option<String> = c.one("SELECT updated_at FROM annotations WHERE id = ?1", params![a.id], |r| r.get(0))?;
                if let Some(cur) = cur {
                    if a.updated_at > cur {
                        c.exec("UPDATE annotations SET kind = ?1, color = ?2, style = ?3, body = ?4, tags = ?5, updated_at = ?6, deleted_at = ?7 WHERE id = ?8", params![a.kind, a.color, a.style, a.body, to_json(&a.tags), a.updated_at, a.deleted_at, a.id])?;
                        result.annotations.updated += 1;
                    } else {
                        result.annotations.unchanged += 1;
                    }
                    continue;
                }
                let anchor_id = c.insert_exported_anchor(doc_id, "annotation", &idx, &a.anchor)?;
                c.exec(
                    "INSERT INTO annotations (id, document_id, anchor_id, kind, color, style, body, tags, request_hash, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10, ?11)",
                    params![a.id, doc_id, anchor_id, a.kind, a.color, a.style, a.body, to_json(&a.tags), a.created_at, a.updated_at, a.deleted_at],
                )?;
                result.annotations.added += 1;
            }
            for r in &w.records {
                c.apply_record(Some(doc_id), Some(&idx), r, result)?;
            }
            for p in &w.progress {
                let cur: Option<String> = c.one("SELECT updated_at FROM progress WHERE document_id = ?1", params![doc_id], |r| r.get(0))?;
                if cur.map(|u| u >= p.updated_at).unwrap_or(false) {
                    continue;
                }
                let anchor_id = match &p.place {
                    Some(place) => Some(c.insert_exported_anchor(doc_id, "progress", &idx, place)?),
                    None => None,
                };
                let section_id = if idx.section_by_id.contains_key(&p.section_id) { p.section_id.clone() } else { idx.doc.sections.first().map(|s| s.id.clone()).unwrap_or_else(|| p.section_id.clone()) };
                c.exec(
                    "INSERT INTO progress (document_id, section_id, scroll_offset, percent, anchor_id, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(document_id) DO UPDATE SET section_id = excluded.section_id, scroll_offset = excluded.scroll_offset, percent = excluded.percent,
                     anchor_id = excluded.anchor_id, updated_at = excluded.updated_at",
                    params![doc_id, section_id, p.offset, p.percent, anchor_id, p.updated_at],
                )?;
            }
            c.emit("import.applied", Emit::doc(doc_id), json!({ "annotations": w.annotations.len(), "records": w.records.len() }))?;
            Ok(())
        })?;
        self.annotations_changed(doc_id)
    }

    fn apply_record(&mut self, doc_id: Option<&str>, idx: Option<&Arc<DocIndex>>, r: &ExportedRecord, result: &mut ImportResult) -> Result<()> {
        let cur: Option<String> = self.one("SELECT updated_at FROM tool_records WHERE id = ?1", params![r.id], |row| row.get(0))?;
        if let Some(cur) = cur {
            if r.updated_at > cur {
                self.exec("UPDATE tool_records SET data = ?1, updated_at = ?2, deleted_at = ?3 WHERE id = ?4", params![to_json(&r.data), r.updated_at, r.deleted_at, r.id])?;
                result.records.updated += 1;
            } else {
                result.records.unchanged += 1;
            }
            return Ok(());
        }
        let anchor_id = match (doc_id, idx, &r.anchor) {
            (Some(d), Some(idx), Some(a)) => Some(self.insert_exported_anchor(d, "record", idx, a)?),
            _ => None,
        };
        self.exec(
            "INSERT INTO tool_records (id, tool_id, document_id, anchor_id, data, request_hash, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8)",
            params![r.id, r.tool_id, doc_id, anchor_id, to_json(&r.data), r.created_at, r.updated_at, r.deleted_at],
        )?;
        result.records.added += 1;
        Ok(())
    }
}
