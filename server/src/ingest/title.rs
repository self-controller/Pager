use regex::Regex;
use std::sync::OnceLock;

/// "my-great_notes.md" → "My great notes".
pub fn title_from_file_name(name: &str) -> String {
    static EXT: OnceLock<Regex> = OnceLock::new();
    let ext = EXT.get_or_init(|| Regex::new(r"\.[A-Za-z0-9]{1,8}$").unwrap());
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let base = ext.replace(base, "");
    let t: String = base.replace(['-', '_'], " ");
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() {
        return "Untitled".to_string();
    }
    let mut chars = t.chars();
    let first: String = chars.next().map(|c| c.to_uppercase().collect()).unwrap_or_default();
    format!("{first}{}", chars.as_str())
}

const SMALL_WORDS: &[&str] = &["a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "the", "to", "up"];

/// "THE GIFT OF THE MAGI" → "The Gift of the Magi". Leaves mixed-case input alone.
pub fn title_case(s: &str) -> String {
    if s != s.to_uppercase() || !s.chars().any(|c| c.is_uppercase()) {
        return s.to_string();
    }
    let lower = s.to_lowercase();
    // Split keeping the whitespace between words, as `split(/(\s+)/)` does.
    let mut parts: Vec<(String, bool)> = Vec::new();
    let mut cur = String::new();
    let mut cur_ws: Option<bool> = None;
    for c in lower.chars() {
        let ws = c.is_whitespace();
        if cur_ws != Some(ws) && !cur.is_empty() {
            parts.push((std::mem::take(&mut cur), cur_ws.unwrap_or(false)));
        }
        cur_ws = Some(ws);
        cur.push(c);
    }
    if !cur.is_empty() {
        parts.push((cur, cur_ws.unwrap_or(false)));
    }
    let mut out = String::new();
    for (i, (w, ws)) in parts.iter().enumerate() {
        if *ws {
            out.push_str(w);
            continue;
        }
        if i > 0 && SMALL_WORDS.contains(&w.as_str()) {
            out.push_str(w);
        } else {
            let mut cs = w.chars();
            if let Some(f) = cs.next() {
                out.extend(f.to_uppercase());
            }
            out.push_str(cs.as_str());
        }
    }
    out
}
