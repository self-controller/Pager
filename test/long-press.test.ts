import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLongPress, LONG_PRESS_SLOP } from "@/components/ui/ContextMenu";

// The long press that opens a row's menu on a phone, as a real finger makes it: it drifts, it
// scrolls, and the browser may send a click when it lifts.

type Press = ReturnType<typeof createLongPress>;

function touch(x: number, y: number, extra: Partial<{ pointerType: "mouse" | "pen" | "touch"; isPrimary: boolean }> = {}) {
  return { pointerType: "touch" as const, isPrimary: true, clientX: x, clientY: y, ...extra };
}

/** A click as the browser sends it; true if it reached the page (wasn't swallowed). */
function click(): { reached: boolean; prevented: boolean } {
  let reached = false;
  const onClick = () => {
    reached = true;
  };
  document.body.addEventListener("click", onClick);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  document.body.removeEventListener("click", onClick);
  return { reached, prevented: event.defaultPrevented };
}

describe("a long press", () => {
  let pressed: Array<{ x: number; y: number }>;
  let press: Press;

  beforeEach(() => {
    vi.useFakeTimers();
    pressed = [];
    press = createLongPress((at) => pressed.push(at));
  });

  afterEach(() => {
    press.dispose();
    vi.useRealTimers();
  });

  it("fires after half a second, where the finger went down", () => {
    press.handlers.onPointerDown(touch(40, 200));
    vi.advanceTimersByTime(499);
    expect(pressed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(pressed).toEqual([{ x: 40, y: 200 }]);
  });

  it("is not a tap: lifting early cancels it", () => {
    press.handlers.onPointerDown(touch(40, 200));
    vi.advanceTimersByTime(200);
    press.handlers.onPointerUp();
    vi.advanceTimersByTime(1000);
    expect(pressed).toEqual([]);
    expect(click().reached).toBe(true);
  });

  it("lets the finger drift a little, as a real one does", () => {
    press.handlers.onPointerDown(touch(40, 200));
    press.handlers.onPointerMove(touch(43, 204));
    press.handlers.onPointerMove(touch(40 + LONG_PRESS_SLOP, 200));
    vi.advanceTimersByTime(500);
    expect(pressed).toHaveLength(1);
  });

  it("is cancelled by a longer move, or by the browser taking the touch to scroll", () => {
    press.handlers.onPointerDown(touch(40, 200));
    press.handlers.onPointerMove(touch(40, 200 + LONG_PRESS_SLOP + 1));
    vi.advanceTimersByTime(600);
    expect(pressed).toEqual([]);

    press.handlers.onPointerDown(touch(40, 200));
    press.handlers.onPointerCancel();
    vi.advanceTimersByTime(600);
    expect(pressed).toEqual([]);
  });

  it("ignores a mouse and a second finger", () => {
    press.handlers.onPointerDown(touch(40, 200, { pointerType: "mouse" }));
    press.handlers.onPointerDown(touch(40, 200, { isPrimary: false }));
    vi.advanceTimersByTime(600);
    expect(pressed).toEqual([]);
  });

  it("swallows the click that follows the press, wherever it lands, and only that one", () => {
    press.handlers.onPointerDown(touch(40, 200));
    vi.advanceTimersByTime(500);
    window.dispatchEvent(new Event("pointerup"));
    const first = click();
    expect(first).toEqual({ reached: false, prevented: true });
    expect(click().reached).toBe(true);
  });

  it("never swallows the next touch's click", () => {
    press.handlers.onPointerDown(touch(40, 200));
    vi.advanceTimersByTime(500);
    // The finger lifts with no click (iOS sends none after a long hold); then a tap on the menu.
    window.dispatchEvent(new Event("pointerup"));
    window.dispatchEvent(new Event("pointerdown"));
    expect(click().reached).toBe(true);
  });

  it("stops waiting for a click a moment after the finger lifts", () => {
    press.handlers.onPointerDown(touch(40, 200));
    vi.advanceTimersByTime(500);
    window.dispatchEvent(new Event("pointerup"));
    vi.advanceTimersByTime(400);
    expect(click().reached).toBe(true);
  });

  it("keeps one press across a second touch-down, and stops when disposed", () => {
    press.handlers.onPointerDown(touch(40, 200));
    vi.advanceTimersByTime(300);
    press.handlers.onPointerDown(touch(60, 220));
    vi.advanceTimersByTime(300);
    expect(pressed).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(pressed).toEqual([{ x: 60, y: 220 }]);

    press.handlers.onPointerDown(touch(40, 200));
    press.dispose();
    vi.advanceTimersByTime(600);
    expect(pressed).toHaveLength(1);
    expect(click().reached).toBe(true);
  });
});
