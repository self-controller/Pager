//! Reading sessions, derived from progress saves: when you read, for how long, from where to where.
//! Kept only while the "sessions" recording switch is on. Nothing is shown unless the UI asks.

use crate::clock::{iso_ms, parse_iso};
use crate::core::Core;
use crate::db::from_json;
use crate::journal::Emit;
use crate::model::*;
use crate::Result;
use rusqlite::{params, Row};
use serde_json::{json, Map, Value};

/// A pause longer than this ends a reading session.
pub const SESSION_GAP_MS: i64 = 30 * 60_000;
/// Time between two progress saves counts as reading only up to this much.
const MAX_STEP_MS: i64 = 5 * 60_000;

#[derive(Clone, Debug)]
struct SessionRow {
    id: i64,
    document_id: String,
    started_at: String,
    ended_at: String,
    active_ms: i64,
    from_percent: Option<f64>,
    to_percent: Option<f64>,
}

impl SessionRow {
    fn from_row(r: &Row) -> rusqlite::Result<SessionRow> {
        Ok(SessionRow { id: r.get("id")?, document_id: r.get("document_id")?, started_at: r.get("started_at")?, ended_at: r.get("ended_at")?, active_ms: r.get("active_ms")?, from_percent: r.get("from_percent")?, to_percent: r.get("to_percent")? })
    }
}

impl Core {
    pub fn session_touch(&mut self, doc_id: &str, percent: f64) -> Result<()> {
        if !self.app_settings().record.sessions {
            return Ok(());
        }
        let now = self.now_ms();
        let open = self.one("SELECT * FROM reading_sessions WHERE document_id = ?1 AND open = 1 ORDER BY id DESC LIMIT 1", params![doc_id], SessionRow::from_row)?;
        if let Some(open) = open {
            let gap = now - parse_iso(&open.ended_at).unwrap_or(now);
            if gap <= SESSION_GAP_MS {
                self.exec("UPDATE reading_sessions SET ended_at = ?1, active_ms = active_ms + ?2, to_percent = ?3 WHERE id = ?4", params![iso_ms(now), gap.clamp(0, MAX_STEP_MS), percent, open.id])?;
                return Ok(());
            }
            self.session_end(&open)?;
        }
        self.close_stale_sessions(Some(doc_id))?;
        self.exec("INSERT INTO reading_sessions (document_id, started_at, ended_at, active_ms, from_percent, to_percent, open) VALUES (?1, ?2, ?2, 0, ?3, ?3, 1)", params![doc_id, iso_ms(now), percent])?;
        Ok(())
    }

    fn session_end(&mut self, r: &SessionRow) -> Result<()> {
        self.tx(|c| {
            c.exec("UPDATE reading_sessions SET open = 0 WHERE id = ?1", params![r.id])?;
            c.emit("reading.session", Emit::doc(&r.document_id), json!({ "startedAt": r.started_at, "endedAt": r.ended_at, "activeMs": r.active_ms, "fromPercent": r.from_percent, "toPercent": r.to_percent }))?;
            Ok(())
        })
    }

    /// Close sessions that have been quiet for longer than the gap.
    pub fn close_stale_sessions(&mut self, doc_id: Option<&str>) -> Result<()> {
        let cutoff = iso_ms(self.now_ms() - SESSION_GAP_MS);
        let rows = match doc_id {
            Some(d) => self.all("SELECT * FROM reading_sessions WHERE open = 1 AND ended_at < ?1 AND document_id = ?2", params![cutoff, d], SessionRow::from_row)?,
            None => self.all("SELECT * FROM reading_sessions WHERE open = 1 AND ended_at < ?1", params![cutoff], SessionRow::from_row)?,
        };
        for r in rows {
            self.session_end(&r)?;
        }
        Ok(())
    }

    pub fn list_sessions(&mut self, doc_id: &str) -> Result<Vec<ReadingSession>> {
        self.close_stale_sessions(Some(doc_id))?;
        let rows = self.all("SELECT * FROM reading_sessions WHERE document_id = ?1 ORDER BY started_at DESC LIMIT 200", params![doc_id], SessionRow::from_row)?;
        Ok(rows.into_iter().map(|r| ReadingSession { doc_id: r.document_id, started_at: r.started_at, ended_at: r.ended_at, active_ms: r.active_ms, from_percent: r.from_percent, to_percent: r.to_percent }).collect())
    }

    /// Jumps, sessions and edits of the file, newest first: enough for "go back" and "last time".
    pub fn history(&mut self, doc_id: &str) -> Result<Vec<HistoryEntry>> {
        self.close_stale_sessions(Some(doc_id))?;
        let rows: Vec<(String, String, String)> = self.all(
            "SELECT at, type, payload FROM events WHERE document_id = ?1 AND type IN ('progress.jumped', 'reading.session', 'revision.created', 'annotations.reanchored') ORDER BY seq DESC LIMIT 200",
            params![doc_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        Ok(rows
            .into_iter()
            .map(|(at, kind, payload)| {
                let p: Map<String, Value> = from_json(Some(&payload), Map::new());
                let mut e = HistoryEntry { at, kind: kind.clone(), section_id: None, detail: None };
                if kind == "progress.jumped" {
                    e.section_id = p.get("toSectionId").and_then(Value::as_str).map(str::to_string);
                }
                if kind == "annotations.reanchored" {
                    let results = p.get("results").and_then(Value::as_array).cloned().unwrap_or_default();
                    let count = |status: &str| results.iter().filter(|r| r.get("to").and_then(Value::as_str) == Some(status)).count();
                    e.detail = Some(json!({ "orphaned": count("orphaned"), "fuzzy": count("fuzzy"), "total": results.len() }));
                } else {
                    e.detail = Some(Value::Object(p));
                }
                e
            })
            .collect())
    }
}
