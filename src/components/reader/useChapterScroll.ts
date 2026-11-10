import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { readingPointAtLine } from "./dom";
import { dispatchReaderScroll } from "./events";
import { SCROLL_SETTLE_MS } from "./gestures";
import type { Measurable, ReaderLayout } from "./layout";
import { screenAt, screenCount, scrollOffset, scrollTopForOffset, scrollTopForScreen } from "./pagination";

/** The reading line sits this far below the top of the reading box: jumps land their words there. */
export const READ_LINE_PX = 20;
/** Without `scrollend`, the scroll counts as settled after this long without a scroll event. */
const IDLE_MS = 120;
/** A move made by code is told from a person's scrolling for this long. */
const OWN_SCROLL_MS = 100;

/** The scroll layout: one chapter, scrolled top to bottom. Its pages are screenfuls. */
export interface ChapterScroll extends ReaderLayout {
  readonly kind: "scroll";
  /** The reading box's height: the pane less what the bars cover. */
  viewHeight: number;
  /** Scrolls by `dy` px, as a person would (keys). */
  scrollBy(dy: number, smooth?: boolean): void;
  /**
   * Scrolls by `dy` px over `ms` (at once under reduced motion) as the app's own move, not a
   * person's: the bars stay as they are. Does nothing while a finger is on the chapter.
   */
  glideBy(dy: number, ms?: number): void;
  /** Scrolls to the top or the end of the chapter, as a person would (Home, End). */
  scrollToEdge(edge: "start" | "end", smooth?: boolean): void;
  atTop(): boolean;
}

const reducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const px = (v: string) => parseFloat(v) || 0;

/**
 * Lays one chapter out in `scrollerRef` (the live pane of ScrollView) and scrolls it vertically.
 * The pane's `scroll-padding` is what the overlaid bars cover: the reading box is the rest. Tells a
 * person's scrolling (`onScroll(top, max, true)`) from moves made by code, announces each scrolled
 * frame (READER_SCROLL_EVENT) for floating panels, and bumps `rest` each time the scroll settles
 * somewhere new. Re-measures when the pane or its content resizes, fonts arrive or images load.
 */
export function useChapterScroll(
  scrollerRef: RefObject<HTMLElement | null>,
  contentKey: string,
  deps: unknown[] = [],
  onScroll?: (top: number, max: number, user: boolean) => void,
): ChapterScroll {
  const [metrics, setMetrics] = useState({ key: "", viewHeight: 0, maxTop: 0, pageCount: 1, version: 0 });
  const [page, setPage] = useState(0);
  const [rest, setRest] = useState(0);
  const keyRef = useRef(contentKey);
  keyRef.current = contentKey;
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;
  const frame = useRef(0);
  /** A move made by code: scroll events landing on `top` before `until` are ours. */
  const own = useRef<{ top: number; until: number } | null>(null);
  const userScroll = useRef(0);
  const touching = useRef(false);
  const restTop = useRef(0);
  const glide = useRef(0);

  const pageAt = useCallback((top: number) => {
    const m = metricsRef.current;
    return screenAt(top, m.maxTop, m.viewHeight);
  }, []);

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const viewHeight = Math.max(1, el.clientHeight - px(cs.scrollPaddingTop) - px(cs.scrollPaddingBottom));
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const pageCount = screenCount(maxTop, viewHeight);
    setMetrics((m) => ({ key: keyRef.current, viewHeight, maxTop, pageCount, version: m.version + 1 }));
    setPage(screenAt(el.scrollTop, maxTop, viewHeight));
  }, [scrollerRef]);

  const relayout = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(measure);
  }, [measure]);

  /** Moves the scroll by code, so the move isn't taken for a person's. */
  const jump = useCallback(
    (top: number) => {
      const el = scrollerRef.current;
      if (!el) return;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      const t = Math.min(max, Math.max(0, top));
      if (Math.abs(el.scrollTop - t) >= 1) {
        own.current = { top: t, until: performance.now() + OWN_SCROLL_MS };
        el.scrollTop = t;
      }
      setPage(pageAt(t));
    },
    [scrollerRef, pageAt],
  );

  // New content: start at its top and measure it before paint (the old measurement is reported as
  // none until then, so callers wait for a real one).
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el) {
      own.current = null;
      if (el.scrollTop !== 0) {
        own.current = { top: 0, until: performance.now() + OWN_SCROLL_MS };
        el.scrollTop = 0;
      }
      restTop.current = 0;
    }
    setPage(0);
    measure();
    return () => cancelAnimationFrame(frame.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

  // The type changed: the same chapter is a new height.
  useLayoutEffect(() => {
    relayout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayout, ...deps]);

  // The pane or the chapter resized (window, tool panel, an image, the fonts).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(relayout);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
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

  // Follow the scroll: tell a person's from ours, announce each frame, and note where it rests.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const hasScrollEnd = "onscrollend" in window;
    let idle = 0;
    let announced = 0;
    const settle = () => {
      if (touching.current) return;
      const top = el.scrollTop;
      if (Math.abs(top - restTop.current) >= 1) {
        restTop.current = top;
        setRest((r) => r + 1);
      }
    };
    const onScrollEvent = () => {
      const now = performance.now();
      const top = el.scrollTop;
      const o = own.current;
      let user = true;
      if (o && now < o.until) {
        user = false;
        if (Math.abs(top - o.top) < 1) own.current = null;
      } else {
        own.current = null;
        userScroll.current = now;
      }
      onScrollRef.current?.(top, el.scrollHeight - el.clientHeight, user);
      if (!announced) {
        announced = requestAnimationFrame(() => {
          announced = 0;
          dispatchReaderScroll("scroll");
          setPage(pageAt(el.scrollTop));
        });
      }
      if (!hasScrollEnd) {
        window.clearTimeout(idle);
        idle = window.setTimeout(settle, IDLE_MS);
      }
    };
    const onTouchStart = () => {
      touching.current = true;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length > 0) return;
      touching.current = false;
      window.clearTimeout(idle);
      idle = window.setTimeout(settle, IDLE_MS);
    };
    el.addEventListener("scroll", onScrollEvent, { passive: true });
    el.addEventListener("scrollend", settle);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.clearTimeout(idle);
      cancelAnimationFrame(announced);
      el.removeEventListener("scroll", onScrollEvent);
      el.removeEventListener("scrollend", settle);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [scrollerRef, pageAt, contentKey]);

  /** The reading box: the text column's width, the pane's height less what the bars cover. */
  const box = useCallback((): DOMRect | null => {
    const el = scrollerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const column = el.querySelector("[data-chapter-text]")?.getBoundingClientRect() ?? r;
    const top = px(cs.scrollPaddingTop);
    const bottom = px(cs.scrollPaddingBottom);
    return new DOMRect(column.left, r.top + top, column.width, Math.max(0, r.height - top - bottom));
  }, [scrollerRef]);

  const maxTop = useCallback(() => {
    const el = scrollerRef.current;
    return el ? Math.max(0, el.scrollHeight - el.clientHeight) : 0;
  }, [scrollerRef]);

  const reveal = useCallback(
    (target: Measurable, options?: { at?: number }) => {
      const el = scrollerRef.current;
      const b = box();
      if (!el || !b) return;
      const at = options?.at ?? READ_LINE_PX;
      const top = el.scrollTop + target.getBoundingClientRect().top - (b.top + at);
      // Words near the top of the chapter are shown from the top, title and all.
      jump(top < 2 * READ_LINE_PX ? 0 : top);
    },
    [scrollerRef, box, jump],
  );

  const restore = useCallback(
    (target: Measurable, delta: number, options?: { force?: boolean }) => {
      // A fling or a finger on the glass wins over keeping the old words in place.
      if (!options?.force && (touching.current || performance.now() - userScroll.current < SCROLL_SETTLE_MS)) return;
      reveal(target, { at: delta });
    },
    [reveal],
  );

  const pageOf = useCallback(
    (target: Measurable): number => {
      const el = scrollerRef.current;
      const b = box();
      if (!el || !b) return 0;
      const m = metricsRef.current;
      const top = el.scrollTop + target.getBoundingClientRect().top - b.top - READ_LINE_PX;
      return screenAt(Math.min(m.maxTop, Math.max(0, top)), m.maxTop, m.viewHeight);
    },
    [scrollerRef, box],
  );

  const inView = useCallback(
    (target: Measurable) => {
      const b = box();
      if (!b) return false;
      const r = target.getBoundingClientRect();
      return r.bottom > b.top && r.top < b.bottom;
    },
    [box],
  );

  const readingPoint = useCallback(
    (root: Element) => {
      const el = scrollerRef.current;
      const b = box();
      // At the top of the chapter the place is simply its start.
      if (!el || !b || el.scrollTop <= 2 * READ_LINE_PX) return null;
      return readingPointAtLine(root, b, b.top + READ_LINE_PX + 4);
    },
    [scrollerRef, box],
  );

  const offset = useCallback(() => scrollOffset(scrollerRef.current?.scrollTop ?? 0, maxTop()), [scrollerRef, maxTop]);
  const goTo = useCallback((p: number) => jump(scrollTopForScreen(p, maxTop(), metricsRef.current.viewHeight)), [jump, maxTop]);
  const goToOffset = useCallback((o: number) => jump(scrollTopForOffset(o, maxTop())), [jump, maxTop]);
  const toStart = useCallback(() => jump(0), [jump]);
  const toEnd = useCallback(() => jump(maxTop()), [jump, maxTop]);

  const scrollBy = useCallback(
    (dy: number, smooth = true) => {
      scrollerRef.current?.scrollBy({ top: dy, behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
    },
    [scrollerRef],
  );
  const scrollToEdge = useCallback(
    (edge: "start" | "end", smooth = true) => {
      scrollerRef.current?.scrollTo({
        top: edge === "start" ? 0 : maxTop(),
        behavior: smooth && !reducedMotion() ? "smooth" : "auto",
      });
    },
    [scrollerRef, maxTop],
  );
  const glideBy = useCallback(
    (dy: number, ms = 320) => {
      const el = scrollerRef.current;
      // Never while a finger is down: in the iPhone app a scroll set from script fights the system's.
      if (!el || touching.current) return;
      cancelAnimationFrame(glide.current);
      const from = el.scrollTop;
      const to = Math.min(Math.max(0, el.scrollHeight - el.clientHeight), Math.max(0, from + dy));
      if (Math.abs(to - from) < 1) return;
      if (ms <= 0 || reducedMotion()) {
        jump(to);
        return;
      }
      const t0 = performance.now();
      const step = () => {
        if (touching.current) return;
        const t = Math.min(1, (performance.now() - t0) / ms);
        const top = from + (to - from) * (1 - (1 - t) ** 3);
        // Each frame is marked as ours, so the bars don't take it for the person scrolling.
        own.current = { top, until: performance.now() + OWN_SCROLL_MS };
        el.scrollTop = top;
        if (t < 1) glide.current = requestAnimationFrame(step);
      };
      glide.current = requestAnimationFrame(step);
    },
    [scrollerRef, jump],
  );
  useEffect(() => () => cancelAnimationFrame(glide.current), [contentKey]);
  const atTop = useCallback(() => (scrollerRef.current?.scrollTop ?? 0) <= 0, [scrollerRef]);
  const userScrolledAt = useCallback(() => userScroll.current, []);

  const fresh = metrics.key === contentKey && contentKey !== "";
  return {
    kind: "scroll",
    page: fresh ? page : 0,
    pageCount: fresh ? metrics.pageCount : 1,
    version: fresh ? metrics.version : 0,
    rest,
    viewHeight: metrics.viewHeight,
    offset,
    goTo,
    goToOffset,
    toStart,
    toEnd,
    reveal,
    restore,
    inView,
    pageOf,
    readingPoint,
    box,
    relayout,
    userScrolledAt,
    scrollBy,
    glideBy,
    scrollToEdge,
    atTop,
  };
}
