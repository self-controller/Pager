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
    pub origin: Option<String>,
    /// Your own iroh relay (https://...), or null for n0's public relays.
    #[serde(default)]
    pub relay: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub mirror: MirrorSettings,
    pub record: RecordSettings,
    pub idle_shutdown_minutes: i64,
    pub remote: RemoteSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            mirror: MirrorSettings { enabled: true, dir: None },
            record: RecordSettings { navigation: true, lookups: true, search: true, sessions: true, other: true },
            idle_shutdown_minutes: 360,
            remote: RemoteSettings { enabled: false, origin: None, relay: None },
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
