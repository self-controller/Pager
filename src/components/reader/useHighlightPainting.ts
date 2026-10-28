import { useLayoutEffect, type RefObject } from "react";
import type { Annotation, HighlightColor } from "@/api/types";
import { indexText, rangeForOffsets } from "./dom";

export const HIGHLIGHT_COLORS: HighlightColor[] = ["yellow", "green", "blue", "pink", "purple"];

/** Registry names styled in prose.css with ::highlight(). */
export function highlightName(a: Pick<Annotation, "color" | "style">): string | null {
  if (a.style === "none") return null;
  const color = a.color ?? "yellow";
  return a.style === "underline" ? `reader-underline-${color}` : `reader-${color}`;
}

export function highlightsSupported(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

/**
 * Paints this section's annotations with the CSS Custom Highlight API: no wrapping elements, so
 * the section's text (and every offset into it) stays exactly as the server sent it. The active
 * annotation (open in the popover) gets its own, stronger highlight on top.
 */
export function useHighlightPainting(
  bodyRef: RefObject<HTMLElement | null>,
  sectionId: string | undefined,
  html: string | undefined,
  annotations: Annotation[] | undefined,
  activeId: string | null,
): void {
  useLayoutEffect(() => {
    const root = bodyRef.current;
    if (!root || !sectionId || !annotations?.length || !highlightsSupported()) return;
    const index = indexText(root);
    const groups = new Map<string, Range[]>();
    const add = (name: string, range: Range) => groups.set(name, [...(groups.get(name) ?? []), range]);

    for (const a of annotations) {
      for (const seg of a.anchor.segments) {
        if (seg.sectionId !== sectionId) continue;
        const range = rangeForOffsets(index, seg.start, seg.end);
        if (!range) continue;
        const name = a.id === activeId ? "reader-active" : highlightName(a);
        if (name) add(name, range);
        if (a.anchor.status === "fuzzy") add("reader-fuzzy", range.cloneRange());
      }
    }

    for (const [name, ranges] of groups) {
      const h = new Highlight(...ranges);
      if (name === "reader-active") h.priority = 2;
      if (name === "reader-fuzzy") h.priority = 1;
      CSS.highlights.set(name, h);
    }
    return () => {
      for (const name of groups.keys()) CSS.highlights.delete(name);
    };
  }, [bodyRef, sectionId, html, annotations, activeId]);
}

/** Annotations whose painted segments in this section contain the given section offset. */
export function annotationsAt(annotations: Annotation[] | undefined, sectionId: string, offset: number): Annotation[] {
  return (annotations ?? []).filter((a) =>
    a.anchor.segments.some((s) => s.sectionId === sectionId && offset >= s.start && offset < s.end),
  );
}
