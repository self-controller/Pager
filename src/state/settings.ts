import { useEffect, useSyncExternalStore } from "react";
import type { HighlightColor } from "@/api/types";

export type ThemeSetting = "system" | "light" | "dark";
export type Typeface = "serif" | "sans";
export type LibraryView = "compact" | "detailed";
export type LibrarySort = "name" | "recent" | "added" | "progress";

export interface Settings {
  theme: ThemeSetting;
  /** Pixels added to the 19px body size. */
  fontOffset: number;
  typeface: Typeface;
  /** Whether the reader's tool panel is open. */
  toolPanelOpen: boolean;
  /** Colour for new highlights: the last one picked. */
  highlightColor: HighlightColor;
  /** How the library lists books: dense rows or cards with covers. */
  libraryView: LibraryView;
  librarySort: LibrarySort;
}

export const FONT_OFFSET_MIN = -3;
export const FONT_OFFSET_MAX = 9;

const KEY = "pager.settings";
const DEFAULTS: Settings = {
  theme: "system",
  fontOffset: 0,
  typeface: "serif",
  toolPanelOpen: false,
  highlightColor: "yellow",
  libraryView: "detailed",
  librarySort: "recent",
};

const listeners = new Set<() => void>();
let current: Settings = read();

function read(): Settings {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  current.fontOffset = Math.min(FONT_OFFSET_MAX, Math.max(FONT_OFFSET_MIN, current.fontOffset));
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode or full storage: settings last for this session only.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}

function resolveTheme(theme: ThemeSetting): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Mirrors settings onto <html>: data-theme, body text offset and typeface. Mount once. */
export function useApplySettings(): void {
  const settings = useSettings();

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.dataset.theme = resolveTheme(settings.theme);
    };
    apply();
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings.theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--font-size-offset", `${settings.fontOffset}px`);
    root.style.setProperty("--font-body", settings.typeface === "sans" ? "var(--font-ui)" : "var(--font-spectral)");
  }, [settings.fontOffset, settings.typeface]);
}
