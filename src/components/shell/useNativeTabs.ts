import { useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { isNativeApp, onNativeTab, onNativeTabBar, setNativeTabBar, setNativeTabs } from "@/lib/native";
import { NATIVE_TABS, NAV } from "./nav";
import { TabMemory } from "./tabMemory";
import { useNavTargets } from "./useBookTab";

/**
 * The bar hides with the reader's chrome, and under a sheet or a tray: ui/Sheet.tsx marks
 * `<html data-sheet-open>` (empty for a modal sheet, "tray" for a tray; either hides the bar).
 */
function barHidden(): boolean {
  const d = document.documentElement.dataset;
  return d.readerChrome === "hidden" || d.sheetOpen !== undefined;
}

/**
 * In the iPhone app, the shell's half of the system tab bar (ios/Sources/Pager/TabsController.swift):
 * tells the app which tab the page is in and whether the bar hides (with the reader's chrome, or under
 * a sheet), answers its taps with tab memory (tabMemory.ts), and keeps the bar's space. Leaving the
 * shell (the pairing page) hides the bar. Does nothing in a browser.
 *
 * Tab switches in the app crossfade like the browser's: tab memory asks for a view transition, and
 * it lasts the same 100 ms (`--tab-fade-duration`, which tokens.css sets for the app).
 */
export function useNativeTabs(): void {
  const location = useLocation();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  // The Book tab's link: the book read last.
  const target = useNavTargets();
  const targetRef = useRef(target);
  targetRef.current = target;
  const [memory] = useState(() =>
    isNativeApp()
      ? new TabMemory({
          tabs: NATIVE_TABS,
          link: (tab) => {
            const item = NAV.find((n) => n.tab === tab);
            return item ? targetRef.current(item) : "/";
          },
          navigate: (to, options) => void navigateRef.current(to, options),
          scrollY: () => window.scrollY,
          scrollTo: (top, smooth) => window.scrollTo({ top, behavior: smooth ? "smooth" : "instant" }),
          afterPaint: (run) => requestAnimationFrame(() => requestAnimationFrame(run)),
          reducedMotion: () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
        })
      : null,
  );

  // The app's calls, the reader's chrome and the sheets. Layout effects run in order, so these are in
  // place before the first `tabs` message below, which the app answers with the bar's footprint.
  useLayoutEffect(() => {
    if (!memory) return;
    const root = document.documentElement;
    const chrome = new MutationObserver(() => setNativeTabs(memory.current, barHidden()));
    chrome.observe(root, { attributes: true, attributeFilter: ["data-reader-chrome", "data-sheet-open"] });
    const stopTab = onNativeTab((name) => {
      const entry = NATIVE_TABS.find((t) => t.tab === name);
      if (entry) memory.select(entry.tab);
    });
    const stopTabBar = onNativeTabBar(setNativeTabBar);
    return () => {
      chrome.disconnect();
      stopTab();
      stopTabBar();
      setNativeTabs(null, true);
    };
  }, [memory]);

  // Each new location: its tab, told to the app; and the scroll a tap asked for, before it paints.
  useLayoutEffect(() => {
    if (!memory) return;
    setNativeTabs(memory.locate(location), barHidden());
    memory.rendered();
  }, [memory, location]);
}
