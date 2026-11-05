//! Briefings (a cache, keyed by document, level, focus and content hash) and runs (one row per
//! attempt; Phase 2's per-phone limit counts them).

use super::schema::{Briefing, Level};
use super::RunView;
use crate::core::Core;
use crate::db::to_json;
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
        let focus = b.focus.clone().unwrap_or_default();
        self.exec(
            "INSERT INTO context_briefings (id, document_id, content_hash, level, focus, briefing, model, usage, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(document_id, level, focus, content_hash) DO UPDATE SET id = excluded.id, briefing = excluded.briefing, model = excluded.model, usage = excluded.usage, created_at = excluded.created_at",
            params![id, b.doc_id, b.content_hash, b.level.as_str(), focus, to_json(b), b.model, to_json(usage), b.generated_at],
        )?;
        Ok(id)
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
            Ok(RunView {
                id: r.get(0)?,
                doc_id: r.get(1)?,
                level: Level::parse(&level).unwrap_or(Level::General),
                status: r.get(3)?,
                stage: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                error: r.get(5)?,
                started_at: r.get(6)?,
                finished_at: r.get(7)?,
            })
        })
    }

    /// Runs still marked running when the server starts were cut off by a restart.
    pub fn briefing_interrupt_runs(&self) -> Result<usize> {
        self.exec(
            "UPDATE context_runs SET status = 'failed', stage = 'failed', error = 'The briefing was interrupted when Pager stopped. Nothing was saved.', finished_at = ?1 WHERE status = 'running'",
            params![self.now()],
        )
    }

    /// Paid runs a device started since `since` (ISO time): Phase 2's per-phone limit.
    pub fn briefing_runs_since(&self, device_id: &str, since: &str) -> Result<i64> {
        self.count("SELECT COUNT(*) FROM context_runs WHERE device_id = ?1 AND started_at >= ?2", params![device_id, since])
    }
}
