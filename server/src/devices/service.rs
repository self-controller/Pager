//! Paired devices: each holds one random token; only its sha256 is stored. A device is refused once
//! it is revoked or has not been seen for 90 days. Nothing is deleted until the desktop removes it.

use crate::clock::parse_iso;
use crate::core::{Core, Notice};
use crate::errors::{invalid, not_found};
use crate::ids::{new_secret, same_hash, sha256_hex};
use crate::journal::Emit;
use crate::model::DeviceView;
use crate::Result;
use rusqlite::{params, Row};
use serde_json::{json, Value};

/// A device not seen for this long is refused and listed as expired; pairing again gives a new credential.
pub const DEVICE_IDLE_MS: i64 = 90 * 24 * 60 * 60 * 1000;
/// last_seen_at is written at most this often per device, not on every request.
const TOUCH_MS: i64 = 60_000;

#[derive(Clone, Debug)]
pub struct DeviceRow {
    pub id: String,
    pub name: String,
    pub token_hash: String,
    pub created_at: String,
    pub last_seen_at: String,
    pub last_ip: Option<String>,
    pub revoked_at: Option<String>,
    /// The iroh endpoint the phone paired from; None for a device paired over Tailscale.
    pub endpoint_id: Option<String>,
}

impl DeviceRow {
    fn from_row(r: &Row) -> rusqlite::Result<DeviceRow> {
        Ok(DeviceRow { id: r.get("id")?, name: r.get("name")?, token_hash: r.get("token_hash")?, created_at: r.get("created_at")?, last_seen_at: r.get("last_seen_at")?, last_ip: r.get("last_ip")?, revoked_at: r.get("revoked_at")?, endpoint_id: r.get("endpoint_id")? })
    }
}

/// Device names are what the desktop shows ("David's iPhone"): trimmed, 1–64 characters.
pub fn device_name(raw: Option<&Value>) -> Result<String> {
    let name = raw.and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| invalid("Give this device a name."))?;
    if name.chars().count() > 64 {
        return Err(invalid("A device name is at most 64 characters."));
    }
    Ok(name.to_string())
}

impl Core {
    fn device_row(&self, id: &str) -> Result<DeviceRow> {
        self.one("SELECT * FROM devices WHERE id = ?1", params![id], DeviceRow::from_row)?.ok_or_else(|| not_found("That device"))
    }

    fn device_status(&self, r: &DeviceRow) -> &'static str {
        if r.revoked_at.is_some() {
            return "revoked";
        }
        let seen = parse_iso(&r.last_seen_at).unwrap_or(0);
        if self.now_ms() - seen > DEVICE_IDLE_MS {
            "expired"
        } else {
            "active"
        }
    }

    fn device_view(&self, r: &DeviceRow) -> DeviceView {
        DeviceView { id: r.id.clone(), name: r.name.clone(), created_at: r.created_at.clone(), last_seen_at: r.last_seen_at.clone(), last_ip: r.last_ip.clone(), endpoint_id: r.endpoint_id.clone(), status: self.device_status(r).to_string() }
    }

    /// A new device and its token. The token is returned once and never stored. A phone pairing
    /// again over iroh (`endpoint_id`) replaces its earlier credential: the old row is revoked.
    pub fn device_create(&mut self, raw_name: &str, ip: Option<&str>, endpoint_id: Option<&str>) -> Result<(DeviceView, String)> {
        let name = device_name(Some(&Value::String(raw_name.to_string())))?;
        let token = new_secret();
        let id = self.new_id();
        let now = self.now();
        let hash = sha256_hex(token.as_bytes());
        self.tx(|c| {
            if let Some(e) = endpoint_id {
                let old: Vec<(String, String)> = c.all("SELECT id, name FROM devices WHERE endpoint_id = ?1 AND revoked_at IS NULL", params![e], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
                for (old_id, old_name) in old {
                    c.exec("UPDATE devices SET revoked_at = ?1 WHERE id = ?2", params![now, old_id])?;
                    c.emit("device.revoked", Emit::subject(&old_id), json!({ "name": old_name, "replaced": true }))?;
                }
            }
            c.exec("INSERT INTO devices (id, name, token_hash, created_at, last_seen_at, last_ip, endpoint_id) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6)", params![id, name, hash, now, ip, endpoint_id])?;
            c.emit("device.paired", Emit::subject(&id), json!({ "name": name }))?;
            Ok(())
        })?;
        Ok((self.device_get(&id)?, token))
    }

    /// The device holding `token`, whatever its status, or None.
    pub fn device_verify(&self, token: &str) -> Result<Option<DeviceRow>> {
        if token.is_empty() {
            return Ok(None);
        }
        let hash = sha256_hex(token.as_bytes());
        let r = self.one("SELECT * FROM devices WHERE token_hash = ?1", params![hash], DeviceRow::from_row)?;
        // The lookup is by hash; the comparison that decides is constant-time.
        Ok(r.filter(|r| same_hash(&r.token_hash, &hash)))
    }

    /// The active device holding `token` (recording that it was seen), or None: unknown, revoked,
    /// expired, or presented from the wrong place. `peer` is the iroh endpoint the request came
    /// from: a token is good only from the endpoint it was paired from, and a token paired over
    /// Tailscale (no endpoint) only over Tailscale.
    pub fn device_authenticate(&mut self, token: &str, ip: Option<&str>, peer: Option<&str>) -> Result<Option<DeviceView>> {
        let Some(mut r) = self.device_verify(token)? else { return Ok(None) };
        if self.device_status(&r) != "active" {
            return Ok(None);
        }
        if r.endpoint_id.as_deref() != peer {
            return Ok(None);
        }
        self.device_touch(&mut r, ip)?;
        Ok(Some(self.device_view(&r)))
    }

    /// Record a sighting, at most once a minute per device.
    pub fn device_touch(&mut self, r: &mut DeviceRow, ip: Option<&str>) -> Result<()> {
        let now = self.now_ms();
        if now - parse_iso(&r.last_seen_at).unwrap_or(0) < TOUCH_MS {
            return Ok(());
        }
        let iso = crate::clock::iso_ms(now);
        self.exec("UPDATE devices SET last_seen_at = ?1, last_ip = coalesce(?2, last_ip) WHERE id = ?3", params![iso, ip, r.id])?;
        r.last_seen_at = iso;
        if let Some(ip) = ip {
            r.last_ip = Some(ip.to_string());
        }
        Ok(())
    }

    /// Is `endpoint_id` an active device's?
    pub fn device_endpoint_active(&self, endpoint_id: &str) -> Result<bool> {
        let rows = self.all("SELECT * FROM devices WHERE endpoint_id = ?1 AND revoked_at IS NULL", params![endpoint_id], DeviceRow::from_row)?;
        Ok(rows.iter().any(|r| self.device_status(r) == "active"))
    }

    /// The endpoint a device was paired from, if it was paired over iroh and still exists.
    pub fn device_endpoint_of(&self, device_id: &str) -> Result<Option<String>> {
        Ok(self.one("SELECT endpoint_id FROM devices WHERE id = ?1", params![device_id], |r| r.get::<_, Option<String>>(0))?.flatten())
    }

    /// The bridge's gate: a connection is let in for an active device, or while a pairing window is open.
    pub fn peer_may_connect(&mut self, endpoint_id: &str) -> bool {
        self.device_endpoint_active(endpoint_id).unwrap_or(false) || self.pairing.is_open()
    }

    pub fn device_get(&self, id: &str) -> Result<DeviceView> {
        Ok(self.device_view(&self.device_row(id)?))
    }

    /// Newest first, revoked and expired ones included.
    pub fn device_list(&self) -> Result<Vec<DeviceView>> {
        let rows = self.all("SELECT * FROM devices ORDER BY created_at DESC, rowid DESC", params![], DeviceRow::from_row)?;
        Ok(rows.iter().map(|r| self.device_view(r)).collect())
    }

    pub fn device_rename(&mut self, id: &str, raw: Option<&Value>) -> Result<DeviceView> {
        self.device_row(id)?;
        let name = device_name(raw)?;
        self.tx(|c| {
            c.exec("UPDATE devices SET name = ?1 WHERE id = ?2", params![name, id])?;
            c.emit("device.renamed", Emit::subject(id), json!({ "name": name }))?;
            Ok(())
        })?;
        self.device_get(id)
    }

    /// Revoke an active device: refused from its very next request, and its open streams close.
    /// A device that is already revoked or expired is removed.
    pub fn device_revoke(&mut self, id: &str) -> Result<()> {
        let r = self.device_row(id)?;
        if self.device_status(&r) == "active" {
            let now = self.now();
            self.tx(|c| {
                c.exec("UPDATE devices SET revoked_at = ?1 WHERE id = ?2", params![now, id])?;
                c.emit("device.revoked", Emit::subject(id), json!({ "name": r.name }))?;
                Ok(())
            })?;
        } else {
            self.tx(|c| {
                c.exec("DELETE FROM devices WHERE id = ?1", params![id])?;
                c.emit("device.removed", Emit::subject(id), json!({ "name": r.name }))?;
                Ok(())
            })?;
        }
        self.notify(Notice::DeviceRevoked(id.to_string()));
        Ok(())
    }

    // ---- Pairing, orchestrated here because approval creates a device ----

    /// `ticket` is this computer's iroh ticket, when iroh is on: the window then also carries the phone app's link.
    pub fn pairing_open(&mut self, origin: &str, ticket: Option<String>) -> Result<crate::model::PairingWindow> {
        self.pairing.open(origin, ticket)
    }

    pub fn pairing_approve(&mut self, request_id: Option<&Value>) -> Result<DeviceView> {
        let (name, ip, endpoint_id) = self.pairing.pending_request(request_id)?;
        let (device, token) = self.device_create(&name, ip.as_deref(), endpoint_id.as_deref())?;
        self.pairing.approved(request_id, token, &device.id, &device.name);
        Ok(device)
    }
}
