//! `pager-server`: run the reading service in the foreground.

use pager_server::app::AppOptions;
use pager_server::config::{default_data_dir, default_port, default_reads_dir, default_remote_port, web_dir};
use pager_server::devices::tailnet::system_origin;
use pager_server::server::{start, StartOptions};

#[tokio::main]
async fn main() {
    let data_dir = default_data_dir();
    let reads_dir = default_reads_dir();
    let port = default_port();
    let mut app = AppOptions::new(data_dir.clone());
    app.reads_dir = Some(reads_dir.clone());
    app.port = port;
    app.remote_port = default_remote_port();
    app.web = web_dir();
    app.welcome = true;
    app.suggest_origin = Some(system_origin());
    // The CLI marks servers it starts in the background; only those stop themselves when idle.
    let idle = std::env::var("PAGER_BACKGROUND").map(|v| v == "1").unwrap_or(false);
    let mut running = match start(StartOptions { app, watch: true, idle_shutdown: idle }).await {
        Ok(r) => r,
        Err(e) => {
            if e.message.contains("Address already in use") || e.message.contains("address in use") {
                eprintln!("Port {port} is already in use. Is Pager already running? (PAGER_PORT picks another port.)");
            } else {
                eprintln!("{}", e.message);
            }
            std::process::exit(1);
        }
    };
    println!("Pager is running at http://localhost:{port}  (library: {}, data: {})", reads_dir.display(), data_dir.display());
    tokio::select! {
        _ = running.wait_for_shutdown() => {}
        _ = tokio::signal::ctrl_c() => {}
        _ = sigterm() => {}
    }
    running.close().await;
}

#[cfg(unix)]
async fn sigterm() {
    use tokio::signal::unix::{signal, SignalKind};
    match signal(SignalKind::terminate()) {
        Ok(mut s) => {
            s.recv().await;
        }
        Err(_) => std::future::pending::<()>().await,
    }
}

#[cfg(not(unix))]
async fn sigterm() {
    std::future::pending::<()>().await
}
