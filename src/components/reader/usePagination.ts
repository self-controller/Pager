import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { clampPage, pageCountFor, pageForLeft, scrollLeftFor } from "./pagination";

export const PAGE_GAP = 64;
/** Dispatched on `window` whenever the visible page changes. Popovers and selections listen. */
export const PAGE_CHANGE_EVENT = "reader:pagechange";

export interface Pager {
  page: number;
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  gap: number;
  /** Counts layouts; 0 until the first measurement, so callers can wait for one. */
  version: number;
  goTo(page: number): void;
  /** False at the last page (the caller moves to the next section). */
  next(): boolean;
  /** False at the first page. */
  prev(): boolean;
  /** The page an element or range starts on. */
  pageOf(target: Element | Range): number;
  /** The visible page's rectangle in viewport coordinates. */
  box(): DOMRect | null;
  relayout(): void;
}

/**
 * Lays the section out in one-page-wide CSS columns inside `scrollerRef` and turns pages by
 * scrolling it. Re-measures when the box resizes, the content changes, fonts arrive or images load.
 */
export function usePagination(scrollerRef: RefObject<HTMLElement | null>, contentKey: string, deps: unknown[] = []): Pager {
  const [metrics, setMetrics] = useState({ key: "", pageWidth: 0, pageHeight: 0, pageCount: 1, version: 0 });
  const [page, setPage] = useState(0);
  const pageRef = useRef(0);
  const frame = useRef(0);
  const keyRef = useRef(contentKey);
  keyRef.current = contentKey;

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const pageWidth = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const pageHeight = el.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    const pageCount = pageCountFor(el.scrollWidth, pageWidth, PAGE_GAP);
    setMetrics((m) => ({ key: keyRef.current, pageWidth, pageHeight, pageCount, version: m.version + 1 }));
  }, [scrollerRef]);

  const relayout = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(measure);
  }, [measure]);

  // New content: start on its first page and measure it before paint (the old measurement is
  // reported as none until then, so callers wait for a real one).
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    pageRef.current = 0;
    setPage(0);
    if (el) el.scrollLeft = 0;
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

  // Show the page: scroll the column box. Also keep the page inside the new count after a relayout.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const clamped = clampPage(pageRef.current, metrics.pageCount);
    if (clamped !== pageRef.current) {
      pageRef.current = clamped;
      setPage(clamped);
    }
    el.scrollLeft = scrollLeftFor(clamped, metrics.pageWidth, PAGE_GAP);
  }, [scrollerRef, page, metrics]);

  const goTo = useCallback(
    (next: number) => {
      const el = scrollerRef.current;
      const count = el ? pageCountFor(el.scrollWidth, metrics.pageWidth || el.clientWidth, PAGE_GAP) : metrics.pageCount;
      const clamped = clampPage(next, count);
      if (clamped === pageRef.current) return;
      pageRef.current = clamped;
      setPage(clamped);
      window.dispatchEvent(new CustomEvent(PAGE_CHANGE_EVENT, { detail: { page: clamped } }));
    },
    [scrollerRef, metrics.pageCount],
  );

  const next = useCallback(() => {
    if (pageRef.current >= metrics.pageCount - 1) return false;
    goTo(pageRef.current + 1);
    return true;
  }, [goTo, metrics.pageCount]);

  const prev = useCallback(() => {
    if (pageRef.current <= 0) return false;
    goTo(pageRef.current - 1);
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
    (target: Element | Range): number => {
      const el = scrollerRef.current;
      if (!el) return 0;
      const rect = target.getBoundingClientRect();
      const width = metrics.pageWidth || el.clientWidth;
      const contentLeft = rect.left - el.getBoundingClientRect().left + el.scrollLeft;
      return clampPage(pageForLeft(contentLeft, width, PAGE_GAP), pageCountFor(el.scrollWidth, width, PAGE_GAP));
    },
    [scrollerRef, metrics.pageWidth],
  );

  const fresh = metrics.key === contentKey;
  return {
    page,
    pageCount: fresh ? metrics.pageCount : 1,
    pageWidth: metrics.pageWidth,
    pageHeight: metrics.pageHeight,
    gap: PAGE_GAP,
    version: fresh ? metrics.version : 0,
    goTo,
    next,
    prev,
    pageOf,
    box,
    relayout,
  };
}
