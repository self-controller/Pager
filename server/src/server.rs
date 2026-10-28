//! Start the reading service: the local listener on 127.0.0.1 (and ::1), the folder scan, the
//! watcher, the mirror flusher, idle shutdown, and remote access (the TCP listener and the iroh
//! endpoint) that follows the setting.

use crate::app::{App, AppOptions};
use crate::config::VERSION;
use crate::core::Notice;
use crate::http::{local_app, remote::remote_app};
use crate::library::watcher::{Watcher, WatcherOptions};
use crate::remote::identity;
use crate::remote::node::{self, IrohInfo, IrohOptions};
use crate::Result;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};

pub struct StartOptions {
    pub app: AppOptions,
    pub watch: bool,
    pub idle_shutdown: bool,
}

pub struct Running {
    pub app: Arc<App>,
    local: Vec<(oneshot::Sender<()>, tokio::task::JoinHandle<()>)>,
    remote: Arc<RemoteListener>,
    watcher: Option<Watcher>,
    tasks: Vec<tokio::task::JoinHandle<()>>,
    info: std::path::PathBuf,
    closed: bool,
}

impl Running {
    /// The server stops itself on `POST /shutdown` or an idle timeout: wait for that.
    pub async fn wait_for_shutdown(&self) {
        let mut rx = self.app.notices.subscribe();
        loop {
            match rx.recv().await {
                Ok(Notice::Shutdown) => return,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                _ => {}
            }
        }
    }

    pub async fn close(&mut self) {
        if self.closed {
            return;
        }
        self.closed = true;
        self.app.notify(Notice::Closing);
        if let Some(w) = self.watcher.as_mut() {
            w.close();
        }
        for t in self.tasks.drain(..) {
            t.abort();
        }
        self.remote.stop().await;
        for (tx, handle) in self.local.drain(..) {
            let _ = tx.send(());
            let _ = tokio::time::timeout(Duration::from_secs(2), handle).await;
        }
        let _ = self.app.run(|c| c.mirror_flush()).await;
        if let Ok(text) = std::fs::read_to_string(&self.info) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if v.get("pid").and_then(|p| p.as_u64()) == Some(std::process::id() as u64) {
                    let _ = std::fs::remove_file(&self.info);
                }
            }
        }
    }
}

async fn serve_on(addr: SocketAddr, router: axum::Router) -> std::io::Result<(oneshot::Sender<()>, tokio::task::JoinHandle<()>)> {
    let listener = TcpListener::bind(addr).await?;
    let (tx, rx) = oneshot::channel::<()>();
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = rx.await;
            })
            .await;
    });
    Ok((tx, handle))
}

/// Remote access: the TCP listener on 127.0.0.1 only (tailscale serve forwards to it, never another
/// address) and the iroh endpoint, together. Stopping ends open streams first. Starts and stops run
/// one at a time, so a quick off-on-off can't race; a failure of either part (the port is taken, iroh
/// can't bind) is logged and leaves 3006 and the other part running.
pub struct RemoteListener {
    app: Arc<App>,
    port: u16,
    state: Mutex<Option<(oneshot::Sender<()>, tokio::task::JoinHandle<()>)>>,
    /// The relay setting iroh was started with: a change restarts it.
    relay: Mutex<Option<Option<String>>>,
}

impl RemoteListener {
    pub fn new(app: Arc<App>, port: u16) -> RemoteListener {
        RemoteListener { app, port, state: Mutex::new(None), relay: Mutex::new(None) }
    }

    pub async fn start(&self) {
        let mut st = self.state.lock().await;
        let settings = self.app.lock().app_settings().remote;
        if st.is_none() {
            let router = remote_app(&self.app);
            match serve_on(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), self.port), router).await {
                Ok(s) => {
                    *st = Some(s);
                    println!("Remote access is on at http://127.0.0.1:{} (point tailscale serve at it).", self.port);
                }
                Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => eprintln!("Remote access couldn't start: port {} is in use (PAGER_REMOTE_PORT picks another).", self.port),
                Err(e) => eprintln!("Remote access: {e}"),
            }
        }
        let mut relay = self.relay.lock().await;
        if self.app.iroh.is_on() && relay.as_ref() != Some(&settings.relay) {
            self.app.notify(Notice::RemoteClosing);
            self.app.iroh.stop().await;
        }
        if !self.app.iroh.is_on() {
            match self.start_iroh(settings.relay.as_deref()).await {
                Ok(info) => {
                    *relay = Some(settings.relay.clone());
                    println!("Phones can reach this computer over iroh. Its ID is {} ({}).", info.short_id, info.endpoint_id);
                }
                Err(e) => eprintln!("Remote access over iroh couldn't start: {}", e.message),
            }
        }
    }

    async fn start_iroh(&self, relay: Option<&str>) -> Result<IrohInfo> {
        let key = identity::load_or_create(&self.app.data_dir)?;
        let opts = IrohOptions::from_settings(relay, key)?;
        let info = self.app.iroh.start(self.app.clone(), remote_app(&self.app), opts).await?;
        // Say which relay carries this computer once one is reached.
        if let Some(e) = self.app.iroh.endpoint() {
            tokio::spawn(async move {
                if tokio::time::timeout(Duration::from_secs(30), e.online()).await.is_ok() {
                    if let Some(r) = node::info_of(&e).relay {
                        println!("iroh relay: {r}");
                    }
                }
            });
        }
        Ok(info)
    }

    pub async fn stop(&self) {
        let mut st = self.state.lock().await;
        let tcp = st.take();
        if tcp.is_none() && !self.app.iroh.is_on() {
            return;
        }
        // Streams end themselves cleanly; anything still open after a second is cut.
        self.app.notify(Notice::RemoteClosing);
        if let Some((tx, handle)) = tcp {
            let _ = tx.send(());
            if tokio::time::timeout(Duration::from_secs(1), handle).await.is_err() {
                // The task keeps draining connections in the background; the port is released as they close.
            }
        }
        self.app.iroh.stop().await;
        *self.relay.lock().await = None;
        println!("Remote access is off.");
    }

    pub async fn is_on(&self) -> bool {
        self.state.lock().await.is_some() || self.app.iroh.is_on()
    }
}

pub async fn start(o: StartOptions) -> Result<Running> {
    let app = App::new(o.app)?;
    let local = local_app(&app);
    let mut listeners = Vec::new();
    listeners.push(serve_on(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), app.port), local.clone()).await?);
    // Also answer on IPv6 loopback, since "localhost" may resolve to ::1 first. Optional.
    if let Ok(l) = serve_on(SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), app.port), local).await {
        listeners.push(l);
    }

    let info = app.data_dir.join("server.json");
    std::fs::create_dir_all(&app.data_dir)?;
    std::fs::write(&info, serde_json::to_string_pretty(&serde_json::json!({ "pid": std::process::id(), "port": app.port, "version": VERSION, "startedAt": app.started_at, "dataDir": app.data_dir })).unwrap())?;

    // The library folder: made if missing, seeded with the welcome page on first run, scanned, then watched.
    let a = app.clone();
    tokio::task::spawn_blocking(move || a.ensure()).await.map_err(|e| crate::errors::AppError::internal(e.to_string()))??;
    let watcher = if o.watch { Some(Watcher::start(app.clone(), WatcherOptions::default())) } else { None };

    let mut tasks = Vec::new();
    // The Markdown mirror's debounced writes.
    let a = app.clone();
    tasks.push(tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(250)).await;
            let _ = a.run(|c| c.mirror_flush_due()).await;
        }
    }));
    // A server the CLI started in the background stops itself after `idleShutdownMinutes` with no open
    // tabs (no stream) and no requests. Settings: app.idleShutdownMinutes (0 = never).
    if o.idle_shutdown {
        let a = app.clone();
        tasks.push(tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;
                let minutes = a.run(|c| Ok(c.app_settings().idle_shutdown_minutes)).await.unwrap_or(360);
                let idle_ms = a.clock.now_ms() - a.idle.last_ms.load(Ordering::SeqCst);
                if minutes > 0 && a.idle.streams.load(Ordering::SeqCst) == 0 && idle_ms > minutes * 60_000 {
                    a.notify(Notice::Shutdown);
                }
            }
        }));
    }

    // Remote access is off until the setting turns it on, and follows the setting without a restart.
    let remote = Arc::new(RemoteListener::new(app.clone(), app.remote_port));
    if app.lock().app_settings().remote.enabled {
        remote.start().await;
    }
    let r = remote.clone();
    let mut notices = app.notices.subscribe();
    tasks.push(tokio::spawn(async move {
        loop {
            match notices.recv().await {
                Ok(Notice::AppSettingsChanged(s)) => {
                    if s.remote.enabled {
                        r.start().await;
                    } else {
                        r.stop().await;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                _ => {}
            }
        }
    }));

    Ok(Running { app, local: listeners, remote, watcher, tasks, info, closed: false })
}
