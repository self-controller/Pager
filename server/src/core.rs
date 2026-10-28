//! The server's state: one SQLite connection, caches and in-memory services, behind one lock. The
//! original kept this as a context object passed to a handful of service classes; here every
//! service is an `impl Core` block in its own module, so they call each other freely.

use crate::clock::Clock;
use crate::db::open_db;
use crate::devices::pairing::Pairing;
use crate::ids::new_id;
use crate::journal::Bus;
use crate::library::assets::AssetStore;
use crate::library::jobs::Jobs;
use crate::library::revisions::RevisionCache;
use crate::model::{AppSettings, JournalEvent};
use crate::Result;
use rusqlite::types::{ToSqlOutput, Value as SqlValue, ValueRef};
use rusqlite::{Connection, ToSql};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::broadcast;

/// In-process notifications between services and the listeners.
#[derive(Clone, Debug)]
pub enum Notice {
    DocumentAdded(String),
    DocumentsRemoved(String),
    DocumentOpened(String),
    FolderScanned(String),
    AppSettingsChanged(AppSettings),
    DeviceRevoked(String),
    RemoteClosing,
    Closing,
    Shutdown,
    Request,
    StreamOpen,
    StreamClose,
}

#[derive(Clone)]
pub struct Notices {
    async_tx: broadcast::Sender<Notice>,
    sync: Arc<Mutex<Vec<std::sync::mpsc::Sender<Notice>>>>,
}

impl Default for Notices {
    fn default() -> Self {
        let (async_tx, _) = broadcast::channel(256);
        Notices { async_tx, sync: Arc::new(Mutex::new(Vec::new())) }
    }
}

impl Notices {
    pub fn emit(&self, n: Notice) {
        let _ = self.async_tx.send(n.clone());
        self.sync.lock().unwrap().retain(|tx| tx.send(n.clone()).is_ok());
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Notice> {
        self.async_tx.subscribe()
    }

    pub fn subscribe_sync(&self) -> std::sync::mpsc::Receiver<Notice> {
        let (tx, rx) = std::sync::mpsc::channel();
        self.sync.lock().unwrap().push(tx);
        rx
    }
}

pub struct CoreOptions {
    pub data_dir: PathBuf,
    /// Defaults to `<data_dir>/reads` (tests); the server passes `default_reads_dir()`.
    pub reads_dir: Option<PathBuf>,
    pub clock: Clock,
    pub port: u16,
    /// ":memory:" for tests that don't need a file.
    pub db_file: Option<PathBuf>,
    pub mirror_delay_ms: u64,
}

pub struct Core {
    pub db: Connection,
    pub clock: Clock,
    pub data_dir: PathBuf,
    pub reads_dir: PathBuf,
    pub port: u16,
    pub started_at: String,
    pub assets: AssetStore,
    pub cache: RevisionCache,
    pub jobs: Jobs,
    pub bus: Bus,
    pub notices: Notices,
    pub(crate) tx_depth: u32,
    pub(crate) pending_events: Option<Vec<JournalEvent>>,
    /// The reads folder with symlinks resolved; set once the folder has been ensured.
    pub reads_root: Option<PathBuf>,
    pub reads_source_id: Option<String>,
    /// Documents whose Markdown mirror is due, and when.
    pub mirror_pending: HashMap<String, Instant>,
    pub mirror_delay_ms: u64,
    pub pairing: Pairing,
}

impl Core {
    pub fn new(o: CoreOptions, bus: Bus, notices: Notices) -> Result<Core> {
        let db_file = o.db_file.unwrap_or_else(|| o.data_dir.join("pager.db"));
        let db = open_db(&db_file, Some(&o.data_dir.join("backups")))?;
        let started_at = o.clock.iso();
        Ok(Core {
            db,
            clock: o.clock.clone(),
            assets: AssetStore::new(&o.data_dir),
            cache: RevisionCache::new(&o.data_dir, 12),
            reads_dir: o.reads_dir.unwrap_or_else(|| o.data_dir.join("reads")),
            data_dir: o.data_dir,
            port: o.port,
            started_at,
            jobs: Jobs::default(),
            bus,
            notices,
            tx_depth: 0,
            pending_events: None,
            reads_root: None,
            reads_source_id: None,
            mirror_pending: HashMap::new(),
            mirror_delay_ms: o.mirror_delay_ms,
            pairing: Pairing::new(o.clock),
        })
    }

    pub fn now(&self) -> String {
        self.clock.iso()
    }

    pub fn now_ms(&self) -> i64 {
        self.clock.now_ms()
    }

    pub fn new_id(&self) -> String {
        new_id(self.clock.now_ms())
    }

    pub fn notify(&self, n: Notice) {
        self.notices.emit(n);
    }

    // ---- Small query helpers ----

    pub fn one<T>(&self, sql: &str, params: &[&dyn ToSql], f: impl FnOnce(&rusqlite::Row) -> rusqlite::Result<T>) -> Result<Option<T>> {
        let mut st = self.db.prepare(sql)?;
        let mut rows = st.query(params)?;
        match rows.next()? {
            Some(r) => Ok(Some(f(r)?)),
            None => Ok(None),
        }
    }

    pub fn all<T>(&self, sql: &str, params: &[&dyn ToSql], mut f: impl FnMut(&rusqlite::Row) -> rusqlite::Result<T>) -> Result<Vec<T>> {
        let mut st = self.db.prepare(sql)?;
        let mut rows = st.query(params)?;
        let mut out = Vec::new();
        while let Some(r) = rows.next()? {
            out.push(f(r)?);
        }
        Ok(out)
    }

    pub fn exec(&self, sql: &str, params: &[&dyn ToSql]) -> Result<usize> {
        Ok(self.db.execute(sql, params)?)
    }

    pub fn count(&self, sql: &str, params: &[&dyn ToSql]) -> Result<i64> {
        Ok(self.one(sql, params, |r| r.get::<_, i64>(0))?.unwrap_or(0))
    }

    pub fn exists(&self, sql: &str, params: &[&dyn ToSql]) -> Result<bool> {
        Ok(self.one(sql, params, |_| Ok(()))?.is_some())
    }
}

/// A JSON value as a SQL parameter (strings, numbers, booleans, null).
pub fn sql_value(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                SqlValue::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

/// `ToSql` for a borrowed JSON value.
pub struct Sql<'a>(pub &'a Value);

impl ToSql for Sql<'_> {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::Owned(sql_value(self.0)))
    }
}

pub fn text_ref(v: ValueRef<'_>) -> Option<String> {
    match v {
        ValueRef::Text(t) => Some(String::from_utf8_lossy(t).into_owned()),
        _ => None,
    }
}
