//! Briefings (a cache, keyed by document, level, focus and content hash) and runs (one row per
//! attempt; Phase 2's per-phone limit counts them).

use super::schema::{Briefing, Level};
use super::RunView;
use crate::clock::{iso_ms, parse_iso};
use crate::core::Core;
use crate::db::to_json;
use crate::errors::AppError;
use crate::Result;
use rusqlite::params;
use serde_json::Value;

fn parse(s: String) -> Option<Briefing> {
    serde_json::from_str(&s).ok()
}

impl Core {
    pub fn briefing_get(&self, doc_id: &str, level: Level, focus: &str, content_hash: &str) -> Result<Option<Briefing>> {
        Ok(self
            .one(
                "SELECT briefing FROM context_briefings WHERE document_id = ?1 AND level = ?2 AND focus = ?3 AND content_hash = ?4",
                params![doc_id, level.as_str(), focus, content_hash],
                |r| r.get::<_, String>(0),
            )?
            .and_then(parse))
    }

    /// The newest briefing for any version of the file.
    pub fn briefing_latest(&self, doc_id: &str, level: Level, focus: &str) -> Result<Option<Briefing>> {
        Ok(self
            .one(
                "SELECT briefing FROM context_briefings WHERE document_id = ?1 AND level = ?2 AND focus = ?3 ORDER BY created_at DESC, rowid DESC LIMIT 1",
                params![doc_id, level.as_str(), focus],
                |r| r.get::<_, String>(0),
            )?
            .and_then(parse))
    }

    /// Levels with a stored briefing for this document (any version of the file).
    pub fn briefing_levels(&self, doc_id: &str, focus: &str) -> Result<Vec<Level>> {
        let have: Vec<String> = self.all("SELECT DISTINCT level FROM context_briefings WHERE document_id = ?1 AND focus = ?2", params![doc_id, focus], |r| r.get(0))?;
        Ok(Level::ALL.into_iter().filter(|l| have.iter().any(|h| h == l.as_str())).collect())
    }

    /// Store a briefing; a refresh of the same version replaces the old one.
    pub fn briefing_save(&self, b: &Briefing, usage: &Value) -> Result<String> {
        let id = self.new_id();
        let focus = b.focus.as_deref().map(super::focus::focus_key).unwrap_or_default();
        self.exec(
            "INSERT INTO context_briefings (id, document_id, content_hash, level, focus, briefing, model, usage, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(document_id, level, focus, content_hash) DO UPDATE SET id = excluded.id, briefing = excluded.briefing, model = excluded.model, usage = excluded.usage, created_at = excluded.created_at",
            params![id, b.doc_id, b.content_hash, b.level.as_str(), focus, to_json(b), b.model, to_json(usage), b.generated_at],
        )?;
        Ok(id)
    }

    /// Every stored briefing of a document still in the library: the newest per document, level and
    /// focus (any version of the file), newest first. For the Assistant page's list.
    pub fn briefing_list(&self) -> Result<Vec<BriefingEntry>> {
        let rows: Vec<(String, String, String, Option<String>, String)> = self.all(
            "SELECT b.document_id, b.level, b.focus, json_extract(b.briefing, '$.focus'), b.created_at FROM context_briefings b
             JOIN documents d ON d.id = b.document_id AND d.deleted_at IS NULL
             ORDER BY b.created_at DESC, b.rowid DESC",
            params![],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )?;
        let mut seen = std::collections::HashSet::new();
        Ok(rows
            .into_iter()
            .filter(|(doc, level, focus, _, _)| seen.insert((doc.clone(), level.clone(), focus.clone())))
            .filter_map(|(doc_id, level, key, focus, generated_at)| {
                let level = Level::parse(&level)?;
                // The focus as shown ("Malthus"); the key ("malthus") for a briefing stored without one.
                let focus = if key.is_empty() { None } else { Some(focus.filter(|f| !f.trim().is_empty()).unwrap_or(key)) };
                Some(BriefingEntry { doc_id, level, focus, generated_at })
            })
            .collect())
    }

    pub fn briefing_run_insert(&self, run: &RunView, content_hash: &str, focus: &str, device_id: Option<&str>) -> Result<()> {
        self.exec(
            "INSERT INTO context_runs (id, document_id, content_hash, level, focus, device_id, status, stage, started_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![run.id, run.doc_id, content_hash, run.level.as_str(), focus, device_id, run.status, run.stage, run.started_at],
        )?;
        Ok(())
    }

    pub fn briefing_run_finish(&self, run: &RunView, usage: &Value, briefing_id: Option<&str>) -> Result<()> {
        self.exec(
            "UPDATE context_runs SET status = ?2, stage = ?3, error = ?4, usage = ?5, briefing_id = ?6, finished_at = ?7 WHERE id = ?1",
            params![run.id, run.status, run.stage, run.error, to_json(usage), briefing_id, run.finished_at],
        )?;
        Ok(())
    }

    pub fn briefing_run_get(&self, id: &str) -> Result<Option<RunView>> {
        self.one("SELECT id, document_id, level, status, stage, error, started_at, finished_at FROM context_runs WHERE id = ?1", params![id], |r| {
            let level: String = r.get(2)?;
            let mut v = RunView::new(r.get(0)?, r.get(1)?, Level::parse(&level).unwrap_or(Level::General), r.get(6)?);
            v.status = r.get(3)?;
            v.stage = r.get::<_, Option<String>>(4)?.unwrap_or_default();
            v.error = r.get(5)?;
            v.finished_at = r.get(7)?;
            Ok(v)
        })
    }

    /// Runs still marked running when the server starts were cut off by a restart.
    pub fn briefing_interrupt_runs(&self) -> Result<usize> {
        self.exec(
            "UPDATE context_runs SET status = 'failed', stage = 'failed', error = 'The briefing was interrupted when Pager stopped. Nothing was saved.', finished_at = ?1 WHERE status = 'running'",
            params![self.now()],
        )
    }

    /// Paid runs a device started since `since` (ISO time): the per-phone limit.
    pub fn briefing_runs_since(&self, device_id: &str, since: &str) -> Result<i64> {
        self.count("SELECT COUNT(*) FROM context_runs WHERE device_id = ?1 AND started_at >= ?2", params![device_id, since])
    }

    /// How many paid runs a paired phone has left in the rolling 24 hours (`context.phoneDailyLimit`),
    /// and when the next one frees up if none are left. Every run it started counts: a new
    /// briefing and a Refresh alike. A cache hit, or joining a run already going, starts none.
    pub fn briefing_phone_allowance(&self, device_id: &str, now_ms: i64) -> Result<PhoneAllowance> {
        let limit = self.app_settings().context.phone_daily_limit.max(0);
        let since = iso_ms(now_ms - DAY_MS);
        let used = self.briefing_runs_since(device_id, &since)?;
        let mut free_at_ms = None;
        if used >= limit && limit > 0 {
            // The run whose 24 hours end first among those over the limit.
            let at: Option<String> = self.one(
                "SELECT started_at FROM context_runs WHERE device_id = ?1 AND started_at >= ?2 ORDER BY started_at ASC LIMIT 1 OFFSET ?3",
                params![device_id, since, used - limit],
                |r| r.get(0),
            )?;
            free_at_ms = at.as_deref().and_then(parse_iso).map(|t| t + DAY_MS);
        }
        Ok(PhoneAllowance { used, limit, free_at_ms, now_ms })
    }
}

const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// A stored briefing, as the Assistant page lists it.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefingEntry {
    pub doc_id: String,
    pub level: Level,
    /// The name or work a focused briefing is about; None for the whole book.
    pub focus: Option<String>,
    pub generated_at: String,
}

/// A phone's paid runs in the last 24 hours, against its limit.
#[derive(Clone, Debug)]
pub struct PhoneAllowance {
    pub used: i64,
    pub limit: i64,
    free_at_ms: Option<i64>,
    now_ms: i64,
}

impl PhoneAllowance {
    pub fn left(&self) -> i64 {
        (self.limit - self.used).max(0)
    }

    /// 429 `limit_reached` when no run is left, with a calm message for the phone.
    pub fn check(&self) -> Result<()> {
        if self.left() > 0 {
            return Ok(());
        }
        let message = if self.limit == 0 {
            "New briefings are made on the computer: its settings don't let phones start them. Briefings already made still open here.".to_string()
        } else {
            let when = match self.free_at_ms.map(|t| t - self.now_ms) {
                Some(ms) if ms <= 60 * 60 * 1000 => " You can start another within the hour.".to_string(),
                Some(ms) => format!(" You can start another in about {} hours.", (ms + 60 * 60 * 1000 - 1) / (60 * 60 * 1000)),
                None => String::new(),
            };
            let runs = if self.limit == 1 { "1 new briefing".to_string() } else { format!("{} new briefings", self.limit) };
            format!("This phone has started {runs} in the last 24 hours, the most it can in a day.{when} Briefings already made still open, and the computer can make new ones any time.")
        };
        Err(AppError::new(429, "limit_reached", message))
    }
}
