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
 * The tabs of the app's tab bar (`PagerTab` in ios/Sources/Pager/TabsController.swift names the same
 * ones). Their order is NAV's (src/components/shell/nav.ts).
 */
export type NativeTab = "library" | "book" | "highlights" | "assistant" | "settings";

/**
 * What the page tells the app, on `window.webkit.messageHandlers.pager`. PagerWebView.swift reads the
 * same `t`s and ignores any other.
 */
export type ShellMessage =
  | { t: "haptic.prepare"; kind: HapticKind }
  | { t: "haptic.fire"; kind: HapticKind }
  /**
   * The page colour under the current theme, so the app's edges and cold start match it, and whether
   * the theme is light or dark, so the app's tab bar matches the page even against the phone's setting.
   */
  | { t: "theme"; background: string; scheme: "light" | "dark" }
  /** While the reader is open the app turns its edge swipe back and its bounce off, so edge swipes reach the page. */
  | { t: "reader"; open: boolean }
  /** The items the app adds to its menu for the current selection: none unless it is in the reader's text. */
  | { t: "selection"; items: NativeMenuItem[] }
  /**
   * The tab the page is in (null keeps the bar's selection), and whether the tab bar hides: with the
   * reader's chrome, and on pages outside the app's shell (pairing).
   */
  | { t: "tabs"; tab: NativeTab | null; hidden: boolean };

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

let lastTheme = "";

/** Sends the app the page colour (`--bg-primary` under the current theme) and the scheme when either changed. */
function sendTheme(): void {
  if (!shell()) return;
  const root = document.documentElement;
  const background = toHex(getComputedStyle(root).getPropertyValue("--bg-primary"));
  if (!background) return;
  const scheme = root.dataset.theme === "dark" ? "dark" : "light";
  const key = `${background}:${scheme}`;
  if (key === lastTheme) return;
  lastTheme = key;
  post({ t: "theme", background, scheme });
}

/**
 * In the iPhone app, keeps the app told the page colour: now, and whenever the theme changes
 * (`data-theme` on <html>, set before first paint and by useApplySettings). Marks <html> with
 * `data-native-tabs`: the app draws the tab bar, so the page hides its own (globals.css, tokens.css).
 * Call once at startup, before the first render; a no-op in a browser.
 */
export function startNativeShell(): void {
  if (!shell()) return;
  document.documentElement.dataset.nativeTabs = "";
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

/** What the app calls on `window.__pager`. Each takes only names or a number from the app's own code. */
interface PagerCalls {
  /** One of Pager's items in the app's menu was chosen. */
  menu: (item: string) => void;
  /** A tab in the app's bar was tapped, the selected one included. */
  tab: (tab: string) => void;
  /** The tab bar's footprint: points from its top to the bottom of the screen. */
  tabBar: (points: number) => void;
}

type PagerGlobal = { __pager?: Partial<PagerCalls> };

/** Puts `handler` on `window.__pager[name]`; the returned function takes it off, unless a newer one replaced it. */
function onNative<K extends keyof PagerCalls>(name: K, handler: PagerCalls[K]): () => void {
  const w = window as PagerGlobal;
  w.__pager ??= {};
  w.__pager[name] = handler;
  return () => {
    if (w.__pager?.[name] === handler) delete w.__pager[name];
  };
}

/**
 * Runs `handler` when one of Pager's items in the app's menu is chosen: the app calls
 * `window.__pager.menu("highlight")`. Returns the function that stops it.
 */
export function onNativeMenu(handler: PagerCalls["menu"]): () => void {
  return onNative("menu", handler);
}

// --- The app's tab bar ---

let lastTabs = "";

/**
 * Tells the app which tab the page is in (null keeps its selection) and whether to hide the tab bar,
 * when either changed.
 */
export function setNativeTabs(tab: NativeTab | null, hidden: boolean): void {
  if (!shell()) return;
  const key = `${tab}:${hidden}`;
  if (key === lastTabs) return;
  lastTabs = key;
  post({ t: "tabs", tab, hidden });
}

/** Runs `handler` when a tab in the app's bar is tapped: the app calls `window.__pager.tab("highlights")`. */
export function onNativeTab(handler: PagerCalls["tab"]): () => void {
  return onNative("tab", handler);
}

/** Runs `handler` with the tab bar's footprint in points: the app calls `window.__pager.tabBar(83)`. */
export function onNativeTabBar(handler: PagerCalls["tabBar"]): () => void {
  return onNative("tabBar", handler);
}

/** The event the page gets when the tab bar's space (`--size-bottom-nav`) changed in the app. */
export const TAB_BAR_EVENT = "pager:tab-bar";

let tabBarPoints: number | null = null;

/** `env(safe-area-inset-bottom)` in px, read off a hidden probe (CSS has it only as `env()`). */
function safeAreaBottom(): number {
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom)";
  document.body.appendChild(probe);
  const bottom = Number.parseFloat(getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();
  return bottom;
}

function applyTabBar(): void {
  if (tabBarPoints === null) return;
  const root = document.documentElement;
  const value = `${Math.max(0, tabBarPoints - safeAreaBottom())}px`;
  if (root.style.getPropertyValue("--native-tab-bar") === value) return;
  root.style.setProperty("--native-tab-bar", value);
  window.dispatchEvent(new Event(TAB_BAR_EVENT));
}

/**
 * The app's tab bar covers `points` from the bottom of the screen. The page keeps that space as
 * `--native-tab-bar` (which `--size-bottom-nav` takes in the app, tokens.css), less the home
 * indicator's inset, which the CSS adds itself. Measured again on a resize (a rotation), as the
 * inset may change after the app's number arrives. It stays set when the bar hides: the page keeps
 * the bar's space, so the reader never reflows.
 */
export function setNativeTabBar(points: number): void {
  if (!Number.isFinite(points)) return;
  if (tabBarPoints === null) window.addEventListener("resize", applyTabBar);
  tabBarPoints = points;
  applyTabBar();
}
