//! Reading settings are the UI's: opaque JSON objects in a global scope and one per document, merged
//! shallowly (document over global). A null in a patch removes that key. App settings steer the server.

use crate::core::{Core, Notice};
use crate::db::{from_json, to_json};
use crate::errors::{invalid, not_found, AppError};
use crate::journal::Emit;
use crate::model::*;
use crate::Result;
use rusqlite::params;
use serde_json::{json, Map, Value};

const MAX_SCOPE_BYTES: usize = 64 * 1024;

/// The phone's origin, exactly: https://<name>, or http:// on a loopback name for trying it on this computer.
fn parse_origin(raw: &Value) -> Result<Option<String>> {
    if raw.is_null() {
        return Ok(None);
    }
    let s = raw.as_str().map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| invalid("remote.origin is an address like https://my-pc.tail1234.ts.net, or null."))?;
    let url = url::Url::parse(s).map_err(|_| invalid("remote.origin should be an address like https://my-pc.tail1234.ts.net."))?;
    let host = url.host_str().unwrap_or("");
    let local = url.scheme() == "http" && matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1");
    if url.scheme() != "https" && !local {
        return Err(invalid("remote.origin must start with https:// (tailscale serve gives your computer an https address)."));
    }
    if !url.username().is_empty() || url.password().is_some() || url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err(invalid("remote.origin is just the address, with no path after it."));
    }
    Ok(Some(url.origin().ascii_serialization()))
}

/// Your own iroh relay, as iroh takes it (https://relay.example.com/), or null for n0's public relays.
fn parse_relay(raw: &Value) -> Result<Option<String>> {
    if raw.is_null() {
        return Ok(None);
    }
    let s = raw.as_str().map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| invalid("remote.relay is a relay address like https://relay.example.com, or null."))?;
    let url = url::Url::parse(s).map_err(|_| invalid("remote.relay should be an address like https://relay.example.com."))?;
    if !matches!(url.scheme(), "https" | "http") || url.host_str().is_none() || url.query().is_some() || url.fragment().is_some() {
        return Err(invalid("remote.relay should be an address like https://relay.example.com."));
    }
    Ok(Some(iroh::RelayUrl::from(url).to_string()))
}

fn is_json(v: &Value, depth: u32) -> bool {
    if depth > 20 {
        return false;
    }
    match v {
        Value::Null | Value::String(_) | Value::Bool(_) => true,
        Value::Number(n) => n.as_f64().map(f64::is_finite).unwrap_or(false),
        Value::Array(a) => a.iter().all(|x| is_json(x, depth + 1)),
        Value::Object(o) => o.values().all(|x| is_json(x, depth + 1)),
    }
}

impl Core {
    fn settings_read(&self, scope: &str) -> Result<Map<String, Value>> {
        let v: Option<String> = self.one("SELECT value FROM settings WHERE scope = ?1", params![scope], |r| r.get(0))?;
        Ok(from_json(v.as_deref(), Map::new()))
    }

    pub fn settings_raw(&self, scope: &str) -> Result<Map<String, Value>> {
        self.settings_read(scope)
    }

    fn settings_write(&mut self, scope: &str, value: &Value) -> Result<()> {
        let s = to_json(value);
        if s.len() > MAX_SCOPE_BYTES {
            return Err(AppError::new(413, "too_large", "Settings are limited to 64 KB per scope."));
        }
        self.exec("INSERT INTO settings (scope, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(scope) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", params![scope, s, self.now()])?;
        Ok(())
    }

    pub fn app_settings(&self) -> AppSettings {
        let stored = self.settings_read("app").unwrap_or_default();
        let d = AppSettings::default();
        let get = |path: &[&str]| -> Option<Value> {
            let mut cur: &Value = &Value::Object(stored.clone());
            for k in path {
                cur = cur.get(*k)?;
            }
            Some(cur.clone())
        };
        AppSettings {
            mirror: MirrorSettings {
                enabled: get(&["mirror", "enabled"]).and_then(|v| v.as_bool()).unwrap_or(d.mirror.enabled),
                dir: match get(&["mirror", "dir"]) {
                    Some(Value::String(s)) => Some(s),
                    _ => None,
                },
            },
            record: RecordSettings {
                navigation: get(&["record", "navigation"]).and_then(|v| v.as_bool()).unwrap_or(true),
                lookups: get(&["record", "lookups"]).and_then(|v| v.as_bool()).unwrap_or(true),
                search: get(&["record", "search"]).and_then(|v| v.as_bool()).unwrap_or(true),
                sessions: get(&["record", "sessions"]).and_then(|v| v.as_bool()).unwrap_or(true),
                other: get(&["record", "other"]).and_then(|v| v.as_bool()).unwrap_or(true),
            },
            idle_shutdown_minutes: get(&["idleShutdownMinutes"]).and_then(|v| v.as_i64()).unwrap_or(d.idle_shutdown_minutes),
            remote: RemoteSettings {
                enabled: get(&["remote", "enabled"]).and_then(|v| v.as_bool()).unwrap_or(false),
                origin: match get(&["remote", "origin"]) {
                    Some(Value::String(s)) => Some(s),
                    _ => None,
                },
                relay: match get(&["remote", "relay"]) {
                    Some(Value::String(s)) => Some(s),
                    _ => None,
                },
            },
        }
    }

    pub fn settings_get(&self, doc_id: Option<&str>) -> Result<SettingsResponse> {
        let global = self.settings_read("global")?;
        let document = match doc_id {
            Some(d) => Some(self.settings_read(&format!("doc:{d}"))?),
            None => None,
        };
        let mut effective = global.clone();
        if let Some(d) = &document {
            for (k, v) in d {
                effective.insert(k.clone(), v.clone());
            }
        }
        Ok(SettingsResponse { effective, global, document, app: Some(self.app_settings()) })
    }

    fn patch_scope(&mut self, scope: &str, patch: &Value) -> Result<Vec<String>> {
        let o = patch.as_object().ok_or_else(|| invalid("Send settings as a JSON object."))?;
        if !is_json(patch, 0) {
            return Err(invalid("Settings must be plain JSON values."));
        }
        let mut cur = self.settings_read(scope)?;
        let keys: Vec<String> = o.keys().cloned().collect();
        for (k, v) in o {
            if v.is_null() {
                cur.remove(k);
            } else {
                cur.insert(k.clone(), v.clone());
            }
        }
        self.settings_write(scope, &Value::Object(cur))?;
        Ok(keys)
    }

    pub fn patch_global_settings(&mut self, patch: &Value) -> Result<SettingsResponse> {
        self.tx(|c| {
            let keys = c.patch_scope("global", patch)?;
            c.emit("settings.changed", Emit::default(), json!({ "scope": "global", "keys": keys }))?;
            Ok(())
        })?;
        self.settings_get(None)
    }

    pub fn patch_document_settings(&mut self, doc_id: &str, patch: &Value) -> Result<SettingsResponse> {
        self.live_row(doc_id)?;
        let scope = format!("doc:{doc_id}");
        self.tx(|c| {
            let keys = c.patch_scope(&scope, patch)?;
            c.emit("settings.changed", Emit::doc(doc_id), json!({ "scope": scope, "keys": keys }))?;
            Ok(())
        })?;
        self.settings_get(Some(doc_id))
    }

    pub fn reset_document_settings(&mut self, doc_id: &str) -> Result<()> {
        let scope = format!("doc:{doc_id}");
        self.tx(|c| {
            c.exec("DELETE FROM settings WHERE scope = ?1", params![scope])?;
            c.emit("settings.changed", Emit::doc(doc_id), json!({ "scope": scope, "keys": [] }))?;
            Ok(())
        })
    }

    pub fn patch_app_settings(&mut self, patch: &Value) -> Result<SettingsResponse> {
        let p = patch.as_object().ok_or_else(|| invalid("Send settings as a JSON object."))?;
        let mut cur = self.app_settings();
        let mut keys: Vec<&str> = Vec::new();
        if let Some(m) = p.get("mirror").and_then(Value::as_object) {
            if let Some(e) = m.get("enabled") {
                cur.mirror.enabled = e.as_bool().ok_or_else(|| invalid("mirror.enabled is true or false."))?;
            }
            if let Some(d) = m.get("dir") {
                cur.mirror.dir = match d {
                    Value::Null => None,
                    Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
                    _ => return Err(invalid("mirror.dir is a folder path or null.")),
                };
            }
            keys.push("mirror");
        } else if p.get("mirror").map(|m| !m.is_null()).unwrap_or(false) {
            return Err(invalid("mirror should be an object."));
        }
        if let Some(r) = p.get("record").and_then(Value::as_object) {
            for (k, v) in r {
                let b = v.as_bool().ok_or_else(|| invalid(format!("record.{k} is true or false.")))?;
                match k.as_str() {
                    "navigation" => cur.record.navigation = b,
                    "lookups" => cur.record.lookups = b,
                    "search" => cur.record.search = b,
                    "sessions" => cur.record.sessions = b,
                    "other" => cur.record.other = b,
                    _ => return Err(invalid(format!("There is no recording switch called {k}."))),
                }
            }
            keys.push("record");
        } else if p.get("record").map(|m| !m.is_null()).unwrap_or(false) {
            return Err(invalid("record should be an object."));
        }
        if let Some(m) = p.get("idleShutdownMinutes") {
            let n = m.as_f64().filter(|f| f.is_finite() && *f >= 0.0).ok_or_else(|| invalid("idleShutdownMinutes is 0 (never) or more."))?;
            cur.idle_shutdown_minutes = n.round() as i64;
            keys.push("idleShutdownMinutes");
        }
        if let Some(r) = p.get("remote").and_then(Value::as_object) {
            if let Some(o) = r.get("origin") {
                cur.remote.origin = parse_origin(o)?;
            }
            if let Some(e) = r.get("enabled") {
                cur.remote.enabled = e.as_bool().ok_or_else(|| invalid("remote.enabled is true or false."))?;
            }
            if let Some(v) = r.get("relay") {
                cur.remote.relay = parse_relay(v)?;
            }
            if cur.remote.enabled && cur.remote.origin.is_none() {
                return Err(invalid("Set the address your phone will use (remote.origin) before turning on remote access."));
            }
            keys.push("remote");
        } else if p.get("remote").map(|m| !m.is_null()).unwrap_or(false) {
            return Err(invalid("remote should be an object."));
        }
        let value = serde_json::to_value(&cur)?;
        self.tx(|c| {
            c.settings_write("app", &value)?;
            c.emit("settings.changed", Emit::default(), json!({ "scope": "app", "keys": keys }))?;
            Ok(())
        })?;
        self.notify(Notice::AppSettingsChanged(cur));
        self.settings_get(None)
    }

    // ---- Presets: named snapshots of reading settings ----

    pub fn presets(&self) -> Result<Vec<Preset>> {
        self.all("SELECT * FROM presets ORDER BY created_at", params![], |r| {
            let value: String = r.get("value")?;
            Ok(Preset { id: r.get("id")?, name: r.get("name")?, values: from_json(Some(&value), Map::new()), created_at: r.get("created_at")?, updated_at: r.get("updated_at")? })
        })
    }

    fn preset_name(v: Option<&Value>) -> Result<String> {
        let name = v.and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| invalid("Give the preset a name."))?;
        Ok(name.chars().take(100).collect())
    }

    fn preset_values(v: Option<&Value>) -> Result<Value> {
        match v {
            Some(val) if val.is_object() && is_json(val, 0) => Ok(val.clone()),
            _ => Err(invalid("values should be a JSON object of settings.")),
        }
    }

    pub fn create_preset(&mut self, body: &Value) -> Result<Preset> {
        let o = body.as_object().ok_or_else(|| invalid("Send the preset as a JSON object."))?;
        let name = Self::preset_name(o.get("name"))?;
        let values = Self::preset_values(o.get("values"))?;
        let id = self.new_id();
        let now = self.now();
        self.exec("INSERT INTO presets (id, name, value, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)", params![id, name, to_json(&values), now])?;
        self.presets()?.into_iter().find(|p| p.id == id).ok_or_else(|| not_found("That preset"))
    }

    pub fn update_preset(&mut self, id: &str, body: &Value) -> Result<Preset> {
        let o = body.as_object().ok_or_else(|| invalid("Send the preset as a JSON object."))?;
        if !self.presets()?.iter().any(|p| p.id == id) {
            return Err(not_found("That preset"));
        }
        if let Some(n) = o.get("name") {
            let name = Self::preset_name(Some(n))?;
            self.exec("UPDATE presets SET name = ?1 WHERE id = ?2", params![name, id])?;
        }
        if let Some(v) = o.get("values") {
            let values = Self::preset_values(Some(v))?;
            self.exec("UPDATE presets SET value = ?1 WHERE id = ?2", params![to_json(&values), id])?;
        }
        self.exec("UPDATE presets SET updated_at = ?1 WHERE id = ?2", params![self.now(), id])?;
        self.presets()?.into_iter().find(|p| p.id == id).ok_or_else(|| not_found("That preset"))
    }

    pub fn delete_preset(&mut self, id: &str) -> Result<()> {
        if self.exec("DELETE FROM presets WHERE id = ?1", params![id])? == 0 {
            return Err(not_found("That preset"));
        }
        Ok(())
    }
}
