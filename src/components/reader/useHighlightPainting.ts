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

/** One rendered section to paint: the live one, or a neighbour peeking in during a chapter turn. */
export interface PaintSurface {
  ref: RefObject<HTMLElement | null>;
  sectionId: string | undefined;
  html: string | undefined;
}

/**
 * Paints the annotations of the sections on screen with the CSS Custom Highlight API: no wrapping
 * elements, so each section's text (and every offset into it) stays exactly as the server sent it.
 * `live` is the open section; `peeks` are the neighbours the scroll layout keeps beside it, painted
 * too so their highlights don't pop in when a turn lands. The active annotation (open in the popover)
 * gets its own, stronger highlight on top. `surfaceKey` names the layout: switching it renders the
 * text afresh, which needs painting again.
 */
export function useHighlightPainting(
  live: PaintSurface,
  peeks: readonly [PaintSurface?, PaintSurface?],
  annotations: Annotation[] | undefined,
  activeId: string | null,
  surfaceKey = "",
): void {
  const [a, b] = peeks;
  useLayoutEffect(() => {
    if (!annotations?.length || !highlightsSupported()) return;
    const groups = new Map<string, Range[]>();
    const add = (name: string, range: Range) => groups.set(name, [...(groups.get(name) ?? []), range]);

    for (const surface of [live, a, b]) {
      const root = surface?.ref.current;
      if (!surface || !root || !surface.sectionId) continue;
      const index = indexText(root);
      for (const ann of annotations) {
        for (const seg of ann.anchor.segments) {
          if (seg.sectionId !== surface.sectionId) continue;
          const range = rangeForOffsets(index, seg.start, seg.end);
          if (!range) continue;
          const name = surface === live && ann.id === activeId ? "reader-active" : highlightName(ann);
          if (name) add(name, range);
          if (ann.anchor.status === "fuzzy") add("reader-fuzzy", range.cloneRange());
        }
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
    // The surfaces are listed by their parts: a new object each render must not repaint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    live.ref,
    live.sectionId,
    live.html,
    a?.ref,
    a?.sectionId,
    a?.html,
    b?.ref,
    b?.sectionId,
    b?.html,
    annotations,
    activeId,
    surfaceKey,
  ]);
}

/** Annotations whose painted segments in this section contain the given section offset. */
export function annotationsAt(annotations: Annotation[] | undefined, sectionId: string, offset: number): Annotation[] {
  return (annotations ?? []).filter((a) =>
    a.anchor.segments.some((s) => s.sectionId === sectionId && offset >= s.start && offset < s.end),
  );
}
