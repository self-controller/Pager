//! The shared, lockable state behind both listeners, and the few operations that must run outside
//! the lock (the folder scan at startup, folder imports and deprecated folder sources, which read
//! many files one at a time so requests get in between).

use crate::clock::Clock;
use crate::config::{DEFAULT_PORT, DEFAULT_REMOTE_PORT};
use crate::core::{Core, CoreOptions, Notice, Notices};
use crate::devices::tailnet::OriginLookup;
use crate::errors::AppError;
use crate::journal::Bus;
use crate::library::folders::{add_folder, scan_folder};
use crate::library::library::expand_path;
use crate::library::reads::{copy_folder, ImportOutcome};
use crate::model::{AddSourceResult, IngestJob};
use crate::Result;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

pub struct AppOptions {
    pub data_dir: PathBuf,
    pub reads_dir: Option<PathBuf>,
    pub clock: Clock,
    pub port: u16,
    pub remote_port: u16,
    pub db_file: Option<PathBuf>,
    pub mirror_delay_ms: u64,
    pub web: Option<PathBuf>,
    pub welcome: bool,
    pub suggest_origin: Option<OriginLookup>,
}

impl AppOptions {
    pub fn new(data_dir: PathBuf) -> AppOptions {
        AppOptions { data_dir, reads_dir: None, clock: Clock::System, port: DEFAULT_PORT, remote_port: DEFAULT_REMOTE_PORT, db_file: None, mirror_delay_ms: 2000, web: None, welcome: false, suggest_origin: None }
    }
}

enum EnsureState {
    Pending,
    Running,
    Done(String),
}

pub struct Idle {
    pub last_ms: AtomicI64,
    pub streams: AtomicI64,
}

pub struct App {
    core: Mutex<Core>,
    pub bus: Bus,
    pub notices: Notices,
    pub clock: Clock,
    pub data_dir: PathBuf,
    pub reads_dir: PathBuf,
    pub port: u16,
    pub remote_port: u16,
    pub web_dir: Option<PathBuf>,
    pub welcome: bool,
    pub suggest_origin: OriginLookup,
    pub started_at: String,
    ensure: Mutex<EnsureState>,
    ensure_cv: Condvar,
    pub idle: Idle,
    /// The iroh endpoint and bridge, on while remote access is on.
    pub iroh: crate::remote::node::IrohNode,
}

impl App {
    pub fn new(o: AppOptions) -> Result<Arc<App>> {
        let bus = Bus::default();
        let notices = Notices::default();
        let core = Core::new(
            CoreOptions { data_dir: o.data_dir.clone(), reads_dir: o.reads_dir.clone(), clock: o.clock.clone(), port: o.port, db_file: o.db_file.clone(), mirror_delay_ms: o.mirror_delay_ms },
            bus.clone(),
            notices.clone(),
        )?;
        let reads_dir = core.reads_dir.clone();
        let started_at = core.started_at.clone();
        let now = o.clock.now_ms();
        Ok(Arc::new(App {
            core: Mutex::new(core),
            bus,
            notices,
            clock: o.clock,
            data_dir: o.data_dir,
            reads_dir,
            port: o.port,
            remote_port: o.remote_port,
            web_dir: o.web,
            welcome: o.welcome,
            suggest_origin: o.suggest_origin.unwrap_or_else(|| Arc::new(|| None)),
            started_at,
            ensure: Mutex::new(EnsureState::Pending),
            ensure_cv: Condvar::new(),
            idle: Idle { last_ms: AtomicI64::new(now), streams: AtomicI64::new(0) },
            iroh: crate::remote::node::IrohNode::default(),
        }))
    }

    pub fn lock(&self) -> MutexGuard<'_, Core> {
        self.core.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Run a blocking piece of work against the core on the blocking pool.
    pub async fn run<T: Send + 'static>(self: &Arc<Self>, f: impl FnOnce(&mut Core) -> Result<T> + Send + 'static) -> Result<T> {
        let app = self.clone();
        tokio::task::spawn_blocking(move || {
            let mut c = app.lock();
            f(&mut c)
        })
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
    }

    /// Like `run`, after making sure the reads folder exists and is scanned.
    pub async fn run_ensured<T: Send + 'static>(self: &Arc<Self>, f: impl FnOnce(&mut Core) -> Result<T> + Send + 'static) -> Result<T> {
        let app = self.clone();
        tokio::task::spawn_blocking(move || {
            app.ensure()?;
            let mut c = app.lock();
            f(&mut c)
        })
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
    }

    /// Make the root exist, register it as the library's folder source and scan it. Idempotent:
    /// callers waiting on a scan in progress get its result.
    pub fn ensure(&self) -> Result<String> {
        {
            let mut st = self.ensure.lock().unwrap();
            loop {
                match &*st {
                    EnsureState::Done(id) => return Ok(id.clone()),
                    EnsureState::Running => st = self.ensure_cv.wait(st).unwrap(),
                    EnsureState::Pending => {
                        *st = EnsureState::Running;
                        break;
                    }
                }
            }
        }
        let result = self.do_ensure();
        let mut st = self.ensure.lock().unwrap();
        *st = match &result {
            Ok(id) => EnsureState::Done(id.clone()),
            Err(_) => EnsureState::Pending,
        };
        self.ensure_cv.notify_all();
        result
    }

    fn do_ensure(&self) -> Result<String> {
        std::fs::create_dir_all(&self.reads_dir)?;
        let real = std::fs::canonicalize(&self.reads_dir)?;
        let source_id = {
            let mut c = self.lock();
            c.reads_root = Some(real.clone());
            if self.welcome {
                c.seed_welcome()?;
            }
            let source = c.ensure_source("folder", &real.to_string_lossy(), "Reads")?;
            c.reads_source_id = Some(source.id.clone());
            source.id
        };
        scan_folder(self, &source_id, &real, None)?;
        Ok(source_id)
    }

    /// Copy a file (done) or a folder (a background job) from a path on this machine.
    pub fn import_path(self: &Arc<Self>, dir: Option<&Value>, raw: Option<&Value>) -> Result<IngestJob> {
        self.ensure()?;
        let outcome = self.lock().import_path(dir, raw)?;
        match outcome {
            ImportOutcome::Done(job) => Ok(job),
            ImportOutcome::Folder { job, src, dest, source_id } => {
                let app = self.clone();
                let jid = job.id.clone();
                std::thread::spawn(move || copy_folder(&app, &src, &dest, &source_id, &jid));
                Ok(job)
            }
        }
    }

    /// Deprecated `POST /sources`: watch a file or folder in place.
    pub fn add_source(self: &Arc<Self>, raw: &str) -> Result<AddSourceResult> {
        let abs = expand_path(raw)?;
        let real = std::fs::canonicalize(&abs).map_err(|_| AppError::new(404, "not_found", format!("Nothing was found at {}.", raw.trim())))?;
        let meta = std::fs::metadata(&real).map_err(|_| AppError::new(404, "not_found", format!("Nothing was found at {}.", raw.trim())))?;
        if meta.is_dir() {
            return add_folder(self, &real);
        }
        if !meta.is_file() {
            return Err(AppError::new(422, "unsupported", format!("{} isn't a file Pager can open.", raw.trim())));
        }
        let mut c = self.lock();
        let name = real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let source = c.ensure_source("file", &real.to_string_lossy(), &name)?;
        let job = c.job_create();
        match c.ingest_path(&real, &source.id) {
            Ok(doc_id) => {
                c.job_finish(&job.id, &[doc_id])?;
            }
            Err(e) => {
                // A file that can't be read leaves no empty source behind.
                let n = c.count("SELECT COUNT(*) FROM documents WHERE source_id = ?1 AND deleted_at IS NULL", rusqlite::params![source.id])?;
                if n == 0 {
                    c.exec("UPDATE sources SET removed_at = ?1 WHERE id = ?2", rusqlite::params![c.now(), source.id])?;
                }
                c.job_fail(&job.id, &e.message)?;
                return Err(e);
            }
        }
        let job = c.jobs.get(&job.id).unwrap_or(job);
        Ok(AddSourceResult { source: c.get_source(&source.id)?, job })
    }

    pub fn touch(&self) {
        self.idle.last_ms.store(self.clock.now_ms(), Ordering::SeqCst);
    }

    pub fn notify(&self, n: Notice) {
        self.notices.emit(n);
    }
}
