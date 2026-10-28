import { Highlighter, LibraryBig, Settings, Sparkles, type LucideIcon } from "lucide-react";

export interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Fill the icon when active. Only for icons with no inner detail. */
  fill: boolean;
  end?: boolean;
  /** Shown in the mobile bottom bar. */
  mobile: boolean;
}

/** The library is home; the rest are the reader's own rooms. */
export const NAV: NavEntry[] = [
  { to: "/", label: "Library", icon: LibraryBig, fill: false, end: true, mobile: true },
  { to: "/highlights", label: "Highlights", icon: Highlighter, fill: false, mobile: true },
  { to: "/assistant", label: "Assistant", icon: Sparkles, fill: true, mobile: true },
  { to: "/settings", label: "Settings", icon: Settings, fill: false, mobile: true },
];
