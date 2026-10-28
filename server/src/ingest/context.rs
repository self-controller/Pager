use super::builder::DocBuilder;
use super::html::external_url;
use crate::config::limits;
use crate::library::assets::{asset_url, AssetStore};
use crate::model::ImageRef;
use base64::Engine;
use regex::Regex;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// What a converter may use besides the bytes it was given.
pub struct IngestContext {
    /// File name as the reader knows it (for titles).
    pub file_name: String,
    /// Directory of the source file, for relative images; None for uploads.
    pub base_dir: Option<PathBuf>,
    pub assets: AssetStore,
}

impl IngestContext {
    pub fn new(file_name: &str, base_dir: Option<&Path>, assets: AssetStore) -> IngestContext {
        IngestContext { file_name: file_name.to_string(), base_dir: base_dir.map(Path::to_path_buf), assets }
    }
}

fn image_ref(src: &str, alt: &str, title: Option<&str>, remote: bool) -> ImageRef {
    ImageRef { src: src.to_string(), remote, alt: alt.to_string(), title: title.filter(|t| !t.is_empty()).map(str::to_string), width: None, height: None }
}

/// Resolve an image reference from a Markdown or HTML file: remote URLs stay remote (not loaded
/// unless the reader allows it); data: URIs and local files are copied into the asset store.
pub fn resolve_local_image(ctx: &IngestContext, builder: &mut DocBuilder, src: &str, alt: &str, title: Option<&str>) -> Option<ImageRef> {
    static DATA: OnceLock<Regex> = OnceLock::new();
    static SCHEME: OnceLock<Regex> = OnceLock::new();
    let data = DATA.get_or_init(|| Regex::new(r"(?is)^data:image/[\w.+-]+;base64,(.*)$").unwrap());
    let scheme = SCHEME.get_or_init(|| Regex::new(r"(?i)^[a-z][a-z0-9+.-]*:").unwrap());
    if let Some(ext) = external_url(src) {
        if !ext.starts_with("mailto:") {
            return Some(image_ref(&ext, alt, title, true));
        }
    }
    if let Some(m) = data.captures(src.trim()) {
        let payload: String = m[1].chars().filter(|c| !c.is_whitespace()).collect();
        let bytes = base64::engine::general_purpose::STANDARD.decode(payload.as_bytes()).ok()?;
        let file = ctx.assets.put(&bytes)?;
        builder.assets.insert(file.clone());
        return Some(image_ref(&asset_url(&file), alt, title, false));
    }
    let base = ctx.base_dir.as_ref()?;
    if scheme.is_match(src) {
        return None;
    }
    let rel = src.split(['?', '#']).next().unwrap_or("");
    let rel = percent_encoding::percent_decode_str(rel).decode_utf8().map(|s| s.into_owned()).unwrap_or_else(|_| rel.to_string());
    let full = base.join(rel);
    let found = (|| {
        let st = std::fs::metadata(&full).ok()?;
        if !st.is_file() || st.len() > limits::IMAGE_BYTES {
            return None;
        }
        let bytes = std::fs::read(&full).ok()?;
        ctx.assets.put(&bytes)
    })();
    match found {
        Some(file) => {
            builder.assets.insert(file.clone());
            Some(image_ref(&asset_url(&file), alt, title, false))
        }
        None => {
            builder.warn("Some images could not be found next to the file.");
            None
        }
    }
}
