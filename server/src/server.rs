//! Start the reading service: the local listener on 127.0.0.1 (and ::1), the folder scan, the
//! watcher, the mirror flusher, idle shutdown, and remote access that follows the setting (the iroh
//! endpoint, and the TCP listener while a Tailscale address is set).

use crate::app::{App, AppOptions};
use crate::config::VERSION;
use crate::core::Notice;
use crate::http::{local_app, remote::remote_app};
use crate::library::watcher::{Watcher, WatcherOptions};
use crate::remote::identity;
use crate::remote::node::{self, IrohInfo, IrohOptions, Relay};
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
    local: Vec<Serving>,
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

/// A listener's shutdown signal and its server task.
type Serving = (oneshot::Sender<()>, tokio::task::JoinHandle<()>);

async fn serve_on(addr: SocketAddr, router: axum::Router) -> std::io::Result<Serving> {
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

/// Stop a listener after its streams were told to end: they end themselves cleanly, and anything
/// still open after a second is cut.
async fn shut((tx, handle): Serving) {
    let _ = tx.send(());
    if tokio::time::timeout(Duration::from_secs(1), handle).await.is_err() {
        // The task keeps draining connections in the background; the port is released as they close.
    }
}

/// Remote access: the iroh endpoint whenever it is on, and the TCP listener on 127.0.0.1 only
/// (tailscale serve forwards to it, never another address) while a Tailscale address is set.
/// Stopping ends open streams first. Changes run one at a time, so a quick off-on-off can't race; a
/// failure of either part (the port is taken, iroh can't bind) is logged and leaves 3006 and the
/// other part running.
pub struct RemoteListener {
    app: Arc<App>,
    port: u16,
    state: Mutex<Option<Serving>>,
    /// The relay address and token iroh was started with: a change to either restarts it.
    relay: Mutex<Option<(Option<String>, Option<String>)>>,
    /// The tests' iroh options (loopback, or their own relay) in place of the setting's address.
    iroh_options: Option<IrohOptions>,
}

impl RemoteListener {
    pub fn new(app: Arc<App>, port: u16) -> RemoteListener {
        RemoteListener { app, port, state: Mutex::new(None), relay: Mutex::new(None), iroh_options: None }
    }

    /// Bind iroh with these options (the secret key still comes from the data folder, and a custom
    /// relay's token from `remote.relayToken`).
    pub fn with_iroh_options(mut self, o: IrohOptions) -> RemoteListener {
        self.iroh_options = Some(o);
        self
    }

    /// Make both parts match `app.remote`: off stops everything; on runs iroh, and the TCP listener
    /// only while `origin` is set.
    pub async fn sync(&self) {
        let settings = self.app.lock().app_settings().remote;
        if !settings.enabled {
            return self.stop().await;
        }
        let mut st = self.state.lock().await;
        if settings.origin.is_none() {
            Self::stop_tcp(&self.app, &mut st).await;
        } else if st.is_none() {
            let router = remote_app(&self.app);
            match serve_on(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), self.port), router).await {
                Ok(s) => {
                    *st = Some(s);
                    println!("Remote access over Tailscale is on at http://127.0.0.1:{} (point tailscale serve at it).", self.port);
                }
                Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => eprintln!("Remote access over Tailscale couldn't start: port {} is in use (PAGER_REMOTE_PORT picks another).", self.port),
                Err(e) => eprintln!("Remote access over Tailscale: {e}"),
            }
        }
        let mut relay = self.relay.lock().await;
        let wanted = (settings.relay.clone(), settings.relay_token.clone());
        if self.app.iroh.is_on() && relay.as_ref() != Some(&wanted) {
            self.app.notify(Notice::RemoteClosing);
            self.app.iroh.stop().await;
        }
        if !self.app.iroh.is_on() {
            match self.start_iroh(settings.relay.as_deref(), settings.relay_token.as_deref()).await {
                Ok(info) => {
                    *relay = Some(wanted);
                    println!("Phones can reach this computer over iroh. Its ID is {} ({}).", info.short_id, info.endpoint_id);
                }
                Err(e) => eprintln!("Remote access over iroh couldn't start: {}", e.message),
            }
        }
    }

    async fn start_iroh(&self, relay: Option<&str>, token: Option<&str>) -> Result<IrohInfo> {
        let key = identity::load_or_create(&self.app.data_dir)?;
        let opts = match &self.iroh_options {
            Some(o) => {
                let mut o = IrohOptions { secret_key: Some(key), ..o.clone() };
                if let Relay::Custom(c) = &mut o.relay {
                    c.auth_token = token.map(str::to_string);
                }
                o
            }
            None => IrohOptions::from_settings(relay, token, key)?,
        };
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

    /// Stop the TCP listener alone (the Tailscale address was cleared). Device streams on both paths
    /// end, as on any stop; a phone over iroh reopens its stream from the last event.
    async fn stop_tcp(app: &App, st: &mut Option<Serving>) {
        let Some(tcp) = st.take() else { return };
        app.notify(Notice::RemoteClosing);
        shut(tcp).await;
        println!("Remote access over Tailscale is off.");
    }

    pub async fn stop(&self) {
        let mut st = self.state.lock().await;
        let tcp = st.take();
        if tcp.is_none() && !self.app.iroh.is_on() {
            return;
        }
        self.app.notify(Notice::RemoteClosing);
        if let Some(tcp) = tcp {
            shut(tcp).await;
        }
        self.app.iroh.stop().await;
        *self.relay.lock().await = None;
        println!("Remote access is off.");
    }

    /// Whether the TCP listener (the Tailscale path) is running.
    pub async fn tcp_is_on(&self) -> bool {
        self.state.lock().await.is_some()
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
    remote.sync().await;
    let r = remote.clone();
    let mut notices = app.notices.subscribe();
    tasks.push(tokio::spawn(async move {
        loop {
            match notices.recv().await {
                Ok(Notice::AppSettingsChanged(_)) => r.sync().await,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                _ => {}
            }
        }
    }));

    Ok(Running { app, local: listeners, remote, watcher, tasks, info, closed: false })
}
