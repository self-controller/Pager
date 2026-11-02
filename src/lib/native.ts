import { getSettings } from "@/state/settings";

/** The scheme the iPhone app serves this UI on (`pager-app://localhost/`); its scheme handler carries `/api` over iroh. */
export const NATIVE_SCHEME = "pager-app:";

/** Whether this UI is running inside the iPhone app, not in a browser. */
export function isNativeApp(): boolean {
  return typeof window !== "undefined" && window.location.protocol === NATIVE_SCHEME;
}

/** The moments the app plays a haptic for: values changing, a snap, a highlight placed, an outcome. */
export type HapticKind = "selection" | "light" | "soft" | "success" | "error";

/** Pager's items in the app's own selection menu (ios/Sources/Pager/PagerWebView.swift names the same ones). */
export type NativeMenuItem = "highlight" | "note" | "reattach";

/**
 * What the page tells the app, on `window.webkit.messageHandlers.pager`. PagerWebView.swift reads the
 * same `t`s and ignores any other.
 */
export type ShellMessage =
  | { t: "haptic.prepare"; kind: HapticKind }
  | { t: "haptic.fire"; kind: HapticKind }
  /** The page colour under the current theme, so the app's edges and cold start match it. */
  | { t: "theme"; background: string }
  /** While the reader is open the app turns its edge swipe back and its bounce off, so edge swipes reach the page. */
  | { t: "reader"; open: boolean }
  /** The items the app adds to its menu for the current selection: none unless it is in the reader's text. */
  | { t: "selection"; items: NativeMenuItem[] };

interface PagerMessageHandler {
  postMessage(message: ShellMessage): void;
}

function shell(): PagerMessageHandler | undefined {
  if (!isNativeApp()) return undefined;
  return (window as { webkit?: { messageHandlers?: Record<string, PagerMessageHandler | undefined> } }).webkit?.messageHandlers
    ?.pager;
}

function post(message: ShellMessage): void {
  shell()?.postMessage(message);
}

// --- Haptics ---

/** Libby's gap: a haptic within this many ms of the last one waits until the gap has passed, and only the latest waiting one plays. */
export const HAPTIC_GAP_MS = 75;

let lastHaptic = -Infinity;
let waiting: HapticKind | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function hapticsOn(): boolean {
  return shell() !== undefined && getSettings().haptics;
}

function play(kind: HapticKind): void {
  lastHaptic = Date.now();
  post({ t: "haptic.fire", kind });
}

/** Readies the Taptic Engine on touch-down, so the haptic on commit plays without lag. A no-op in a browser. */
export function prepareHaptic(kind: HapticKind): void {
  if (hapticsOn()) post({ t: "haptic.prepare", kind });
}

/**
 * Plays a haptic in the iPhone app, unless Settings turned haptics off. One within 75 ms of the last
 * is held to the 75 ms mark rather than stacked, and a later request replaces a held one. A no-op in
 * a browser.
 */
export function haptic(kind: HapticKind): void {
  if (!hapticsOn()) return;
  const wait = lastHaptic + HAPTIC_GAP_MS - Date.now();
  if (wait <= 0 && timer === undefined) {
    play(kind);
    return;
  }
  waiting = kind;
  timer ??= setTimeout(
    () => {
      timer = undefined;
      const next = waiting;
      waiting = null;
      if (next && hapticsOn()) play(next);
    },
    Math.max(0, wait),
  );
}

// --- Theme ---

function channel(raw: string): number | null {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  const v = raw.endsWith("%") ? (n * 255) / 100 : n;
  return Math.min(255, Math.max(0, Math.round(v)));
}

/** `#rgb`, `#rrggbb` (with or without alpha) and `rgb()`/`rgba()`, as `#rrggbb`. */
function parseColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f]{3})[0-9a-f]?$/.exec(v)?.[1];
  if (short) return `#${[...short].map((c) => c + c).join("")}`;
  const long = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(v)?.[1];
  if (long) return `#${long}`;
  const args = /^rgba?\(([^)]*)\)$/.exec(v)?.[1];
  if (args === undefined) return null;
  const parts = args
    .split(/[\s,/]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map(channel);
  if (parts.length < 3 || parts.some((p) => p === null)) return null;
  return `#${parts.map((p) => p!.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A CSS colour as `#rrggbb` (alpha dropped), or null if it can't be read. Other notations (names,
 * hsl()) go through a canvas, which serialises an opaque colour as `#rrggbb`.
 */
export function toHex(css: string): string | null {
  const direct = parseColor(css);
  if (direct || !css.trim() || typeof CSS === "undefined" || !CSS.supports("color", css.trim())) return direct;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = css.trim();
  return typeof ctx.fillStyle === "string" ? parseColor(ctx.fillStyle) : null;
}

let lastBackground: string | null = null;

/** Sends the app the page colour (`--bg-primary` under the current theme) when it changed. */
function sendTheme(): void {
  if (!shell()) return;
  const background = toHex(getComputedStyle(document.documentElement).getPropertyValue("--bg-primary"));
  if (!background || background === lastBackground) return;
  lastBackground = background;
  post({ t: "theme", background });
}

/**
 * In the iPhone app, keeps the app told the page colour: now, and whenever the theme changes
 * (`data-theme` on <html>, set before first paint and by useApplySettings). Call once at startup; a
 * no-op in a browser.
 */
export function startNativeShell(): void {
  if (!shell()) return;
  sendTheme();
  new MutationObserver(sendTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  // The stylesheet may not have applied at the first read.
  window.addEventListener("load", sendTheme, { once: true });
}

// --- The reader and the app's selection menu ---

/** Tells the app whether the reader is open (it turns its edge swipe back and its bounce off while it is). */
export function setNativeReaderOpen(open: boolean): void {
  post({ t: "reader", open });
}

let lastItems = "";

/** Tells the app which of Pager's items to add to its menu for the current selection; [] for none. */
export function setNativeMenuItems(items: NativeMenuItem[]): void {
  if (!shell()) return;
  const key = items.join(",");
  if (key === lastItems) return;
  lastItems = key;
  post({ t: "selection", items });
}

type MenuHandler = (item: string) => void;
type PagerGlobal = { __pager?: { menu?: MenuHandler } };

/**
 * Runs `handler` when one of Pager's items in the app's menu is chosen: the app calls
 * `window.__pager.menu("highlight")`. Returns the function that stops it.
 */
export function onNativeMenu(handler: MenuHandler): () => void {
  const w = window as PagerGlobal;
  w.__pager ??= {};
  w.__pager.menu = handler;
  return () => {
    if (w.__pager?.menu === handler) delete w.__pager.menu;
  };
}
