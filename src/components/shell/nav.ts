import { Highlighter, LibraryBig, Settings, Sparkles, type LucideIcon } from "lucide-react";
import type { NativeTab } from "@/lib/native";

export interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Fill the icon when active. Only for icons with no inner detail. */
  fill: boolean;
  end?: boolean;
  /** Shown in the mobile bottom bar. */
  mobile: boolean;
  /** Its tab in the iPhone app's tab bar, for the mobile entries. */
  tab?: NativeTab;
}

/**
 * The library is home; the rest are the reader's own rooms. The mobile entries' order is the tab
 * bar's, in the browser and in the iPhone app (`PagerTab` in ios/Sources/Pager/TabsController.swift
 * lists the same tabs in the same order).
 */
export const NAV: NavEntry[] = [
  { to: "/", label: "Library", icon: LibraryBig, fill: false, end: true, mobile: true, tab: "library" },
  { to: "/highlights", label: "Highlights", icon: Highlighter, fill: false, mobile: true, tab: "highlights" },
  { to: "/assistant", label: "Assistant", icon: Sparkles, fill: true, mobile: true, tab: "assistant" },
  { to: "/settings", label: "Settings", icon: Settings, fill: false, mobile: true, tab: "settings" },
];

/** The app's tabs in the bar's order, each with its top page. */
export const NATIVE_TABS: { tab: NativeTab; root: string }[] = NAV.flatMap((n) => (n.tab ? [{ tab: n.tab, root: n.to }] : []));
