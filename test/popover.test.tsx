import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentDetail } from "@/api/types";
import { ReaderTopBar } from "@/components/reader/ReaderTopBar";
import { ContextMenu, type MenuEntry } from "@/components/ui/ContextMenu";
import { Popover } from "@/components/ui/Popover";
import { POP_OUT_MS, usePresence } from "@/lib/usePresence";

// Popups anchored to a button or the pointer: they stay while they leave, Reading settings is one
// on every screen, and the pointer menu shrinks away on Esc or a press outside.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
let media: Record<string, boolean>;

function mediaList(query: string): MediaQueryList {
  return {
    matches: media[query] ?? false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  } as MediaQueryList;
}

async function render(ui: ReactNode) {
  await act(async () => root.render(ui));
}

async function wait(ms: number) {
  await act(async () => vi.advanceTimersByTime(ms));
}

async function pointer(type: string, el: Element, pointerType: string, x = 100, y = 100) {
  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 3, pointerType, isPrimary: true };
  await act(async () => el.dispatchEvent(new PointerEvent(type, init)));
}

async function esc() {
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
}

beforeEach(() => {
  media = {};
  vi.spyOn(window, "matchMedia").mockImplementation(mediaList);
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("usePresence", () => {
  let seen: { shown: boolean; leaving: boolean };
  function Probe({ open }: { open: boolean }) {
    seen = usePresence(open);
    return null;
  }

  it("stays shown through the exit, and is gone after it", async () => {
    await render(<Probe open={false} />);
    expect(seen).toEqual({ shown: false, leaving: false });
    await render(<Probe open />);
    expect(seen).toEqual({ shown: true, leaving: false });
    await render(<Probe open={false} />);
    expect(seen).toEqual({ shown: true, leaving: true });
    await wait(POP_OUT_MS - 1);
    expect(seen.shown).toBe(true);
    await wait(1);
    expect(seen).toEqual({ shown: false, leaving: false });
  });

  it("takes 150 ms under reduced motion", async () => {
    media["(prefers-reduced-motion: reduce)"] = true;
    await render(<Probe open />);
    await render(<Probe open={false} />);
    await wait(150);
    expect(seen.shown).toBe(false);
  });

  it("opening again during the exit cancels it", async () => {
    await render(<Probe open />);
    await render(<Probe open={false} />);
    await wait(100);
    await render(<Probe open />);
    expect(seen).toEqual({ shown: true, leaving: false });
    await wait(POP_OUT_MS * 2);
    expect(seen).toEqual({ shown: true, leaving: false });
  });

  it("clears its timer when it unmounts", async () => {
    await render(<Probe open />);
    await render(<Probe open={false} />);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(host);
  });
});

describe("Popover", () => {
  const trigger = () => host.querySelector<HTMLButtonElement>("button")!;
  const panel = () => host.querySelector<HTMLElement>("[role=dialog]");
  let changes: boolean[];

  function Harness({ forceClosed }: { forceClosed?: boolean }) {
    return (
      <div>
        <Popover
          title="Reading settings"
          onOpenChange={(open) => changes.push(open)}
          forceClosed={forceClosed}
          trigger={(props) => <button {...props}>Aa</button>}
        >
          <p>settings</p>
        </Popover>
        <p id="page">text</p>
      </div>
    );
  }
  const page = () => host.querySelector("#page")!;

  beforeEach(() => {
    changes = [];
  });

  async function open() {
    await render(<Harness />);
    await act(async () => trigger().click());
  }

  it("opens a panel that grows from its button, and says so", async () => {
    await open();
    const el = panel()!;
    expect(el.getAttribute("aria-label")).toBe("Reading settings");
    expect(el.classList.contains("pop-in")).toBe(true);
    expect(el.classList.contains("origin-top-right")).toBe(true);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe(el.id);
    expect(changes).toEqual([true]);
  });

  it("is a panel on a phone too, not a sheet, and marks nothing", async () => {
    media["(max-width: 767px)"] = true;
    await open();
    expect(document.querySelector("dialog")).toBeNull();
    expect(panel()?.textContent).toBe("settings");
    expect(document.documentElement.dataset.sheetOpen).toBeUndefined();
  });

  it("leaves on Esc: still a dialog while it shrinks, then gone", async () => {
    await open();
    await esc();
    const el = panel()!;
    expect(el).not.toBeNull();
    expect(el.classList.contains("pop-out")).toBe(true);
    expect(el.classList.contains("pop-in")).toBe(false);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(changes).toEqual([true, false]);
    await wait(POP_OUT_MS);
    expect(panel()).toBeNull();
  });

  it("closes on a mouse press outside, not on one inside", async () => {
    await open();
    await pointer("pointerdown", panel()!, "mouse");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    await pointer("pointerdown", page(), "mouse");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on a tap outside, when the finger lifts", async () => {
    await open();
    await pointer("pointerdown", page(), "touch");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    await pointer("pointerup", page(), "touch", 110, 108);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("stays open when a touch outside becomes a scroll", async () => {
    await open();
    await pointer("pointerdown", page(), "touch");
    await pointer("pointercancel", page(), "touch");
    await pointer("pointerup", page(), "touch");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    // Or moves too far before it lifts.
    await pointer("pointerdown", page(), "pen");
    await pointer("pointerup", page(), "pen", 100, 130);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("leaves a press on its trigger to the trigger's click", async () => {
    await open();
    await pointer("pointerdown", trigger(), "touch");
    await pointer("pointerup", trigger(), "touch");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    await act(async () => trigger().click());
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when forced to", async () => {
    await open();
    await render(<Harness forceClosed />);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(changes).toEqual([true, false]);
    await wait(POP_OUT_MS);
    expect(panel()).toBeNull();
  });
});

describe("Reading settings in the top bar", () => {
  const book = {
    id: "book",
    kind: "book",
    format: "epub",
    title: "Middlemarch",
    author: "George Eliot",
    sourceId: "s",
    sourceName: "Uploads",
    addedAt: "2026-01-01T00:00:00Z",
    saved: false,
    toc: [],
  } as DocumentDetail;

  function Bar({ hidden, onChange }: { hidden?: boolean; onChange: (open: boolean) => void }) {
    return <ReaderTopBar doc={book} percent={0} toolsOpen={false} onToggleTools={() => {}} hidden={hidden} onSettingsOpenChange={onChange} />;
  }

  async function renderBar(onChange: (open: boolean) => void) {
    let setHidden: (h: boolean) => void = () => {};
    function Shell() {
      const [hidden, set] = useState(false);
      setHidden = set;
      return <Bar hidden={hidden} onChange={onChange} />;
    }
    const router = createMemoryRouter([{ path: "*", element: <Shell /> }], { initialEntries: ["/read/book"] });
    await render(<RouterProvider router={router} />);
    return (h: boolean) => act(async () => setHidden(h));
  }
  const aa = () => host.querySelector<HTMLButtonElement>('button[aria-label="Reading settings"]')!;

  it("on a phone hangs from the bar with the phone's class, and reports it is open", async () => {
    media["(max-width: 767px)"] = true;
    const onChange = vi.fn();
    await renderBar(onChange);
    await act(async () => aa().click());
    const el = host.querySelector<HTMLElement>("[role=dialog]")!;
    expect(el.classList.contains("settings-pop")).toBe(true);
    expect(el.classList.contains("w-[300px]")).toBe(false);
    expect(document.querySelector("dialog")).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it("on a desktop is 300px wide, without the phone's class", async () => {
    await renderBar(() => {});
    await act(async () => aa().click());
    const el = host.querySelector<HTMLElement>("[role=dialog]")!;
    expect(el.classList.contains("w-[300px]")).toBe(true);
    expect(el.classList.contains("settings-pop")).toBe(false);
  });

  it("closes when the bars hide", async () => {
    const onChange = vi.fn();
    const hide = await renderBar(onChange);
    await act(async () => aa().click());
    await hide(true);
    expect(aa().getAttribute("aria-expanded")).toBe("false");
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});

describe("the pointer menu", () => {
  let picked: string[];
  const items = (): MenuEntry[] => [
    { id: "open", label: "Open", onSelect: () => picked.push("open") },
    { id: "delete", label: "Delete", danger: true, onSelect: () => picked.push("delete") },
  ];
  const menu = () => host.querySelector<HTMLElement>(".fixed.z-40");

  beforeEach(() => {
    picked = [];
  });

  async function show(onClose: () => void, at = { x: 40, y: 50 }) {
    await render(<ContextMenu label="Book" at={at} items={items()} onClose={onClose} />);
    // The outside-press listener is attached on the next tick.
    await wait(0);
  }

  it("grows from the pointer", async () => {
    await show(() => {});
    const el = menu()!;
    expect(el.classList.contains("pop-in")).toBe(true);
    expect(el.style.transformOrigin).toBe("0px 0px");
  });

  it("shrinks away on Esc, and closes after it", async () => {
    const onClose = vi.fn();
    await show(onClose);
    await esc();
    expect(menu()?.classList.contains("pop-out")).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await wait(POP_OUT_MS);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shrinks away on a press outside", async () => {
    const onClose = vi.fn();
    await show(onClose);
    await pointer("pointerdown", document.body, "mouse");
    expect(menu()?.classList.contains("pop-out")).toBe(true);
    await wait(POP_OUT_MS);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes at once on a pick, then runs it", async () => {
    const onClose = vi.fn();
    await show(onClose);
    const row = Array.from(host.querySelectorAll<HTMLButtonElement>("[role=menuitem]")).find((b) => b.textContent === "Open")!;
    await act(async () => row.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(picked).toEqual(["open"]);
  });

  it("closes at once on a scroll", async () => {
    const onClose = vi.fn();
    await show(onClose);
    await act(async () => window.dispatchEvent(new Event("scroll")));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moved during its exit, arrives again and the old close never fires", async () => {
    const onClose = vi.fn();
    await show(onClose);
    await esc();
    await wait(100);
    await show(onClose, { x: 200, y: 120 });
    const el = menu()!;
    expect(el.classList.contains("pop-in")).toBe(true);
    expect(el.classList.contains("pop-out")).toBe(false);
    await wait(POP_OUT_MS * 2);
    expect(onClose).not.toHaveBeenCalled();
  });
});
