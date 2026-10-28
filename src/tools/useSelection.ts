import { useEffect, useState, type RefObject } from "react";
import type { TextSelection } from "./types";

/** Character offset of (node, offset) within root's textContent. */
export function textOffsetWithin(root: Node, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** Converts the current DOM selection into a TextSelection if it lies inside `root`. */
export function readSelection(root: HTMLElement, sectionId: string): TextSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const text = range.toString();
  if (!text.trim()) return null;
  const start = textOffsetWithin(root, range.startContainer, range.startOffset);
  const end = textOffsetWithin(root, range.endContainer, range.endOffset);
  const r = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
  return {
    text,
    sectionId,
    start,
    end,
    rect: r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null,
  };
}

/** Tracks the user's text selection inside the reader body. */
export function useSelection(rootRef: RefObject<HTMLElement | null>, sectionId: string | undefined): TextSelection | null {
  const [selection, setSelection] = useState<TextSelection | null>(null);

  useEffect(() => {
    if (!sectionId) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = rootRef.current;
        setSelection(root ? readSelection(root, sectionId) : null);
      });
    };
    document.addEventListener("selectionchange", update);
    window.addEventListener("reader:pagechange", update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("reader:pagechange", update);
      window.removeEventListener("resize", update);
    };
  }, [rootRef, sectionId]);

  return selection;
}
