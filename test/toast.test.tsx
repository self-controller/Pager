import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_ACTION_MS, TOAST_LEAVE_MS, TOAST_MS, ToastProvider, useToast, type ToastOptions } from "@/components/ui/Toast";

// The toast's life: how long it stays, how it leaves, and what a second one does to the first.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
let show: (options: ToastOptions) => void;

function Grab() {
  show = useToast().toast;
  return null;
}

/** The toast on the page, if any. */
function shown(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".toast");
}

function leaving(): boolean {
  return shown()?.hasAttribute("data-leaving") ?? false;
}

async function toast(options: ToastOptions) {
  await act(async () => show(options));
}

/** Lets time pass: no animations run here, so the toast lives on its own timers. */
async function wait(ms: number) {
  await act(async () => vi.advanceTimersByTime(ms));
}

beforeEach(async () => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <ToastProvider>
        <Grab />
      </ToastProvider>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("how long a toast stays", () => {
  it("a plain notice stays 3 s, fades for 200 ms and is then removed", async () => {
    expect(TOAST_MS).toBe(3000);
    expect(TOAST_LEAVE_MS).toBe(200);
    await toast({ message: "Reattached" });
    expect(shown()?.textContent).toBe("Reattached");
    expect(leaving()).toBe(false);
    await wait(2999);
    expect(leaving()).toBe(false);
    await wait(1);
    expect(shown()).not.toBeNull();
    expect(leaving()).toBe(true);
    await wait(199);
    expect(shown()).not.toBeNull();
    await wait(1);
    expect(shown()).toBeNull();
  });

  it("one with an action stays 5 s", async () => {
    expect(TOAST_ACTION_MS).toBe(5000);
    await toast({ message: "Highlight removed", action: { label: "Undo", onClick: () => {} } });
    await wait(4999);
    expect(leaving()).toBe(false);
    await wait(1);
    expect(leaving()).toBe(true);
    await wait(200);
    expect(shown()).toBeNull();
  });

  it("an explicit duration wins, with an action or without", async () => {
    await toast({ message: "Short", duration: 1000, action: { label: "Undo", onClick: () => {} } });
    await wait(999);
    expect(leaving()).toBe(false);
    await wait(1);
    expect(leaving()).toBe(true);
    await wait(200);
    expect(shown()).toBeNull();

    await toast({ message: "Long", duration: 8000 });
    await wait(7999);
    expect(leaving()).toBe(false);
    await wait(1);
    expect(leaving()).toBe(true);
  });
});

describe("a second toast", () => {
  it("replaces the first at once, as a new element with its own time", async () => {
    await toast({ message: "First" });
    const first = shown();
    await wait(2000);
    await toast({ message: "Second" });
    expect(document.querySelectorAll(".toast")).toHaveLength(1);
    expect(shown()?.textContent).toBe("Second");
    // A new element, so its entrance runs again.
    expect(shown()).not.toBe(first);
    // The first one's timer is gone: the second stays its full 3 s.
    await wait(2999);
    expect(leaving()).toBe(false);
    await wait(1);
    expect(leaving()).toBe(true);
  });

  it("replaces one that is fading out, and is not removed by its timer", async () => {
    await toast({ message: "First" });
    await wait(3100);
    expect(leaving()).toBe(true);
    await toast({ message: "Second" });
    expect(shown()?.textContent).toBe("Second");
    expect(leaving()).toBe(false);
    await wait(200);
    expect(shown()?.textContent).toBe("Second");
  });
});

describe("the toast's action", () => {
  it("runs once, and the toast fades out", async () => {
    const undo = vi.fn();
    await toast({ message: "Highlight removed", action: { label: "Undo", onClick: undo } });
    const button = shown()!.querySelector("button")!;
    await act(async () => button.click());
    expect(undo).toHaveBeenCalledTimes(1);
    expect(leaving()).toBe(true);
    await act(async () => button.click());
    expect(undo).toHaveBeenCalledTimes(1);
    await wait(200);
    expect(shown()).toBeNull();
  });
});

describe("for a screen reader", () => {
  it("the live region is always there, and the toast appears inside it", async () => {
    const region = document.querySelector('[role="status"][aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region!.childElementCount).toBe(0);
    await toast({ message: "Moved to Library" });
    expect(region!.contains(shown())).toBe(true);
  });
});
