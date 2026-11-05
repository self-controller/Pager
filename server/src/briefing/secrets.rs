//! The Anthropic API key. It is read once at startup: from `ANTHROPIC_API_KEY` in the environment,
//! else from `~/.config/pager/secrets.env` (mode 600, outside the repository). It is never written
//! to the environment, a log, a response or the database, and only `x-api-key` on requests to
//! api.anthropic.com carries it.

use std::path::{Path, PathBuf};

pub const KEY_VAR: &str = "ANTHROPIC_API_KEY";

/// The key. `Debug` hides it and there is no `Display` or `Serialize`, so it can't be printed or
/// sent by accident.
#[derive(Clone, PartialEq, Eq)]
pub struct ApiKey(String);

impl ApiKey {
    /// A non-empty value with no spaces or control characters.
    pub fn new(raw: &str) -> Option<ApiKey> {
        let k = raw.trim();
        if k.is_empty() || k.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return None;
        }
        Some(ApiKey(k.to_string()))
    }

    /// The key itself, for the request header only.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for ApiKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ApiKey(***)")
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum KeySource {
    Environment,
    File(PathBuf),
}

#[derive(Debug, Default)]
pub struct Loaded {
    pub key: Option<ApiKey>,
    pub source: Option<KeySource>,
    /// Said once at startup (names the file, never its contents).
    pub warning: Option<String>,
}

/// `$XDG_CONFIG_HOME/pager/secrets.env`, else `~/.config/pager/secrets.env`.
pub fn secrets_path() -> PathBuf {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/")).join(".config"));
    base.join("pager").join("secrets.env")
}

/// The key from the environment value (wins when non-empty) or the secrets file.
pub fn load_api_key(env_value: Option<&str>, file: &Path) -> Loaded {
    if let Some(k) = env_value.and_then(ApiKey::new) {
        return Loaded { key: Some(k), source: Some(KeySource::Environment), warning: None };
    }
    let Ok(meta) = std::fs::metadata(file) else { return Loaded::default() };
    if !meta.is_file() {
        return Loaded::default();
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = meta.permissions().mode();
        if mode & 0o077 != 0 {
            return Loaded {
                warning: Some(format!("Not reading {}: other users can read it. Run `chmod 600 {}` and start Pager again.", file.display(), file.display())),
                ..Loaded::default()
            };
        }
    }
    let Ok(text) = std::fs::read_to_string(file) else {
        return Loaded { warning: Some(format!("Couldn't read {}.", file.display())), ..Loaded::default() };
    };
    match parse_env_file(&text, KEY_VAR).as_deref().and_then(ApiKey::new) {
        Some(k) => Loaded { key: Some(k), source: Some(KeySource::File(file.to_path_buf())), warning: None },
        None => Loaded::default(),
    }
}

/// The value of `name` in a dotenv-style file: `NAME=value` lines, an optional `export `, single or
/// double quotes, `#` comments. The last assignment wins.
pub fn parse_env_file(text: &str, name: &str) -> Option<String> {
    let mut found = None;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").map(str::trim_start).unwrap_or(line);
        let Some((k, v)) = line.split_once('=') else { continue };
        if k.trim() != name {
            continue;
        }
        let v = v.trim();
        let value = if let Some(inner) = v.strip_prefix('"').and_then(|r| r.split_once('"')).map(|(a, _)| a) {
            inner.to_string()
        } else if let Some(inner) = v.strip_prefix('\'').and_then(|r| r.split_once('\'')).map(|(a, _)| a) {
            inner.to_string()
        } else {
            // Unquoted: a ` #` starts a comment.
            v.split(" #").next().unwrap_or("").trim().to_string()
        };
        found = Some(value);
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_usual_shapes() {
        assert_eq!(parse_env_file("ANTHROPIC_API_KEY=abc", KEY_VAR).as_deref(), Some("abc"));
        assert_eq!(parse_env_file("# a comment\nexport ANTHROPIC_API_KEY=\"q1\" # note\n", KEY_VAR).as_deref(), Some("q1"));
        assert_eq!(parse_env_file("ANTHROPIC_API_KEY='s1'\nOTHER=x", KEY_VAR).as_deref(), Some("s1"));
        assert_eq!(parse_env_file("ANTHROPIC_API_KEY = plain # trailing", KEY_VAR).as_deref(), Some("plain"));
        assert_eq!(parse_env_file("OTHER=x", KEY_VAR), None);
    }

    #[test]
    fn debug_hides_the_key() {
        let k = ApiKey::new("sk-ant-secret").unwrap();
        assert_eq!(format!("{k:?}"), "ApiKey(***)");
        assert!(ApiKey::new("  ").is_none());
        assert!(ApiKey::new("a b").is_none());
    }
}
