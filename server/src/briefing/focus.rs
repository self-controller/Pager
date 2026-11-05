//! "Context for this": a briefing narrowed to one name or work the reader selected (Phase 3).
//!
//! The selection is cleaned before it is used as a cache key or sent anywhere: spaces collapsed,
//! surrounding quotes and punctuation dropped, a possessive ’s removed ("Malthus’s" → "Malthus").
//! The cache key is the cleaned text in lower case, so "Malthus" and "malthus" share a briefing.
//! src/tools/context/model.ts (`normalizeFocus`) does the same on the client.

/// Longer selections are refused: Context for this is for a name or a title.
pub const FOCUS_MAX_CHARS: usize = 120;

pub const FOCUS_REFUSED: &str = "Select a name or a title (up to 120 characters) for Context for this.";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Focus {
    /// As shown and sent to the model: "Malthus".
    pub text: String,
    /// The cache key: "malthus".
    pub key: String,
}

/// Quotes and punctuation that may cling to a selection's ends.
fn clinging(c: char) -> bool {
    matches!(c, '"' | '\'' | '“' | '”' | '‘' | '’' | '«' | '»' | '„' | '‚' | '`' | '.' | ',' | ';' | ':' | '!' | '?' | '…' | '—' | '–' | '-' | '*' | '_')
}

fn strip_unbalanced(mut s: String) -> String {
    loop {
        let before = s.clone();
        s = s.trim_matches(clinging).trim().to_string();
        for (open, close) in [('(', ')'), ('[', ']')] {
            if s.starts_with(open) && !s.contains(close) {
                s = s[open.len_utf8()..].trim().to_string();
            }
            if s.ends_with(close) && !s.contains(open) {
                s = s[..s.len() - close.len_utf8()].trim().to_string();
            }
            if s.starts_with(open) && s.ends_with(close) && s.matches(open).count() == 1 {
                s = s[open.len_utf8()..s.len() - close.len_utf8()].trim().to_string();
            }
        }
        if s == before {
            return s;
        }
    }
}

/// None for no focus (the whole book); an error message for a selection that can't be one.
pub fn parse_focus(raw: Option<&str>) -> Result<Option<Focus>, &'static str> {
    let Some(raw) = raw else { return Ok(None) };
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return Ok(None);
    }
    if collapsed.chars().count() > FOCUS_MAX_CHARS {
        return Err(FOCUS_REFUSED);
    }
    let mut text = strip_unbalanced(collapsed);
    // A possessive leaves at least three letters ("Ross's" → "Ross"; "It's" stays).
    for suffix in ["’s", "'s", "’S", "'S"] {
        if text.chars().count() >= suffix.chars().count() + 3 && text.ends_with(suffix) {
            text = strip_unbalanced(text[..text.len() - suffix.len()].to_string());
            break;
        }
    }
    if !text.chars().any(char::is_alphabetic) {
        return Err(FOCUS_REFUSED);
    }
    let key = focus_key(&text);
    Ok(Some(Focus { text, key }))
}

/// The cache key for a focus as shown: lower case, curly apostrophes straightened.
pub fn focus_key(text: &str) -> String {
    text.to_lowercase().replace(['’', '‘'], "'")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(s: &str) -> Option<String> {
        parse_focus(Some(s)).unwrap().map(|f| f.text)
    }

    #[test]
    fn cleans_a_selection() {
        assert_eq!(text("  Malthus  "), Some("Malthus".into()));
        assert_eq!(text("“Malthus’s”"), Some("Malthus".into()));
        assert_eq!(text("Mr. Darcy,"), Some("Mr. Darcy".into()));
        assert_eq!(text("Entail (fee tail)"), Some("Entail (fee tail)".into()));
        assert_eq!(text("(Lyell)"), Some("Lyell".into()));
        assert_eq!(text("Principles of\n  Geology."), Some("Principles of Geology".into()));
        assert_eq!(text("—Zarathustra—"), Some("Zarathustra".into()));
        assert_eq!(text("Ross's"), Some("Ross".into()));
        assert_eq!(text("It's"), Some("It's".into()), "too short to be a possessive");
        assert_eq!(parse_focus(Some("Malthus")).unwrap().unwrap().key, "malthus");
        assert_eq!(parse_focus(Some("D’Arcy")).unwrap().unwrap().key, "d'arcy");
    }

    #[test]
    fn refuses_what_isnt_a_name() {
        assert_eq!(parse_focus(None), Ok(None));
        assert_eq!(parse_focus(Some("   ")), Ok(None));
        assert_eq!(parse_focus(Some("…")), Err(FOCUS_REFUSED));
        assert_eq!(parse_focus(Some("1859")), Err(FOCUS_REFUSED));
        assert_eq!(parse_focus(Some(&"word ".repeat(30))), Err(FOCUS_REFUSED));
        assert!(parse_focus(Some(&"a".repeat(120))).unwrap().is_some());
    }
}
