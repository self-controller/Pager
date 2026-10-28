//! One parsed revision, indexed. The document text is every leaf's text joined by "\n", in reading
//! order; it is the space anchors' positions and quotes live in. All offsets are UTF-16 units.

use super::normalise::{normalise, Normalised};
use crate::model::*;
use crate::render::html::{render_section, RenderedSection};
use crate::util::utf16::{from_u16, len16, to_u16};
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Clone, Debug)]
pub struct LeafEntry {
    pub id: String,
    pub text: String,
    pub len: usize,
    pub section_index: usize,
    /// Offset of the leaf's text in the document text.
    pub start: usize,
    /// Index in reading order.
    pub index: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Bias {
    Start,
    End,
}

pub struct DocIndex {
    pub doc: ParsedDocument,
    pub revision_id: String,
    pub leaves: Vec<LeafEntry>,
    pub by_id: HashMap<String, usize>,
    pub section_by_id: HashMap<String, usize>,
    /// First leaf index of each section.
    pub section_first_leaf: Vec<usize>,
    text: OnceLock<Vec<u16>>,
    rendered: Vec<OnceLock<RenderedSection>>,
    norm: OnceLock<Normalised>,
}

impl std::fmt::Debug for DocIndex {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "DocIndex({}, {} leaves)", self.revision_id, self.leaves.len())
    }
}

impl DocIndex {
    pub fn new(doc: ParsedDocument, revision_id: &str) -> DocIndex {
        let mut leaves = Vec::new();
        let mut by_id = HashMap::new();
        let mut section_by_id = HashMap::new();
        let mut section_first_leaf = Vec::new();
        let mut pos = 0;
        for (si, s) in doc.sections.iter().enumerate() {
            section_by_id.insert(s.id.clone(), si);
            section_first_leaf.push(leaves.len());
            for leaf in all_leaves(&s.blocks) {
                let len = len16(&leaf.text);
                let e = LeafEntry { id: leaf.id.clone(), text: leaf.text.clone(), len, section_index: si, start: pos, index: leaves.len() };
                by_id.insert(leaf.id.clone(), leaves.len());
                leaves.push(e);
                pos += len + 1;
            }
        }
        let n = doc.sections.len();
        DocIndex { doc, revision_id: revision_id.to_string(), leaves, by_id, section_by_id, section_first_leaf, text: OnceLock::new(), rendered: (0..n).map(|_| OnceLock::new()).collect(), norm: OnceLock::new() }
    }

    pub fn leaf(&self, id: &str) -> Option<&LeafEntry> {
        self.by_id.get(id).map(|&i| &self.leaves[i])
    }

    /// The document text as UTF-16 units.
    pub fn text(&self) -> &[u16] {
        self.text.get_or_init(|| {
            let mut out: Vec<u16> = Vec::new();
            for (i, l) in self.leaves.iter().enumerate() {
                if i > 0 {
                    out.push(b'\n' as u16);
                }
                out.extend(to_u16(&l.text));
            }
            out
        })
    }

    pub fn normalised(&self) -> &Normalised {
        self.norm.get_or_init(|| normalise(self.text()))
    }

    pub fn length(&self) -> usize {
        match self.leaves.last() {
            Some(l) => l.start + l.len,
            None => 0,
        }
    }

    pub fn section(&self, i: usize) -> Option<&DocSection> {
        self.doc.sections.get(i)
    }

    pub fn render(&self, section_index: usize) -> &RenderedSection {
        self.rendered[section_index].get_or_init(|| render_section(&self.doc.sections[section_index]))
    }

    /// Block point → document text position (None if the block isn't in this revision).
    pub fn pos(&self, p: &BlockPoint) -> Option<usize> {
        let e = self.leaf(&p.block_id)?;
        Some(e.start + p.offset.min(e.len))
    }

    /// Document position → block point. At a "\n" between leaves, `Start` bias moves to the next leaf,
    /// `End` bias stays at the end of the previous one.
    pub fn point(&self, pos: usize, bias: Bias) -> Option<BlockPoint> {
        if self.leaves.is_empty() {
            return None;
        }
        let mut lo = 0;
        let mut hi = self.leaves.len() - 1;
        while lo < hi {
            let mid = (lo + hi + 1) >> 1;
            if self.leaves[mid].start <= pos {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        let e = &self.leaves[lo];
        let off = pos.saturating_sub(e.start);
        if pos >= e.start && off > e.len {
            // On the separator after this leaf.
            if bias == Bias::Start {
                if let Some(next) = self.leaves.get(lo + 1) {
                    return Some(BlockPoint { block_id: next.id.clone(), offset: 0 });
                }
            }
            return Some(BlockPoint { block_id: e.id.clone(), offset: e.len });
        }
        Some(BlockPoint { block_id: e.id.clone(), offset: off })
    }

    /// Text between two document positions.
    pub fn slice(&self, start: usize, end: usize) -> String {
        let t = self.text();
        let a = start.min(t.len());
        let b = end.min(t.len()).max(a);
        from_u16(&t[a..b])
    }

    pub fn section_of_block(&self, block_id: &str) -> Option<&DocSection> {
        let e = self.leaf(block_id)?;
        self.doc.sections.get(e.section_index)
    }

    /// The section index whose text range contains `pos`.
    pub fn section_at(&self, pos: usize) -> usize {
        match self.point(pos, Bias::Start) {
            Some(p) => self.leaf(&p.block_id).map(|e| e.section_index).unwrap_or(0),
            None => 0,
        }
    }

    /// Fraction of the document (by characters) before the start of `section_index` + `offset` of it.
    pub fn percent_at(&self, section_index: usize, offset: f64) -> f64 {
        let total = self.length().max(1) as f64;
        let first = self.section_first_leaf.get(section_index).and_then(|&i| self.leaves.get(i));
        let next_first = self.section_first_leaf.get(section_index + 1).and_then(|&i| self.leaves.get(i));
        let a = first.map(|l| l.start as f64).unwrap_or(0.0);
        let b = next_first.map(|l| l.start as f64).unwrap_or(total);
        ((a + (b - a) * offset) / total).clamp(0.0, 1.0)
    }
}
