import { useEffect, useRef, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { HighlightColor } from "@/api/types";
import { isNativeApp, onNativeMenu, setNativeMenuItems, setNativeReaderOpen, type NativeMenuItem } from "@/lib/native";
import { useSettings } from "@/state/settings";
import type { TextSelection } from "@/tools/types";
import { readSelection } from "@/tools/useSelection";
import { HIGHLIGHT_COLORS } from "./useHighlightPainting";

export interface NativeMenuActions {
  /** In `color` when the app's colour submenu named one; in the last-used colour otherwise. */
  highlight: (selection: TextSelection, color?: HighlightColor) => void;
  note: (selection: TextSelection) => void;
  /** While moving a highlight by hand: then the only item offered. */
  reattach?: (selection: TextSelection) => void;
}

/** Whether the selection has words and lies inside `root`. Cheap enough for every selectionchange. */
export function selectionInside(root: HTMLElement | null): boolean {
  const sel = window.getSelection();
  if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  return root.contains(range.startContainer) && root.contains(range.endContainer) && range.toString().trim() !== "";
}

/** The highlight colours in the order the app's menu lists them: the last-used first, then the rest. */
export function menuColors(last: HighlightColor): HighlightColor[] {
  return [last, ...HIGHLIGHT_COLORS.filter((c) => c !== last)];
}

/** The colour the app passed back, if it is one of ours. */
function asColor(name: string | undefined): HighlightColor | undefined {
  return HIGHLIGHT_COLORS.find((c) => c === name);
}

/**
 * The reader's half of the iPhone app's own selection menu, which stands in for SelectionMenu there.
 * While the reader is mounted it tells the app so (the app's bounce and forward swipe go off), keeps it told
 * whether the selection is in the reading text (then the app adds Highlight, as a submenu of the
 * colours, and Note, or Reattach Here while moving a highlight), and runs those items on the
 * selection. A no-op in a browser.
 */
export function useNativeMenu(
  bodyRef: RefObject<HTMLElement | null>,
  sectionId: string | undefined,
  actions: NativeMenuActions,
): void {
  const latest = useRef(actions);
  latest.current = actions;
  const reattaching = Boolean(actions.reattach);
  const { highlightColor } = useSettings();

  useEffect(() => {
    if (!isNativeApp()) return;
    setNativeReaderOpen(true);
    return () => setNativeReaderOpen(false);
  }, []);

  useEffect(() => {
    if (!isNativeApp() || !sectionId) return;
    const items: NativeMenuItem[] = reattaching ? ["reattach"] : ["highlight", "note"];
    const colors = reattaching ? [] : menuColors(highlightColor);
    // At once, not a frame later as useSelection does: the app builds its menu as soon as it shows.
    const report = () => {
      if (selectionInside(bodyRef.current)) setNativeMenuItems(items, colors);
      else setNativeMenuItems([]);
    };
    report();
    document.addEventListener("selectionchange", report);
    const stop = onNativeMenu((item, color) => {
      const root = bodyRef.current;
      const selection = root ? readSelection(root, sectionId) : null;
      if (!selection) return;
      const a = latest.current;
      // Rendered before this returns, so the note box takes focus while the tap still counts as the
      // user's (WebKit then brings up the keyboard).
      flushSync(() => {
        if (a.reattach) {
          if (item === "reattach") a.reattach(selection);
        } else if (item === "highlight") {
          a.highlight(selection, asColor(color));
        } else if (item === "note") {
          a.note(selection);
        }
      });
    });
    return () => {
      document.removeEventListener("selectionchange", report);
      stop();
      setNativeMenuItems([]);
    };
  }, [bodyRef, sectionId, reattaching, highlightColor]);
}
