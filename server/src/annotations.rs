//! Highlights, notes and bookmarks. Each holds an anchor; deleting is soft so it can be undone.

use crate::anchoring::doctext::DocIndex;
use crate::anchoring::selectors::parse_anchor_input;
use crate::anchoring::store::AnchorRow;
use crate::core::Core;
use crate::db::{from_json, to_json};
use crate::errors::{invalid, not_found, AppError};
use crate::ids::{is_client_id, sha256_hex};
use crate::journal::Emit;
use crate::model::*;
use crate::Result;
use rusqlite::{params, params_from_iter, Row};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

const KINDS: &[&str] = &["highlight", "note", "bookmark"];
const COLORS: &[&str] = &["yellow", "green", "blue", "pink", "purple"];
const STYLES: &[&str] = &["highlight", "underline", "none"];
const MAX_BODY: usize = 100_000;

#[derive(Clone, Debug)]
pub struct AnnotationRow {
    pub id: String,
    pub document_id: String,
    pub anchor_id: String,
    pub kind: String,
    pub color: Option<String>,
    pub style: String,
    pub body: Option<String>,
    pub tags: String,
    pub request_hash: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

impl AnnotationRow {
    fn from_row(r: &Row) -> rusqlite::Result<AnnotationRow> {
        Ok(AnnotationRow {
            id: r.get("id")?,
            document_id: r.get("document_id")?,
            anchor_id: r.get("anchor_id")?,
            kind: r.get("kind")?,
            color: r.get("color")?,
            style: r.get("style")?,
            body: r.get("body")?,
            tags: r.get("tags")?,
            request_hash: r.get("request_hash")?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
            deleted_at: r.get("deleted_at")?,
        })
    }
}

fn clean_tags(tags: Option<&Value>) -> Result<Vec<String>> {
    let Some(tags) = tags else { return Ok(vec![]) };
    if tags.is_null() {
        return Ok(vec![]);
    }
    let arr = tags.as_array().filter(|a| a.iter().all(Value::is_string)).ok_or_else(|| invalid("tags should be a list of words."))?;
    let mut out: Vec<String> = Vec::new();
    for t in arr {
        let t = t.as_str().unwrap().trim().trim_start_matches('#').to_string();
        if !t.is_empty() && !out.contains(&t) {
            out.push(t);
        }
    }
    if out.len() > 50 || out.iter().any(|t| t.chars().count() > 64) {
        return Err(invalid("Keep tags to 50, each under 64 characters."));
    }
    Ok(out)
}

/// A field that may be absent, null, or a string.
fn opt_str(v: Option<&Value>) -> Option<Option<String>> {
    match v {
        None => None,
        Some(Value::Null) => Some(None),
        Some(Value::String(s)) => Some(Some(s.clone())),
        Some(_) => Some(Some(String::from("\u{0}"))),
    }
}

fn check_fields(p: &serde_json::Map<String, Value>) -> Result<()> {
    if let Some(k) = p.get("kind") {
        if !k.as_str().map(|s| KINDS.contains(&s)).unwrap_or(false) {
            return Err(invalid(format!("kind is one of {}.", KINDS.join(", "))));
        }
    }
    if let Some(c) = p.get("color") {
        if !c.is_null() && !c.as_str().map(|s| COLORS.contains(&s)).unwrap_or(false) {
            return Err(invalid(format!("color is one of {}, or null.", COLORS.join(", "))));
        }
    }
    if let Some(s) = p.get("style") {
        if !s.as_str().map(|s| STYLES.contains(&s)).unwrap_or(false) {
            return Err(invalid(format!("style is one of {}.", STYLES.join(", "))));
        }
    }
    if let Some(b) = p.get("body") {
        if !b.is_null() && !b.as_str().map(|s| s.encode_utf16().count() <= MAX_BODY).unwrap_or(false) {
            return Err(invalid("body should be text (up to 100,000 characters) or null."));
        }
    }
    Ok(())
}

impl Core {
    fn annotation_row(&self, id: &str) -> Result<AnnotationRow> {
        self.one("SELECT * FROM annotations WHERE id = ?1", params![id], AnnotationRow::from_row)?.ok_or_else(|| not_found("That annotation"))
    }

    fn annotation_view(&self, r: &AnnotationRow, idx: &DocIndex) -> Result<Annotation> {
        let anchor: AnchorRow = self.anchor_row(&r.anchor_id)?.ok_or_else(|| not_found("That annotation"))?;
        Ok(Annotation {
            id: r.id.clone(),
            doc_id: r.document_id.clone(),
            kind: r.kind.clone(),
            color: r.color.clone(),
            style: r.style.clone(),
            body: r.body.clone(),
            tags: from_json(Some(&r.tags), vec![]),
            anchor: self.anchor_view(&anchor, idx),
            created_at: r.created_at.clone(),
            updated_at: r.updated_at.clone(),
            deleted_at: r.deleted_at.clone(),
        })
    }

    /// The document's current index with every anchor checked against it.
    pub fn current_index(&mut self, doc_id: &str) -> Result<Arc<DocIndex>> {
        self.live_row(doc_id)?;
        let idx = self.fresh(doc_id)?;
        self.ensure_current(doc_id, &idx)?;
        Ok(idx)
    }

    pub fn get_annotation(&mut self, id: &str) -> Result<Annotation> {
        let r = self.annotation_row(id)?;
        let idx = self.current_index(&r.document_id)?;
        self.annotation_view(&r, &idx)
    }

    /// A document's annotations in reading order; orphans last.
    pub fn list_annotations(&mut self, doc_id: &str, include_deleted: bool) -> Result<Vec<Annotation>> {
        let idx = self.current_index(doc_id)?;
        let sql = format!("SELECT a.* FROM annotations a JOIN anchors n ON n.id = a.anchor_id WHERE a.document_id = ?1 {} ORDER BY n.status = 'orphaned', n.doc_start, a.created_at", if include_deleted { "" } else { "AND a.deleted_at IS NULL" });
        let rows = self.all(&sql, params![doc_id], AnnotationRow::from_row)?;
        rows.iter().map(|r| self.annotation_view(r, &idx)).collect()
    }

    /// For painting one section (the index is already loaded).
    pub fn annotations_for_section(&mut self, doc_id: &str, idx: &Arc<DocIndex>, section_id: &str) -> Result<Vec<Annotation>> {
        self.ensure_current(doc_id, idx)?;
        let rows = self.all("SELECT a.* FROM annotations a JOIN anchors n ON n.id = a.anchor_id WHERE a.document_id = ?1 AND a.deleted_at IS NULL AND n.status != 'orphaned' ORDER BY n.doc_start", params![doc_id], AnnotationRow::from_row)?;
        let mut out = Vec::new();
        for r in rows {
            let a = self.annotation_view(&r, idx)?;
            if a.anchor.segments.iter().any(|s| s.section_id == section_id) {
                out.push(a);
            }
        }
        Ok(out)
    }

    /// Returns the annotation and whether it was created (false: an idempotent repeat).
    pub fn create_annotation(&mut self, doc_id: &str, input: &Value) -> Result<(Annotation, bool)> {
        let o = input.as_object().ok_or_else(|| invalid("Send the annotation as a JSON object."))?;
        check_fields(o)?;
        let tags = clean_tags(o.get("tags"))?;
        let client_id = match o.get("id") {
            None => None,
            Some(Value::String(s)) if is_client_id(s) => Some(s.clone()),
            Some(_) => return Err(invalid("id should be 8–64 letters, digits, - or _.")),
        };
        let request_hash = sha256_hex(
            serde_json::to_string(&json!([doc_id, o.get("revisionId").cloned().unwrap_or(Value::Null), o.get("range").cloned().unwrap_or(Value::Null), o.get("sectionRange").cloned().unwrap_or(Value::Null), o.get("kind").cloned().unwrap_or(Value::Null), o.get("color").cloned().unwrap_or(Value::Null), o.get("style").cloned().unwrap_or(Value::Null), o.get("body").cloned().unwrap_or(Value::Null), tags]))?.as_bytes(),
        );
        if let Some(cid) = &client_id {
            if let Some(existing) = self.one("SELECT * FROM annotations WHERE id = ?1", params![cid], AnnotationRow::from_row)? {
                if existing.request_hash.as_deref() == Some(&request_hash) && existing.document_id == doc_id {
                    return Ok((self.get_annotation(&existing.id)?, false));
                }
                return Err(AppError::new(409, "conflict", "An annotation with that id already exists."));
            }
        }
        let idx = self.current_index(doc_id)?;
        let anchor_input = parse_anchor_input(input)?;
        let sel = self.selectors_for_input(doc_id, &idx, &anchor_input)?;
        let collapsed = sel.doc_start == sel.doc_end;
        let body: Option<String> = o.get("body").and_then(Value::as_str).filter(|b| !b.trim().is_empty()).map(str::to_string);
        let kind: String = o.get("kind").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| if collapsed { "bookmark" } else if body.is_some() { "note" } else { "highlight" }.to_string());
        if kind != "bookmark" && collapsed && body.is_none() {
            return Err(invalid("Select some text to highlight."));
        }
        let color: Option<String> = match o.get("color") {
            None => {
                if kind == "bookmark" {
                    None
                } else {
                    Some("yellow".into())
                }
            }
            Some(Value::Null) => None,
            Some(v) => v.as_str().map(str::to_string),
        };
        let style: String = o.get("style").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| if kind == "bookmark" { "none" } else { "highlight" }.to_string());
        let id = client_id.unwrap_or_else(|| self.new_id());
        let now = self.now();
        self.tx(|c| {
            let anchor_id = c.anchor_insert(doc_id, "annotation", &sel)?;
            c.exec(
                "INSERT INTO annotations (id, document_id, anchor_id, kind, color, style, body, tags, request_hash, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
                params![id, doc_id, anchor_id, kind, color, style, body, to_json(&tags), request_hash, now],
            )?;
            c.emit("annotation.created", Emit::doc_subject(doc_id, &id), json!({ "kind": kind }))?;
            Ok(())
        })?;
        self.annotations_changed(doc_id)?;
        let r = self.annotation_row(&id)?;
        Ok((self.annotation_view(&r, &idx)?, true))
    }

    pub fn update_annotation(&mut self, id: &str, patch: &Value) -> Result<Annotation> {
        let o = patch.as_object().ok_or_else(|| invalid("Send the changes as a JSON object."))?;
        let r = self.annotation_row(id)?;
        if r.deleted_at.is_some() {
            return Err(not_found("That annotation"));
        }
        check_fields(o)?;
        let idx = self.current_index(&r.document_id)?;
        let sel = match o.get("reattach") {
            Some(v) if !v.is_null() => Some(self.selectors_for_input(&r.document_id, &idx, &parse_anchor_input(v)?)?),
            _ => None,
        };
        let tags = match o.get("tags") {
            Some(t) => Some(clean_tags(Some(t))?),
            None => None,
        };
        let accept = o.get("acceptAnchor").map(|v| v.as_bool().unwrap_or(false) || v.is_string() || v.is_number()).unwrap_or(false);
        let mut fields: Vec<&str> = Vec::new();
        let now = self.now();
        let doc_id = r.document_id.clone();
        self.tx(|c| {
            if let Some(k) = o.get("kind").and_then(Value::as_str) {
                c.exec("UPDATE annotations SET kind = ?1 WHERE id = ?2", params![k, id])?;
                fields.push("kind");
            }
            if let Some(col) = opt_str(o.get("color")) {
                c.exec("UPDATE annotations SET color = ?1 WHERE id = ?2", params![col, id])?;
                fields.push("color");
            }
            if let Some(s) = o.get("style").and_then(Value::as_str) {
                c.exec("UPDATE annotations SET style = ?1 WHERE id = ?2", params![s, id])?;
                fields.push("style");
            }
            if let Some(b) = opt_str(o.get("body")) {
                let v = b.filter(|s| !s.trim().is_empty());
                c.exec("UPDATE annotations SET body = ?1 WHERE id = ?2", params![v, id])?;
                fields.push("body");
            }
            if let Some(t) = &tags {
                c.exec("UPDATE annotations SET tags = ?1 WHERE id = ?2", params![to_json(t), id])?;
                fields.push("tags");
            }
            if let Some(sel) = &sel {
                c.anchor_replace(&r.anchor_id, sel, AnchorStatus::Anchored, 1.0, false)?;
                fields.push("anchor");
            } else if accept {
                c.anchor_accept(&r.anchor_id)?;
                fields.push("anchor");
            }
            if !fields.is_empty() {
                c.exec("UPDATE annotations SET updated_at = ?1 WHERE id = ?2", params![now, id])?;
                c.emit("annotation.updated", Emit::doc_subject(&doc_id, id), json!({ "fields": fields }))?;
            }
            Ok(())
        })?;
        if !fields.is_empty() {
            self.annotations_changed(&doc_id)?;
        }
        let r = self.annotation_row(id)?;
        self.annotation_view(&r, &idx)
    }

    pub fn remove_annotation(&mut self, id: &str) -> Result<()> {
        let r = self.annotation_row(id)?;
        if r.deleted_at.is_some() {
            return Ok(());
        }
        let now = self.now();
        self.tx(|c| {
            c.exec("UPDATE annotations SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2", params![now, id])?;
            c.emit("annotation.deleted", Emit::doc_subject(&r.document_id, id), json!({}))?;
            Ok(())
        })?;
        self.annotations_changed(&r.document_id)
    }

    pub fn restore_annotation(&mut self, id: &str) -> Result<Annotation> {
        let r = self.annotation_row(id)?;
        if r.deleted_at.is_some() {
            let now = self.now();
            self.tx(|c| {
                c.exec("UPDATE annotations SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2", params![now, id])?;
                c.emit("annotation.restored", Emit::doc_subject(&r.document_id, id), json!({}))?;
                Ok(())
            })?;
            self.annotations_changed(&r.document_id)?;
        }
        self.get_annotation(id)
    }

    /// Everything that follows a change to a document's annotations: search index, mirror.
    pub fn annotations_changed(&mut self, doc_id: &str) -> Result<()> {
        self.index_annotations(doc_id)?;
        self.mirror_schedule(doc_id);
        Ok(())
    }

    /// Across the library, newest first: the Highlights page.
    pub fn library_annotations(&mut self, kind: Option<&str>, tag: Option<&str>, doc_id: Option<&str>, q: Option<&str>, before: Option<&str>, limit: Option<i64>) -> Result<Vec<LibraryAnnotation>> {
        let mut where_: Vec<String> = vec!["a.deleted_at IS NULL".into(), "d.deleted_at IS NULL".into()];
        let mut args: Vec<Value> = Vec::new();
        if let Some(k) = kind {
            where_.push("a.kind = ?".into());
            args.push(Value::String(k.into()));
        }
        if let Some(d) = doc_id {
            where_.push("a.document_id = ?".into());
            args.push(Value::String(d.into()));
        }
        if let Some(t) = tag {
            where_.push("EXISTS (SELECT 1 FROM json_each(a.tags) WHERE lower(value) = lower(?))".into());
            args.push(Value::String(t.trim_start_matches('#').into()));
        }
        if let Some(q) = q {
            where_.push("(lower(n.exact) LIKE ? ESCAPE '\\' OR lower(coalesce(a.body, '')) LIKE ? ESCAPE '\\')".into());
            let like = format!("%{}%", q.to_lowercase().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
            args.push(Value::String(like.clone()));
            args.push(Value::String(like));
        }
        if let Some(b) = before {
            where_.push("a.created_at < ?".into());
            args.push(Value::String(b.into()));
        }
        let limit = limit.unwrap_or(200).clamp(1, 500);
        let sql = format!("SELECT a.* FROM annotations a JOIN anchors n ON n.id = a.anchor_id JOIN documents d ON d.id = a.document_id WHERE {} ORDER BY a.created_at DESC LIMIT {limit}", where_.join(" AND "));
        let rows: Vec<AnnotationRow> = {
            let mut st = self.db.prepare(&sql)?;
            let rows = st.query_map(params_from_iter(args.iter().map(crate::core::sql_value)), AnnotationRow::from_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        let mut out = Vec::new();
        let mut indexes: HashMap<String, Option<Arc<DocIndex>>> = HashMap::new();
        for r in rows {
            if !indexes.contains_key(&r.document_id) {
                let idx = self.current_index(&r.document_id).ok();
                indexes.insert(r.document_id.clone(), idx);
            }
            let Some(idx) = indexes.get(&r.document_id).cloned().flatten() else { continue };
            let a = self.annotation_view(&r, &idx)?;
            let doc_row = self.row(&r.document_id)?;
            let summary = self.summary(&doc_row)?;
            let section_title = a.anchor.section_id.as_ref().and_then(|sid| idx.doc.sections.iter().find(|s| &s.id == sid)).map(|s| s.title.clone());
            let href = match (&a.anchor.range, &a.anchor.section_id) {
                (Some(range), Some(sid)) => format!("/read/{}/{}#{}", r.document_id, sid, range.start.block_id),
                _ => format!("/read/{}", r.document_id),
            };
            out.push(LibraryAnnotation { annotation: a, doc_title: summary.title, doc_author: summary.author, section_title, href });
        }
        Ok(out)
    }

    pub fn tags(&self) -> Result<Vec<TagCount>> {
        self.all(
            "SELECT value AS tag, COUNT(*) AS count FROM annotations a, json_each(a.tags) JOIN documents d ON d.id = a.document_id
             WHERE a.deleted_at IS NULL AND d.deleted_at IS NULL GROUP BY lower(value) ORDER BY count DESC, tag",
            params![],
            |r| Ok(TagCount { tag: r.get(0)?, count: r.get(1)? }),
        )
    }
}
