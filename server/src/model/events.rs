use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEvent {
    pub seq: i64,
    pub at: String,
    pub origin: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub v: i64,
    pub doc_id: Option<String>,
    pub subject_id: Option<String>,
    pub payload: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostEventsResult {
    pub accepted: i64,
    pub last_seq: Option<i64>,
}
