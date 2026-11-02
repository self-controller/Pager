/**
 * DOM helpers for the reading surface. Two coordinate systems (API.md, "Coordinate rule"):
 *  - section offsets: positions in the section body's textContent (selections, highlight segments);
 *  - block points: { blockId, offset } into one [data-b] block's text, which skips [data-atom]
 *    elements and counts each <br> as one "\n" (the reading place, survives edits to the file).
 * Nothing here changes the DOM's text, so both stay valid.
 */

export interface TextIndex {
  nodes: Text[];
  /** textContent offset at which each node starts. */
  starts: number[];
  length: number;
}

/** Every text node under `root` in document order, with its starting textContent offset. */
export function indexText(root: Node): TextIndex {
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let length = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    starts.push(length);
    length += (n as Text).data.length;
  }
  return { nodes, starts, length };
}

/** Index of the last node starting at or before `offset`. */
function nodeAt(index: TextIndex, offset: number): number {
  let lo = 0;
  let hi = index.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (index.starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** A DOM Range covering textContent offsets [start, end), or null when empty or out of bounds. */
export function rangeForOffsets(index: TextIndex, start: number, end: number): Range | null {
  if (index.nodes.length === 0 || start < 0 || end > index.length || end <= start) return null;
  let si = nodeAt(index, start);
  // A start at the very end of a node belongs at the beginning of the next one.
  while (si < index.nodes.length - 1 && start === index.starts[si]! + index.nodes[si]!.data.length) si++;
  const ei = nodeAt(index, end - 1);
  const range = (index.nodes[0]!.ownerDocument ?? document).createRange();
  range.setStart(index.nodes[si]!, start - index.starts[si]!);
  range.setEnd(index.nodes[ei]!, end - index.starts[ei]!);
  return range;
}

/** The text position under a viewport point, as (node, offset). */
export function caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
  const d = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof d.caretPositionFromPoint === "function") {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  if (typeof d.caretRangeFromPoint === "function") {
    const r = d.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}

/** Walks a block's text the way the server counts it: skip [data-atom], <br> is one character. */
function walkBlock(block: Element, visit: (node: Node, start: number, length: number) => boolean | void): number {
  const doc = block.ownerDocument;
  const walker = doc.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeType === 1 && (n as Element).hasAttribute("data-atom") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let acc = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const length = n.nodeType === 3 ? (n as Text).data.length : (n as Element).tagName === "BR" ? 1 : 0;
    if (visit(n, acc, length) === true) return acc;
    acc += length;
  }
  return acc;
}

/** Offset of (node, offset) within a block's text, per the coordinate rule. */
export function blockOffsetOf(block: Element, node: Node, offset: number): number {
  // A position given as (element, childIndex) means "just before that child".
  const target = node.nodeType === 3 ? node : (node.childNodes[offset] ?? null);
  let result: number | null = null;
  const total = walkBlock(block, (n, start) => {
    if (n === target) {
      result = node.nodeType === 3 ? start + offset : start;
      return true;
    }
    return false;
  });
  return result ?? total;
}

/** A one-character range at a block text offset (for measuring where that offset sits). */
export function rangeAtBlockOffset(block: Element, offset: number): Range | null {
  let found: Range | null = null;
  let last: Text | null = null;
  walkBlock(block, (n, start, length) => {
    if (n.nodeType !== 3 || length === 0) return false;
    last = n as Text;
    if (offset >= start && offset < start + length) {
      found = block.ownerDocument.createRange();
      found.setStart(n, offset - start);
      found.setEnd(n, offset - start + 1);
      return true;
    }
    return false;
  });
  if (found) return found;
  const tail = last as Text | null;
  if (!tail) return null;
  const r = block.ownerDocument.createRange();
  r.setStart(tail, Math.max(0, tail.data.length - 1));
  r.setEnd(tail, tail.data.length);
  return r;
}

/** Leaf [data-b] blocks (those not containing other blocks), in document order. */
export function leafBlocks(root: Element): Element[] {
  return Array.from(root.querySelectorAll("[data-b]")).filter((el) => !el.querySelector("[data-b]"));
}

export interface ReadingPoint {
  blockId: string;
  offset: number;
  /** Pixels between the top of the reading box and that text position (0 on a page), to put it back exactly. */
  delta: number;
}

const intersects = (r: DOMRect, box: DOMRect) =>
  r.right > box.left + 1 && r.left < box.right - 1 && r.bottom > box.top + 1 && r.top < box.bottom - 1;

/**
 * The reading place on a page: the first block with any part inside `box` (the visible page), and
 * the text offset at the page's top-left corner when the block began on an earlier page.
 */
export function readingPointInBox(root: Element, box: DOMRect): ReadingPoint | null {
  const block = leafBlocks(root).find((b) => intersects(b.getBoundingClientRect(), box));
  const blockId = block?.getAttribute("data-b");
  if (!block || !blockId) return null;
  const rect = block.getBoundingClientRect();
  if (rect.left >= box.left - 1) return { blockId, offset: 0, delta: 0 };
  const doc = block.ownerDocument;
  for (const dy of [4, 14, 28]) {
    const caret = caretAt(doc, box.left + 2, box.top + dy);
    if (caret && block.contains(caret.node)) return { blockId, offset: blockOffsetOf(block, caret.node, caret.offset), delta: 0 };
  }
  return { blockId, offset: 0, delta: 0 };
}

/**
 * The first of `count` blocks in vertical order whose bottom is below `lineY`, or -1. Binary search,
 * measuring only the blocks it visits; `rectAt(i)` gives block i's viewport rectangle. A hidden
 * block (an all-zero rectangle, like a hidden duplicate title) can mislead the search, so the
 * answer is then walked back over any earlier blocks still below the line.
 */
export function firstBlockAtLine(count: number, rectAt: (i: number) => { top: number; bottom: number }, lineY: number): number {
  const hidden = (r: { top: number; bottom: number }) => r.top === 0 && r.bottom === 0;
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rectAt(mid).bottom > lineY) hi = mid;
    else lo = mid + 1;
  }
  if (lo >= count) return -1;
  let found = lo;
  for (let k = lo - 1; k >= 0; k--) {
    const r = rectAt(k);
    if (hidden(r)) continue;
    if (r.bottom > lineY) found = k;
    else break;
  }
  return found;
}

/**
 * The reading place in a vertical scroll: the block crossing the reading line `lineY` (or the first
 * one below it), and the text offset on that line when the block began above it. `delta` is how far
 * below the box's top that text sits.
 */
export function readingPointAtLine(root: Element, box: DOMRect, lineY: number): ReadingPoint | null {
  const blocks = leafBlocks(root);
  const i = firstBlockAtLine(blocks.length, (k) => blocks[k]!.getBoundingClientRect(), lineY);
  const block = i >= 0 ? blocks[i]! : null;
  const blockId = block?.getAttribute("data-b");
  if (!block || !blockId) return null;
  const rect = block.getBoundingClientRect();
  if (rect.top >= lineY - 1) return { blockId, offset: 0, delta: rect.top - box.top };
  const caret = caretAt(block.ownerDocument, rect.left + 2, lineY);
  if (!caret || !block.contains(caret.node)) return { blockId, offset: 0, delta: rect.top - box.top };
  const offset = blockOffsetOf(block, caret.node, caret.offset);
  const top = rangeAtBlockOffset(block, offset)?.getBoundingClientRect().top ?? rect.top;
  return { blockId, offset, delta: top - box.top };
}

/** The rectangle of a block point's first character (or its block), or null when the block is gone. */
export function rectForPoint(root: Element, point: { blockId: string; offset: number }): DOMRect | null {
  const block = root.querySelector(`[data-b="${CSS.escape(point.blockId)}"]`);
  if (!block) return null;
  if (point.offset > 0) {
    const r = rangeAtBlockOffset(block, point.offset)?.getBoundingClientRect();
    if (r && (r.width || r.height)) return r;
  }
  return block.getBoundingClientRect();
}
