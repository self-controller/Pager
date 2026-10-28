//! Memory for smart tools: opaque JSON records under a tool's own id, optionally attached to a place
//! in a document (re-anchored like annotations). New tools need no backend change.

use crate::anchoring::doctext::DocIndex;
use crate::anchoring::selectors::parse_anchor_input;
use crate::core::Core;
use crate::db::from_json;
use crate::errors::{invalid, not_found, AppError};
use crate::ids::{is_client_id, sha256_hex};
use crate::journal::Emit;
use crate::model::*;
use crate::Result;
use regex::Regex;
use rusqlite::{params, params_from_iter, Row};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

const MAX_DATA: usize = 64 * 1024;

#[derive(Clone, Debug)]
pub struct RecordRow {
    pub id: String,
    pub tool_id: String,
    pub document_id: Option<String>,
    pub anchor_id: Option<String>,
    pub data: String,
    pub request_hash: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

impl RecordRow {
    fn from_row(r: &Row) -> rusqlite::Result<RecordRow> {
        Ok(RecordRow { id: r.get("id")?, tool_id: r.get("tool_id")?, document_id: r.get("document_id")?, anchor_id: r.get("anchor_id")?, data: r.get("data")?, request_hash: r.get("request_hash")?, created_at: r.get("created_at")?, updated_at: r.get("updated_at")?, deleted_at: r.get("deleted_at")? })
    }
}

fn check_tool(tool_id: &str) -> Result<()> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^[a-z][a-z0-9_-]{0,63}$").unwrap());
    if !re.is_match(tool_id) {
        return Err(invalid("Tool ids are lower-case letters, digits, - and _ (up to 64)."));
    }
    Ok(())
}

fn encode_data(data: Option<&Value>) -> Result<String> {
    let data = data.ok_or_else(|| invalid("Send the record's data."))?;
    let s = serde_json::to_string(data)?;
    if s.len() > MAX_DATA {
        return Err(AppError::new(413, "too_large", "Tool records hold up to 64 KB of data."));
    }
    Ok(s)
}

impl Core {
    fn record_row(&self, tool_id: &str, id: &str) -> Result<RecordRow> {
        self.one("SELECT * FROM tool_records WHERE id = ?1 AND tool_id = ?2", params![id, tool_id], RecordRow::from_row)?.ok_or_else(|| not_found("That record"))
    }

    fn record_index(&mut self, doc_id: Option<&str>) -> Option<Arc<DocIndex>> {
        let doc_id = doc_id?;
        let idx = self.fresh(doc_id).ok()?;
        self.ensure_current(doc_id, &idx).ok()?;
        Some(idx)
    }

    fn record_view(&self, r: &RecordRow, idx: Option<&DocIndex>) -> Result<ToolRecord> {
        let anchor = match (&r.anchor_id, idx) {
            (Some(aid), Some(idx)) => self.anchor_row(aid)?.map(|a| self.anchor_view(&a, idx)),
            _ => None,
        };
        Ok(ToolRecord { id: r.id.clone(), tool_id: r.tool_id.clone(), doc_id: r.document_id.clone(), anchor, data: from_json(Some(&r.data), Value::Null), created_at: r.created_at.clone(), updated_at: r.updated_at.clone(), deleted_at: r.deleted_at.clone() })
    }

    pub fn list_records(&mut self, tool_id: &str, doc_id: Option<&str>, include_deleted: bool) -> Result<Vec<ToolRecord>> {
        check_tool(tool_id)?;
        let mut where_: Vec<&str> = vec!["tool_id = ?"];
        let mut args: Vec<Value> = vec![Value::String(tool_id.into())];
        if let Some(d) = doc_id {
            where_.push("document_id = ?");
            args.push(Value::String(d.into()));
        }
        if !include_deleted {
            where_.push("deleted_at IS NULL");
        }
        let sql = format!("SELECT * FROM tool_records WHERE {} ORDER BY created_at DESC", where_.join(" AND "));
        let rows: Vec<RecordRow> = {
            let mut st = self.db.prepare(&sql)?;
            let rows = st.query_map(params_from_iter(args.iter().map(crate::core::sql_value)), RecordRow::from_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        let mut idxs: HashMap<String, Option<Arc<DocIndex>>> = HashMap::new();
        let mut out = Vec::new();
        for r in rows {
            let idx = match &r.document_id {
                Some(d) => {
                    if !idxs.contains_key(d) {
                        let i = self.record_index(Some(d));
                        idxs.insert(d.clone(), i);
                    }
                    idxs.get(d).cloned().flatten()
                }
                None => None,
            };
            out.push(self.record_view(&r, idx.as_deref())?);
        }
        Ok(out)
    }

    pub fn get_record(&mut self, tool_id: &str, id: &str) -> Result<ToolRecord> {
        check_tool(tool_id)?;
        let r = self.record_row(tool_id, id)?;
        let idx = self.record_index(r.document_id.as_deref());
        self.record_view(&r, idx.as_deref())
    }

    pub fn create_record(&mut self, tool_id: &str, input: &Value) -> Result<(ToolRecord, bool)> {
        check_tool(tool_id)?;
        let o = input.as_object().ok_or_else(|| invalid("Send the record as a JSON object."))?;
        let data = encode_data(o.get("data"))?;
        let client_id = match o.get("id") {
            None => None,
            Some(Value::String(s)) if is_client_id(s) => Some(s.clone()),
            Some(_) => return Err(invalid("id should be 8–64 letters, digits, - or _.")),
        };
        let doc_id: Option<String> = o.get("docId").and_then(Value::as_str).map(str::to_string);
        let anchor = o.get("anchor").filter(|a| !a.is_null());
        if anchor.is_some() && doc_id.is_none() {
            return Err(invalid("An anchored record needs a docId."));
        }
        let hash = sha256_hex(serde_json::to_string(&json!([tool_id, doc_id, anchor.cloned().unwrap_or(Value::Null), data]))?.as_bytes());
        if let Some(cid) = &client_id {
            if let Some(existing) = self.one("SELECT * FROM tool_records WHERE id = ?1", params![cid], RecordRow::from_row)? {
                if existing.request_hash.as_deref() == Some(&hash) && existing.tool_id == tool_id {
                    return Ok((self.get_record(tool_id, &existing.id)?, false));
                }
                return Err(AppError::new(409, "conflict", "A record with that id already exists."));
            }
        }
        let mut idx: Option<Arc<DocIndex>> = None;
        if let Some(d) = &doc_id {
            self.live_row(d)?;
            idx = Some(self.fresh(d)?);
        }
        let sel = match (anchor, &idx, &doc_id) {
            (Some(a), Some(idx), Some(d)) => Some(self.selectors_for_input(d, idx, &parse_anchor_input(a)?)?),
            _ => None,
        };
        let id = client_id.unwrap_or_else(|| self.new_id());
        let now = self.now();
        self.tx(|c| {
            let anchor_id = match (&sel, &doc_id) {
                (Some(sel), Some(d)) => Some(c.anchor_insert(d, "record", sel)?),
                _ => None,
            };
            c.exec(
                "INSERT INTO tool_records (id, tool_id, document_id, anchor_id, data, request_hash, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                params![id, tool_id, doc_id, anchor_id, data, hash, now],
            )?;
            c.emit("record.created", Emit { doc_id: doc_id.clone(), subject_id: Some(id.clone()), at: None }, json!({ "toolId": tool_id }))?;
            Ok(())
        })?;
        let r = self.record_row(tool_id, &id)?;
        Ok((self.record_view(&r, idx.as_deref())?, true))
    }

    pub fn update_record(&mut self, tool_id: &str, id: &str, patch: &Value) -> Result<ToolRecord> {
        check_tool(tool_id)?;
        let o = patch.as_object().ok_or_else(|| invalid("Send the changes as a JSON object."))?;
        let r = self.record_row(tool_id, id)?;
        if r.deleted_at.is_some() {
            return Err(not_found("That record"));
        }
        let idx = self.record_index(r.document_id.as_deref());
        let anchor = o.get("anchor");
        let sel = match (anchor, &r.document_id, &idx) {
            (Some(a), Some(d), Some(idx)) if !a.is_null() => Some(self.selectors_for_input(d, idx, &parse_anchor_input(a)?)?),
            _ => None,
        };
        if anchor.map(|a| !a.is_null()).unwrap_or(false) && r.document_id.is_none() {
            return Err(invalid("This record isn't attached to a document."));
        }
        let data = match o.get("data") {
            Some(d) => Some(encode_data(Some(d))?),
            None => None,
        };
        let now = self.now();
        let clear_anchor = anchor.map(Value::is_null).unwrap_or(false);
        self.tx(|c| {
            if let Some(d) = &data {
                c.exec("UPDATE tool_records SET data = ?1 WHERE id = ?2", params![d, id])?;
            }
            if clear_anchor {
                if let Some(aid) = &r.anchor_id {
                    c.exec("UPDATE tool_records SET anchor_id = NULL WHERE id = ?1", params![id])?;
                    c.anchor_delete(aid)?;
                }
            } else if let Some(sel) = &sel {
                match &r.anchor_id {
                    Some(aid) => c.anchor_replace(aid, sel, AnchorStatus::Anchored, 1.0, true)?,
                    None => {
                        let aid = c.anchor_insert(r.document_id.as_deref().unwrap(), "record", sel)?;
                        c.exec("UPDATE tool_records SET anchor_id = ?1 WHERE id = ?2", params![aid, id])?;
                    }
                }
            }
            c.exec("UPDATE tool_records SET updated_at = ?1 WHERE id = ?2", params![now, id])?;
            c.emit("record.updated", Emit { doc_id: r.document_id.clone(), subject_id: Some(id.to_string()), at: None }, json!({ "toolId": tool_id }))?;
            Ok(())
        })?;
        let r = self.record_row(tool_id, id)?;
        self.record_view(&r, idx.as_deref())
    }

    pub fn remove_record(&mut self, tool_id: &str, id: &str) -> Result<()> {
        check_tool(tool_id)?;
        let r = self.record_row(tool_id, id)?;
        if r.deleted_at.is_some() {
            return Ok(());
        }
        let now = self.now();
        self.tx(|c| {
            c.exec("UPDATE tool_records SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2", params![now, id])?;
            c.emit("record.deleted", Emit { doc_id: r.document_id.clone(), subject_id: Some(id.to_string()), at: None }, json!({ "toolId": tool_id }))?;
            Ok(())
        })
    }
}
