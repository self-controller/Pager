import { describe, expect, it } from "vitest";
import {
  canStartDrag,
  CHAPTER_GAP,
  dragIntent,
  dragOffset,
  dragOutcome,
  initialWheel,
  releaseVelocity,
  settleDuration,
  SETTLE_MAX_MS,
  SETTLE_MIN_MS,
  turnTarget,
  wheelTurn,
  type DragStart,
} from "@/components/reader/chapterTurn";

const start = (over: Partial<DragStart> = {}): DragStart => ({
  kind: "touch",
  primary: true,
  x: 200,
  inOverlay: false,
  hadSelection: false,
  hadOverlay: false,
  zoom: 1,
  turning: false,
  ...over,
});

describe("starting a chapter drag", () => {
  it("lets a plain touch or pen press start one", () => {
    expect(canStartDrag(start())).toBe(true);
    expect(canStartDrag(start({ kind: "pen" }))).toBe(true);
  });

  it("never drags with a mouse, a second finger, or from the back-swipe edge", () => {
    expect(canStartDrag(start({ kind: "mouse" }))).toBe(false);
    expect(canStartDrag(start({ primary: false }))).toBe(false);
    expect(canStartDrag(start({ x: 10 }))).toBe(false);
    expect(canStartDrag(start({ x: 24 }))).toBe(true);
  });

  it("leaves selections, overlays, zoomed pages and a turn in progress alone", () => {
    expect(canStartDrag(start({ hadSelection: true }))).toBe(false);
    expect(canStartDrag(start({ hadOverlay: true }))).toBe(false);
    expect(canStartDrag(start({ inOverlay: true }))).toBe(false);
    expect(canStartDrag(start({ zoom: 1.5 }))).toBe(false);
    expect(canStartDrag(start({ turning: true }))).toBe(false);
  });
});

describe("deciding between a drag and a scroll", () => {
  it("waits until the press has moved 10 px", () => {
    expect(dragIntent(6, 6, 100)).toBe("pending");
    expect(dragIntent(12, 2, 100)).toBe("drag");
  });

  it("drags only when at least twice as sideways as vertical", () => {
    expect(dragIntent(-20, 10, 100)).toBe("drag");
    expect(dragIntent(-20, 11, 100)).toBe("scroll");
    expect(dragIntent(2, 30, 100)).toBe("scroll");
  });

  it("takes a still press held long for the start of a selection", () => {
    expect(dragIntent(3, 2, 500)).toBe("hold");
    expect(dragIntent(3, 2, 499)).toBe("pending");
  });
});

describe("following the finger", () => {
  const w = 390;
  it("moves one to one toward a chapter that exists", () => {
    expect(dragOffset(-100, w, true, true)).toBe(-100);
    expect(dragOffset(80, w, true, true)).toBe(80);
  });

  it("rubber-bands toward a missing chapter", () => {
    expect(dragOffset(-100, w, true, false)).toBeCloseTo(-35);
    expect(dragOffset(100, w, false, true)).toBeCloseTo(35);
  });

  it("never goes past the neighbour", () => {
    expect(dragOffset(-1000, w, true, true)).toBe(-(w + CHAPTER_GAP));
  });
});

describe("release velocity", () => {
  it("measures the last 100 ms of the drag", () => {
    const samples = [
      { x: 0, t: 0 },
      { x: -10, t: 150 },
      { x: -60, t: 250 },
    ];
    expect(releaseVelocity(samples, 250)).toBeCloseTo(-0.5);
  });

  it("is 0 when the finger had stopped before lifting", () => {
    expect(releaseVelocity([{ x: 0, t: 0 }, { x: -50, t: 40 }], 400)).toBe(0);
    expect(releaseVelocity([], 0)).toBe(0);
  });
});

describe("whether a released drag turns", () => {
  const base = { width: 400, canPrev: true, canNext: true, velocity: 0 };
  it("turns past 30% of the width", () => {
    expect(dragOutcome({ ...base, dx: -121 })).toBe(1);
    expect(dragOutcome({ ...base, dx: 121 })).toBe(-1);
    expect(dragOutcome({ ...base, dx: -119 })).toBe(0);
  });

  it("turns on a quick flick once it has travelled 40 px", () => {
    expect(dragOutcome({ ...base, dx: -45, velocity: -0.5 })).toBe(1);
    expect(dragOutcome({ ...base, dx: -30, velocity: -0.9 })).toBe(0);
    expect(dragOutcome({ ...base, dx: -45, velocity: -0.3 })).toBe(0);
  });

  it("cancels on a quick flick back toward the start", () => {
    expect(dragOutcome({ ...base, dx: -200, velocity: 0.5 })).toBe(0);
    expect(dragOutcome({ ...base, dx: -200, velocity: 0.3 })).toBe(1);
  });

  it("never turns toward a missing chapter", () => {
    expect(dragOutcome({ ...base, canNext: false, dx: -300 })).toBe(0);
    expect(dragOutcome({ ...base, canPrev: false, dx: 300 })).toBe(0);
    expect(dragOutcome({ ...base, dx: 0 })).toBe(0);
  });
});

describe("turn timing", () => {
  it("takes longer the more is left", () => {
    expect(settleDuration(0, 414)).toBe(SETTLE_MIN_MS);
    expect(settleDuration(414, 414)).toBe(SETTLE_MAX_MS);
    expect(settleDuration(-207, 414)).toBe(270);
  });

  it("stops with the neighbour fully in view", () => {
    expect(turnTarget(1, 390)).toBe(-(390 + CHAPTER_GAP));
    expect(turnTarget(-1, 390)).toBe(390 + CHAPTER_GAP);
  });
});

describe("sideways trackpad swipes", () => {
  it("turns once 80 px of sideways scrolling adds up", () => {
    let s = initialWheel();
    let r = wheelTurn(s, { dx: 40, dy: 0, now: 0 });
    expect(r.turn).toBe(0);
    r = wheelTurn(r.state, { dx: 45, dy: 2, now: 16 });
    expect(r.turn).toBe(1);
    s = initialWheel();
    expect(wheelTurn(s, { dx: -90, dy: 0, now: 0 }).turn).toBe(-1);
  });

  it("ignores vertical scrolling and a pause between strokes", () => {
    let r = wheelTurn(initialWheel(), { dx: 5, dy: 40, now: 0 });
    expect(r.turn).toBe(0);
    r = wheelTurn(r.state, { dx: 60, dy: 0, now: 10 });
    r = wheelTurn(r.state, { dx: 60, dy: 0, now: 300 });
    expect(r.turn).toBe(0);
  });

  it("never turns twice from one swipe's momentum", () => {
    let r = wheelTurn(initialWheel(), { dx: 100, dy: 0, now: 0 });
    expect(r.turn).toBe(1);
    for (let t = 16; t < 1500; t += 16) {
      r = wheelTurn(r.state, { dx: 30, dy: 0, now: t });
      expect(r.turn).toBe(0);
    }
    // Still for a moment, then a new swipe turns again.
    r = wheelTurn(r.state, { dx: 100, dy: 0, now: 2000 });
    expect(r.turn).toBe(1);
  });
});
