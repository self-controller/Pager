//! The briefing's JSON contract (shared/src/context.ts is the same shape). The model hands in a
//! `Draft` through the strict `submit_briefing` tool; the verifier keeps what it can check and fills
//! in `check` and `resolvedUrl`; the stored `Briefing` adds the run's details.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Who the briefing is written for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    General,
    Student,
    Scholar,
}

impl Level {
    pub const ALL: [Level; 3] = [Level::General, Level::Student, Level::Scholar];

    pub fn parse(s: &str) -> Option<Level> {
        match s {
            "general" => Some(Level::General),
            "student" => Some(Level::Student),
            "scholar" => Some(Level::Scholar),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Level::General => "general",
            Level::Student => "student",
            Level::Scholar => "scholar",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SectionKind {
    Overview,
    Moment,
    Conversation,
    ReadFirst,
    Terms,
    FurtherReading,
}

impl SectionKind {
    /// The order sections are shown in.
    pub const ORDER: [SectionKind; 6] = [SectionKind::Overview, SectionKind::Moment, SectionKind::Conversation, SectionKind::ReadFirst, SectionKind::Terms, SectionKind::FurtherReading];

    pub fn as_str(self) -> &'static str {
        match self {
            SectionKind::Overview => "overview",
            SectionKind::Moment => "moment",
            SectionKind::Conversation => "conversation",
            SectionKind::ReadFirst => "readFirst",
            SectionKind::Terms => "terms",
            SectionKind::FurtherReading => "furtherReading",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Essential,
    Helpful,
    Optional,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReadScope {
    Whole,
    Part,
    Summary,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecordKind {
    Isbn,
    Olid,
    Doi,
    Wikidata,
    Url,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CitationKind {
    Page,
    Record,
}

/// How the verifier confirmed a citation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Check {
    /// The quote was found on the page.
    Quoted,
    /// The catalogue record resolved and matched.
    Record,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Record {
    pub kind: RecordKind,
    pub value: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Citation {
    pub kind: CitationKind,
    #[serde(default)]
    pub url: Option<String>,
    pub title: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub year: Option<String>,
    #[serde(default)]
    pub quote: Option<String>,
    #[serde(default)]
    pub record: Option<Record>,
    /// Set by the verifier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check: Option<Check>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Claim {
    pub text: String,
    #[serde(default)]
    pub inferred: bool,
    #[serde(default)]
    pub spoiler: bool,
    pub citations: Vec<Citation>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Work {
    pub title: String,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub year: Option<String>,
    pub record: Record,
    /// The record's page, set by the verifier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Side {
    pub position: String,
    pub claims: Vec<Claim>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Disagreement {
    pub summary: String,
    pub sides: Vec<Side>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub heading: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work: Option<Work>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tier: Option<Tier>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_scope: Option<ReadScope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_estimate: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suits: Option<String>,
    #[serde(default)]
    pub spoiler: bool,
    #[serde(default)]
    pub claims: Vec<Claim>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disagreement: Option<Disagreement>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub kind: SectionKind,
    pub items: Vec<Item>,
}

/// What the model hands in.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    #[serde(default)]
    pub little_known: bool,
    pub sections: Vec<Section>,
}

/// The counts of one run, stored with the briefing and logged.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub claims_kept: u32,
    pub claims_dropped: u32,
    pub works_kept: u32,
    pub works_dropped: u32,
    pub api_calls: u32,
    pub searches: u32,
    pub fetches: u32,
    pub lookups: u32,
    pub input_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub output_tokens: u64,
    /// An estimate at Sonnet's list prices.
    pub cost_usd: f64,
    pub duration_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Briefing {
    pub version: u32,
    pub doc_id: String,
    pub level: Level,
    #[serde(default)]
    pub focus: Option<String>,
    pub content_hash: String,
    pub generated_at: String,
    /// The model that answered (a refusal fallback can name another).
    pub model: String,
    pub little_known: bool,
    pub sections: Vec<Section>,
    pub stats: Stats,
}

pub const BRIEFING_VERSION: u32 = 1;

fn nullable(t: Value) -> Value {
    json!({ "anyOf": [t, { "type": "null" }] })
}

fn string() -> Value {
    json!({ "type": "string" })
}

fn object(props: Value) -> Value {
    let required: Vec<String> = props.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
    json!({ "type": "object", "properties": props, "required": required, "additionalProperties": false })
}

/// The input schema of `submit_briefing`: a Draft. Every property is required (nullable where
/// optional) and every object closed, as strict tool use asks; counts are checked in Rust.
pub fn draft_schema() -> Value {
    let record = object(json!({
        "kind": { "type": "string", "enum": ["isbn", "olid", "doi", "wikidata", "url"] },
        "value": string(),
    }));
    let citation = object(json!({
        "kind": { "type": "string", "enum": ["page", "record"] },
        "url": nullable(string()),
        "title": string(),
        "author": nullable(string()),
        "year": nullable(string()),
        "quote": nullable(string()),
        "record": nullable(json!({ "$ref": "#/$defs/record" })),
    }));
    let claim = object(json!({
        "text": string(),
        "inferred": { "type": "boolean" },
        "spoiler": { "type": "boolean" },
        "citations": { "type": "array", "items": { "$ref": "#/$defs/citation" } },
    }));
    let work = object(json!({
        "title": string(),
        "authors": { "type": "array", "items": string() },
        "year": nullable(string()),
        "record": { "$ref": "#/$defs/record" },
    }));
    let disagreement = object(json!({
        "summary": string(),
        "sides": { "type": "array", "items": object(json!({
            "position": string(),
            "claims": { "type": "array", "items": { "$ref": "#/$defs/claim" } },
        })) },
    }));
    let item = object(json!({
        "heading": string(),
        "relation": nullable(string()),
        "work": nullable(json!({ "$ref": "#/$defs/work" })),
        "tier": nullable(json!({ "type": "string", "enum": ["essential", "helpful", "optional"] })),
        "readScope": nullable(json!({ "type": "string", "enum": ["whole", "part", "summary"] })),
        "readNote": nullable(string()),
        "timeEstimate": nullable(string()),
        "suits": nullable(string()),
        "spoiler": { "type": "boolean" },
        "claims": { "type": "array", "items": { "$ref": "#/$defs/claim" } },
        "disagreement": nullable(json!({ "$ref": "#/$defs/disagreement" })),
    }));
    let mut root = object(json!({
        "littleKnown": { "type": "boolean" },
        "sections": { "type": "array", "items": object(json!({
            "kind": { "type": "string", "enum": ["overview", "moment", "conversation", "readFirst", "terms", "furtherReading"] },
            "items": { "type": "array", "items": { "$ref": "#/$defs/item" } },
        })) },
    }));
    root["$defs"] = json!({
        "record": record,
        "citation": citation,
        "claim": claim,
        "work": work,
        "disagreement": disagreement,
        "item": item,
    });
    root
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_draft_in_the_schema_shape_parses() {
        let v = json!({
            "littleKnown": false,
            "sections": [{ "kind": "readFirst", "items": [{
                "heading": "Malthus, An Essay on the Principle of Population",
                "relation": null,
                "work": { "title": "An Essay on the Principle of Population", "authors": ["Thomas Robert Malthus"], "year": "1798", "record": { "kind": "olid", "value": "OL1W" } },
                "tier": "essential", "readScope": "summary", "readNote": "A summary is enough", "timeEstimate": "20 minutes", "suits": null,
                "spoiler": false,
                "claims": [{ "text": "Darwin read Malthus in 1838.", "inferred": false, "spoiler": false, "citations": [
                    { "kind": "page", "url": "https://example.org/a", "title": "A", "author": null, "year": null, "quote": "one two three four five six", "record": null }
                ] }],
                "disagreement": null
            }] }]
        });
        let d: Draft = serde_json::from_value(v).unwrap();
        assert_eq!(d.sections[0].kind, SectionKind::ReadFirst);
        assert_eq!(d.sections[0].items[0].tier, Some(Tier::Essential));
        assert!(draft_schema()["$defs"]["item"]["required"].as_array().unwrap().len() >= 10);
    }
}
