//! "Same book, other edition": move everything attached to one document (annotations, tool records,
//! the reading place, per-document settings) onto another, re-finding each place in the other text.
//! What can't be found is kept as orphaned. The emptied document leaves the library.

use crate::anchoring::matcher::locate;
use crate::anchoring::selectors::selectors_for_span;
use crate::anchoring::store::{selectors_of, AnchorRow};
use crate::core::{Core, Notice};
use crate::db::to_json;
use crate::errors::invalid;
use crate::journal::Emit;
use crate::model::AnchorStatus;
use crate::Result;
use rusqlite::params;
use serde_json::{json, Map, Value};

impl Core {
    pub fn merge_documents(&mut self, from_id: &str, into_id: &str) -> Result<(i64, i64)> {
        if from_id == into_id {
            return Err(invalid("Choose a different document to merge into."));
        }
        self.live_row(from_id)?;
        self.live_row(into_id)?;
        let source = self.index(from_id)?;
        let target = self.fresh(into_id)?;
        self.ensure_current(from_id, &source)?;
        let mut moved = 0;
        let mut orphaned = 0;
        self.tx(|c| {
            let rows = c.all("SELECT * FROM anchors WHERE document_id = ?1", params![from_id], AnchorRow::from_row)?;
            for r in rows {
                // A reading place only moves if the target has none.
                if r.owner == "progress" && c.exists("SELECT 1 FROM progress WHERE document_id = ?1", params![into_id])? {
                    continue;
                }
                let found = if r.status == "orphaned" { None } else { locate(&selectors_of(&r), source.length(), &target) };
                c.exec("UPDATE anchors SET document_id = ?1 WHERE id = ?2", params![into_id, r.id])?;
                match found {
                    Some(f) => {
                        let sel = selectors_for_span(&target, f.doc_start, f.doc_end)?;
                        let status = if f.status == AnchorStatus::Anchored { AnchorStatus::Moved } else { f.status };
                        c.anchor_replace(&r.id, &sel, status, f.confidence, false)?;
                        moved += 1;
                    }
                    None => {
                        c.exec("UPDATE anchors SET status = 'orphaned', confidence = 0, checked_revision_id = ?1 WHERE id = ?2", params![target.revision_id, r.id])?;
                        orphaned += 1;
                    }
                }
            }
            c.exec("UPDATE annotations SET document_id = ?1 WHERE document_id = ?2", params![into_id, from_id])?;
            c.exec("UPDATE tool_records SET document_id = ?1 WHERE document_id = ?2", params![into_id, from_id])?;
            let p: Option<Option<String>> = c.one("SELECT anchor_id FROM progress WHERE document_id = ?1", params![from_id], |r| r.get(0))?;
            if let Some(anchor_id) = p {
                if !c.exists("SELECT 1 FROM progress WHERE document_id = ?1", params![into_id])? {
                    c.exec("UPDATE progress SET document_id = ?1 WHERE document_id = ?2", params![into_id, from_id])?;
                } else {
                    c.exec("DELETE FROM progress WHERE document_id = ?1", params![from_id])?;
                    if let Some(aid) = anchor_id {
                        c.exec("DELETE FROM anchors WHERE id = ?1 AND document_id = ?2", params![aid, from_id])?;
                    }
                }
            }
            // Per-document settings: the target's own choices win.
            let mut merged: Map<String, Value> = c.settings_raw(&format!("doc:{from_id}"))?;
            for (k, v) in c.settings_raw(&format!("doc:{into_id}"))? {
                merged.insert(k, v);
            }
            if !merged.is_empty() {
                c.exec(
                    "INSERT INTO settings (scope, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(scope) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                    params![format!("doc:{into_id}"), to_json(&Value::Object(merged)), c.now()],
                )?;
            }
            c.exec("DELETE FROM settings WHERE scope = ?1", params![format!("doc:{from_id}")])?;
            let now = c.now();
            c.exec("UPDATE documents SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2", params![now, from_id])?;
            c.emit("document.merged", Emit::doc_subject(from_id, into_id), json!({ "intoId": into_id }))?;
            c.emit("document.removed", Emit::doc(from_id), json!({}))?;
            Ok(())
        })?;
        self.annotations_changed(into_id)?;
        self.notify(Notice::DocumentsRemoved(from_id.to_string()));
        Ok((moved, orphaned))
    }
}
