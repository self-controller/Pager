//! Parsed revisions are cached as JSON in `<data>/cache/<revisionId>.json` (rebuildable from the
//! source file or its snapshot) and kept indexed in memory for recently used documents.

use crate::anchoring::doctext::DocIndex;
use crate::model::{ParsedDocument, MODEL_VERSION};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub struct RevisionCache {
    dir: PathBuf,
    lru: HashMap<String, Arc<DocIndex>>,
    order: VecDeque<String>,
    max: usize,
}

impl RevisionCache {
    pub fn new(data_dir: &Path, max: usize) -> RevisionCache {
        RevisionCache { dir: data_dir.join("cache"), lru: HashMap::new(), order: VecDeque::new(), max }
    }

    fn file(&self, revision_id: &str) -> Option<PathBuf> {
        if revision_id.len() != 20 || !revision_id.bytes().all(|b| b.is_ascii_digit() || b.is_ascii_lowercase()) {
            return None;
        }
        Some(self.dir.join(format!("{revision_id}.json")))
    }

    pub fn save(&mut self, revision_id: &str, doc: ParsedDocument) -> Arc<DocIndex> {
        if let Some(f) = self.file(revision_id) {
            let _ = std::fs::create_dir_all(&self.dir);
            let tmp = self.dir.join(format!("{revision_id}.json.{}.tmp", std::process::id()));
            if std::fs::write(&tmp, serde_json::to_vec(&doc).unwrap_or_default()).is_ok() {
                let _ = std::fs::rename(&tmp, &f);
            }
        }
        let idx = Arc::new(DocIndex::new(doc, revision_id));
        self.remember(revision_id, idx.clone());
        idx
    }

    /// The cached revision, or None if it isn't cached (or was cached by an older model).
    pub fn load(&mut self, revision_id: &str) -> Option<Arc<DocIndex>> {
        if let Some(hit) = self.lru.get(revision_id).cloned() {
            self.order.retain(|k| k != revision_id);
            self.order.push_back(revision_id.to_string());
            return Some(hit);
        }
        let f = self.file(revision_id)?;
        let bytes = std::fs::read(f).ok()?;
        let doc: ParsedDocument = serde_json::from_slice(&bytes).ok()?;
        if doc.model_version != MODEL_VERSION {
            return None;
        }
        let idx = Arc::new(DocIndex::new(doc, revision_id));
        self.remember(revision_id, idx.clone());
        Some(idx)
    }

    pub fn drop_revision(&mut self, revision_id: &str) {
        self.lru.remove(revision_id);
        self.order.retain(|k| k != revision_id);
        if let Some(f) = self.file(revision_id) {
            let _ = std::fs::remove_file(f);
        }
    }

    fn remember(&mut self, id: &str, idx: Arc<DocIndex>) {
        self.lru.insert(id.to_string(), idx);
        self.order.retain(|k| k != id);
        self.order.push_back(id.to_string());
        while self.lru.len() > self.max {
            if let Some(oldest) = self.order.pop_front() {
                self.lru.remove(&oldest);
            }
        }
    }
}
