//! The Markdown mirror of one document's annotations: plain, greppable, Obsidian-friendly, and
//! byte-stable (the same annotations always produce the same bytes, so nothing is rewritten idly).

use crate::model::*;
use regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

pub struct MirrorDoc {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub format: String,
    pub path: String,
    pub section_titles: HashMap<String, String>,
    pub section_order: Vec<String>,
}

/// YAML scalar that never parses as anything but a string.
pub fn yaml_scalar(s: &str) -> String {
    static SAFE: OnceLock<Regex> = OnceLock::new();
    static RESERVED: OnceLock<Regex> = OnceLock::new();
    let safe = SAFE.get_or_init(|| Regex::new(r"^[\p{L}\p{N}][\p{L}\p{N} .,'’()&/-]*$").unwrap());
    let reserved = RESERVED.get_or_init(|| Regex::new(r"(?i)^(true|false|null|yes|no|on|off|~|\d[\d.:-]*)$").unwrap());
    if safe.is_match(s) && !reserved.is_match(s) && !s.contains(": ") {
        return s.to_string();
    }
    serde_json::to_string(s).unwrap_or_default()
}

fn block_ref(id: &str) -> String {
    format!("^r-{}", id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' }).collect::<String>())
}

fn quote_lines(s: &str) -> String {
    s.split('\n').map(|l| if l.trim().is_empty() { ">".to_string() } else { format!("> {l}") }).collect::<Vec<_>>().join("\n")
}

pub fn mirror_markdown(doc: &MirrorDoc, annotations: &[Annotation], base_url: &str) -> String {
    let live: Vec<&Annotation> = annotations.iter().filter(|a| a.deleted_at.is_none()).collect();
    let updated = live.iter().map(|a| a.updated_at.as_str()).max().unwrap_or("");
    let mut lines: Vec<String> = vec![
        "---".into(),
        format!("title: {}", yaml_scalar(&doc.title)),
        format!("authors: [{}]", doc.authors.iter().map(|a| yaml_scalar(a)).collect::<Vec<_>>().join(", ")),
        format!("format: {}", doc.format),
    ];
    if !doc.path.is_empty() {
        lines.push(format!("source: {}", yaml_scalar(&doc.path)));
    }
    lines.push(format!("pager-document: {}", doc.id));
    if !updated.is_empty() {
        lines.push(format!("updated: {updated}"));
    }
    lines.extend(["---".into(), String::new(), format!("# {}", doc.title), String::new()]);
    let mut placed: Vec<&Annotation> = live.iter().copied().filter(|a| a.anchor.status != AnchorStatus::Orphaned && a.anchor.section_id.is_some()).collect();
    let mut orphans: Vec<&Annotation> = live.iter().copied().filter(|a| !(a.anchor.status != AnchorStatus::Orphaned && a.anchor.section_id.is_some())).collect();
    let order: HashMap<&str, usize> = doc.section_order.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
    placed.sort_by(|a, b| {
        let oa = order.get(a.anchor.section_id.as_deref().unwrap_or("")).copied().unwrap_or(0);
        let ob = order.get(b.anchor.section_id.as_deref().unwrap_or("")).copied().unwrap_or(0);
        oa.cmp(&ob).then(a.anchor.position.start.cmp(&b.anchor.position.start)).then(a.id.cmp(&b.id))
    });
    let entry = |lines: &mut Vec<String>, a: &Annotation, orphan: bool| {
        let quote = if orphan { &a.anchor.original_quote } else { &a.anchor.quote };
        if a.kind == "bookmark" && quote.is_empty() {
            lines.push("*Bookmark*".into());
            lines.push(String::new());
        } else if !quote.is_empty() {
            lines.push(quote_lines(quote));
            lines.push(String::new());
        }
        if let Some(b) = &a.body {
            lines.push(b.trim().to_string());
            lines.push(String::new());
        }
        if a.kind != "highlight" {
            lines.push(format!("- kind: {}", a.kind));
        }
        if let Some(c) = &a.color {
            lines.push(format!("- color: {c}"));
        }
        if !a.tags.is_empty() {
            lines.push(format!("- tags: {}", a.tags.iter().map(|t| format!("#{}", t.split_whitespace().collect::<Vec<_>>().join("-"))).collect::<Vec<_>>().join(" ")));
        }
        if !orphan {
            if let (Some(r), Some(sid)) = (&a.anchor.range, &a.anchor.section_id) {
                lines.push(format!("- link: {base_url}/read/{}/{sid}#{}", doc.id, r.start.block_id));
            }
        }
        if orphan {
            lines.push("- place: not found in the current file".into());
        } else if a.anchor.status == AnchorStatus::Fuzzy {
            lines.push("- place: the text here changed a little since this was marked".into());
        }
        lines.push(format!("- added: {}", a.created_at.chars().take(10).collect::<String>()));
        lines.push(String::new());
        lines.push(block_ref(&a.id));
        lines.push(String::new());
    };
    let mut section: Option<&str> = None;
    for a in &placed {
        let sid = a.anchor.section_id.as_deref().unwrap_or("");
        if section != Some(sid) {
            section = Some(sid);
            lines.push(format!("## {}", doc.section_titles.get(sid).map(String::as_str).unwrap_or("Section")));
            lines.push(String::new());
        }
        entry(&mut lines, a, false);
    }
    if !orphans.is_empty() {
        lines.extend(["## Orphaned".into(), String::new(), "These couldn't be found in the current version of the file. They are kept with the words you marked.".into(), String::new()]);
        orphans.sort_by(|x, y| x.created_at.cmp(&y.created_at).then(x.id.cmp(&y.id)));
        for a in &orphans {
            entry(&mut lines, a, true);
        }
    }
    static BLANKS: OnceLock<Regex> = OnceLock::new();
    let blanks = BLANKS.get_or_init(|| Regex::new(r"\n{3,}").unwrap());
    let joined = lines.join("\n");
    format!("{}\n", blanks.replace_all(&joined, "\n\n").trim_end())
}

/// "Pride and Prejudice" → "pride-and-prejudice".
pub fn slug(title: &str) -> String {
    let folded: String = title.nfkd().filter(|c| !is_combining_mark(*c)).collect::<String>().to_lowercase();
    let mut s = String::new();
    let mut dash = false;
    for c in folded.chars() {
        if c.is_ascii_alphanumeric() {
            s.push(c);
            dash = false;
        } else if !dash {
            s.push('-');
            dash = true;
        }
    }
    let s = s.trim_matches('-');
    let s: String = s.chars().take(60).collect();
    let s = s.trim_end_matches('-');
    if s.is_empty() {
        "document".to_string()
    } else {
        s.to_string()
    }
}
