//! Ingest jobs live in memory for an hour; the documents they produce are what persists.

use crate::ids::new_id;
use crate::model::IngestJob;
use std::collections::HashMap;
use std::time::{Duration, Instant};

const TTL: Duration = Duration::from_secs(60 * 60);

#[derive(Default)]
pub struct Jobs {
    jobs: HashMap<String, (IngestJob, Instant)>,
    /// Jobs that changed since the caller last drained them (the journal announces them).
    pub changed: Vec<IngestJob>,
}

impl Jobs {
    pub fn create(&mut self, now_ms: i64) -> IngestJob {
        self.prune();
        let job = IngestJob { id: new_id(now_ms), status: "processing".into(), document_ids: Vec::new(), error: None };
        self.jobs.insert(job.id.clone(), (job.clone(), Instant::now()));
        job
    }

    pub fn get(&self, id: &str) -> Option<IngestJob> {
        self.jobs.get(id).map(|(j, _)| j.clone())
    }

    pub fn progress(&mut self, id: &str, document_ids: &[String]) {
        if let Some((j, _)) = self.jobs.get_mut(id) {
            j.document_ids = document_ids.to_vec();
            self.changed.push(j.clone());
        }
    }

    pub fn finish(&mut self, id: &str, document_ids: &[String]) {
        if let Some((j, _)) = self.jobs.get_mut(id) {
            j.status = "done".into();
            let mut seen = std::collections::HashSet::new();
            j.document_ids = document_ids.iter().filter(|d| seen.insert((*d).clone())).cloned().collect();
            self.changed.push(j.clone());
        }
    }

    pub fn fail(&mut self, id: &str, error: &str) {
        if let Some((j, _)) = self.jobs.get_mut(id) {
            j.status = "error".into();
            j.error = Some(error.to_string());
            self.changed.push(j.clone());
        }
    }

    fn prune(&mut self) {
        let now = Instant::now();
        self.jobs.retain(|_, (j, at)| !(now.duration_since(*at) > TTL && j.status != "processing"));
    }
}
