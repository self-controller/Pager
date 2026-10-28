//! What the UI chooses to remember (POST /api/events), listing and purging.

use super::{row_to_event, Emit};
use crate::clock::{iso_ms, parse_iso};
use crate::core::Core;
use crate::errors::invalid;
use crate::model::{JournalEvent, PostEventsResult, RecordSettings};
use crate::Result;
use regex::Regex;
use rusqlite::params_from_iter;
use serde_json::Value;
use std::sync::OnceLock;

const MAX_PAYLOAD: usize = 4 * 1024;
const MAX_BATCH: usize = 100;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Category {
    Navigation,
    Lookups,
    Search,
    Sessions,
    Other,
}

pub fn category_of(kind: &str) -> Category {
    if kind.starts_with("nav.") {
        Category::Navigation
    } else if kind.starts_with("lookup.") {
        Category::Lookups
    } else if kind.starts_with("search.") {
        Category::Search
    } else if kind.starts_with("session.") {
        Category::Sessions
    } else {
        Category::Other
    }
}

fn enabled(record: &RecordSettings, c: Category) -> bool {
    match c {
        Category::Navigation => record.navigation,
        Category::Lookups => record.lookups,
        Category::Search => record.search,
        Category::Sessions => record.sessions,
        Category::Other => record.other,
    }
}

impl Core {
    /// A recording category switched off means nothing is written.
    pub fn record_client_events(&mut self, record: &RecordSettings, body: &Value) -> Result<PostEventsResult> {
        static TYPE: OnceLock<Regex> = OnceLock::new();
        static SERVER: OnceLock<Regex> = OnceLock::new();
        let type_re = TYPE.get_or_init(|| Regex::new(r"^[a-z]+(\.[a-z0-9_]+)+$").unwrap());
        let server_re = SERVER.get_or_init(|| Regex::new(r"^(document|revision|annotation|annotations|record|progress|settings|source|job|reading|import|device)\.").unwrap());
        let items = body.as_array().ok_or_else(|| invalid("Send a JSON array of events."))?;
        if items.len() > MAX_BATCH {
            return Err(invalid(format!("Send at most {MAX_BATCH} events at a time.")));
        }
        let now = self.clock.now_ms();
        let mut checked: Vec<(String, Option<String>, Option<String>, Value, String)> = Vec::new();
        for raw in items {
            let o = raw.as_object().ok_or_else(|| invalid("Each event needs a type like nav.section_opened."))?;
            let kind = o.get("type").and_then(Value::as_str).filter(|t| type_re.is_match(t)).ok_or_else(|| invalid("Each event needs a type like nav.section_opened."))?;
            if server_re.is_match(kind) {
                return Err(invalid(format!("{}.* events are written by the server.", kind.split('.').next().unwrap_or(""))));
            }
            let payload = match o.get("payload") {
                None | Some(Value::Null) if !o.contains_key("payload") => Value::Object(Default::default()),
                Some(Value::Object(m)) => Value::Object(m.clone()),
                _ => return Err(invalid("payload should be a JSON object.")),
            };
            if serde_json::to_string(&payload).map(|s| s.len()).unwrap_or(0) > MAX_PAYLOAD {
                return Err(invalid("Each event's payload is limited to 4 KB."));
            }
            let mut ids: Vec<Option<String>> = Vec::new();
            for k in ["docId", "subjectId"] {
                match o.get(k) {
                    None => ids.push(None),
                    Some(Value::String(s)) => ids.push(Some(s.clone())),
                    Some(_) => return Err(invalid(format!("{k} should be text."))),
                }
            }
            let mut at = iso_ms(now);
            if let Some(a) = o.get("at") {
                let t = match a {
                    Value::String(s) => parse_iso(s),
                    other => parse_iso(&other.to_string()),
                };
                let t = t.ok_or_else(|| invalid("at should be an ISO-8601 time."))?;
                at = iso_ms(t.min(now + 60_000));
            }
            checked.push((kind.to_string(), ids[0].clone(), ids[1].clone(), payload, at));
        }
        let record = record.clone();
        self.tx(move |c| {
            let mut accepted = 0;
            let mut last_seq = None;
            for (kind, doc_id, subject_id, payload, at) in checked {
                if !enabled(&record, category_of(&kind)) {
                    continue;
                }
                let ev = c.append("client", &kind, Emit { doc_id, subject_id, at: Some(at) }, payload)?;
                accepted += 1;
                last_seq = Some(ev.seq);
            }
            Ok(PostEventsResult { accepted, last_seq })
        })
    }

    pub fn list_events(&self, doc_id: Option<&str>, kind: Option<&str>, after: Option<i64>, limit: Option<i64>) -> Result<Vec<JournalEvent>> {
        let mut where_: Vec<String> = Vec::new();
        let mut args: Vec<Value> = Vec::new();
        if let Some(d) = doc_id {
            where_.push("document_id = ?".into());
            args.push(Value::String(d.to_string()));
        }
        if let Some(t) = kind {
            if let Some(prefix) = t.strip_suffix(".*") {
                where_.push("type LIKE ?".into());
                args.push(Value::String(format!("{prefix}.%")));
            } else {
                where_.push("type = ?".into());
                args.push(Value::String(t.to_string()));
            }
        }
        if let Some(a) = after {
            where_.push("seq > ?".into());
            args.push(Value::from(a));
        }
        let limit = limit.unwrap_or(200).clamp(1, 1000);
        let sql = format!(
            "SELECT * FROM events {} ORDER BY seq {} LIMIT {limit}",
            if where_.is_empty() { String::new() } else { format!("WHERE {}", where_.join(" AND ")) },
            if after.is_some() { "ASC" } else { "DESC" }
        );
        let mut st = self.db.prepare(&sql)?;
        let rows = st.query_map(params_from_iter(args.iter().map(crate::core::sql_value)), row_to_event)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Forget recorded interactions: one category or all client events, optionally for one document.
    pub fn purge_events(&mut self, doc_id: Option<&str>, category: Option<&str>) -> Result<usize> {
        let mut where_: Vec<String> = vec!["origin = 'client'".into()];
        let mut args: Vec<Value> = Vec::new();
        if let Some(d) = doc_id {
            where_.push("document_id = ?".into());
            args.push(Value::String(d.to_string()));
        }
        let cat = category.unwrap_or("all");
        if cat != "all" {
            let prefix = match cat {
                "other" => {
                    where_.push("type NOT LIKE 'nav.%' AND type NOT LIKE 'lookup.%' AND type NOT LIKE 'search.%' AND type NOT LIKE 'session.%'".into());
                    None
                }
                "navigation" => Some("nav."),
                "lookups" => Some("lookup."),
                "search" => Some("search."),
                "sessions" => Some("session."),
                _ => return Err(invalid("category is navigation, lookups, search, sessions, other or all.")),
            };
            if let Some(p) = prefix {
                where_.push("type LIKE ?".into());
                args.push(Value::String(format!("{p}%")));
            }
        }
        let sql = format!("DELETE FROM events WHERE {}", where_.join(" AND "));
        Ok(self.db.execute(&sql, params_from_iter(args.iter().map(crate::core::sql_value)))?)
    }
}
