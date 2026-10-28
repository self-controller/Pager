import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ProgressUpdate, ReadingProgress, Section } from "@/api/types";
import { readingPointInBox, rectForPoint, type ReadingPoint } from "./dom";
import { offsetFromPage, pageFromOffset } from "./pagination";
import type { Pager } from "./usePagination";

const SAVE_DELAY_MS = 1000;

/** Finds an in-section jump target by element id or block id. */
export function findTarget(root: HTMLElement, id: string): HTMLElement | null {
  const esc = CSS.escape(id);
  return root.querySelector<HTMLElement>(`#${esc}`) ?? root.querySelector<HTMLElement>(`[data-b="${esc}"]`);
}

/** Turns to the page an element is on and moves focus there for screen readers. */
export function showTarget(target: HTMLElement, pager: Pager): void {
  pager.goTo(pager.pageOf(target));
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

/** The page holding a saved block point, or null when its block is gone. */
export function pageForPoint(root: Element, point: { blockId: string; offset: number }, pager: Pager): number | null {
  const rect = rectForPoint(root, point);
  if (!rect) return null;
  return pager.pageOf({ getBoundingClientRect: () => rect } as unknown as Element);
}

/**
 * Keeps the reader's place in page coordinates, three ways:
 *  - when a section opens: jump to `targetId` (a link into the section), else to the page asked for
 *    (arriving from the next or previous chapter), else resume at the saved block point (survives
 *    font changes and edits to the file), else at the saved offset;
 *  - while reading: save the page as an offset plus the block point at the page's top-left
 *    (debounced; flushed on section change, tab hide and unmount);
 *  - when the pages are laid out again (the file changed on disk, the box resized, the type changed):
 *    turn to the page that now holds the same words.
 */
export function useReadingProgress({
  section,
  sectionCount,
  initial,
  bodyRef,
  pager,
  save,
  targetId,
  arrivedByJump,
  initialPage,
}: {
  section: Section | undefined;
  sectionCount: number;
  initial: ReadingProgress | undefined;
  bodyRef: RefObject<HTMLElement | null>;
  pager: Pager;
  save: (update: ProgressUpdate) => void;
  /** Block or element id to open at (the URL hash), instead of the saved position. */
  targetId?: string;
  /** The section was reached through contents, a link or a deep link: saved with reason "jump". */
  arrivedByJump?: boolean;
  /** Asked for by a page turn across chapters: the first or the last page. */
  initialPage?: number | "last";
}): { offset: number; percent: number } {
  const latest = useRef({ initial, targetId, arrivedByJump, initialPage, save, revisionId: section?.revisionId, pager });
  latest.current = { initial, targetId, arrivedByJump, initialPage, save, revisionId: section?.revisionId, pager };
  const ready = useRef(false);
  const pending = useRef<ProgressUpdate | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const place = useRef<ReadingPoint | null>(null);
  const shown = useRef<{ sectionId?: string; html?: string; version?: number }>({});

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
  const { page, pageCount, version } = pager;
  const [offset, setOffset] = useState(0);

  /** Builds a progress update for the current page, remembering the words at its top-left. */
  const snapshot = useCallback(
    (o: number, reason: "read" | "jump" = "read"): ProgressUpdate | null => {
      if (!sectionId) return null;
      const el = bodyRef.current;
      const box = latest.current.pager.box();
      const point = el && box ? readingPointInBox(el, box) : null;
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
    const p = latest.current.pager;

    if (prev.sectionId === sectionId) {
      // Same section: the file changed, the box resized, or the type changed. Same words, new page.
      if ((prev.html !== html || prev.version !== version) && body && place.current) {
        const target = pageForPoint(body, place.current, p);
        if (target !== null) p.goTo(target);
      }
      shown.current = { sectionId, html, version };
      return;
    }

    ready.current = false;
    const { initial: saved, targetId: target, arrivedByJump: jump, initialPage: asked } = latest.current;
    const targetEl = body && target ? findTarget(body, target) : null;
    const resumes = saved?.sectionId === sectionId;
    let start = 0;
    if (body && targetEl) {
      showTarget(targetEl, p);
      start = p.pageOf(targetEl);
    } else if (asked !== undefined) {
      start = asked === "last" ? pageCount - 1 : asked;
    } else if (body && resumes && saved.point && saved.anchor !== "orphaned") {
      start = pageForPoint(body, saved.point, p) ?? pageFromOffset(saved.offset, pageCount);
    } else if (resumes) {
      start = pageFromOffset(saved.offset, pageCount);
    }
    p.goTo(start);
    const o = offsetFromPage(start, pageCount);
    setOffset(o);
    ready.current = true;
    const first = snapshot(o, jump || targetEl ? "jump" : "read");
    if (first) latest.current.save(first);
    shown.current = { sectionId, html, version };
  }, [sectionId, html, version, pageCount, bodyRef, snapshot]);

  // Leaving a section (or the page) saves what is pending.
  useEffect(() => {
    if (!sectionId) return;
    return () => {
      flush();
      ready.current = false;
    };
  }, [sectionId, flush]);

  // Track page turns.
  useEffect(() => {
    if (!sectionId || !ready.current) return;
    const o = offsetFromPage(page, pageCount);
    setOffset(o);
    pending.current = snapshot(o);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  }, [sectionId, page, pageCount, snapshot, flush]);

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

  return { offset, percent: sectionId ? (sectionIndex + offset) / count : 0 };
}
