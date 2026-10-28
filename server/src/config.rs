use std::path::{Path, PathBuf};

pub const API_VERSION: u32 = 1;
pub const DEFAULT_PORT: u16 = 3006;
/// The remote listener (paired phones, behind `tailscale serve`), when app.remote.enabled is on.
pub const DEFAULT_REMOTE_PORT: u16 = 3007;
pub const WEB_DEV_PORT: u16 = 5176;
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The repository (this crate's parent folder): `reads/`, `samples/` and `dist/` live next to it.
pub fn repo_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."))
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

/// `$PAGER_DATA_DIR`, else `$XDG_DATA_HOME/pager`, else `~/.local/share/pager`.
pub fn default_data_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("PAGER_DATA_DIR").filter(|d| !d.is_empty()) {
        return absolute(PathBuf::from(d));
    }
    let xdg = std::env::var_os("XDG_DATA_HOME").filter(|d| !d.is_empty()).map(PathBuf::from).unwrap_or_else(|| home_dir().join(".local").join("share"));
    xdg.join("pager")
}

/// `$PAGER_READS_DIR`, else `<repository>/reads`: the folder the library lives in.
pub fn default_reads_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("PAGER_READS_DIR").filter(|d| !d.is_empty()) {
        return absolute(PathBuf::from(d));
    }
    repo_dir().join("reads")
}

/// The repository's samples/welcome.md, copied into an empty reads folder on first run.
pub fn welcome_file() -> Option<PathBuf> {
    let p = repo_dir().join("samples").join("welcome.md");
    p.exists().then_some(p)
}

/// The UI's production build, served on the API's origin when present (build it with VITE_USE_HTTP=1).
pub fn web_dir() -> Option<PathBuf> {
    let dir = std::env::var_os("PAGER_WEB_DIR").filter(|d| !d.is_empty()).map(|d| absolute(PathBuf::from(d))).unwrap_or_else(|| repo_dir().join("dist"));
    dir.join("index.html").exists().then_some(dir)
}

fn port_from(var: &str, default: u16) -> u16 {
    std::env::var(var).ok().and_then(|v| v.trim().parse::<u32>().ok()).filter(|n| *n > 0 && *n < 65536).map(|n| n as u16).unwrap_or(default)
}

pub fn default_port() -> u16 {
    port_from("PAGER_PORT", DEFAULT_PORT)
}

pub fn default_remote_port() -> u16 {
    port_from("PAGER_REMOTE_PORT", DEFAULT_REMOTE_PORT)
}

pub fn absolute(p: PathBuf) -> PathBuf {
    if p.is_absolute() {
        p
    } else {
        std::env::current_dir().map(|c| c.join(&p)).unwrap_or(p)
    }
}

/// Limits on what we will read.
pub mod limits {
    pub const FILE_BYTES: u64 = 200 * 1024 * 1024;
    pub const TEXT_BYTES: usize = 20 * 1024 * 1024;
    pub const ZIP_UNCOMPRESSED_BYTES: u64 = 1024 * 1024 * 1024;
    pub const ZIP_ENTRIES: usize = 5000;
    pub const IMAGE_BYTES: u64 = 30 * 1024 * 1024;
    /// Sections longer than this (characters) are split further.
    pub const SECTION_CHARS: usize = 120_000;
    /// Documents shorter than this stay in one section even with several headings.
    pub const SPLIT_MIN_CHARS: usize = 30_000;
    pub const SYNTHETIC_PART_CHARS: usize = 40_000;
}
