use super::annotation::{AnchorStatus, Annotation, BlockPoint};
use super::document::{Block, Note, OutlineEntry};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProgress {
    pub doc_id: String,
    pub section_id: String,
    pub offset: f64,
    pub percent: f64,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub point: Option<BlockPoint>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<AnchorStatus>,
    pub device_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSummary {
    pub id: String,
    pub kind: String,
    pub format: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub source_id: String,
    pub source_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub excerpt: Option<String>,
    pub word_count: i64,
    pub estimated_minutes: i64,
    pub section_count: i64,
    pub added_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_opened_at: Option<String>,
    pub saved: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<ReadingProgress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rel_path: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TocEntry {
    pub id: String,
    pub title: String,
    pub index: usize,
    pub depth: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDetail {
    #[serde(flatten)]
    pub summary: DocumentSummary,
    pub toc: Vec<TocEntry>,
    pub revision_id: String,
    pub live: bool,
    pub authors: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// Absolute path on disk (empty for uploads). Local listener only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub path_status: String,
    pub warnings: Vec<String>,
    pub outline: Vec<OutlineEntry>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: String,
    pub doc_id: String,
    pub index: usize,
    pub title: String,
    pub html: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prev_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_id: Option<String>,
    pub revision_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocks: Option<Vec<Block>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<Vec<Note>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub annotations: Option<Vec<Annotation>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub kind: String,
    pub path: String,
    pub name: String,
    pub document_count: i64,
    pub added_at: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestJob {
    pub id: String,
    pub status: String,
    pub document_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddSourceResult {
    pub source: Source,
    pub job: IngestJob,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct DocumentQuery {
    pub kind: Option<String>,
    pub saved: Option<bool>,
    pub history: bool,
    pub sort: Option<String>,
    pub q: Option<String>,
    pub source_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDevice {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HealthRemote {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device: Option<RemoteDevice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested_origin: Option<String>,
    /// This computer's ID (its iroh endpoint), while remote access is on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint_id: Option<String>,
    /// The relay carrying this computer right now, once one is reached.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub app: String,
    pub api_version: u32,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reads_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    /// Present (possibly null) on the remote listener; present only with a suggestion locally.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote: Option<Option<HealthRemote>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceView {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub last_seen_at: String,
    pub last_ip: Option<String>,
    /// The phone's iroh endpoint ID for a device paired over iroh; null for one paired over Tailscale.
    pub endpoint_id: Option<String>,
    pub status: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingWindow {
    pub code: String,
    pub url: String,
    /// `pager://pair?v=1&t=<ticket>&code=XXXX-XXXX` for the phone app, while iroh is on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_url: Option<String>,
    pub expires_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPair {
    pub request_id: String,
    pub name: String,
    pub ip: Option<String>,
    pub at: String,
    /// The asking phone's endpoint ID, when it asked over iroh.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingState {
    pub open: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    pub attempts: u32,
    pub pending: Option<PendingPair>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairRequestResult {
    pub request_id: String,
    pub poll_secret: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PairPollResult {
    Pending { status: String },
    Done { token: String, device: RemoteDevice },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestDocument {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub format: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rel_path: Option<String>,
    pub revision_id: String,
    pub content_hash: String,
    pub size: i64,
    pub section_count: i64,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedDocument {
    pub id: String,
    pub deleted_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncManifest {
    pub cursor: i64,
    pub full: bool,
    pub documents: Vec<ManifestDocument>,
    pub deleted: Vec<DeletedDocument>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeFile {
    pub kind: String,
    pub name: String,
    pub path: String,
    pub format: String,
    pub size: u64,
    pub modified_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc: Option<DocumentSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeFolder {
    pub kind: String,
    pub name: String,
    pub path: String,
    pub folders: Vec<TreeFolder>,
    pub files: Vec<TreeFile>,
    pub file_count: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TreeResponse {
    pub root: TreeFolder,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CreateFileResult {
    pub path: String,
    pub document: DocumentSummary,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MoveEntryResult {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document: Option<DocumentSummary>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub doc_id: String,
    pub doc_title: String,
    pub section_id: String,
    pub block_id: String,
    pub snippet: String,
    pub ranges: Vec<(usize, usize)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub annotation_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSearchResult {
    pub doc: DocumentSummary,
    pub matched: Vec<String>,
    pub hits: Vec<SearchHit>,
    pub total_hits: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub at: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingSession {
    pub doc_id: String,
    pub started_at: String,
    pub ended_at: String,
    pub active_ms: i64,
    pub from_percent: Option<f64>,
    pub to_percent: Option<f64>,
}

// ---- Export / import ----

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedDocument {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub format: String,
    pub path: String,
    pub file_name: String,
    pub content_hashes: Vec<String>,
    pub identifier: Option<String>,
    pub added_at: String,
    pub last_opened_at: Option<String>,
    pub saved: bool,
    pub title_override: Option<String>,
    pub author_override: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedAnchor {
    pub exact: String,
    pub prefix: String,
    pub suffix: String,
    pub position: super::annotation::Position,
    pub status: AnchorStatus,
    pub original_quote: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedAnnotation {
    pub id: String,
    pub doc_id: String,
    pub kind: String,
    pub color: Option<String>,
    pub style: String,
    pub body: Option<String>,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub anchor: ExportedAnchor,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedRecord {
    pub id: String,
    pub tool_id: String,
    pub doc_id: Option<String>,
    pub data: Value,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub anchor: Option<ExportedAnchor>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedProgress {
    pub doc_id: String,
    pub section_id: String,
    pub offset: f64,
    pub percent: f64,
    pub updated_at: String,
    pub place: Option<ExportedAnchor>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct ExportedSettings {
    #[serde(default)]
    pub global: serde_json::Map<String, Value>,
    #[serde(default)]
    pub documents: serde_json::Map<String, Value>,
    #[serde(default)]
    pub app: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedPreset {
    pub id: String,
    pub name: String,
    pub values: serde_json::Map<String, Value>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ExportApp {
    pub version: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PagerExport {
    pub format: String,
    pub version: i64,
    pub exported_at: String,
    pub app: ExportApp,
    pub documents: Vec<ExportedDocument>,
    pub annotations: Vec<ExportedAnnotation>,
    pub records: Vec<ExportedRecord>,
    pub progress: Vec<ExportedProgress>,
    #[serde(default)]
    pub settings: ExportedSettings,
    pub presets: Vec<ExportedPreset>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct Counts {
    pub added: i64,
    pub updated: i64,
    pub unchanged: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct DocCounts {
    pub matched: i64,
    pub waiting: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct ImportResult {
    pub documents: DocCounts,
    pub annotations: Counts,
    pub records: Counts,
}
