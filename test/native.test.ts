import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Native = typeof import("@/lib/native");
type SettingsModule = typeof import("@/state/settings");

const happyDOM = (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM;
const browserUrl = window.location.href;

let native: Native;
let settings: SettingsModule;
let postMessage: ReturnType<typeof vi.fn>;

/** Every message the page posted to the app. */
function sent(): unknown[] {
  return postMessage.mock.calls.map((c) => c[0]);
}

function fired(): string[] {
  return sent()
    .filter((m) => (m as { t: string }).t === "haptic.fire")
    .map((m) => (m as { kind: string }).kind);
}

beforeEach(async () => {
  // Inside the app: its scheme, and its message handler.
  happyDOM.setURL("pager-app://localhost/read/doc");
  postMessage = vi.fn();
  (window as unknown as { webkit?: unknown }).webkit = { messageHandlers: { pager: { postMessage } } };
  // Fresh module state (the last haptic, the last colour) for each test.
  vi.resetModules();
  settings = await import("@/state/settings");
  native = await import("@/lib/native");
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { webkit?: unknown }).webkit;
  delete (window as unknown as { __pager?: unknown }).__pager;
  happyDOM.setURL(browserUrl);
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-native-tabs");
  document.documentElement.style.removeProperty("--bg-primary");
  document.documentElement.style.removeProperty("--native-tab-bar");
});

describe("haptics", () => {
  it("plays the first at once and holds a quick second to the 75 ms mark, the latest winning", () => {
    native.haptic("selection");
    expect(fired()).toEqual(["selection"]);

    vi.advanceTimersByTime(10);
    native.haptic("light");
    native.haptic("soft");
    expect(fired()).toEqual(["selection"]);

    vi.advanceTimersByTime(64);
    expect(fired()).toEqual(["selection"]);
    vi.advanceTimersByTime(1);
    expect(fired()).toEqual(["selection", "soft"]);

    vi.advanceTimersByTime(500);
    expect(fired()).toEqual(["selection", "soft"]);
  });

  it("spaces a quick run out to one every 75 ms", () => {
    for (let i = 0; i < 20; i++) {
      native.haptic("selection");
      vi.advanceTimersByTime(10);
    }
    vi.advanceTimersByTime(200);
    // 200 ms of taps: at 0, 75, 150, then the last one held to 225.
    expect(fired()).toHaveLength(4);
  });

  it("plays at once once the gap has passed", () => {
    native.haptic("success");
    vi.advanceTimersByTime(75);
    native.haptic("error");
    expect(fired()).toEqual(["success", "error"]);
  });

  it("readies the engine on touch-down", () => {
    native.prepareHaptic("soft");
    expect(sent()).toEqual([{ t: "haptic.prepare", kind: "soft" }]);
  });

  it("plays nothing when Settings turned haptics off", () => {
    expect(settings.getSettings().haptics).toBe(true);
    settings.updateSettings({ haptics: false });
    native.prepareHaptic("selection");
    native.haptic("selection");
    vi.advanceTimersByTime(100);
    expect(sent()).toEqual([]);
  });

  it("does nothing in a browser", () => {
    happyDOM.setURL(browserUrl);
    native.haptic("selection");
    native.haptic("soft");
    expect(vi.getTimerCount()).toBe(0);
    expect(sent()).toEqual([]);
  });
});

describe("toHex", () => {
  it("reads the notations the page colour can come in", () => {
    expect(native.toHex("#FFFFFF")).toBe("#ffffff");
    expect(native.toHex("  #121212 ")).toBe("#121212");
    expect(native.toHex("#fff")).toBe("#ffffff");
    expect(native.toHex("#abcd")).toBe("#aabbcc");
    expect(native.toHex("#12345678")).toBe("#123456");
    expect(native.toHex("rgb(18, 18, 18)")).toBe("#121212");
    expect(native.toHex("rgba(255, 255, 255, 0.5)")).toBe("#ffffff");
    expect(native.toHex("rgb(18 18 18 / 1)")).toBe("#121212");
    expect(native.toHex("rgb(100% 0% 50%)")).toBe("#ff0080");
  });

  it("gives null for what it can't read", () => {
    expect(native.toHex("")).toBeNull();
    expect(native.toHex("#12")).toBeNull();
    expect(native.toHex("rgb(1, 2)")).toBeNull();
    expect(native.toHex("not a colour")).toBeNull();
  });
});

describe("the page colour", () => {
  it("sends --bg-primary and the scheme at start and when data-theme changes, once per change", async () => {
    vi.useRealTimers();
    const root = document.documentElement;
    root.dataset.theme = "light";
    root.style.setProperty("--bg-primary", "#FFFFFF");
    native.startNativeShell();
    expect(sent()).toEqual([{ t: "theme", background: "#ffffff", scheme: "light" }]);

    root.style.setProperty("--bg-primary", "#121212");
    root.dataset.theme = "dark";
    await new Promise((r) => setTimeout(r, 0));
    expect(sent()).toEqual([
      { t: "theme", background: "#ffffff", scheme: "light" },
      { t: "theme", background: "#121212", scheme: "dark" },
    ]);

    // The same theme set again (useApplySettings does this on mount): no message.
    root.dataset.theme = "dark";
    await new Promise((r) => setTimeout(r, 0));
    expect(sent()).toHaveLength(2);

    // The scheme alone changing, on the same colour.
    root.dataset.theme = "light";
    await new Promise((r) => setTimeout(r, 0));
    expect(sent().at(-1)).toEqual({ t: "theme", background: "#121212", scheme: "light" });
    expect(sent()).toHaveLength(3);
  });

  it("marks <html> for the app's tab bar, only in the app", () => {
    vi.useRealTimers();
    native.startNativeShell();
    expect(document.documentElement.hasAttribute("data-native-tabs")).toBe(true);

    document.documentElement.removeAttribute("data-native-tabs");
    happyDOM.setURL(browserUrl);
    native.startNativeShell();
    expect(document.documentElement.hasAttribute("data-native-tabs")).toBe(false);
  });
});

describe("the app's tab bar", () => {
  type Pager = { tab?: (tab: string) => void; tabBar?: (points: number) => void; menu?: (item: string) => void };
  const pager = () => (window as unknown as { __pager?: Pager }).__pager;

  it("sends the tab and whether the bar hides only when either changes", () => {
    native.setNativeTabs("library", false);
    native.setNativeTabs("library", false);
    native.setNativeTabs("library", true);
    native.setNativeTabs("highlights", true);
    native.setNativeTabs("highlights", true);
    native.setNativeTabs(null, true);
    expect(sent()).toEqual([
      { t: "tabs", tab: "library", hidden: false },
      { t: "tabs", tab: "library", hidden: true },
      { t: "tabs", tab: "highlights", hidden: true },
      { t: "tabs", tab: null, hidden: true },
    ]);
  });

  it("sends nothing in a browser", () => {
    happyDOM.setURL(browserUrl);
    native.setNativeTabs("library", false);
    expect(sent()).toEqual([]);
  });

  it("lets the app call the tab handlers until they stop, next to the menu's", () => {
    const menu = vi.fn();
    const tab = vi.fn();
    const tabBar = vi.fn();
    const stopMenu = native.onNativeMenu(menu);
    const stopTab = native.onNativeTab(tab);
    const stopTabBar = native.onNativeTabBar(tabBar);
    pager()?.tab?.("highlights");
    pager()?.tabBar?.(83);
    pager()?.menu?.("note");
    expect(tab).toHaveBeenCalledWith("highlights");
    expect(tabBar).toHaveBeenCalledWith(83);
    expect(menu).toHaveBeenCalledWith("note");

    stopTab();
    stopTabBar();
    expect(pager()?.tab).toBeUndefined();
    expect(pager()?.tabBar).toBeUndefined();
    expect(pager()?.menu).toBe(menu);
    stopMenu();
  });

  it("keeps a newer tab handler when an older one stops", () => {
    const stopOld = native.onNativeTab(vi.fn());
    const newer = vi.fn();
    native.onNativeTab(newer);
    stopOld();
    pager()?.tab?.("settings");
    expect(newer).toHaveBeenCalledWith("settings");
  });

  it("keeps the bar's footprint, above the home indicator, as --native-tab-bar", () => {
    const root = document.documentElement;
    const changed = vi.fn();
    window.addEventListener(native.TAB_BAR_EVENT, changed);
    try {
      // No safe area in the test DOM: the footprint is all bar.
      native.setNativeTabBar(83);
      expect(root.style.getPropertyValue("--native-tab-bar")).toBe("83px");
      native.setNativeTabBar(83);
      native.setNativeTabBar(Number.NaN);
      expect(changed).toHaveBeenCalledTimes(1);
      native.setNativeTabBar(-4);
      expect(root.style.getPropertyValue("--native-tab-bar")).toBe("0px");
      expect(changed).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener(native.TAB_BAR_EVENT, changed);
    }
  });
});

describe("the reader and the app's menu", () => {
  it("says when the reader opens and closes", () => {
    native.setNativeReaderOpen(true);
    native.setNativeReaderOpen(false);
    expect(sent()).toEqual([
      { t: "reader", open: true },
      { t: "reader", open: false },
    ]);
  });

  it("sends the menu's items only when they change", () => {
    native.setNativeMenuItems(["highlight", "note"]);
    native.setNativeMenuItems(["highlight", "note"]);
    native.setNativeMenuItems([]);
    native.setNativeMenuItems(["reattach"]);
    expect(sent()).toEqual([
      { t: "selection", items: ["highlight", "note"] },
      { t: "selection", items: [] },
      { t: "selection", items: ["reattach"] },
    ]);
  });

  it("sends the highlight colours with the items, and again when their order changes", () => {
    native.setNativeMenuItems(["highlight", "note"], ["blue", "yellow", "green", "pink", "purple"]);
    native.setNativeMenuItems(["highlight", "note"], ["blue", "yellow", "green", "pink", "purple"]);
    native.setNativeMenuItems(["highlight", "note"], ["pink", "yellow", "green", "blue", "purple"]);
    native.setNativeMenuItems([]);
    native.setNativeMenuItems([]);
    expect(sent()).toEqual([
      { t: "selection", items: ["highlight", "note"], colors: ["blue", "yellow", "green", "pink", "purple"] },
      { t: "selection", items: ["highlight", "note"], colors: ["pink", "yellow", "green", "blue", "purple"] },
      { t: "selection", items: [] },
    ]);
    // No items and no colours is how the app starts: nothing to say.
    expect(sent().some((m) => "colors" in (m as object) && (m as { items: unknown[] }).items.length === 0)).toBe(false);
  });

  it("says nothing for no items at the start", () => {
    native.setNativeMenuItems([]);
    expect(sent()).toEqual([]);
  });

  it("passes the colour picked in the app's Highlight submenu to the handler", () => {
    const handler = vi.fn();
    const stop = native.onNativeMenu(handler);
    const pager = (window as unknown as { __pager?: { menu?: (item: string, color?: string) => void } }).__pager;
    pager?.menu?.("highlight", "green");
    expect(handler).toHaveBeenLastCalledWith("highlight", "green");
    pager?.menu?.("highlight");
    expect(handler).toHaveBeenLastCalledWith("highlight");
    stop();
  });

  it("lets the app call the reader's handler until it stops", () => {
    const handler = vi.fn();
    const stop = native.onNativeMenu(handler);
    const pager = (window as unknown as { __pager?: { menu?: (item: string) => void } }).__pager;
    pager?.menu?.("highlight");
    expect(handler).toHaveBeenCalledWith("highlight");
    stop();
    expect(pager?.menu).toBeUndefined();
  });

  it("keeps a newer handler when an older one stops", () => {
    const stopOld = native.onNativeMenu(vi.fn());
    const newer = vi.fn();
    native.onNativeMenu(newer);
    stopOld();
    (window as unknown as { __pager: { menu: (item: string) => void } }).__pager.menu("note");
    expect(newer).toHaveBeenCalledWith("note");
  });
});

describe("selectionInside", () => {
  it("is true only for a selection with words inside the root", async () => {
    const { selectionInside } = await import("@/components/reader/useNativeMenu");
    const root = document.createElement("div");
    root.innerHTML = "<p>Reading maketh a full man.</p>";
    const outside = document.createElement("p");
    outside.textContent = "Elsewhere";
    document.body.append(root, outside);
    const select = (node: Node, start: number, end: number) => {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    };
    try {
      const text = root.querySelector("p")!.firstChild!;
      select(text, 0, 7);
      expect(selectionInside(root)).toBe(true);
      select(text, 7, 8);
      expect(selectionInside(root)).toBe(false); // only a space
      select(outside.firstChild!, 0, 4);
      expect(selectionInside(root)).toBe(false);
      window.getSelection()!.removeAllRanges();
      expect(selectionInside(root)).toBe(false);
      expect(selectionInside(null)).toBe(false);
    } finally {
      root.remove();
      outside.remove();
    }
  });
});
