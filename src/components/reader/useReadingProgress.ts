import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ProgressUpdate, ReadingProgress, Section } from "@/api/types";
import { rectForPoint, type ReadingPoint } from "./dom";
import { layoutStamp, measurable, placeAtPoint, type ReaderLayout } from "./layout";

const SAVE_DELAY_MS = 1000;

/** Finds an in-section jump target by element id or block id. */
export function findTarget(root: HTMLElement, id: string): HTMLElement | null {
  const esc = CSS.escape(id);
  return root.querySelector<HTMLElement>(`#${esc}`) ?? root.querySelector<HTMLElement>(`[data-b="${esc}"]`);
}

/** How long the landing wash lasts (prose.css `.is-landing`: held for 2 s, faded over 1 s). */
export const LANDING_MS = 3000;

/**
 * Washes the block a jump landed on in the accent for a moment, so the eye finds it. Only a class
 * on the existing element: the text and the DOM, and so every offset, stay as they are.
 */
export function flashLanding(el: Element | null): void {
  if (!el) return;
  el.classList.remove("is-landing");
  void (el as HTMLElement).offsetWidth; // restart the animation when the same block is hit again
  el.classList.add("is-landing");
  let timer = 0;
  const done = (e?: Event) => {
    if (e && e.target !== el) return;
    window.clearTimeout(timer);
    el.removeEventListener("animationend", done);
    el.classList.remove("is-landing");
  };
  el.addEventListener("animationend", done);
  // Reduced motion has no animation to end: the still wash comes off after the same time.
  timer = window.setTimeout(done, LANDING_MS + 100);
}

/** Brings an element into view (its page, or scrolled to it), marks it, and moves focus there for screen readers. */
export function showTarget(target: HTMLElement, layout: ReaderLayout): void {
  layout.reveal(target);
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  flashLanding(target);
}

/** The page holding a saved block point, or null when its block is gone. */
export function pageForPoint(root: Element, point: { blockId: string; offset: number }, layout: ReaderLayout): number | null {
  const rect = rectForPoint(root, point);
  if (!rect) return null;
  return layout.pageOf(measurable(rect));
}

/**
 * Keeps the reader's place, in either layout, three ways:
 *  - when a section opens: jump to `targetId` (a link into the section), else to `initialPoint` (the
 *    back pill's place, flashed), else to the page asked for (arriving from the next or previous
 *    chapter: its start, or its end), else resume at the saved block point (survives font changes
 *    and edits to the file), else at the saved offset;
 *  - while reading: each time the view comes to rest, save its offset plus the block point at the
 *    reading place (debounced; flushed on section change, tab hide and unmount);
 *  - when the section is laid out again (the file changed on disk, the box resized, the type
 *    changed, the other layout chosen): bring the same words back into view.
 */
export function useReadingProgress({
  section,
  sectionCount,
  initial,
  bodyRef,
  layout,
  save,
  targetId,
  arrivedByJump,
  initialPage,
  initialPoint,
}: {
  section: Section | undefined;
  sectionCount: number;
  initial: ReadingProgress | undefined;
  bodyRef: RefObject<HTMLElement | null>;
  layout: ReaderLayout;
  save: (update: ProgressUpdate) => void;
  /** Block or element id to open at (the URL hash), instead of the saved position. */
  targetId?: string;
  /** The section was reached through contents, a link or a deep link: saved with reason "jump". */
  arrivedByJump?: boolean;
  /** Asked for by a page turn across chapters: the first or the last page. */
  initialPage?: number | "last";
  /** A block point to open at (the back pill going to another chapter); `initialPage` if it's gone. */
  initialPoint?: { blockId: string; offset: number };
}): { offset: number; percent: number; placed: boolean } {
  const latest = useRef({
    initial,
    targetId,
    arrivedByJump,
    initialPage,
    initialPoint,
    save,
    revisionId: section?.revisionId,
    layout,
  });
  latest.current = { initial, targetId, arrivedByJump, initialPage, initialPoint, save, revisionId: section?.revisionId, layout };
  const ready = useRef(false);
  const pending = useRef<ProgressUpdate | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const place = useRef<ReadingPoint | null>(null);
  const shown = useRef<{ sectionId?: string; html?: string; stamp?: string; kind?: string }>({});

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (pending.current) {
      latest.current.save(pending.current);
      pending.current = null;
    }
  }, []);

  const sectionId = section?.id;
  const sectionIndex = section?.index ?? 0;
  const html = section?.html;
  const count = Math.max(1, sectionCount);
  const { rest, pageCount, version } = layout;
  const stamp = layoutStamp(layout);
  const [offset, setOffset] = useState(0);
  /** The section last put on its page; positions seen before that are the loading's, not the reader's. */
  const [placedId, setPlacedId] = useState<string | null>(null);

  /** Builds a progress update for where the view is, remembering the words at the reading place. */
  const snapshot = useCallback(
    (o: number, reason: "read" | "jump" = "read"): ProgressUpdate | null => {
      if (!sectionId) return null;
      const el = bodyRef.current;
      const point = el ? latest.current.layout.readingPoint(el) : null;
      place.current = point;
      const revisionId = latest.current.revisionId;
      return {
        sectionId,
        offset: o,
        percent: (sectionIndex + o) / count,
        ...(point ? { point: { blockId: point.blockId, offset: point.offset } } : {}),
        ...(point && revisionId ? { revisionId } : {}),
        ...(reason === "jump" ? { reason } : {}),
      };
    },
    [sectionId, sectionIndex, count, bodyRef],
  );

  // Placement: on open, after the first layout; on relayout, keep the same words in view.
  useLayoutEffect(() => {
    if (!sectionId || version === 0) return;
    const prev = shown.current;
    const body = bodyRef.current;
    const p = latest.current.layout;

    if (prev.sectionId === sectionId) {
      // Same section: the file changed, the box resized, the type or the layout changed. Same words.
      if ((prev.html !== html || prev.stamp !== stamp) && body && place.current) {
        const rect = rectForPoint(body, place.current);
        if (rect) p.restore(measurable(rect), place.current.delta, { force: prev.html !== html || prev.kind !== p.kind });
      }
      shown.current = { sectionId, html, stamp, kind: p.kind };
      return;
    }

    ready.current = false;
    const { initial: saved, targetId: target, arrivedByJump: jump, initialPage: asked, initialPoint: point } = latest.current;
    const targetEl = body && target ? findTarget(body, target) : null;
    const resumes = saved?.sectionId === sectionId;
    if (body && targetEl) {
      showTarget(targetEl, p);
    } else if (body && point && placeAtPoint(body, point, p)) {
      flashLanding(body.querySelector(`[data-b="${CSS.escape(point.blockId)}"]`));
    } else if (asked !== undefined) {
      if (asked === "last") p.toEnd();
      else p.goTo(asked);
    } else if (body && resumes && saved.point && saved.anchor !== "orphaned" && placeAtPoint(body, saved.point, p)) {
      // Back at the saved words.
    } else if (resumes) {
      p.goToOffset(saved.offset);
    } else {
      p.goTo(0);
    }
    const o = p.offset();
    setOffset(o);
    setPlacedId(sectionId);
    ready.current = true;
    const first = snapshot(o, jump || targetEl ? "jump" : "read");
    if (first) latest.current.save(first);
    shown.current = { sectionId, html, stamp, kind: p.kind };
  }, [sectionId, html, version, stamp, bodyRef, snapshot]);

  // Leaving a section (or the page) saves what is pending.
  useEffect(() => {
    if (!sectionId) return;
    return () => {
      flush();
      ready.current = false;
    };
  }, [sectionId, flush]);

  // Track where the view comes to rest: page turns, or the scroll settling. A layout that hasn't
  // been placed yet (just measured, or just switched to) has nothing to say about the place.
  useEffect(() => {
    if (!sectionId || !ready.current || shown.current.stamp !== stamp) return;
    const o = latest.current.layout.offset();
    setOffset(o);
    pending.current = snapshot(o);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  }, [sectionId, rest, pageCount, stamp, snapshot, flush]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);

  return {
    offset,
    percent: sectionId ? (sectionIndex + offset) / count : 0,
    placed: Boolean(sectionId) && placedId === sectionId,
  };
}
