//! Pairing, after RFC 8628's device flow: the desktop opens a five-minute window with a code; the
//! phone sends the code and a name, then polls; the desktop allows or denies it. One request at a
//! time, five wrong codes close the window. In memory only: a restart cancels it.

use super::service::device_name;
use crate::clock::{iso_ms, Clock};
use crate::errors::{gone, invalid, AppError};
use crate::ids::{new_id, new_secret, random_below, same_hash, sha256_hex};
use crate::model::*;
use crate::Result;
use serde_json::Value;

/// RFC 8628 §6.1's base-20 alphabet: no vowels (no words), no look-alike characters.
const ALPHABET: &[u8] = b"BCDFGHJKLMNPQRSTVWXZ";
pub const PAIRING_MS: i64 = 5 * 60_000;
pub const MAX_ATTEMPTS: u32 = 5;
/// After approval, how long the phone has to collect its credential.
const COLLECT_MS: i64 = 5 * 60_000;

/// What the user types: case, dashes and spaces don't matter.
fn normalise(raw: &str) -> String {
    raw.to_uppercase().chars().filter(|c| !c.is_whitespace() && *c != '-').collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Status {
    Pending,
    Approved,
    Collected,
}

#[derive(Clone, Debug)]
struct PairRequest {
    request_id: String,
    poll_secret_hash: String,
    name: String,
    ip: Option<String>,
    /// The phone's iroh endpoint, when it asked over iroh.
    endpoint_id: Option<String>,
    at: String,
    status: Status,
    /// Held in memory between approval and the phone's next poll, then dropped.
    token: Option<String>,
    device: Option<RemoteDevice>,
    collect_by: Option<i64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Closed {
    Approved,
    Exhausted,
    Expired,
    Cancelled,
}

#[derive(Clone, Debug)]
struct Window {
    code: String,
    code_hash: String,
    url: String,
    app_url: Option<String>,
    expires_at: i64,
    attempts: u32,
    closed: Option<Closed>,
    request: Option<PairRequest>,
}

pub struct Pairing {
    clock: Clock,
    window: Option<Window>,
}

impl Pairing {
    pub fn new(clock: Clock) -> Pairing {
        Pairing { clock, window: None }
    }

    fn now(&self) -> i64 {
        self.clock.now_ms()
    }

    /// The window, after closing it if its time is up.
    fn current(&mut self) -> Option<&mut Window> {
        let now = self.now();
        let w = self.window.as_mut()?;
        if w.closed.is_none() && now >= w.expires_at {
            w.closed = Some(Closed::Expired);
        }
        Some(w)
    }

    pub fn is_open(&mut self) -> bool {
        self.current().map(|w| w.closed.is_none()).unwrap_or(false)
    }

    // ---- The desktop (local listener) ----

    /// Open a window and show its code. `origin` is app.remote.origin; `ticket` is this computer's iroh
    /// ticket when iroh is on, which makes the phone app's `pager://pair` link.
    pub fn open(&mut self, origin: &str, ticket: Option<String>) -> Result<PairingWindow> {
        if self.is_open() {
            return Err(AppError::new(409, "conflict", "A pairing code is already showing. Use it, or cancel it first."));
        }
        let raw: String = (0..8).map(|_| ALPHABET[random_below(ALPHABET.len() as u32) as usize] as char).collect();
        let code = format!("{}-{}", &raw[..4], &raw[4..]);
        let expires_at = self.now() + PAIRING_MS;
        // The fragment never reaches a server, so the code stays out of any proxy's logs.
        let url = format!("{origin}/pair#code={code}");
        let app_url = ticket.map(|t| format!("pager://pair?v=1&t={t}&code={code}"));
        self.window = Some(Window { code: code.clone(), code_hash: sha256_hex(raw.as_bytes()), url: url.clone(), app_url: app_url.clone(), expires_at, attempts: 0, closed: None, request: None });
        Ok(PairingWindow { code, url, app_url, expires_at: iso_ms(expires_at) })
    }

    pub fn state(&mut self) -> PairingState {
        let Some(w) = self.current().cloned() else { return PairingState { open: false, code: None, url: None, app_url: None, expires_at: None, attempts: 0, pending: None } };
        if w.closed.is_some() {
            return PairingState { open: false, code: None, url: None, app_url: None, expires_at: None, attempts: w.attempts, pending: None };
        }
        let pending = w.request.as_ref().filter(|r| r.status == Status::Pending).map(|r| PendingPair { request_id: r.request_id.clone(), name: r.name.clone(), ip: r.ip.clone(), at: r.at.clone(), endpoint_id: r.endpoint_id.clone() });
        PairingState { open: true, code: Some(w.code), url: Some(w.url), app_url: w.app_url, expires_at: Some(iso_ms(w.expires_at)), attempts: w.attempts, pending }
    }

    /// The waiting request's name, ip and endpoint, if `request_id` names it.
    pub fn pending_request(&mut self, request_id: Option<&Value>) -> Result<(String, Option<String>, Option<String>)> {
        let wanted = request_id.and_then(Value::as_str).map(str::to_string);
        let w = self.current();
        let r = w.and_then(|w| if w.closed.is_none() { w.request.as_ref() } else { None });
        match r {
            Some(r) if r.status == Status::Pending && Some(&r.request_id) == wanted.as_ref() => Ok((r.name.clone(), r.ip.clone(), r.endpoint_id.clone())),
            _ => Err(AppError::new(404, "not_found", "That pairing request isn't waiting any more.")),
        }
    }

    /// Allow the waiting phone: its device exists now, and it collects the token on its next poll.
    pub fn approved(&mut self, _request_id: Option<&Value>, token: String, device_id: &str, device_name: &str) {
        let now = self.now();
        if let Some(w) = self.window.as_mut() {
            if let Some(r) = w.request.as_mut() {
                r.status = Status::Approved;
                r.token = Some(token);
                r.device = Some(RemoteDevice { id: device_id.to_string(), name: device_name.to_string() });
                r.collect_by = Some(now + COLLECT_MS);
            }
            w.closed = Some(Closed::Approved);
        }
    }

    /// Refuse the waiting phone. The window stays open, so the right phone can try again.
    pub fn deny(&mut self, request_id: Option<&Value>) -> Result<()> {
        self.pending_request(request_id)?;
        if let Some(w) = self.window.as_mut() {
            w.request = None;
        }
        Ok(())
    }

    pub fn cancel(&mut self) {
        if let Some(w) = self.current() {
            if w.closed.is_none() {
                w.closed = Some(Closed::Cancelled);
            }
        }
    }

    // ---- The phone (remote listener, unauthenticated) ----

    /// `endpoint_id` is the phone's iroh endpoint when it asks over iroh; it is written to the device on approval.
    pub fn request(&mut self, body: &Value, ip: Option<&str>, endpoint_id: Option<&str>) -> Result<PairRequestResult> {
        let now = self.now();
        let Some(w) = self.current() else {
            return Err(AppError::new(404, "not_found", "Nothing is waiting to pair. On your computer, open Settings, then Phone, then Pair a phone."));
        };
        match w.closed {
            Some(Closed::Exhausted) => return Err(gone("That code was typed wrong too many times. Ask your computer for a new one.")),
            Some(_) => return Err(gone("That pairing code is no longer valid. Ask your computer for a new one.")),
            None => {}
        }
        let name = device_name(body.get("name"))?;
        let code = body.get("code").and_then(Value::as_str).ok_or_else(|| invalid("Type the code your computer shows."))?;
        if !same_hash(&sha256_hex(normalise(code).as_bytes()), &w.code_hash) {
            w.attempts += 1;
            if w.attempts >= MAX_ATTEMPTS {
                w.closed = Some(Closed::Exhausted);
            }
            return Err(invalid("That code doesn't match. Check the code on your computer and try again."));
        }
        if w.request.is_some() {
            return Err(gone("Another device is already using this code. Ask your computer for a new one."));
        }
        let poll_secret = new_secret();
        let request_id = new_id(now);
        w.request = Some(PairRequest { request_id: request_id.clone(), poll_secret_hash: sha256_hex(poll_secret.as_bytes()), name, ip: ip.map(str::to_string), endpoint_id: endpoint_id.map(str::to_string), at: iso_ms(now), status: Status::Pending, token: None, device: None, collect_by: None });
        Ok(PairRequestResult { request_id, poll_secret })
    }

    /// `pending` until the desktop answers; then the credential, exactly once. Anything else is gone.
    pub fn poll(&mut self, body: &Value) -> Result<PairPollResult> {
        let now = self.now();
        let lost = || gone("This pairing request is no longer waiting. Start again from your computer.");
        let request_id = body.get("requestId").and_then(Value::as_str).map(str::to_string);
        let poll_secret = body.get("pollSecret").and_then(Value::as_str).map(str::to_string);
        let Some(w) = self.current() else { return Err(lost()) };
        let closed = w.closed.is_some();
        let Some(r) = w.request.as_mut() else { return Err(lost()) };
        let (Some(rid), Some(secret)) = (request_id, poll_secret) else { return Err(lost()) };
        if r.request_id != rid || !same_hash(&sha256_hex(secret.as_bytes()), &r.poll_secret_hash) {
            return Err(lost());
        }
        if r.status == Status::Pending {
            if closed {
                return Err(lost());
            }
            return Ok(PairPollResult::Pending { status: "pending".into() });
        }
        if r.status != Status::Approved || r.token.is_none() || now > r.collect_by.unwrap_or(0) {
            return Err(lost());
        }
        let token = r.token.take().unwrap();
        r.status = Status::Collected;
        Ok(PairPollResult::Done { token, device: r.device.clone().unwrap() })
    }
}
