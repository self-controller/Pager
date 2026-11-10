import { useCallback, useEffect, useInsertionEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { isTabSwitch } from "@/components/shell/tabMemory";
import type { LayoutKind } from "./layout";
import { chromeStep, holdChrome, initialChromeScroll } from "./scrollChrome";

/** Touch screens open a book with the chrome hidden, as Apple Books does; a mouse never starts without it. */
function startsVisible(): boolean {
  return !window.matchMedia?.("(pointer: coarse)").matches;
}

/**
 * Whether the reader's chrome (its top bar and, on phones, the tab bar) shows. On a touch screen a
 * book opens without it and a tap in the middle of the page brings it; touch taps and swipes on the
 * page hide it (PagedView); a mouse or the Tab key brings it back, so neither is ever left without it. While hidden, <html data-reader-chrome="hidden"> lets the tab
 * bar, which lives outside the reader, hide too (globals.css). Cleared when the reader closes.
 * <html data-reader-layout> names the layout, so the shell can let a scrolling chapter run under
 * the tab bar. A book reopened by a tap on the iPhone app's tab bar (tabMemory.ts) starts with its
 * chrome showing, so the bar just tapped doesn't vanish under the finger.
 */
export function useReaderChrome(docId: string | undefined, layout: LayoutKind = "paged"): [boolean, (visible: boolean) => void] {
  const tabSwitch = isTabSwitch(useLocation().state);
  const [visible, setVisible] = useState(() => tabSwitch || startsVisible());

  // Another book opens as the first did. Set while rendering, so its first frame is already right.
  const [openedId, setOpenedId] = useState(docId);
  if (openedId !== docId) {
    setOpenedId(docId);
    setVisible(tabSwitch || startsVisible());
  }

  // Both marks go on as the reader's elements go into the page, before any layout effect runs: one
  // that measures (useChapterScroll) would otherwise style the top bar as shown, and the bar would
  // then slide away in the first frames. So the reader's first frame is its final state, and the
  // shell's layout effects (useNativeTabs) read the marks as they will stay.
  useInsertionEffect(() => {
    const root = document.documentElement;
    root.dataset.readerLayout = layout;
    return () => {
      delete root.dataset.readerLayout;
    };
  }, [layout]);

  useInsertionEffect(() => {
    if (visible) return;
    const root = document.documentElement;
    root.dataset.readerChrome = "hidden";
    return () => {
      delete root.dataset.readerChrome;
    };
  }, [visible]);

  useEffect(() => {
    if (visible) return;
    const onPointer = (e: PointerEvent) => {
      // A wheel scroll can come with a pointermove that didn't move: that's no reason to show.
      if (e.pointerType === "mouse" && (e.type === "pointerdown" || e.movementX || e.movementY)) setVisible(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") setVisible(true);
    };
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [visible]);

  return [visible, setVisible];
}

/**
 * The scroll layout's chrome follows the scroll (scrollChrome.ts): feed `onScroll` every scroll
 * position, with whether a person made it; `hold` keeps the chrome as it is for a moment (after a
 * chapter turn). Moves made by code only re-base the count.
 */
export function useScrollChrome(setChrome: (visible: boolean) => void, enabled: boolean) {
  const state = useRef(initialChromeScroll());
  const onScroll = useCallback(
    (top: number, max: number, user: boolean) => {
      if (!enabled || !user) {
        state.current = { ...state.current, last: Math.max(0, Math.min(top, max)), acc: 0 };
        return;
      }
      const r = chromeStep(state.current, { top, max, now: performance.now() });
      state.current = r.state;
      if (r.show !== null) setChrome(r.show);
    },
    [enabled, setChrome],
  );
  const hold = useCallback((ms?: number) => {
    state.current = holdChrome(state.current, performance.now(), ms);
  }, []);
  return { onScroll, hold };
}
