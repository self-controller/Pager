//! Every place something is attached to. Annotations, tool records and the reading position all hold
//! an anchor; `reanchor_document` keeps every one of them attached when a document gets a new revision.

use super::doctext::DocIndex;
use super::matcher::locate;
use super::selectors::{range_from_input, segments_for, selectors_for, selectors_for_span, StoredSelectors};
use crate::core::Core;
use crate::errors::AppError;
use crate::journal::Emit;
use crate::model::*;
use crate::Result;
use rusqlite::{params, Row};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Clone, Debug)]
pub struct AnchorRow {
    pub id: String,
    pub document_id: String,
    pub owner: String,
    pub revision_id: String,
    pub section_id: String,
    pub start_block: String,
    pub start_offset: i64,
    pub end_block: String,
    pub end_offset: i64,
    pub doc_start: i64,
    pub doc_end: i64,
    pub exact: String,
    pub prefix: String,
    pub suffix: String,
    pub status: String,
    pub confidence: f64,
    pub original_quote: String,
    pub checked_revision_id: String,
    pub ambiguous: i64,
    pub created_at: String,
    pub updated_at: String,
}

impl AnchorRow {
    pub fn from_row(r: &Row) -> rusqlite::Result<AnchorRow> {
        Ok(AnchorRow {
            id: r.get("id")?,
            document_id: r.get("document_id")?,
            owner: r.get("owner")?,
            revision_id: r.get("revision_id")?,
            section_id: r.get("section_id")?,
            start_block: r.get("start_block")?,
            start_offset: r.get("start_offset")?,
            end_block: r.get("end_block")?,
            end_offset: r.get("end_offset")?,
            doc_start: r.get("doc_start")?,
            doc_end: r.get("doc_end")?,
            exact: r.get("exact")?,
            prefix: r.get("prefix")?,
            suffix: r.get("suffix")?,
            status: r.get("status")?,
            confidence: r.get("confidence")?,
            original_quote: r.get("original_quote")?,
            checked_revision_id: r.get("checked_revision_id")?,
            ambiguous: r.get("ambiguous")?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
        })
    }

    pub fn status(&self) -> AnchorStatus {
        AnchorStatus::parse(&self.status)
    }
}

pub fn selectors_of(r: &AnchorRow) -> StoredSelectors {
    StoredSelectors {
        revision_id: r.revision_id.clone(),
        section_id: r.section_id.clone(),
        start: BlockPoint { block_id: r.start_block.clone(), offset: r.start_offset.max(0) as usize },
        end: BlockPoint { block_id: r.end_block.clone(), offset: r.end_offset.max(0) as usize },
        doc_start: r.doc_start.max(0) as usize,
        doc_end: r.doc_end.max(0) as usize,
        exact: r.exact.clone(),
        prefix: r.prefix.clone(),
        suffix: r.suffix.clone(),
        ambiguous: r.ambiguous != 0,
    }
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct ReanchorResult {
    pub id: String,
    pub owner: String,
    pub from: AnchorStatus,
    pub to: AnchorStatus,
    pub confidence: f64,
}

impl Core {
    pub fn anchor_row(&self, id: &str) -> Result<Option<AnchorRow>> {
        self.one("SELECT * FROM anchors WHERE id = ?1", params![id], AnchorRow::from_row)
    }

    pub fn anchor_insert(&mut self, doc_id: &str, owner: &str, sel: &StoredSelectors) -> Result<String> {
        let id = self.new_id();
        let now = self.now();
        self.exec(
            "INSERT INTO anchors (id, document_id, owner, revision_id, section_id, start_block, start_offset, end_block, end_offset,
             doc_start, doc_end, exact, prefix, suffix, status, confidence, original_quote, checked_revision_id, ambiguous, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'anchored', 1, ?12, ?4, ?15, ?16, ?16)",
            params![
                id,
                doc_id,
                owner,
                sel.revision_id,
                sel.section_id,
                sel.start.block_id,
                sel.start.offset as i64,
                sel.end.block_id,
                sel.end.offset as i64,
                sel.doc_start as i64,
                sel.doc_end as i64,
                sel.exact,
                sel.prefix,
                sel.suffix,
                sel.ambiguous as i64,
                now
            ],
        )?;
        Ok(id)
    }

    /// New selectors for an existing anchor (reattach, or a successful re-anchor).
    pub fn anchor_replace(&mut self, id: &str, sel: &StoredSelectors, status: AnchorStatus, confidence: f64, reset_quote: bool) -> Result<()> {
        let sql = format!(
            "UPDATE anchors SET revision_id = ?1, section_id = ?2, start_block = ?3, start_offset = ?4, end_block = ?5, end_offset = ?6, doc_start = ?7, doc_end = ?8,
             exact = ?9, prefix = ?10, suffix = ?11, status = ?12, confidence = ?13, checked_revision_id = ?1, ambiguous = ?14, updated_at = ?15{} WHERE id = ?16",
            if reset_quote { ", original_quote = exact" } else { "" }
        );
        self.exec(
            &sql,
            params![
                sel.revision_id,
                sel.section_id,
                sel.start.block_id,
                sel.start.offset as i64,
                sel.end.block_id,
                sel.end.offset as i64,
                sel.doc_start as i64,
                sel.doc_end as i64,
                sel.exact,
                sel.prefix,
                sel.suffix,
                status.as_str(),
                confidence,
                sel.ambiguous as i64,
                self.now(),
                id
            ],
        )?;
        Ok(())
    }

    pub fn anchor_accept(&mut self, id: &str) -> Result<()> {
        self.exec("UPDATE anchors SET status = 'anchored', confidence = 1, updated_at = ?1 WHERE id = ?2 AND status != 'orphaned'", params![self.now(), id])?;
        Ok(())
    }

    pub fn anchor_delete(&mut self, id: &str) -> Result<()> {
        self.exec("DELETE FROM anchors WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Selectors for a client's AnchorInput, in the current revision. Coordinates from an older revision
    /// (the page was loaded before the file changed) are translated through the matcher.
    pub fn selectors_for_input(&mut self, doc_id: &str, current: &DocIndex, input: &AnchorInput) -> Result<StoredSelectors> {
        match &input.revision_id {
            None => selectors_for(current, &range_from_input(current, input)?),
            Some(rev) if *rev == current.revision_id => selectors_for(current, &range_from_input(current, input)?),
            Some(rev) => {
                let old = self.revision_index(doc_id, rev)?.ok_or_else(|| AppError::new(409, "stale_revision", "This page is from an older version of the document. Reload it and try again."))?;
                let sel = selectors_for(&old, &range_from_input(&old, input)?)?;
                let found = locate(&sel, old.length(), current).ok_or_else(|| AppError::new(409, "stale_revision", "That passage has changed since the page was loaded. Reload it and try again."))?;
                selectors_for_span(current, found.doc_start, found.doc_end)
            }
        }
    }

    /// Selectors for the reading position (old revisions only if still in memory/cache).
    fn selectors_for_point_sync(&mut self, current: &DocIndex, point: &BlockPoint, revision_id: Option<&str>) -> Option<StoredSelectors> {
        let range = TextRange { start: point.clone(), end: point.clone() };
        match revision_id {
            None => selectors_for(current, &range).ok(),
            Some(rev) if rev == current.revision_id => selectors_for(current, &range).ok(),
            Some(rev) => {
                let old = self.cache.load(rev)?;
                let sel = selectors_for(&old, &range).ok()?;
                let found = locate(&sel, old.length(), current)?;
                selectors_for_span(current, found.doc_start, found.doc_start).ok()
            }
        }
    }

    /// What the UI gets: where the anchor is now, ready to paint.
    pub fn anchor_view(&self, r: &AnchorRow, idx: &DocIndex) -> AnchorView {
        let attached = r.status != "orphaned" && r.revision_id == idx.revision_id && idx.by_id.contains_key(&r.start_block) && idx.by_id.contains_key(&r.end_block);
        if !attached {
            return AnchorView {
                status: AnchorStatus::Orphaned,
                confidence: 0.0,
                revision_id: r.revision_id.clone(),
                range: None,
                section_id: None,
                segments: vec![],
                position: Position { start: r.doc_start.max(0) as usize, end: r.doc_end.max(0) as usize },
                quote: r.exact.clone(),
                original_quote: r.original_quote.clone(),
            };
        }
        let start = BlockPoint { block_id: r.start_block.clone(), offset: r.start_offset.max(0) as usize };
        let end = BlockPoint { block_id: r.end_block.clone(), offset: r.end_offset.max(0) as usize };
        AnchorView {
            status: r.status(),
            confidence: r.confidence,
            revision_id: r.revision_id.clone(),
            segments: segments_for(idx, &start, &end),
            section_id: Some(idx.section_of_block(&r.start_block).map(|s| s.id.clone()).unwrap_or_else(|| r.section_id.clone())),
            range: Some(TextRange { start, end }),
            position: Position { start: r.doc_start.max(0) as usize, end: r.doc_end.max(0) as usize },
            quote: r.exact.clone(),
            original_quote: r.original_quote.clone(),
        }
    }

    /// Re-attach every anchor of a document to `next` (inside the revision transaction). Orphans are
    /// retried too, from the last revision they were found in, so A → B → A brings them back.
    pub fn reanchor_document(&mut self, doc_id: &str, next: &DocIndex) -> Result<Vec<ReanchorResult>> {
        let rows = self.all("SELECT * FROM anchors WHERE document_id = ?1 AND checked_revision_id != ?2", params![doc_id, next.revision_id], AnchorRow::from_row)?;
        if rows.is_empty() {
            return Ok(vec![]);
        }
        let mut lengths: HashMap<String, usize> = HashMap::new();
        let mut results = Vec::new();
        let now = self.now();
        for r in rows {
            if r.revision_id == next.revision_id {
                self.exec("UPDATE anchors SET checked_revision_id = ?1 WHERE id = ?2", params![next.revision_id, r.id])?;
                continue;
            }
            let old_length = match lengths.get(&r.revision_id) {
                Some(&l) => l,
                None => {
                    let l: Option<i64> = self.one("SELECT doc_chars FROM revisions WHERE id = ?1", params![r.revision_id], |row| row.get(0))?;
                    let l = l.map(|x| x.max(0) as usize).unwrap_or_else(|| next.length());
                    lengths.insert(r.revision_id.clone(), l);
                    l
                }
            };
            match locate(&selectors_of(&r), old_length, next) {
                Some(found) => {
                    let sel = selectors_for_span(next, found.doc_start, found.doc_end)?;
                    self.anchor_replace(&r.id, &sel, found.status, found.confidence, false)?;
                    results.push(ReanchorResult { id: r.id.clone(), owner: r.owner.clone(), from: r.status(), to: found.status, confidence: found.confidence });
                }
                None => {
                    self.exec("UPDATE anchors SET status = 'orphaned', confidence = 0, checked_revision_id = ?1, updated_at = ?2 WHERE id = ?3", params![next.revision_id, now, r.id])?;
                    results.push(ReanchorResult { id: r.id.clone(), owner: r.owner.clone(), from: r.status(), to: AnchorStatus::Orphaned, confidence: 0.0 });
                }
            }
        }
        Ok(results)
    }

    /// Make sure a document's anchors have been checked against its current revision.
    pub fn ensure_current(&mut self, doc_id: &str, idx: &Arc<DocIndex>) -> Result<()> {
        if !self.exists("SELECT 1 FROM anchors WHERE document_id = ?1 AND checked_revision_id != ?2 LIMIT 1", params![doc_id, idx.revision_id])? {
            return Ok(());
        }
        let idx = idx.clone();
        self.tx(|c| {
            let results = c.reanchor_document(doc_id, &idx)?;
            if !results.is_empty() {
                c.emit("annotations.reanchored", Emit::doc(doc_id), json!({ "revisionId": idx.revision_id, "results": results }))?;
            }
            Ok(())
        })
    }

    // ---- The reading place's anchor ----

    /// `(point, status)` for a progress anchor; the point is None when orphaned.
    pub fn progress_point(&self, anchor_id: Option<&str>) -> Result<Option<(Option<BlockPoint>, AnchorStatus)>> {
        let Some(id) = anchor_id else { return Ok(None) };
        let Some(r) = self.anchor_row(id)? else { return Ok(None) };
        if r.status == "orphaned" {
            return Ok(Some((None, AnchorStatus::Orphaned)));
        }
        Ok(Some((Some(BlockPoint { block_id: r.start_block, offset: r.start_offset.max(0) as usize }), AnchorStatus::parse(&r.status))))
    }

    pub fn set_progress_point(&mut self, doc_id: &str, idx: &DocIndex, anchor_id: Option<&str>, point: &BlockPoint, revision_id: Option<&str>) -> Result<Option<String>> {
        let Some(sel) = self.selectors_for_point_sync(idx, point, revision_id) else { return Ok(anchor_id.map(str::to_string)) };
        if let Some(id) = anchor_id {
            if self.anchor_row(id)?.is_some() {
                self.anchor_replace(id, &sel, AnchorStatus::Anchored, 1.0, true)?;
                return Ok(Some(id.to_string()));
            }
        }
        Ok(Some(self.anchor_insert(doc_id, "progress", &sel)?))
    }
}
