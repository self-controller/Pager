/**
 * DOM position ↔ block point, for UIs that want the robust `range` form of an AnchorInput.
 * Works on any DOM-like tree (browser, jsdom, happy-dom); imports nothing.
 *
 * The rule (API.md, "Coordinate rule"): a block's text is the text-node data inside its
 * `[data-b]` element in document order, skipping `[data-atom]` subtrees, with "\n" for each <br>.
 */

export interface DomNodeLike {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  parentNode: DomNodeLike | null;
  childNodes: ArrayLike<DomNodeLike>;
  getAttribute?(name: string): string | null;
  hasAttribute?(name: string): boolean;
}

const ELEMENT = 1;
const TEXT = 3;

const isEl = (n: DomNodeLike) => n.nodeType === ELEMENT;
const has = (n: DomNodeLike, a: string) => isEl(n) && !!n.hasAttribute?.(a);

/** The nearest `[data-b]` element containing `node` (or `node` itself). */
export function blockElementOf(node: DomNodeLike | null): DomNodeLike | null {
  for (let n = node; n; n = n.parentNode) if (has(n, "data-b")) return n;
  return null;
}

/** Convert a DOM boundary point (as in a Range or Selection) to `{ blockId, offset }`. */
export function pointFromDom(node: DomNodeLike, offset: number): { blockId: string; offset: number } | null {
  const block = blockElementOf(node);
  if (!block) return null;
  const blockId = block.getAttribute?.("data-b") ?? "";
  // A boundary inside an atom counts as the atom's start.
  for (let n: DomNodeLike | null = node; n && n !== block; n = n.parentNode) {
    if (has(n, "data-atom")) {
      const parent = n.parentNode!;
      offset = Array.prototype.indexOf.call(parent.childNodes, n);
      node = parent;
    }
  }
  let count = 0;
  let done = false;
  const walk = (n: DomNodeLike): void => {
    if (done) return;
    if (n === node && n.nodeType === TEXT) {
      count += Math.min(offset, (n.nodeValue ?? "").length);
      done = true;
      return;
    }
    if (n.nodeType === TEXT) {
      count += (n.nodeValue ?? "").length;
      return;
    }
    if (!isEl(n) || (n !== block && has(n, "data-atom"))) return;
    if (n.nodeName.toLowerCase() === "br") {
      count += 1;
      return;
    }
    const kids = n.childNodes;
    for (let i = 0; i < kids.length; i++) {
      if (n === node && i === offset) {
        done = true;
        return;
      }
      walk(kids[i]!);
      if (done) return;
    }
    if (n === node) done = true;
  };
  walk(block);
  return { blockId, offset: count };
}

/** Find the DOM boundary point for `offset` inside a `[data-b]` element. */
export function domFromPoint(block: DomNodeLike, offset: number): { node: DomNodeLike; offset: number } {
  let remaining = offset;
  let last: { node: DomNodeLike; offset: number } = { node: block, offset: 0 };
  let found: { node: DomNodeLike; offset: number } | null = null;
  const walk = (n: DomNodeLike): void => {
    if (found) return;
    if (n.nodeType === TEXT) {
      const len = (n.nodeValue ?? "").length;
      if (remaining <= len) {
        found = { node: n, offset: remaining };
        return;
      }
      remaining -= len;
      last = { node: n, offset: len };
      return;
    }
    if (!isEl(n) || (n !== block && has(n, "data-atom"))) return;
    if (n.nodeName.toLowerCase() === "br") {
      if (remaining === 0) {
        const parent = n.parentNode!;
        found = { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, n) };
        return;
      }
      remaining -= 1;
      const parent = n.parentNode!;
      last = { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, n) + 1 };
      return;
    }
    const kids = n.childNodes;
    for (let i = 0; i < kids.length; i++) walk(kids[i]!);
  };
  walk(block);
  return found ?? last;
}
