use super::doctext::{Bias, DocIndex};
use crate::errors::{invalid, AppError};
use crate::model::*;
use crate::render::html::Bias as MapBias;
use crate::Result;
use serde_json::Value;

/// Context kept on each side of a quote (more after a collapsed point: it says what comes next).
pub const CONTEXT: usize = 32;
pub const CONTEXT_AFTER_POINT: usize = 48;

/// Selectors as stored in the anchors table.
#[derive(Clone, Debug, PartialEq)]
pub struct StoredSelectors {
    pub revision_id: String,
    pub section_id: String,
    pub start: BlockPoint,
    pub end: BlockPoint,
    pub doc_start: usize,
    pub doc_end: usize,
    pub exact: String,
    pub prefix: String,
    pub suffix: String,
    /// The passage sits in a repeated block (its id may name a different copy after an edit).
    pub ambiguous: bool,
}

/// A block whose text repeats elsewhere in the document ("-2" ids, or the first of a set).
pub fn is_repeated(idx: &DocIndex, block_id: &str) -> bool {
    let suffixed = block_id.rfind('-').map(|i| i + 1 < block_id.len() && block_id[i + 1..].bytes().all(|b| b.is_ascii_digit())).unwrap_or(false);
    suffixed || idx.by_id.contains_key(&format!("{block_id}-2"))
}

fn stale() -> AppError {
    AppError::new(409, "stale_revision", "That passage isn't in this version of the document. Reload the page and try again.")
}

/// Selectors for a range in a revision. Points are clamped; a reversed range is put in order.
pub fn selectors_for(idx: &DocIndex, range: &TextRange) -> Result<StoredSelectors> {
    let a = idx.pos(&range.start).ok_or_else(stale)?;
    let b = idx.pos(&range.end).ok_or_else(stale)?;
    let (doc_start, doc_end) = if a <= b { (a, b) } else { (b, a) };
    let start = idx.point(doc_start, Bias::Start).ok_or_else(stale)?;
    let end = if doc_end == doc_start { start.clone() } else { idx.point(doc_end, Bias::End).ok_or_else(stale)? };
    let collapsed = doc_start == doc_end;
    let section_id = idx.section_of_block(&start.block_id).map(|s| s.id.clone()).ok_or_else(stale)?;
    let ambiguous = is_repeated(idx, &start.block_id) || is_repeated(idx, &end.block_id);
    Ok(StoredSelectors {
        revision_id: idx.revision_id.clone(),
        section_id,
        exact: idx.slice(doc_start, doc_end),
        prefix: idx.slice(doc_start.saturating_sub(CONTEXT), doc_start),
        suffix: idx.slice(doc_end, doc_end + if collapsed { CONTEXT_AFTER_POINT } else { CONTEXT }),
        start,
        end,
        doc_start,
        doc_end,
        ambiguous,
    })
}

/// Selectors for a document-text span (as found by the matcher).
pub fn selectors_for_span(idx: &DocIndex, doc_start: usize, doc_end: usize) -> Result<StoredSelectors> {
    let start = idx.point(doc_start, Bias::Start).ok_or_else(stale)?;
    let end = if doc_end == doc_start { start.clone() } else { idx.point(doc_end, Bias::End).ok_or_else(stale)? };
    selectors_for(idx, &TextRange { start, end })
}

/// A section's textContent offsets → a block range.
pub fn range_from_section_range(idx: &DocIndex, sr: &SectionRange) -> Result<TextRange> {
    let si = *idx.section_by_id.get(&sr.section_id).ok_or_else(|| AppError::new(409, "stale_revision", "That section isn't in this version of the document. Reload the page and try again."))?;
    let map = &idx.render(si).map;
    let lo = sr.start.min(sr.end);
    let hi = map.length.min(sr.start.max(sr.end));
    let start = map.to_point(lo, MapBias::Start);
    let end = if hi == lo { start.clone() } else { map.to_point(hi, MapBias::End) };
    match (start, end) {
        (Some(start), Some(end)) => Ok(TextRange { start, end }),
        _ => Err(invalid("That selection has no text in it.")),
    }
}

fn as_point(v: &Value) -> Option<BlockPoint> {
    let o = v.as_object()?;
    let block_id = o.get("blockId")?.as_str()?.to_string();
    let offset = o.get("offset")?;
    let n = offset.as_u64().or_else(|| offset.as_f64().filter(|f| f.fract() == 0.0 && *f >= 0.0).map(|f| f as u64))?;
    Some(BlockPoint { block_id, offset: n as usize })
}

/// Read an AnchorInput out of a request body (the fields may sit at the top level, as in CreateAnnotation).
pub fn parse_anchor_input(v: &Value) -> Result<AnchorInput> {
    let o = v.as_object().ok_or_else(|| invalid("Send the anchor as a JSON object."))?;
    let mut input = AnchorInput::default();
    if let Some(r) = o.get("revisionId") {
        if !r.is_null() {
            input.revision_id = Some(r.as_str().ok_or_else(|| invalid("revisionId should be text."))?.to_string());
        }
    }
    if let Some(r) = o.get("range") {
        if !r.is_null() {
            let ro = r.as_object();
            let start = ro.and_then(|x| x.get("start")).and_then(as_point);
            let end = ro.and_then(|x| x.get("end")).and_then(as_point);
            match (start, end) {
                (Some(start), Some(end)) => input.range = Some(TextRange { start, end }),
                _ => return Err(invalid("range needs start and end points: { blockId, offset }.")),
            }
        }
    }
    if let Some(sr) = o.get("sectionRange") {
        if !sr.is_null() {
            let bad = || invalid("sectionRange needs { sectionId, start, end } with whole-number offsets.");
            let so = sr.as_object().ok_or_else(bad)?;
            let section_id = so.get("sectionId").and_then(Value::as_str).ok_or_else(bad)?.to_string();
            let int = |k: &str| -> Result<usize> {
                let v = so.get(k).ok_or_else(bad)?;
                let n = v.as_i64().or_else(|| v.as_f64().filter(|f| f.fract() == 0.0).map(|f| f as i64)).ok_or_else(bad)?;
                if n < 0 {
                    return Err(bad());
                }
                Ok(n as usize)
            };
            input.section_range = Some(SectionRange { section_id, start: int("start")?, end: int("end")? });
        }
    }
    if let Some(t) = o.get("selectedText") {
        if let Some(s) = t.as_str() {
            input.selected_text = Some(s.to_string());
        }
    }
    Ok(input)
}

/// Validate an AnchorInput against the revision it names and return its block range.
pub fn range_from_input(idx: &DocIndex, input: &AnchorInput) -> Result<TextRange> {
    let range = if let Some(r) = &input.range {
        for p in [&r.start, &r.end] {
            let e = idx.leaf(&p.block_id).ok_or_else(stale)?;
            if p.offset > e.len {
                return Err(invalid(format!("Offset {} is past the end of block {}.", p.offset, p.block_id)));
            }
        }
        r.clone()
    } else if let Some(sr) = &input.section_range {
        range_from_section_range(idx, sr)?
    } else {
        return Err(invalid("Say where: give range or sectionRange."));
    };
    if let Some(sel_text) = &input.selected_text {
        let sel = selectors_for(idx, &range)?;
        if squash(&sel.exact) != squash(sel_text) {
            return Err(AppError::new(409, "selection_mismatch", "The selected text doesn't match the document. Reload the page and try again."));
        }
    }
    Ok(range)
}

/// Compare selected text loosely: line breaks and footnote markers may differ between DOM and text.
fn squash(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

/// Where an anchor sits now, per section, in each section's textContent coordinates (for painting).
pub fn segments_for(idx: &DocIndex, start: &BlockPoint, end: &BlockPoint) -> Vec<SectionSegment> {
    let (Some(a), Some(b)) = (idx.leaf(&start.block_id), idx.leaf(&end.block_id)) else { return vec![] };
    let mut out = Vec::new();
    for si in a.section_index..=b.section_index {
        let map = &idx.render(si).map;
        let flow = map.flow_range();
        let s = if si == a.section_index { map.to_offset(start, MapBias::Start).unwrap_or(flow.0) } else { flow.0 };
        let e = if si == b.section_index { map.to_offset(end, MapBias::End).unwrap_or(flow.1) } else { flow.1 };
        out.push(SectionSegment { section_id: idx.doc.sections[si].id.clone(), start: s, end: e.max(s) });
    }
    out
}
