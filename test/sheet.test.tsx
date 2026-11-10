import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canStartDrag } from "@/components/reader/chapterTurn";
import { OVERLAY_SELECTOR, pointerKind } from "@/components/reader/gestures";
import { usePressArbiter } from "@/components/reader/usePressArbiter";
import { ContextMenu } from "@/components/ui/ContextMenu";
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

function marked(): boolean {
  return "sheetOpen" in document.documentElement.dataset;
}

function closeButton(sheet: Element): HTMLButtonElement {
  return sheet.querySelector<HTMLButtonElement>("button[aria-label='Close']")!;
}

async function render(ui: ReactNode) {
  await act(async () => root.render(ui));
}

beforeEach(() => {
  // A phone that asked for less motion: sheets close at once.
  media = { "(max-width: 767px)": true, "(prefers-reduced-motion: reduce)": true };
  vi.spyOn(window, "matchMedia").mockImplementation(mediaList);
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
    await render(
      <Sheet open onClose={() => {}} title="Things" size="tall">
        <p>inside</p>
      </Sheet>,
    );
    const sheet = first();
    expect(sheet.open).toBe(true);
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.hasAttribute("data-reader-overlay")).toBe(true);
    expect(sheet.getAttribute("aria-label")).toBe("Things");
    expect(sheet.dataset.size).toBe("tall");
    expect(sheet.querySelector("[data-sheet-grip]")).not.toBeNull();
    expect(sheet.querySelector("[data-sheet-body]")?.textContent).toBe("inside");
    expect(marked()).toBe(true);
  });

  it("tells its owner once when the close button closes it, and clears the mark", async () => {
    const onClose = vi.fn();
    await render(
      <Sheet open onClose={onClose} title="Things">
        <p>inside</p>
      </Sheet>,
    );
    await act(async () => closeButton(first()).click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(first().open).toBe(false);
    expect(marked()).toBe(false);
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
    expect(first().hasAttribute("role")).toBe(false);
    expect(document.querySelector(OVERLAY_SELECTOR)).toBeNull();
  });

  it("is still an overlay while it slides away", async () => {
    media["(prefers-reduced-motion: reduce)"] = false;
    vi.useFakeTimers();
    await render(
      <Sheet open onClose={() => {}} title="Things">
        <p>inside</p>
      </Sheet>,
    );
    await act(async () => closeButton(first()).click());
    expect(first().hasAttribute("data-closing")).toBe(true);
    expect(document.querySelector(OVERLAY_SELECTOR)).toBe(first());
    await act(async () => vi.advanceTimersByTime(400));
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
    expect(marked()).toBe(true);
    await render(ui(false, false));
    expect(marked()).toBe(false);
  });

  it("slides away before it tells its owner", async () => {
    media["(prefers-reduced-motion: reduce)"] = false;
    vi.useFakeTimers();
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
    await act(async () => vi.advanceTimersByTime(400));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sheet.open).toBe(false);
    expect(sheet.hasAttribute("data-closing")).toBe(false);
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
  function Page({ open, onTap, onDrag }: { open: boolean; onTap: () => void; onDrag: (ok: boolean) => void }) {
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
        <Sheet open={open} onClose={() => {}} title="Contents">
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
    expect(calls).toEqual(["close", "select"]);
    expect(sheets()).toHaveLength(0);
  });
});

describe("Popover on a phone", () => {
  it("opens a sheet from its trigger", async () => {
    await render(
      <Popover title="Reading settings" trigger={(props) => <button {...props}>Aa</button>}>
        <p>settings</p>
      </Popover>,
    );
    expect(first().open).toBe(false);
    await act(async () => host.querySelector("button")!.click());
    const sheet = first();
    expect(sheet.open).toBe(true);
    expect(sheet.getAttribute("aria-label")).toBe("Reading settings");
    expect(sheet.textContent).toContain("settings");
    await act(async () => closeButton(sheet).click());
    expect(sheet.open).toBe(false);
    expect(host.querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
  });
});
