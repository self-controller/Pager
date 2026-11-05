//! The briefing's JSON contract (shared/src/context.ts is the same shape). The model hands in a
//! `Draft` through the strict `submit_briefing` tool; the verifier keeps what it can check and fills
//! in `check`, `resolvedUrl` and entities' `facts`; the stored `Briefing` adds the run's details.
//!
//! A briefing is mostly historical and situational context. Pre-reading (`readFirst`) is rare: only
//! what the book can't be followed without. Entities and links form a small sourced graph of the
//! people, works, ideas, places and events around the book, for the reader's connection map; their
//! dates and coordinates come from Wikidata, never from the model.

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
    /// The book in one paragraph.
    Overview,
    /// Only what the book can't be followed without. Usually absent.
    ReadFirst,
    /// The historical moment: events, institutions and debates the book assumes.
    Moment,
    /// The author's situation: why, for whom and in what circumstances it was written, how it first
    /// appeared and was received.
    Situation,
    /// The author's conversation: people, works and movements, each with its relation.
    Conversation,
    /// Terms and names the book uses without explaining them.
    Terms,
    /// For after the book.
    FurtherReading,
}

impl SectionKind {
    /// The order sections are shown in.
    pub const ORDER: [SectionKind; 7] = [SectionKind::Overview, SectionKind::ReadFirst, SectionKind::Moment, SectionKind::Situation, SectionKind::Conversation, SectionKind::Terms, SectionKind::FurtherReading];

    pub fn as_str(self) -> &'static str {
        match self {
            SectionKind::Overview => "overview",
            SectionKind::ReadFirst => "readFirst",
            SectionKind::Moment => "moment",
            SectionKind::Situation => "situation",
            SectionKind::Conversation => "conversation",
            SectionKind::Terms => "terms",
            SectionKind::FurtherReading => "furtherReading",
        }
    }

    /// Most items kept in the section.
    pub fn max_items(self) -> usize {
        match self {
            SectionKind::Overview => 1,
            SectionKind::ReadFirst => 2,
            SectionKind::FurtherReading => 3,
            SectionKind::Terms => 6,
            _ => 5,
        }
    }
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
    /// A web page, with a quote found on it.
    Page,
    /// A catalogue record (Open Library, Crossref, Wikidata).
    Record,
    /// The book's own front matter (title page, preface, introduction), with a quote found in it.
    Book,
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
    /// The entity this item is about (an `Entity.id`), for linking the text to the map.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub work: Option<Work>,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntityKind {
    Person,
    Work,
    Idea,
    Movement,
    Institution,
    Place,
    Event,
}

/// Facts about an entity from its Wikidata record (never from the model): for a timeline and a map.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Facts {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// A year ("1809", "-427" for 427 BCE): birth, publication, founding or the event's start.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<String>,
    /// A year: death, dissolution or the event's end.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<String>,
    /// [latitude, longitude], for places.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coordinates: Option<[f64; 2]>,
    /// The Wikidata page they came from.
    pub source: String,
}

/// A node of the connection map. The book is `book` and its author `author`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    pub id: String,
    pub kind: EntityKind,
    pub name: String,
    /// A Wikidata ID (Q…) from find_entity; dropped by the verifier if its label doesn't match.
    #[serde(default)]
    pub wikidata: Option<String>,
    /// A catalogue record, for works.
    #[serde(default)]
    pub record: Option<Record>,
    /// Set by the verifier from Wikidata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub facts: Option<Facts>,
    /// The record's page, set by the verifier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_url: Option<String>,
}

/// An edge of the connection map: a relation backed by a cited claim like any other.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub from: String,
    pub to: String,
    /// "read", "replied to", "borrowed from", "taught", "lived in", …
    pub relation: String,
    pub claim: Claim,
}

/// What the model hands in.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    #[serde(default)]
    pub little_known: bool,
    pub sections: Vec<Section>,
    #[serde(default)]
    pub entities: Vec<Entity>,
    #[serde(default)]
    pub links: Vec<Link>,
}

/// The counts of one run, stored with the briefing and logged.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub claims_kept: u32,
    pub claims_dropped: u32,
    pub works_kept: u32,
    pub works_dropped: u32,
    #[serde(default)]
    pub links_kept: u32,
    #[serde(default)]
    pub links_dropped: u32,
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
    #[serde(default)]
    pub entities: Vec<Entity>,
    #[serde(default)]
    pub links: Vec<Link>,
    pub stats: Stats,
}

/// 2: the situation section, pre-reading without tiers, entities and links.
pub const BRIEFING_VERSION: u32 = 2;

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
        "kind": { "type": "string", "enum": ["page", "record", "book"] },
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
        "entity": nullable(string()),
        "relation": nullable(string()),
        "work": nullable(json!({ "$ref": "#/$defs/work" })),
        "readScope": nullable(json!({ "type": "string", "enum": ["whole", "part", "summary"] })),
        "readNote": nullable(string()),
        "timeEstimate": nullable(string()),
        "suits": nullable(string()),
        "spoiler": { "type": "boolean" },
        "claims": { "type": "array", "items": { "$ref": "#/$defs/claim" } },
        "disagreement": nullable(json!({ "$ref": "#/$defs/disagreement" })),
    }));
    let entity = object(json!({
        "id": string(),
        "kind": { "type": "string", "enum": ["person", "work", "idea", "movement", "institution", "place", "event"] },
        "name": string(),
        "wikidata": nullable(string()),
        "record": nullable(json!({ "$ref": "#/$defs/record" })),
    }));
    let link = object(json!({
        "from": string(),
        "to": string(),
        "relation": string(),
        "claim": { "$ref": "#/$defs/claim" },
    }));
    let mut root = object(json!({
        "littleKnown": { "type": "boolean" },
        "sections": { "type": "array", "items": object(json!({
            "kind": { "type": "string", "enum": ["overview", "readFirst", "moment", "situation", "conversation", "terms", "furtherReading"] },
            "items": { "type": "array", "items": { "$ref": "#/$defs/item" } },
        })) },
        "entities": { "type": "array", "items": { "$ref": "#/$defs/entity" } },
        "links": { "type": "array", "items": { "$ref": "#/$defs/link" } },
    }));
    root["$defs"] = json!({
        "record": record,
        "citation": citation,
        "claim": claim,
        "work": work,
        "disagreement": disagreement,
        "item": item,
        "entity": entity,
        "link": link,
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
            "sections": [{ "kind": "situation", "items": [{
                "heading": "Wallace's letter",
                "entity": "wallace",
                "relation": null,
                "work": null,
                "readScope": null, "readNote": null, "timeEstimate": null, "suits": null,
                "spoiler": false,
                "claims": [{ "text": "Wallace's letter pushed Darwin to publish.", "inferred": false, "spoiler": false, "citations": [
                    { "kind": "page", "url": "https://example.org/a", "title": "A", "author": null, "year": null, "quote": "one two three four five six", "record": null }
                ] }],
                "disagreement": null
            }] }],
            "entities": [
                { "id": "book", "kind": "work", "name": "On the Origin of Species", "wikidata": "Q20124", "record": null },
                { "id": "wallace", "kind": "person", "name": "Alfred Russel Wallace", "wikidata": "Q160627", "record": null }
            ],
            "links": [{ "from": "wallace", "to": "book", "relation": "prompted", "claim": { "text": "Wallace's letter prompted it.", "inferred": false, "spoiler": false, "citations": [] } }]
        });
        let d: Draft = serde_json::from_value(v).unwrap();
        assert_eq!(d.sections[0].kind, SectionKind::Situation);
        assert_eq!(d.entities[1].kind, EntityKind::Person);
        assert_eq!(d.links[0].to, "book");
        let s = draft_schema();
        assert!(s["$defs"]["item"]["required"].as_array().unwrap().len() >= 10);
        assert!(s["$defs"]["link"]["properties"]["claim"].is_object());
    }
}
