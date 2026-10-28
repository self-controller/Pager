//! Content-addressed image store: `<data>/assets/<sha256>.<ext>`. Only real images are accepted.

use crate::config::limits;
use crate::ids::sha256_hex;
use regex::Regex;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

fn asset_file_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[0-9a-f]{64}\.(png|jpg|gif|webp|avif|bmp|svg)$").unwrap())
}

pub fn content_type_of(file: &str) -> Option<&'static str> {
    Some(match file.rsplit('.').next().unwrap_or("") {
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// Sniff an image type from its bytes; None for anything that isn't an image we serve.
pub fn sniff_image(b: &[u8]) -> Option<&'static str> {
    if b.len() < 4 {
        return None;
    }
    if b.starts_with(&[0x89, 0x50, 0x4e, 0x47]) {
        return Some("png");
    }
    if b.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("jpg");
    }
    if b.starts_with(b"GIF8") {
        return Some("gif");
    }
    if b.starts_with(b"BM") {
        return Some("bmp");
    }
    if b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        return Some("webp");
    }
    if b.len() >= 12 && &b[4..8] == b"ftyp" && (b[8..12].starts_with(b"avif") || b[8..12].starts_with(b"avis")) {
        return Some("avif");
    }
    let head = String::from_utf8_lossy(&b[..b.len().min(1024)]).trim_start().to_lowercase();
    if (head.starts_with("<svg") || head.starts_with("<?xml") || head.starts_with("<!doctype svg")) && head.contains("<svg") {
        return Some("svg");
    }
    None
}

#[derive(Clone, Debug)]
pub struct AssetStore {
    pub dir: PathBuf,
}

impl AssetStore {
    pub fn new(data_dir: &Path) -> AssetStore {
        AssetStore { dir: data_dir.join("assets") }
    }

    /// Store image bytes; returns the asset file name (`<sha>.<ext>`) or None if not an image.
    pub fn put(&self, bytes: &[u8]) -> Option<String> {
        if bytes.is_empty() || bytes.len() as u64 > limits::IMAGE_BYTES {
            return None;
        }
        let ext = sniff_image(bytes)?;
        let file = format!("{}.{ext}", sha256_hex(bytes));
        let full = self.dir.join(&file);
        if !full.exists() {
            std::fs::create_dir_all(&self.dir).ok()?;
            let tmp = self.dir.join(format!("{file}.{}.tmp", std::process::id()));
            std::fs::write(&tmp, bytes).ok()?;
            std::fs::rename(&tmp, &full).ok()?;
        }
        Some(file)
    }

    pub fn path(&self, file: &str) -> Option<PathBuf> {
        if !asset_file_re().is_match(file) {
            return None;
        }
        Some(self.dir.join(file))
    }
}

pub fn asset_url(file: &str) -> String {
    format!("/api/assets/{file}")
}
