import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canStartDrag } from "@/components/reader/chapterTurn";
import { OVERLAY_SELECTOR, pointerKind } from "@/components/reader/gestures";
import { usePressArbiter } from "@/components/reader/usePressArbiter";
import { ContextMenu, sheetMenuOrder, type MenuEntry } from "@/components/ui/ContextMenu";
import { Dialog } from "@/components/ui/Dialog";
import { Popover } from "@/components/ui/Popover";
import { Sheet } from "@/components/ui/Sheet";

// Sheets as a phone shows them: what they mark, how they close, and which popups become one.

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

function sheets(): HTMLDialogElement[] {
  return Array.from(document.querySelectorAll<HTMLDialogElement>("[data-sheet]"));
}

function first(): HTMLDialogElement {
  const sheet = sheets()[0];
  if (!sheet) throw new Error("no sheet");
  return sheet;
}

/** The mark on <html>: "" under a modal sheet, "tray" under trays only, undefined with none. */
function mark(): string | undefined {
  return document.documentElement.dataset.sheetOpen;
}

function marked(): boolean {
  return mark() !== undefined;
}

function closeButton(sheet: Element): HTMLButtonElement {
  return sheet.querySelector<HTMLButtonElement>("button[aria-label='Close']")!;
}

async function render(ui: ReactNode) {
  await act(async () => root.render(ui));
}

/** Lets time pass: no animations run here, so an exit ends on the sheet's own timer. */
async function wait(ms: number) {
  await act(async () => vi.advanceTimersByTime(ms));
}

/** Long enough for any exit to end. */
const settle = () => wait(400);

/** A press that lands and lifts on `el` (no click). */
async function pressOn(el: Element, { holdMs = 0, moveTo }: { holdMs?: number; moveTo?: { x: number; y: number } } = {}) {
  const at = { bubbles: true, cancelable: true, clientX: 100, clientY: 100, pointerId: 7, pointerType: "touch", isPrimary: true };
  await act(async () => el.dispatchEvent(new PointerEvent("pointerdown", at)));
  if (holdMs) await wait(holdMs);
  const up = moveTo ? { ...at, clientX: moveTo.x, clientY: moveTo.y } : at;
  await act(async () => el.dispatchEvent(new PointerEvent("pointerup", up)));
}

beforeEach(() => {
  media = { "(max-width: 767px)": true };
  vi.spyOn(window, "matchMedia").mockImplementation(mediaList);
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Sheet", () => {
  it("opens as a modal dialog and marks the page", async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const show = vi.spyOn(HTMLDialogElement.prototype, "show");
    await render(
      <Sheet open onClose={() => {}} title="Things" size="tall">
        <p>inside</p>
      </Sheet>,
    );
    const sheet = first();
    expect(sheet.open).toBe(true);
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.hasAttribute("data-reader-overlay")).toBe(true);
    expect(sheet.hasAttribute("data-tray")).toBe(false);
    expect(sheet.getAttribute("aria-label")).toBe("Things");
    expect(sheet.dataset.size).toBe("tall");
    expect(sheet.querySelector("[data-sheet-grip]")).not.toBeNull();
    expect(sheet.querySelector("[data-sheet-body]")?.textContent).toBe("inside");
    expect(sheet.querySelector("[data-sheet-subtitle]")).toBeNull();
    // The empty mark is the one that freezes the page (globals.css).
    expect(mark()).toBe("");
  });

  it("sizes its body by what it holds", async () => {
    await render(
      <Sheet open onClose={() => {}} title="Things">
        <p>inside</p>
      </Sheet>,
    );
    // No layout here, so the class stands in for it. WebKit (the iPhone app) resolves flex-1's 0%
    // basis to 0 in a column with no height, only a max-height: the body collapsed to its padding
    // and every content-sized sheet was cut off. Chromium sized it by its content either way.
    const body = first().querySelector("[data-sheet-body]")!;
    expect(body.classList.contains("flex-auto")).toBe(true);
    expect(body.classList.contains("flex-1")).toBe(false);
    expect(body.classList.contains("min-h-0")).toBe(true);
  });

  it("takes focus itself when it has no field, so no ring lands on its close button", async () => {
    await render(
      <Sheet open onClose={() => {}} title="Middlemarch">
        <button>Open</button>
      </Sheet>,
    );
    const sheet = first();
    expect(document.activeElement).toBe(sheet);
    expect(sheet.tabIndex).toBe(-1);
    expect(sheet.classList.contains("outline-none")).toBe(true);
  });

  it("gives focus to its first field, or to what asks for it", async () => {
    await render(
      <Sheet open onClose={() => {}} title="Rename">
        <button>Before</button>
        <input aria-label="Name" />
      </Sheet>,
    );
    expect(document.activeElement?.tagName).toBe("INPUT");
    await render(null);
    await render(
      <Sheet open onClose={() => {}} title="Delete">
        <button>Cancel</button>
        <button data-autofocus>Delete</button>
      </Sheet>,
    );
    expect(document.activeElement?.textContent).toBe("Delete");
  });

  it("shows a subtitle under its title, and an action before the close button", async () => {
    await render(
      <Sheet open onClose={() => {}} title="Middlemarch" subtitle="George Eliot" action={<button>Save</button>}>
        <p>inside</p>
      </Sheet>,
    );
    const sheet = first();
    expect(sheet.querySelector("h2")?.textContent).toBe("Middlemarch");
    expect(sheet.querySelector("[data-sheet-subtitle]")?.textContent).toBe("George Eliot");
    const buttons = Array.from(sheet.querySelectorAll("button")).map((b) => b.textContent || b.getAttribute("aria-label"));
    expect(buttons).toEqual(["Save", "Close"]);
  });

  it("tells its owner once when the close button closes it, and clears the mark", async () => {
    const onClose = vi.fn();
    await render(
      <Sheet open onClose={onClose} title="Things">
        <p>inside</p>
      </Sheet>,
    );
    await act(async () => closeButton(first()).click());
    expect(marked()).toBe(false);
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(first().open).toBe(false);
  });

  it("closes without a word when its owner closes it", async () => {
    const onClose = vi.fn();
    const ui = (open: boolean) => (
      <Sheet open={open} onClose={onClose} title="Things">
        <p>inside</p>
      </Sheet>
    );
    await render(ui(true));
    await render(ui(false));
    await settle();
    expect(first().open).toBe(false);
    expect(first().querySelector("[data-sheet-body]")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(marked()).toBe(false);
  });

  it("is an overlay to the reader only while it shows", async () => {
    const ui = (open: boolean) => (
      <Sheet open={open} onClose={() => {}} title="Things">
        <p>inside</p>
      </Sheet>
    );
    await render(ui(false));
    expect(first().hasAttribute("role")).toBe(false);
    expect(first().hasAttribute("data-reader-overlay")).toBe(false);
    expect(first().getAttribute("aria-label")).toBe("Things");
    expect(document.querySelector(OVERLAY_SELECTOR)).toBeNull();
    await render(ui(true));
    expect(document.querySelector(OVERLAY_SELECTOR)).toBe(first());
    await render(ui(false));
    await settle();
    expect(first().hasAttribute("role")).toBe(false);
    expect(document.querySelector(OVERLAY_SELECTOR)).toBeNull();
  });

  it("is still an overlay while it leaves", async () => {
    await render(
      <Sheet open onClose={() => {}} title="Things">
        <p>inside</p>
      </Sheet>,
    );
    await act(async () => closeButton(first()).click());
    expect(first().hasAttribute("data-closing")).toBe(true);
    expect(document.querySelector(OVERLAY_SELECTOR)).toBe(first());
    await settle();
    expect(document.querySelector(OVERLAY_SELECTOR)).toBeNull();
  });

  it("keeps the mark until the last of two sheets closes", async () => {
    const ui = (a: boolean, b: boolean) => (
      <>
        <Sheet open={a} onClose={() => {}} title="A">
          a
        </Sheet>
        <Sheet open={b} onClose={() => {}} title="B">
          b
        </Sheet>
      </>
    );
    await render(ui(true, true));
    await render(ui(false, true));
    await settle();
    expect(marked()).toBe(true);
    await render(ui(false, false));
    await settle();
    expect(marked()).toBe(false);
  });

  it("leaves before it tells its owner", async () => {
    const onClose = vi.fn();
    await render(
      <Sheet open onClose={onClose} title="Things">
        <p>inside</p>
      </Sheet>,
    );
    const sheet = first();
    await act(async () => closeButton(sheet).click());
    expect(sheet.hasAttribute("data-closing")).toBe(true);
    expect(sheet.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    // Its content stays through the exit.
    expect(sheet.querySelector("[data-sheet-body]")?.textContent).toBe("inside");
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sheet.open).toBe(false);
    expect(sheet.hasAttribute("data-closing")).toBe(false);
  });
});

describe("a sheet over the on-screen keyboard", () => {
  /** What the phone reports of the part of the page the keyboard leaves in view. */
  let view: { height: number; offsetTop: number };
  let listeners: Map<string, () => void>;
  /** The window's own two properties, put back after each test. */
  let own: Record<"visualViewport" | "innerHeight", PropertyDescriptor | undefined>;

  const ui = (open: boolean) => (
    <Sheet open={open} onClose={() => {}} title="Choose a book">
      <input aria-label="Title or author" />
    </Sheet>
  );
  const kb = () => first().style.getPropertyValue("--sheet-kb");
  const pan = () => first().style.getPropertyValue("--sheet-pan");
  async function report(next: { height: number; offsetTop: number }, event: "resize" | "scroll") {
    Object.assign(view, next);
    await act(async () => listeners.get(event)?.());
  }

  beforeEach(() => {
    view = { height: 844, offsetTop: 0 };
    listeners = new Map();
    own = {
      visualViewport: Object.getOwnPropertyDescriptor(window, "visualViewport"),
      innerHeight: Object.getOwnPropertyDescriptor(window, "innerHeight"),
    };
    const viewport = {
      get height() {
        return view.height;
      },
      get offsetTop() {
        return view.offsetTop;
      },
      addEventListener: (type: string, run: () => void) => void listeners.set(type, run),
      removeEventListener: (type: string) => void listeners.delete(type),
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
  });
  afterEach(() => {
    for (const name of ["visualViewport", "innerHeight"] as const) {
      delete (window as unknown as Record<string, unknown>)[name];
      if (own[name]) Object.defineProperty(window, name, own[name]);
    }
  });

  it("rides above the keyboard", async () => {
    await render(ui(true));
    expect(kb()).toBe("0px");
    expect(pan()).toBe("0px");
    await report({ height: 508, offsetTop: 0 }, "resize");
    expect(kb()).toBe("336px");
    expect(pan()).toBe("0px");
  });

  it("gives up the height by which iOS panned the page, so its top stays on screen", async () => {
    await render(ui(true));
    // The field took focus while the sheet was still rising, and iOS panned the page up to reach
    // it. The sheet is fixed to the page: its bottom is still the keyboard's top (844 - 136 = 708,
    // the bottom of what shows), and the pan is what its height must give up (globals.css).
    await report({ height: 508, offsetTop: 200 }, "scroll");
    expect(kb()).toBe("136px");
    expect(pan()).toBe("200px");
    await report({ height: 844, offsetTop: 0 }, "resize");
    expect(kb()).toBe("0px");
    expect(pan()).toBe("0px");
  });

  it("forgets both once it has closed", async () => {
    await render(ui(true));
    await report({ height: 508, offsetTop: 200 }, "scroll");
    const sheet = first();
    await render(ui(false));
    await settle();
    expect(sheet.style.getPropertyValue("--sheet-kb")).toBe("");
    expect(sheet.style.getPropertyValue("--sheet-pan")).toBe("");
    expect(listeners.size).toBe(0);
  });
});

describe("how fast a sheet leaves", () => {
  const ui = (open: boolean, onClose = () => {}) => (
    <Sheet open={open} onClose={onClose} title="Things">
      <p>inside</p>
    </Sheet>
  );

  /** A finger on the grip, moved down `dy` px and lifted. */
  async function dragGrip(sheet: Element, dy: number) {
    const grip = sheet.querySelector("[data-sheet-grip]")!;
    const touch = (type: string, y?: number) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "touches", { value: y === undefined ? [] : [{ clientY: y }] });
      return e;
    };
    await act(async () => {
      grip.dispatchEvent(touch("touchstart", 100));
      grip.dispatchEvent(touch("touchmove", 100 + dy));
      grip.dispatchEvent(touch("touchend"));
    });
  }

  it("takes 150 ms after a tap on the close button", async () => {
    await render(ui(true));
    const sheet = first();
    await act(async () => closeButton(sheet).click());
    expect(sheet.dataset.closing).toBe("tap");
    // The fallback timer is the exit plus 50 ms.
    await wait(190);
    expect(sheet.open).toBe(true);
    await wait(20);
    expect(sheet.open).toBe(false);
  });

  it("takes 150 ms when its owner closes it, and on Esc", async () => {
    await render(ui(true));
    const sheet = first();
    await render(ui(false));
    expect(sheet.dataset.closing).toBe("tap");
    await wait(210);
    expect(sheet.open).toBe(false);

    await render(ui(true));
    await act(async () => sheet.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(sheet.dataset.closing).toBe("tap");
    await wait(210);
    expect(sheet.open).toBe(false);
  });

  it("takes 250 ms after a drag, from where the finger let go", async () => {
    const onClose = vi.fn();
    await render(ui(true, onClose));
    const sheet = first();
    await dragGrip(sheet, 200);
    expect(sheet.dataset.closing).toBe("drag");
    expect(sheet.style.getPropertyValue("--sheet-y")).toBe("200px");
    await wait(290);
    expect(sheet.open).toBe(true);
    await wait(20);
    expect(sheet.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ends with its exit animation, before the timer", async () => {
    await render(ui(true));
    const sheet = first();
    await act(async () => closeButton(sheet).click());
    const end = new Event("animationend", { bubbles: true });
    Object.defineProperty(end, "animationName", { value: "sheet-out" });
    await act(async () => sheet.dispatchEvent(end));
    expect(sheet.open).toBe(false);
  });

  it("fades for 200 ms under reduced motion, instead of closing at once", async () => {
    media["(prefers-reduced-motion: reduce)"] = true;
    const onClose = vi.fn();
    await render(ui(true, onClose));
    const sheet = first();
    await act(async () => closeButton(sheet).click());
    expect(sheet.open).toBe(true);
    expect(sheet.hasAttribute("data-closing")).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await wait(240);
    expect(sheet.open).toBe(true);
    await wait(20);
    expect(sheet.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ends with its fade under reduced motion", async () => {
    media["(prefers-reduced-motion: reduce)"] = true;
    await render(ui(true));
    const sheet = first();
    await act(async () => closeButton(sheet).click());
    const end = new Event("animationend", { bubbles: true });
    Object.defineProperty(end, "animationName", { value: "sheet-fade-out" });
    await act(async () => sheet.dispatchEvent(end));
    expect(sheet.open).toBe(false);
  });
});

describe("a tray", () => {
  const ui = (open: boolean, onClose = () => {}) => (
    <>
      <div data-testid="page">text</div>
      <Sheet open={open} onClose={onClose} title="Reading settings" modal={false}>
        <button>Larger</button>
      </Sheet>
    </>
  );
  const page = () => host.querySelector<HTMLElement>("[data-testid=page]")!;

  it("opens with show(), not showModal(), and marks the page without freezing it", async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const show = vi.spyOn(HTMLDialogElement.prototype, "show");
    await render(ui(true));
    const tray = first();
    expect(tray.open).toBe(true);
    expect(show).toHaveBeenCalledTimes(1);
    expect(showModal).not.toHaveBeenCalled();
    expect(tray.hasAttribute("data-tray")).toBe(true);
    // The tab bar hides for any mark; only the empty one freezes the page.
    expect(mark()).toBe("tray");
    // Out of its owner's stacking context, as it is not in the top layer.
    expect(tray.parentElement).toBe(document.body);
    expect(document.querySelector(OVERLAY_SELECTOR)).toBe(tray);
  });

  it("has a grip and a name but no title row", async () => {
    await render(ui(true));
    const tray = first();
    expect(tray.getAttribute("aria-label")).toBe("Reading settings");
    expect(tray.querySelector("[data-sheet-grip]")).not.toBeNull();
    expect(tray.querySelector("h2")).toBeNull();
    expect(closeButton(tray)).toBeNull();
  });

  it("takes focus itself, not a field's: the keyboard stays down", async () => {
    await render(
      <Sheet open onClose={() => {}} title="Highlight" modal={false}>
        <button>Yellow</button>
        <input aria-label="Add a tag" />
      </Sheet>,
    );
    expect(document.activeElement).toBe(first());
    // A modal sheet still gives its first field focus.
    await render(
      <Sheet open onClose={() => {}} title="Note">
        <textarea />
      </Sheet>,
    );
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
  });

  it("closes on Esc", async () => {
    const onClose = vi.fn();
    await render(ui(true, onClose));
    await act(async () =>
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
    );
    expect(first().dataset.closing).toBe("tap");
    await settle();
    expect(first().open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(marked()).toBe(false);
  });

  it("closes on a press outside it, and is still open when the press lands", async () => {
    const onClose = vi.fn();
    await render(ui(true, onClose));
    let openAtDown: boolean | undefined;
    page().addEventListener("pointerdown", () => (openAtDown = Boolean(document.querySelector(OVERLAY_SELECTOR))));
    await pressOn(page());
    expect(openAtDown).toBe(true);
    // Still an overlay through its exit, for the click that follows.
    expect(document.querySelector(OVERLAY_SELECTOR)).toBe(first());
    await settle();
    expect(first().open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open for a press inside it", async () => {
    await render(ui(true));
    await pressOn(first().querySelector("button")!);
    await settle();
    expect(first().open).toBe(true);
  });

  it("stays open when the press outside turns into a scroll or a swipe", async () => {
    await render(ui(true));
    // The browser cancels a press it takes for a scroll.
    await act(async () => {
      page().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 3, clientX: 100, clientY: 300 }));
      page().dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 3 }));
      page().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, clientX: 100, clientY: 300 }));
    });
    await pressOn(page(), { moveTo: { x: 100, y: 180 } });
    await settle();
    expect(first().open).toBe(true);
    expect(mark()).toBe("tray");
  });

  it("gives way to a modal sheet's mark, and gets its own back", async () => {
    const both = (tray: boolean, modal: boolean) => (
      <>
        <Sheet open={tray} onClose={() => {}} title="Tray" modal={false}>
          t
        </Sheet>
        <Sheet open={modal} onClose={() => {}} title="Modal">
          m
        </Sheet>
      </>
    );
    await render(both(true, false));
    expect(mark()).toBe("tray");
    await render(both(true, true));
    expect(mark()).toBe("");
    await render(both(true, false));
    await settle();
    expect(mark()).toBe("tray");
    await render(both(false, false));
    await settle();
    expect(marked()).toBe(false);
  });
});

describe("Dialog", () => {
  it("is a sheet on a phone", async () => {
    await render(
      <Dialog open onClose={() => {}} title="New file">
        <input />
      </Dialog>,
    );
    const sheet = first();
    expect(sheet.dataset.size).toBe("content");
    expect(closeButton(sheet)).not.toBeNull();
    expect(document.activeElement?.tagName).toBe("INPUT");
  });

  it("is a window with the overlay mark on a desktop", async () => {
    media["(max-width: 767px)"] = false;
    await render(
      <Dialog open onClose={() => {}} title="New file">
        <input />
      </Dialog>,
    );
    expect(sheets()).toHaveLength(0);
    const dialog = document.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.hasAttribute("data-reader-overlay")).toBe(true);
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(marked()).toBe(false);
  });

  it("is an overlay to the reader only while open, on a desktop too", async () => {
    media["(max-width: 767px)"] = false;
    const ui = (open: boolean) => (
      <Dialog open={open} onClose={() => {}} title="New file">
        <input />
      </Dialog>
    );
    await render(ui(false));
    const dialog = document.querySelector("dialog")!;
    expect(dialog.hasAttribute("role")).toBe(false);
    expect(dialog.hasAttribute("data-reader-overlay")).toBe(false);
    expect(document.querySelector(OVERLAY_SELECTOR)).toBeNull();
    await render(ui(true));
    expect(document.querySelector(OVERLAY_SELECTOR)).toBe(dialog);
    await render(ui(false));
    expect(document.querySelector(OVERLAY_SELECTOR)).toBeNull();
  });
});

describe("a press on the page beside a sheet", () => {
  // The reader's page as both layouts wire it: the arbiter's handlers, and what a chapter drag asks.
  function Page({
    open,
    modal = true,
    onTap,
    onDrag,
  }: {
    open: boolean;
    modal?: boolean;
    onTap: () => void;
    onDrag: (ok: boolean) => void;
  }) {
    const presses = usePressArbiter({ userScrolledAt: () => 0, onTap });
    return (
      <>
        <div
          data-testid="page"
          {...presses}
          onPointerDown={(e) => {
            presses.onPointerDown(e);
            onDrag(
              canStartDrag({
                kind: pointerKind(e.pointerType),
                primary: e.isPrimary,
                x: e.clientX,
                inOverlay: false,
                hadSelection: false,
                hadOverlay: Boolean(document.querySelector(OVERLAY_SELECTOR)),
                zoom: 1,
                turning: false,
              }),
            );
          }}
        >
          text
        </div>
        <Sheet open={open} onClose={() => {}} title="Contents" modal={modal}>
          <p>inside</p>
        </Sheet>
      </>
    );
  }

  async function press() {
    const page = host.querySelector<HTMLElement>("[data-testid=page]")!;
    const at = { bubbles: true, cancelable: true, clientX: 200, clientY: 400 };
    await act(async () => {
      page.dispatchEvent(new PointerEvent("pointerdown", { ...at, pointerId: 1, pointerType: "touch", isPrimary: true }));
      page.dispatchEvent(new PointerEvent("pointerup", { ...at, pointerId: 1, pointerType: "touch", isPrimary: true }));
      page.dispatchEvent(new MouseEvent("click", { ...at, button: 0 }));
    });
  }

  it("is a free tap, and may drag, while the sheet is closed", async () => {
    const onTap = vi.fn();
    const onDrag = vi.fn();
    await render(<Page open={false} onTap={onTap} onDrag={onDrag} />);
    await press();
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onDrag).toHaveBeenLastCalledWith(true);
  });

  it("only dismisses while the sheet is open", async () => {
    const onTap = vi.fn();
    const onDrag = vi.fn();
    await render(<Page open onTap={onTap} onDrag={onDrag} />);
    await press();
    expect(onTap).not.toHaveBeenCalled();
    expect(onDrag).toHaveBeenLastCalledWith(false);
  });

  it("closes a tray and does nothing else; the next press is free", async () => {
    const onTap = vi.fn();
    const onDrag = vi.fn();
    await render(<Page open modal={false} onTap={onTap} onDrag={onDrag} />);
    await press();
    expect(onTap).not.toHaveBeenCalled();
    expect(onDrag).toHaveBeenLastCalledWith(false);
    expect(first().hasAttribute("data-closing")).toBe(true);
    await settle();
    expect(first().open).toBe(false);
    await press();
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});

describe("ContextMenu on a phone", () => {
  it("is a sheet whose pick closes it and then runs the action", async () => {
    const calls: string[] = [];
    function Host() {
      const [shown, setShown] = useState(true);
      return shown ? (
        <ContextMenu
          label="Book"
          at={{ x: 10, y: 10 }}
          items={[{ id: "rename", label: "Rename", onSelect: () => calls.push("select"), hint: "F2" }]}
          onClose={() => {
            calls.push("close");
            setShown(false);
          }}
        />
      ) : null;
    }
    await render(<Host />);
    const sheet = first();
    expect(sheet.getAttribute("aria-label")).toBe("Book");
    const item = sheet.querySelector<HTMLButtonElement>("[role=menuitem]")!;
    // No key hints on a phone.
    expect(item.textContent).toBe("Rename");
    await act(async () => item.click());
    expect(first().dataset.closing).toBe("tap");
    await settle();
    expect(calls).toEqual(["close", "select"]);
    expect(sheets()).toHaveLength(0);
  });

  const entry = (id: string, danger?: boolean): MenuEntry => ({
    id,
    label: id,
    onSelect: () => {},
    ...(danger ? { danger } : {}),
  });
  const ids = (items: MenuEntry[]) => items.map((item) => (item === "separator" ? "-" : item.id));

  it("says what it acts on, and lists what destroys last, after one divider", async () => {
    await render(
      <ContextMenu
        label="Middlemarch"
        subtitle="George Eliot"
        at={{ x: 10, y: 10 }}
        items={[entry("delete", true), "separator", entry("open"), entry("rename"), "separator"]}
        onClose={() => {}}
      />,
    );
    const sheet = first();
    expect(sheet.querySelector("h2")?.textContent).toBe("Middlemarch");
    expect(sheet.querySelector("[data-sheet-subtitle]")?.textContent).toBe("George Eliot");
    const rows = Array.from(sheet.querySelectorAll("[role=menu] > *"));
    expect(rows.map((row) => (row.getAttribute("role") === "separator" ? "-" : row.textContent))).toEqual([
      "open",
      "rename",
      "-",
      "delete",
    ]);
    expect(rows[rows.length - 1]?.className).toContain("text-error");
    expect(rows[0]?.className).not.toContain("text-error");
  });

  it("orders any menu: danger last after one divider, none leading, trailing or doubled", () => {
    expect(ids(sheetMenuOrder([entry("a"), entry("b"), "separator", entry("x", true)]))).toEqual(["a", "b", "-", "x"]);
    expect(ids(sheetMenuOrder([entry("x", true), entry("a"), "separator", "separator", entry("b"), entry("y", true)]))).toEqual([
      "a",
      "-",
      "b",
      "-",
      "x",
      "y",
    ]);
    expect(ids(sheetMenuOrder(["separator", entry("a"), "separator", entry("x", true), "separator"]))).toEqual(["a", "-", "x"]);
    expect(ids(sheetMenuOrder([entry("x", true)]))).toEqual(["x"]);
    expect(ids(sheetMenuOrder([entry("a"), "separator", entry("b")]))).toEqual(["a", "-", "b"]);
    expect(ids(sheetMenuOrder([]))).toEqual([]);
  });

  it("keeps the order it was given at the pointer, on a desktop", async () => {
    media["(max-width: 767px)"] = false;
    await render(
      <ContextMenu
        label="Book"
        subtitle="Author"
        at={{ x: 10, y: 10 }}
        items={[entry("delete", true), entry("open")]}
        onClose={() => {}}
      />,
    );
    expect(sheets()).toHaveLength(0);
    const rows = Array.from(document.querySelectorAll("[role=menuitem]")).map((row) => row.textContent);
    expect(rows).toEqual(["delete", "open"]);
    expect(document.body.textContent).not.toContain("Author");
  });
});

describe("Popover on a phone", () => {
  it("opens a sheet from its trigger", async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    await render(
      <Popover title="Reading settings" trigger={(props) => <button {...props}>Aa</button>}>
        <p>settings</p>
      </Popover>,
    );
    expect(first().open).toBe(false);
    await act(async () => host.querySelector("button")!.click());
    const sheet = first();
    expect(sheet.open).toBe(true);
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(sheet.getAttribute("aria-label")).toBe("Reading settings");
    expect(sheet.textContent).toContain("settings");
    await act(async () => closeButton(sheet).click());
    await settle();
    expect(sheet.open).toBe(false);
    expect(host.querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
  });

  describe("asked for a tray", () => {
    const ui = (
      <Popover tray title="Reading settings" trigger={(props) => <button {...props}>Aa</button>}>
        <p>settings</p>
      </Popover>
    );
    const trigger = () => host.querySelector<HTMLButtonElement>("button")!;

    it("opens a tray", async () => {
      const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
      await render(ui);
      await act(async () => trigger().click());
      const tray = first();
      expect(tray.open).toBe(true);
      expect(showModal).not.toHaveBeenCalled();
      expect(tray.hasAttribute("data-tray")).toBe(true);
      expect(trigger().getAttribute("aria-controls")).toBe(tray.id);
      expect(mark()).toBe("tray");
    });

    it("closes on a press on its trigger and stays closed", async () => {
      await render(ui);
      await act(async () => trigger().click());
      await pressOn(trigger());
      await act(async () => trigger().click());
      await settle();
      expect(first().open).toBe(false);
      expect(trigger().getAttribute("aria-expanded")).toBe("false");
      await wait(600);
      expect(first().open).toBe(false);
    });

    it("stays closed after a slow press on its trigger, too", async () => {
      await render(ui);
      await act(async () => trigger().click());
      // Held past the exit: a tray that closed on the press itself would be reopened by this click.
      await pressOn(trigger(), { holdMs: 450 });
      expect(first().open).toBe(true);
      await act(async () => trigger().click());
      await settle();
      expect(first().open).toBe(false);
      expect(trigger().getAttribute("aria-expanded")).toBe("false");
    });

    it("is a floating panel on a desktop, as before", async () => {
      media["(max-width: 767px)"] = false;
      await render(ui);
      await act(async () => trigger().click());
      expect(sheets()).toHaveLength(0);
      expect(host.querySelector("[role=dialog]")?.textContent).toBe("settings");
    });
  });
});
