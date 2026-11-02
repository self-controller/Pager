//! The computer's iroh endpoint, bound while remote access is on. It dials nobody: phones dial it
//! by endpoint ID, and every connection it accepts goes to the bridge.

use crate::app::App;
use crate::errors::AppError;
use crate::remote::bridge::{self, Conns};
use crate::remote::protocol::{self, close};
use crate::Result;
use axum::Router;
use iroh::endpoint::presets;
use iroh::tls::CaTlsConfig;
use iroh::{Endpoint, EndpointAddr, RelayConfig, RelayMap, RelayMode, RelayUrl, SecretKey};
use iroh_base::TransportAddr;
use std::net::SocketAddr;
use std::str::FromStr;
use std::sync::Mutex;
use std::sync::Arc;
use std::time::Duration;
use tokio::task::JoinHandle;

/// Which relays an endpoint may use.
#[derive(Clone, Debug)]
pub enum Relay {
    /// n0's public relays and discovery: the default until you run your own relay.
    N0,
    /// One relay you run, and nothing else (no n0 discovery). Its `auth_token`, when set, is the
    /// bearer token the relay asks for (iroh-relay's `access.shared_token`).
    Custom(RelayConfig),
    /// No relay: loopback and the LAN only (the tests and the benchmark).
    Disabled,
}

#[derive(Clone, Debug)]
pub struct IrohOptions {
    /// None: a fresh key for this run (phones and tests).
    pub secret_key: Option<SecretKey>,
    pub relay: Relay,
    pub bind_addr: Option<SocketAddr>,
    pub alpns: Vec<Vec<u8>>,
    /// Which certificates the relay's TLS is checked against, when not the built-in roots (the tests'
    /// relay has a self-signed one).
    pub ca_tls: Option<CaTlsConfig>,
}

/// Your relay, and its token when it asks for one.
pub fn relay_config(url: RelayUrl, token: Option<&str>) -> RelayConfig {
    let c = RelayConfig::from(url);
    match token {
        Some(t) => c.with_auth_token(t),
        None => c,
    }
}

impl IrohOptions {
    /// Loopback only, a random key: both ends of a test in one process.
    pub fn loopback() -> IrohOptions {
        IrohOptions { secret_key: None, relay: Relay::Disabled, bind_addr: Some("127.0.0.1:0".parse().unwrap()), alpns: vec![protocol::ALPN.to_vec()], ca_tls: None }
    }

    /// Out in the world: n0's relays, or `remote.relay` (with `remote.relayToken`) when it is set.
    pub fn from_settings(relay: Option<&str>, token: Option<&str>, key: SecretKey) -> Result<IrohOptions> {
        let relay = match relay {
            None => Relay::N0,
            Some(u) => Relay::Custom(relay_config(RelayUrl::from_str(u).map_err(|e| AppError::internal(format!("remote.relay isn't a relay address: {e}")))?, token)),
        };
        Ok(IrohOptions { secret_key: Some(key), relay, bind_addr: None, alpns: vec![protocol::ALPN.to_vec()], ca_tls: None })
    }

    /// What a phone binds with to reach a computer at `addr`: with a relay token, only the computer's
    /// relay, carrying the token (your own relay has no n0 discovery); without one, n0's relays.
    pub fn phone(secret_key: Option<SecretKey>, addr: &EndpointAddr, relay_token: Option<&str>) -> IrohOptions {
        let relay = match (relay_token, relay_of(addr).and_then(|u| RelayUrl::from_str(&u).ok())) {
            (Some(t), Some(url)) => Relay::Custom(relay_config(url, Some(t))),
            _ => Relay::N0,
        };
        IrohOptions { secret_key, relay, bind_addr: None, alpns: vec![protocol::ALPN.to_vec()], ca_tls: None }
    }

    /// The relay token these options carry, if any.
    pub fn relay_token(&self) -> Option<String> {
        match &self.relay {
            Relay::Custom(c) => c.auth_token.clone(),
            _ => None,
        }
    }
}

/// Bind an endpoint with these options. The computer, the phones' client and the tests all come here.
pub async fn bind_endpoint(o: IrohOptions) -> Result<Endpoint> {
    let mut b = match &o.relay {
        Relay::N0 => iroh::endpoint::Builder::new(presets::N0),
        Relay::Custom(c) => iroh::endpoint::Builder::new(presets::Minimal).relay_mode(RelayMode::Custom(RelayMap::from(c.clone()))),
        Relay::Disabled => iroh::endpoint::Builder::new(presets::Minimal).relay_mode(RelayMode::Disabled),
    };
    if let Some(k) = o.secret_key {
        b = b.secret_key(k);
    }
    if let Some(ca) = o.ca_tls {
        b = b.ca_tls_config(ca);
    }
    b = b.alpns(o.alpns);
    if let Some(a) = o.bind_addr {
        b = b.bind_addr(a).map_err(|e| AppError::internal(format!("iroh can't bind {a}: {e}")))?;
    }
    b.bind().await.map_err(|e| AppError::internal(format!("iroh couldn't start: {e}")))
}

/// An address made of the endpoint's bound loopback sockets only (tests and the benchmark dial it).
pub fn loopback_addr(e: &Endpoint) -> EndpointAddr {
    EndpointAddr::from_parts(e.id(), e.bound_sockets().into_iter().filter(|s| s.ip().is_loopback()).map(TransportAddr::Ip))
}

/// What the desktop shows and what health reports.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrohInfo {
    /// This computer's ID, the endpoint's public key.
    pub endpoint_id: String,
    /// The short form shown in Settings.
    pub short_id: String,
    /// The relay carrying this computer right now, once one is reached.
    pub relay: Option<String>,
}

pub fn info_of(e: &Endpoint) -> IrohInfo {
    IrohInfo { endpoint_id: e.id().to_string(), short_id: e.id().fmt_short().to_string(), relay: relay_of(&e.addr()) }
}

pub fn relay_of(addr: &EndpointAddr) -> Option<String> {
    addr.addrs.iter().find_map(|a| match a {
        TransportAddr::Relay(u) => Some(u.to_string()),
        _ => None,
    })
}

struct Live {
    endpoint: Endpoint,
    /// Whether the endpoint uses a relay at all (not in the loopback tests).
    relays: bool,
    /// The token for your own relay, which the pairing link and health pass on to phones.
    relay_token: Option<String>,
    conns: Conns,
    tasks: Vec<JoinHandle<()>>,
}

/// The endpoint and the bridge around it, inside `App` so handlers can ask about it.
#[derive(Default)]
pub struct IrohNode {
    live: Mutex<Option<Live>>,
}

impl IrohNode {
    pub fn is_on(&self) -> bool {
        self.live.lock().unwrap().is_some()
    }

    pub fn endpoint(&self) -> Option<Endpoint> {
        self.live.lock().unwrap().as_ref().map(|l| l.endpoint.clone())
    }

    pub fn info(&self) -> Option<IrohInfo> {
        self.endpoint().map(|e| info_of(&e))
    }

    /// A ticket for the QR link: this computer's ID, its relay and its current direct addresses.
    pub fn ticket(&self) -> Option<String> {
        self.endpoint().map(|e| iroh_tickets::endpoint::EndpointTicket::new(e.addr()).to_string())
    }

    /// The ticket, once the endpoint has reached its relay: just after remote access turns on it may not
    /// have, and a ticket without the relay can't be dialled from another network when there is no
    /// discovery (your own relay). Waits at most `wait`, then gives the ticket as it is.
    pub async fn ticket_with_relay(&self, wait: Duration) -> Option<String> {
        let (endpoint, relays) = self.live.lock().unwrap().as_ref().map(|l| (l.endpoint.clone(), l.relays))?;
        if relays && relay_of(&endpoint.addr()).is_none() {
            let _ = tokio::time::timeout(wait, endpoint.online()).await;
        }
        self.ticket()
    }

    /// The token your own relay asks for, while iroh runs with one.
    pub fn relay_token(&self) -> Option<String> {
        self.live.lock().unwrap().as_ref().and_then(|l| l.relay_token.clone())
    }

    /// Endpoint IDs with a connection open right now.
    pub fn connected(&self) -> Vec<String> {
        self.live.lock().unwrap().as_ref().map(|l| l.conns.peers()).unwrap_or_default()
    }

    /// Bind and start accepting. `router` is the remote app the bridge calls.
    pub async fn start(&self, app: Arc<App>, router: Router, opts: IrohOptions) -> Result<IrohInfo> {
        if let Some(i) = self.info() {
            return Ok(i);
        }
        let relays = !matches!(opts.relay, Relay::Disabled);
        let relay_token = opts.relay_token();
        let endpoint = bind_endpoint(opts).await?;
        let conns = Conns::default();
        let tasks = vec![
            tokio::spawn(bridge::accept_loop(app.clone(), endpoint.clone(), router, conns.clone())),
            tokio::spawn(bridge::watch_revocations(app, conns.clone())),
        ];
        let info = info_of(&endpoint);
        *self.live.lock().unwrap() = Some(Live { endpoint, relays, relay_token, conns, tasks });
        Ok(info)
    }

    /// Close every phone's connection and the endpoint.
    pub async fn stop(&self) {
        let live = self.live.lock().unwrap().take();
        let Some(live) = live else { return };
        for t in &live.tasks {
            t.abort();
        }
        live.conns.close_all(close::REMOTE_OFF, b"remote access is off");
        let _ = tokio::time::timeout(Duration::from_secs(3), live.endpoint.close()).await;
    }

    /// Close one phone's connections (it was revoked).
    pub fn close_peer(&self, endpoint_id: &str, code: u32, reason: &[u8]) {
        if let Some(l) = self.live.lock().unwrap().as_ref() {
            l.conns.close_peer(endpoint_id, code, reason);
        }
    }
}
