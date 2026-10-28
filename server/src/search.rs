//! Full-text search. The text of each document's current revision is indexed when the revision is
//! made (and lazily for documents indexed before this existed); annotations are reindexed per
//! document whenever they change.

use crate::anchoring::doctext::DocIndex;
use crate::core::Core;
use crate::errors::invalid;
use crate::model::*;
use crate::Result;
use regex::Regex;
use rusqlite::{params, params_from_iter};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::OnceLock;

const OPEN: &str = "\u{1}";
const CLOSE: &str = "\u{2}";

/// Words → an FTS5 query: every word must appear; the last may be a prefix ("hero" finds "heron").
pub fn fts_query(q: &str) -> Option<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"[\p{L}\p{N}][\p{L}\p{N}'’_-]*").unwrap());
    let words: Vec<&str> = re.find_iter(q).map(|m| m.as_str()).take(20).collect();
    if words.is_empty() {
        return None;
    }
    let n = words.len();
    Some(words.iter().enumerate().map(|(i, w)| format!("\"{}\"{}", w.replace('"', "\"\""), if i == n - 1 { "*" } else { "" })).collect::<Vec<_>>().join(" "))
}

fn parse_snippet(raw: &str) -> (String, Vec<(usize, usize)>) {
    let mut out = String::new();
    let mut len = 0usize;
    let mut ranges = Vec::new();
    let mut open: Option<usize> = None;
    for ch in raw.chars() {
        if ch == '\u{1}' {
            open = Some(len);
        } else if ch == '\u{2}' {
            if let Some(o) = open {
                ranges.push((o, len));
            }
            open = None;
        } else {
            out.push(ch);
            len += ch.len_utf16();
        }
    }
    (out, ranges)
}

impl Core {
    /// Index a revision's text (inside the revision transaction is fine).
    pub fn index_revision(&mut self, doc_id: &str, idx: &DocIndex) -> Result<()> {
        let state: Option<String> = self.one("SELECT revision_id FROM fts_state WHERE document_id = ?1", params![doc_id], |r| r.get(0))?;
        if state.as_deref() == Some(&idx.revision_id) {
            return Ok(());
        }
        self.exec("DELETE FROM block_fts WHERE document_id = ?1", params![doc_id])?;
        {
            let mut ins = self.db.prepare("INSERT INTO block_fts (text, document_id, section_id, block_id) VALUES (?1, ?2, ?3, ?4)")?;
            for l in &idx.leaves {
                if l.text.trim().is_empty() {
                    continue;
                }
                ins.execute(params![l.text, doc_id, idx.doc.sections[l.section_index].id, l.id])?;
            }
        }
        self.exec("INSERT OR REPLACE INTO fts_state (document_id, revision_id) VALUES (?1, ?2)", params![doc_id, idx.revision_id])?;
        Ok(())
    }

    pub fn index_annotations(&mut self, doc_id: &str) -> Result<()> {
        self.exec("DELETE FROM annotation_fts WHERE document_id = ?1", params![doc_id])?;
        self.exec(
            "INSERT INTO annotation_fts (quote, body, tags, annotation_id, document_id)
             SELECT n.exact, coalesce(a.body, ''), (SELECT group_concat(value, ' ') FROM json_each(a.tags)), a.id, a.document_id
             FROM annotations a JOIN anchors n ON n.id = a.anchor_id WHERE a.document_id = ?1 AND a.deleted_at IS NULL",
            params![doc_id],
        )?;
        Ok(())
    }

    /// Index any live document whose current revision isn't indexed yet.
    pub fn search_catch_up(&mut self, doc_id: Option<&str>) -> Result<()> {
        let sql = format!(
            "SELECT d.id FROM documents d LEFT JOIN fts_state f ON f.document_id = d.id WHERE d.deleted_at IS NULL AND (f.revision_id IS NULL OR f.revision_id != d.current_revision_id) {}",
            if doc_id.is_some() { "AND d.id = ?1" } else { "" }
        );
        let ids: Vec<String> = match doc_id {
            Some(d) => self.all(&sql, params![d], |r| r.get(0))?,
            None => self.all(&sql, params![], |r| r.get(0))?,
        };
        for id in ids {
            if let Ok(idx) = self.index(&id) {
                let _ = self.tx(|c| {
                    c.index_revision(&id, &idx)?;
                    c.index_annotations(&id)
                });
            }
        }
        Ok(())
    }

    /// Search as the library shows it: one entry per document, with title/author/file-name matches
    /// and the best few passages. An empty or unsearchable query answers [] rather than an error.
    pub fn search_documents(&mut self, q: &str, limit: Option<i64>) -> Result<Vec<DocumentSearchResult>> {
        if fts_query(q).is_none() {
            return Ok(vec![]);
        }
        let per_doc = 3usize;
        let limit = limit.unwrap_or(60).clamp(1, 200) as usize;
        let needle = q.trim().to_lowercase();
        let mut order: Vec<String> = Vec::new();
        let mut results: HashMap<String, DocumentSearchResult> = HashMap::new();
        for doc in self.list_documents(&DocumentQuery { q: Some(q.trim().to_string()), ..Default::default() })? {
            let mut matched: Vec<String> = Vec::new();
            if doc.title.to_lowercase().contains(&needle) {
                matched.push("title".into());
            }
            if doc.author.as_ref().map(|a| a.to_lowercase().contains(&needle)).unwrap_or(false) {
                matched.push("author".into());
            }
            if matched.is_empty() {
                matched.push("fileName".into());
            }
            order.push(doc.id.clone());
            results.insert(doc.id.clone(), DocumentSearchResult { doc, matched, hits: vec![], total_hits: 0 });
        }
        for hit in self.search(q, None, false, Some(200))? {
            if !results.contains_key(&hit.doc_id) {
                let row = self.row(&hit.doc_id)?;
                let doc = self.summary(&row)?;
                order.push(hit.doc_id.clone());
                results.insert(hit.doc_id.clone(), DocumentSearchResult { doc, matched: vec![], hits: vec![], total_hits: 0 });
            }
            let r = results.get_mut(&hit.doc_id).unwrap();
            r.total_hits += 1;
            if r.hits.len() < per_doc {
                r.hits.push(hit);
            }
        }
        // Title, author and file-name matches first (in library order), then passages in rank order.
        let mut out: Vec<DocumentSearchResult> = order.into_iter().filter_map(|id| results.remove(&id)).collect();
        out.sort_by_key(|r| if r.matched.is_empty() { 1 } else { 0 });
        out.truncate(limit);
        Ok(out)
    }

    pub fn search(&mut self, q: &str, doc_id: Option<&str>, in_annotations: bool, limit: Option<i64>) -> Result<Vec<SearchHit>> {
        let Some(matchq) = fts_query(q) else { return Err(invalid("Type a word to search for.")) };
        self.search_catch_up(doc_id)?;
        let limit = limit.unwrap_or(50).clamp(1, 200);
        let mut titles: HashMap<String, String> = HashMap::new();
        let mut args: Vec<Value> = vec![Value::String(OPEN.into()), Value::String(CLOSE.into()), Value::String(matchq)];
        if let Some(d) = doc_id {
            args.push(Value::String(d.into()));
        }
        args.push(Value::from(limit));
        let doc_filter = if doc_id.is_some() { "AND f.document_id = ?4" } else { "" };
        let limit_param = if doc_id.is_some() { "?5" } else { "?4" };
        let rows: Vec<(String, String, String, String, Option<String>)> = if in_annotations {
            let sql = format!(
                "SELECT f.document_id, n.section_id, n.start_block, snippet(annotation_fts, -1, ?1, ?2, '…', 12) AS snip, f.annotation_id
                 FROM annotation_fts f JOIN annotations a ON a.id = f.annotation_id JOIN anchors n ON n.id = a.anchor_id
                 JOIN documents d ON d.id = f.document_id
                 WHERE annotation_fts MATCH ?3 AND d.deleted_at IS NULL {doc_filter} ORDER BY rank LIMIT {limit_param}"
            );
            let mut st = self.db.prepare(&sql)?;
            let rows = st.query_map(params_from_iter(args.iter().map(crate::core::sql_value)), |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        } else {
            let sql = format!(
                "SELECT f.document_id, f.section_id, f.block_id, snippet(block_fts, 0, ?1, ?2, '…', 16) AS snip, NULL
                 FROM block_fts f JOIN documents d ON d.id = f.document_id
                 WHERE block_fts MATCH ?3 AND d.deleted_at IS NULL {doc_filter} ORDER BY rank LIMIT {limit_param}"
            );
            let mut st = self.db.prepare(&sql)?;
            let rows = st.query_map(params_from_iter(args.iter().map(crate::core::sql_value)), |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get::<_, Option<String>>(4)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        let mut out = Vec::new();
        for (doc_id, section_id, block_id, snip, annotation_id) in rows {
            if !titles.contains_key(&doc_id) {
                let row = self.row(&doc_id)?;
                titles.insert(doc_id.clone(), self.summary(&row)?.title);
            }
            let (snippet, ranges) = parse_snippet(&snip);
            out.push(SearchHit { doc_title: titles[&doc_id].clone(), doc_id, section_id, block_id, snippet, ranges, annotation_id });
        }
        Ok(out)
    }
}
