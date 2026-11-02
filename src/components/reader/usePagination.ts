import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { PageTurn } from "@/state/settings";
import { SCROLL_SETTLE_MS, turnMotion } from "./gestures";
import { readingPointInBox } from "./dom";
import { PAGE_CHANGE_EVENT } from "./events";
import type { Measurable, ReaderLayout } from "./layout";
import { clampPage, offsetFromPage, pageAtScroll, pageCountFor, pageForLeft, pageFromOffset, scrollLeftFor } from "./pagination";

export { PAGE_CHANGE_EVENT };
export const PAGE_GAP = 64;

/** A Fade turn fades the new page in over this long. */
const FADE_MS = 150;
/** Without `scrollend`, the pages count as settled after this long without a scroll event. */
const IDLE_MS = 120;
/** A glide made by code that hasn't landed by now is over. */
const GLIDE_TIMEOUT_MS = 1000;

/** The paged layout. Its `page` is the page on screen; after a sliding turn it changes when the slide lands. */
export interface Pager extends ReaderLayout {
  readonly kind: "paged";
  pageWidth: number;
  pageHeight: number;
  gap: number;
  /** Shows a page at once, or with the page-turn motion when `animate` is set. */
  goTo(page: number, options?: { animate?: boolean }): void;
  /** Turns forward with the page-turn motion. False at the last page (the caller moves to the next section). */
  next(): boolean;
  /** Turns back with the page-turn motion. False at the first page. */
  prev(): boolean;
  /** The page an element or range starts on. */
  pageOf(target: Measurable): number;
}

const reducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Lays the section out in one-page-wide CSS columns inside `scrollerRef` and turns pages by
 * scrolling it. The scroller snaps to one page at a time, so a swipe gets the platform's own momentum
 * and snapping; the page shown follows wherever the scroll settles. Taps and keys turn with
 * `turn` (slide, fade or a cut). Re-measures when the box resizes, the content changes, fonts arrive
 * or images load.
 */
export function usePagination(
  scrollerRef: RefObject<HTMLElement | null>,
  contentKey: string,
  deps: unknown[] = [],
  turn: PageTurn = "slide",
): Pager {
  const [metrics, setMetrics] = useState({ key: "", pageWidth: 0, pageHeight: 0, pageCount: 1, version: 0 });
  const [page, setPage] = useState(0);
  /** Where the pages are headed: the page shown, or the target of a turn still sliding. */
  const pageRef = useRef(0);
  /** The page committed to state. */
  const shownRef = useRef(0);
  const frame = useRef(0);
  const keyRef = useRef(contentKey);
  keyRef.current = contentKey;
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const turnRef = useRef(turn);
  turnRef.current = turn;
  /** A scroll made by code: until `until`, scroll events on the way to `left` aren't a person's. */
  const glide = useRef<{ left: number; until: number } | null>(null);
  const glideTimer = useRef<number | undefined>(undefined);
  const userScroll = useRef(0);
  const touching = useRef(false);

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const pageWidth = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const pageHeight = el.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    // The columns' own width: the scroller's also spans the snap markers, which trail a relayout.
    const columns = el.querySelector<HTMLElement>("[data-columns]") ?? el;
    // Content already there on the first measurement (switching from the scroll layout) isn't in
    // columns yet: give them their width now, as the next render will, so the count is right.
    if (columns !== el && pageWidth > 0 && !columns.style.columnWidth) {
      columns.style.columnWidth = `${pageWidth}px`;
      columns.style.columnGap = `${PAGE_GAP}px`;
    }
    const pageCount = pageCountFor(columns.scrollWidth, pageWidth, PAGE_GAP);
    setMetrics((m) => ({ key: keyRef.current, pageWidth, pageHeight, pageCount, version: m.version + 1 }));
  }, [scrollerRef]);

  const relayout = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(measure);
  }, [measure]);

  const commit = useCallback((p: number) => {
    if (p === shownRef.current) return;
    shownRef.current = p;
    setPage(p);
  }, []);

  /** Moves the scroller by code, remembering it so the move isn't taken for a person's scroll. */
  const jump = useCallback((el: HTMLElement, left: number) => {
    glide.current = { left, until: performance.now() + 100 };
    el.scrollLeft = left;
  }, []);

  /** Where the scroll came to rest is the page shown; a swipe's new page is announced here. */
  const settle = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || touching.current) return;
    const g = glide.current;
    if (g && performance.now() < g.until && Math.abs(el.scrollLeft - g.left) >= 1) return;
    glide.current = null;
    window.clearTimeout(glideTimer.current);
    const { pageWidth, pageCount } = metricsRef.current;
    if (pageWidth <= 0) return;
    const p = pageAtScroll(el.scrollLeft, pageWidth, PAGE_GAP, pageCount);
    if (p !== pageRef.current) {
      pageRef.current = p;
      window.dispatchEvent(new CustomEvent(PAGE_CHANGE_EVENT, { detail: { page: p } }));
    }
    commit(p);
  }, [scrollerRef, commit]);

  // New content: start on its first page and measure it before paint (the old measurement is
  // reported as none until then, so callers wait for a real one).
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    pageRef.current = 0;
    shownRef.current = 0;
    setPage(0);
    if (el) jump(el, 0);
    measure();
    return () => cancelAnimationFrame(frame.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

  // The type changed: the same content needs new pages.
  useLayoutEffect(() => {
    relayout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayout, ...deps]);

  // The box resized (window, tool panel, banner), fonts arrived, an image loaded.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(relayout);
    ro.observe(el);
    const onLoad = (e: Event) => {
      if ((e.target as Element | null)?.tagName === "IMG") relayout();
    };
    el.addEventListener("load", onLoad, true);
    void document.fonts?.ready.then(relayout);
    return () => {
      ro.disconnect();
      el.removeEventListener("load", onLoad, true);
    };
  }, [scrollerRef, relayout, contentKey]);

  // Follow the scroll: tell a person's scrolling from ours, and settle on the page it rests at.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const hasScrollEnd = "onscrollend" in window;
    let idle = 0;
    const settleSoon = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(settle, IDLE_MS);
    };
    const onScroll = () => {
      const g = glide.current;
      const now = performance.now();
      if (g && now < g.until) {
        if (Math.abs(el.scrollLeft - g.left) < 1) glide.current = null;
      } else {
        glide.current = null;
        userScroll.current = now;
      }
      if (!hasScrollEnd) settleSoon();
    };
    const onTouchStart = () => {
      touching.current = true;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length > 0) return;
      touching.current = false;
      settleSoon();
    };
    // The browser took the touch over for panning: from here the scrolling is the person's.
    const onCancel = () => {
      glide.current = null;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("scrollend", settle);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    el.addEventListener("pointercancel", onCancel);
    return () => {
      window.clearTimeout(idle);
      window.clearTimeout(glideTimer.current);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("scrollend", settle);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("pointercancel", onCancel);
    };
  }, [scrollerRef, settle, contentKey]);

  // After a relayout, keep the page in place and inside the new count; a swipe in progress settles itself.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const clamped = clampPage(pageRef.current, metrics.pageCount);
    pageRef.current = clamped;
    if (touching.current || performance.now() - userScroll.current < SCROLL_SETTLE_MS) return;
    const left = scrollLeftFor(clamped, metrics.pageWidth, PAGE_GAP);
    if (Math.abs(el.scrollLeft - left) >= 1) jump(el, left);
    commit(clamped);
  }, [scrollerRef, metrics, jump, commit]);

  const goTo = useCallback(
    (next: number, options?: { animate?: boolean }) => {
      const el = scrollerRef.current;
      const width = metricsRef.current.pageWidth || el?.clientWidth || 0;
      const count = el ? pageCountFor(el.scrollWidth, width, PAGE_GAP) : metricsRef.current.pageCount;
      const clamped = clampPage(next, count);
      if (clamped === pageRef.current) return;
      pageRef.current = clamped;
      window.dispatchEvent(new CustomEvent(PAGE_CHANGE_EVENT, { detail: { page: clamped } }));
      if (!el) return commit(clamped);
      const left = scrollLeftFor(clamped, width, PAGE_GAP);
      const motion = options?.animate ? turnMotion(turnRef.current, reducedMotion()) : "none";
      if (motion === "slide" && typeof el.scrollTo === "function" && Math.abs(el.scrollLeft - left) >= 1) {
        // Slide: the browser glides there and the snap lands it; the page commits when it settles.
        glide.current = { left, until: performance.now() + GLIDE_TIMEOUT_MS };
        window.clearTimeout(glideTimer.current);
        glideTimer.current = window.setTimeout(settle, GLIDE_TIMEOUT_MS);
        el.scrollTo({ left, behavior: "smooth" });
        return;
      }
      jump(el, left);
      commit(clamped);
      if (motion === "fade" && typeof el.animate === "function") {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-out" });
      }
    },
    [scrollerRef, jump, commit, settle],
  );

  const next = useCallback(() => {
    if (pageRef.current >= metrics.pageCount - 1) return false;
    goTo(pageRef.current + 1, { animate: true });
    return true;
  }, [goTo, metrics.pageCount]);

  const prev = useCallback(() => {
    if (pageRef.current <= 0) return false;
    goTo(pageRef.current - 1, { animate: true });
    return true;
  }, [goTo]);

  /** The visible page's content box (inside the scroller's padding). */
  const box = useCallback((): DOMRect | null => {
    const el = scrollerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const top = parseFloat(cs.paddingTop) || 0;
    const bottom = parseFloat(cs.paddingBottom) || 0;
    const left = parseFloat(cs.paddingLeft) || 0;
    const right = parseFloat(cs.paddingRight) || 0;
    return new DOMRect(r.left + left, r.top + top, Math.max(0, r.width - left - right), Math.max(0, r.height - top - bottom));
  }, [scrollerRef]);

  const pageOf = useCallback(
    (target: Measurable): number => {
      const el = scrollerRef.current;
      if (!el) return 0;
      const rect = target.getBoundingClientRect();
      const width = metrics.pageWidth || el.clientWidth;
      const contentLeft = rect.left - el.getBoundingClientRect().left + el.scrollLeft;
      return clampPage(pageForLeft(contentLeft, width, PAGE_GAP), pageCountFor(el.scrollWidth, width, PAGE_GAP));
    },
    [scrollerRef, metrics.pageWidth],
  );

  const userScrolledAt = useCallback(() => userScroll.current, []);

  // The shared layout calls, each one of the page calls above.
  const offset = useCallback(() => offsetFromPage(pageRef.current, metricsRef.current.pageCount), []);
  const goToOffset = useCallback((o: number) => goTo(pageFromOffset(o, metricsRef.current.pageCount)), [goTo]);
  const toStart = useCallback(() => goTo(0), [goTo]);
  const toEnd = useCallback(() => goTo(metricsRef.current.pageCount - 1), [goTo]);
  const reveal = useCallback((target: Measurable) => goTo(pageOf(target)), [goTo, pageOf]);
  const restore = useCallback((target: Measurable) => goTo(pageOf(target)), [goTo, pageOf]);
  const inView = useCallback((target: Measurable) => pageOf(target) === shownRef.current, [pageOf]);
  const readingPoint = useCallback(
    (root: Element) => {
      const b = box();
      return b ? readingPointInBox(root, b) : null;
    },
    [box],
  );

  const fresh = metrics.key === contentKey;
  return {
    kind: "paged",
    page,
    rest: page,
    pageCount: fresh ? metrics.pageCount : 1,
    pageWidth: metrics.pageWidth,
    pageHeight: metrics.pageHeight,
    gap: PAGE_GAP,
    version: fresh ? metrics.version : 0,
    offset,
    goTo,
    goToOffset,
    toStart,
    toEnd,
    reveal,
    restore,
    inView,
    next,
    prev,
    pageOf,
    readingPoint,
    box,
    relayout,
    userScrolledAt,
  };
}
