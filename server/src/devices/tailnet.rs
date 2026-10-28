//! `https://<this computer's MagicDNS name>`, read from `tailscale status --json`: a local command
//! that asks the Tailscale daemon, not a network call. None when Tailscale isn't installed or running.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub fn tailnet_origin(timeout: Duration) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let out = std::process::Command::new("tailscale").args(["status", "--json"]).output();
        let _ = tx.send(out.ok());
    });
    let out = rx.recv_timeout(timeout).ok().flatten()?;
    if !out.status.success() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    let name = v.get("Self")?.get("DNSName")?.as_str()?;
    let host = name.trim_end_matches('.');
    if host.is_empty() || !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
        return None;
    }
    Some(format!("https://{}", host.to_lowercase()))
}

pub type OriginLookup = Arc<dyn Fn() -> Option<String> + Send + Sync>;

/// Ask at most once a minute; every failure is an answer of None.
pub fn cached_origin(lookup: OriginLookup, ttl: Duration) -> OriginLookup {
    let last: Mutex<Option<(Instant, Option<String>)>> = Mutex::new(None);
    Arc::new(move || {
        let mut l = last.lock().unwrap();
        if let Some((at, v)) = &*l {
            if at.elapsed() < ttl {
                return v.clone();
            }
        }
        let v = lookup();
        *l = Some((Instant::now(), v.clone()));
        v
    })
}

pub fn system_origin() -> OriginLookup {
    cached_origin(Arc::new(|| tailnet_origin(Duration::from_millis(1500))), Duration::from_secs(60))
}
