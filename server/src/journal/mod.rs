//! The journal: every server-side change appends an event in the same transaction as the change
//! itself (state tables stay authoritative). Events are published to the bus only after commit.

pub mod client;

use crate::core::Core;
use crate::db::{from_json, to_json};
use crate::model::JournalEvent;
use crate::Result;
use rusqlite::params;
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

/// In-process fan-out for the live stream.
#[derive(Clone, Default)]
pub struct Bus {
    inner: Arc<BusInner>,
}

#[derive(Default)]
struct BusInner {
    subs: Mutex<Vec<(u64, mpsc::UnboundedSender<JournalEvent>)>>,
    next: AtomicU64,
}

impl Bus {
    pub fn subscribe(&self) -> (u64, mpsc::UnboundedReceiver<JournalEvent>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let id = self.inner.next.fetch_add(1, Ordering::SeqCst);
        self.inner.subs.lock().unwrap().push((id, tx));
        (id, rx)
    }

    pub fn unsubscribe(&self, id: u64) {
        self.inner.subs.lock().unwrap().retain(|(i, _)| *i != id);
    }

    pub fn publish(&self, e: &JournalEvent) {
        let mut subs = self.inner.subs.lock().unwrap();
        subs.retain(|(_, tx)| tx.send(e.clone()).is_ok());
    }

    pub fn size(&self) -> usize {
        self.inner.subs.lock().unwrap().len()
    }
}

pub fn row_to_event(r: &rusqlite::Row) -> rusqlite::Result<JournalEvent> {
    let payload: String = r.get("payload")?;
    Ok(JournalEvent {
        seq: r.get("seq")?,
        at: r.get("at")?,
        origin: r.get("origin")?,
        kind: r.get("type")?,
        v: r.get("v")?,
        doc_id: r.get("document_id")?,
        subject_id: r.get("subject_id")?,
        payload: from_json(Some(&payload), Value::Object(Default::default())),
    })
}

/// What `emit` takes besides the type and payload.
#[derive(Default)]
pub struct Emit {
    pub doc_id: Option<String>,
    pub subject_id: Option<String>,
    pub at: Option<String>,
}

impl Emit {
    pub fn doc(id: &str) -> Emit {
        Emit { doc_id: Some(id.to_string()), ..Default::default() }
    }

    pub fn subject(id: &str) -> Emit {
        Emit { subject_id: Some(id.to_string()), ..Default::default() }
    }

    pub fn doc_subject(doc: &str, subject: &str) -> Emit {
        Emit { doc_id: Some(doc.to_string()), subject_id: Some(subject.to_string()), at: None }
    }
}

impl Core {
    /// Run `f` in a transaction; events it emits are published once it commits. Nests.
    pub fn tx<T>(&mut self, f: impl FnOnce(&mut Core) -> Result<T>) -> Result<T> {
        if self.tx_depth > 0 {
            self.tx_depth += 1;
            let r = f(self);
            self.tx_depth -= 1;
            return r;
        }
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        self.tx_depth = 1;
        self.pending_events = Some(Vec::new());
        let result = f(self);
        self.tx_depth = 0;
        let events = self.pending_events.take().unwrap_or_default();
        match result {
            Ok(v) => {
                self.db.execute_batch("COMMIT")?;
                for e in &events {
                    self.bus.publish(e);
                }
                Ok(v)
            }
            Err(e) => {
                let _ = self.db.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    /// A server event (payload as JSON).
    pub fn emit(&mut self, kind: &str, opts: Emit, payload: Value) -> Result<JournalEvent> {
        self.append("server", kind, opts, payload)
    }

    pub fn append(&mut self, origin: &str, kind: &str, opts: Emit, payload: Value) -> Result<JournalEvent> {
        let at = opts.at.unwrap_or_else(|| self.clock.iso());
        self.db.execute(
            "INSERT INTO events (at, origin, type, v, document_id, subject_id, payload) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6)",
            params![at, origin, kind, opts.doc_id, opts.subject_id, to_json(&payload)],
        )?;
        let e = JournalEvent { seq: self.db.last_insert_rowid(), at, origin: origin.to_string(), kind: kind.to_string(), v: 1, doc_id: opts.doc_id, subject_id: opts.subject_id, payload };
        match &mut self.pending_events {
            Some(p) => p.push(e.clone()),
            None => self.bus.publish(&e),
        }
        Ok(e)
    }

    pub fn events_since(&self, seq: i64, limit: usize) -> Result<Vec<JournalEvent>> {
        let mut st = self.db.prepare("SELECT * FROM events WHERE seq > ?1 ORDER BY seq LIMIT ?2")?;
        let rows = st.query_map(params![seq, limit as i64], row_to_event)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}
