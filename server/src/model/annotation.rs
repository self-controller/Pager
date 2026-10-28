use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockPoint {
    pub block_id: String,
    /// UTF-16 offset into the block's text.
    pub offset: usize,
}

/// End is exclusive. A collapsed range (start == end) marks a point: a bookmark or a reading place.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TextRange {
    pub start: BlockPoint,
    pub end: BlockPoint,
}

/// Character offsets into the `textContent` of one section's served HTML.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionRange {
    pub section_id: String,
    pub start: usize,
    pub end: usize,
}

/// How a client says where something goes. Give `range` or `sectionRange`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AnchorInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<TextRange>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section_range: Option<SectionRange>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_text: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnchorStatus {
    Anchored,
    Moved,
    Fuzzy,
    Orphaned,
}

impl AnchorStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            AnchorStatus::Anchored => "anchored",
            AnchorStatus::Moved => "moved",
            AnchorStatus::Fuzzy => "fuzzy",
            AnchorStatus::Orphaned => "orphaned",
        }
    }

    pub fn parse(s: &str) -> AnchorStatus {
        match s {
            "moved" => AnchorStatus::Moved,
            "fuzzy" => AnchorStatus::Fuzzy,
            "orphaned" => AnchorStatus::Orphaned,
            _ => AnchorStatus::Anchored,
        }
    }
}

/// One section's part of an anchored range, in that section's textContent coordinates.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionSegment {
    pub section_id: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub start: usize,
    pub end: usize,
}

/// Where an anchor is now, in the current revision.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnchorView {
    pub status: AnchorStatus,
    pub confidence: f64,
    pub revision_id: String,
    pub range: Option<TextRange>,
    pub section_id: Option<String>,
    pub segments: Vec<SectionSegment>,
    pub position: Position,
    pub quote: String,
    pub original_quote: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub doc_id: String,
    pub kind: String,
    pub color: Option<String>,
    pub style: String,
    pub body: Option<String>,
    pub tags: Vec<String>,
    pub anchor: AnchorView,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

/// An annotation with where it lives, for library-wide lists (GET /api/highlights).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryAnnotation {
    #[serde(flatten)]
    pub annotation: Annotation,
    pub doc_title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_author: Option<String>,
    pub section_title: Option<String>,
    pub href: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRecord {
    pub id: String,
    pub tool_id: String,
    pub doc_id: Option<String>,
    pub anchor: Option<AnchorView>,
    pub data: Value,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TagCount {
    pub tag: String,
    pub count: i64,
}
