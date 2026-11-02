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
  document.documentElement.style.removeProperty("--bg-primary");
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
  it("sends --bg-primary at start and when data-theme changes, once per colour", async () => {
    vi.useRealTimers();
    const root = document.documentElement;
    root.dataset.theme = "light";
    root.style.setProperty("--bg-primary", "#FFFFFF");
    native.startNativeShell();
    expect(sent()).toEqual([{ t: "theme", background: "#ffffff" }]);

    root.style.setProperty("--bg-primary", "#121212");
    root.dataset.theme = "dark";
    await new Promise((r) => setTimeout(r, 0));
    expect(sent()).toEqual([
      { t: "theme", background: "#ffffff" },
      { t: "theme", background: "#121212" },
    ]);

    // The same theme set again (useApplySettings does this on mount): no message.
    root.dataset.theme = "dark";
    await new Promise((r) => setTimeout(r, 0));
    expect(sent()).toHaveLength(2);
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
