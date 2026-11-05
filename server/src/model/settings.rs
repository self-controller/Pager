use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub type SettingsObject = Map<String, Value>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MirrorSettings {
    pub enabled: bool,
    pub dir: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RecordSettings {
    pub navigation: bool,
    pub lookups: bool,
    pub search: bool,
    pub sessions: bool,
    pub other: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RemoteSettings {
    pub enabled: bool,
    /// The Tailscale address the Home Screen app uses (optional): the TCP listener runs only while it is set.
    pub origin: Option<String>,
    /// Your own iroh relay (https://...), or null for n0's public relays.
    #[serde(default)]
    pub relay: Option<String>,
    /// The bearer token your relay asks for (iroh-relay's `access.shared_token`), or null. Needs `relay`.
    #[serde(default, rename = "relayToken")]
    pub relay_token: Option<String>,
}

/// Context briefings (prompts/book-context.md).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSettings {
    /// Paid runs (a new briefing or a Refresh) each paired phone may start in a rolling 24 hours.
    /// 0 means phones only open briefings already made. The computer is never limited.
    pub phone_daily_limit: i64,
}

pub const PHONE_DAILY_LIMIT_DEFAULT: i64 = 10;
pub const PHONE_DAILY_LIMIT_MAX: i64 = 100;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub mirror: MirrorSettings,
    pub record: RecordSettings,
    pub idle_shutdown_minutes: i64,
    pub remote: RemoteSettings,
    pub context: ContextSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            mirror: MirrorSettings { enabled: true, dir: None },
            record: RecordSettings { navigation: true, lookups: true, search: true, sessions: true, other: true },
            idle_shutdown_minutes: 360,
            remote: RemoteSettings { enabled: false, origin: None, relay: None, relay_token: None },
            context: ContextSettings { phone_daily_limit: PHONE_DAILY_LIMIT_DEFAULT },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SettingsResponse {
    pub effective: SettingsObject,
    pub global: SettingsObject,
    pub document: Option<SettingsObject>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<AppSettings>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub values: SettingsObject,
    pub created_at: String,
    pub updated_at: String,
}
