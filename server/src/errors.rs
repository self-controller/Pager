use serde_json::{Map, Value};

/// An error with a calm, reader-facing message and an API code.
#[derive(Debug, Clone)]
pub struct AppError {
    pub status: u16,
    pub code: String,
    pub message: String,
    /// Fields sent alongside `error` in the body (409 progress_conflict carries `progress`).
    pub extra: Option<Map<String, Value>>,
}

impl AppError {
    pub fn new(status: u16, code: &str, message: impl Into<String>) -> AppError {
        AppError { status, code: code.to_string(), message: message.into(), extra: None }
    }

    pub fn with_extra(mut self, key: &str, value: Value) -> AppError {
        self.extra.get_or_insert_with(Map::new).insert(key.to_string(), value);
        self
    }

    pub fn internal(message: impl Into<String>) -> AppError {
        AppError::new(500, "internal", format!("Something went wrong in the reading service ({}).", message.into()))
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} ({})", self.message, self.code)
    }
}

impl std::error::Error for AppError {}

pub fn not_found(what: &str) -> AppError {
    AppError::new(404, "not_found", format!("{what} isn't in your library."))
}

pub fn invalid(message: impl Into<String>) -> AppError {
    AppError::new(400, "invalid_request", message)
}

pub fn gone(message: impl Into<String>) -> AppError {
    AppError::new(410, "gone", message)
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::internal(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::internal(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::internal(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;

/// `EACCES: permission denied, open '<path>'`-style messages, as Node phrased them, for file errors
/// shown in the tree.
pub fn io_message(e: &std::io::Error, path: &std::path::Path) -> String {
    let code = match e.kind() {
        std::io::ErrorKind::PermissionDenied => "EACCES: permission denied",
        std::io::ErrorKind::NotFound => "ENOENT: no such file or directory",
        _ => return format!("{e}"),
    };
    format!("{code}, open '{}'", path.display())
}
