import { BookOpen, Highlighter, LibraryBig, Settings, Sparkles, type LucideIcon } from "lucide-react";
import type { NativeTab } from "@/lib/native";

export interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Fill the icon when active. Only for icons with no inner detail. */
  fill: boolean;
  end?: boolean;
  /** The path prefix that makes the tab active, when it isn't `to` (the Book tab: any open book). */
  match?: string;
  /** Shown in the mobile bottom bar. */
  mobile: boolean;
  /** Its tab in the iPhone app's tab bar, for the mobile entries. */
  tab?: NativeTab;
}

/** The reader's routes, `/read/<doc>[/<section>]`: the Book tab's. */
export const BOOK_PATH = "/read";

/**
 * The library is home; the rest are the reader's own rooms. The mobile entries' order is the tab
 * bar's, in the browser and in the iPhone app (`PagerTab` in ios/Sources/Pager/TabsController.swift
 * lists the same tabs in the same order).
 */
export const NAV: NavEntry[] = [
  { to: "/", label: "Library", icon: LibraryBig, fill: false, end: true, mobile: true, tab: "library" },
  // `to` is a stand-in: the shell links to the book read last (useBookTab).
  { to: BOOK_PATH, match: BOOK_PATH, label: "Book", icon: BookOpen, fill: false, mobile: true, tab: "book" },
  { to: "/highlights", label: "Highlights", icon: Highlighter, fill: false, mobile: true, tab: "highlights" },
  { to: "/assistant", label: "Assistant", icon: Sparkles, fill: true, mobile: true, tab: "assistant" },
  { to: "/settings", label: "Settings", icon: Settings, fill: false, mobile: true, tab: "settings" },
];

/** The app's tabs in the bar's order, each with its top page, and the Book tab with the pages it owns. */
export const NATIVE_TABS: { tab: NativeTab; root: string; match?: string }[] = NAV.flatMap((n) =>
  n.tab ? [{ tab: n.tab, root: n.to, match: n.match }] : [],
);
