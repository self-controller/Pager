import { describe, expect, it } from "vitest";
import {
  clampTransform,
  fit,
  panBy,
  isFit,
  MAX_SCALE,
  panIntoView,
  sameTransform,
  transformCss,
  zoomAt,
  zoomLimits,
  type Transform,
} from "@/tools/context/zoom";

// A phone's map: a 700 px stage shown in a 350 px wide viewport of the same shape.
const content = { w: 700, h: 1000 };
const viewport = { w: 350, h: 500 };
const limits = zoomLimits(content, viewport);

describe("fitting the map", () => {
  it("contains the content, centered", () => {
    expect(fit(content, viewport)).toEqual({ scale: 0.5, x: 0, y: 0 });
    // Wider than the content's shape: centered across.
    expect(fit(content, { w: 450, h: 500 })).toEqual({ scale: 0.5, x: 50, y: 0 });
    // Taller: centered down.
    expect(fit({ w: 1000, h: 500 }, { w: 500, h: 500 })).toEqual({ scale: 0.5, x: 0, y: 125 });
    // A padding all round.
    const padded = fit(content, viewport, 10);
    expect(padded.scale).toBeCloseTo(330 / 700);
    expect(padded.x).toBeCloseTo(10);
    expect(padded.y).toBeCloseTo((500 - 1000 * padded.scale) / 2);
  });

  it("is real size where the stage is the viewport (the desktop at rest)", () => {
    expect(fit({ w: 1200, h: 800 }, { w: 1200, h: 800 })).toEqual({ scale: 1, x: 0, y: 0 });
    expect(zoomLimits({ w: 1200, h: 800 }, { w: 1200, h: 800 })).toEqual({ minScale: 1, maxScale: MAX_SCALE });
  });

  it("tells the fitted transform from a zoomed one", () => {
    expect(isFit({ scale: 0.5, x: 0.4, y: -0.3 }, content, viewport)).toBe(true);
    expect(isFit({ scale: 0.6, x: 0, y: 0 }, content, viewport)).toBe(false);
    expect(isFit({ scale: 0.5, x: 0, y: -20 }, content, viewport)).toBe(false);
    expect(sameTransform({ scale: 1, x: 3, y: 4 }, { scale: 1.001, x: 3.5, y: 4 })).toBe(true);
  });
});

describe("zooming", () => {
  it("keeps the point under the fingers where it is", () => {
    const t: Transform = { scale: 0.5, x: 0, y: 0 };
    const p = { x: 100, y: 300 };
    const z = zoomAt(t, 2, p);
    expect(z.scale).toBe(1);
    // The content point under p, before and after.
    const before = { x: (p.x - t.x) / t.scale, y: (p.y - t.y) / t.scale };
    expect(before.x * z.scale + z.x).toBeCloseTo(p.x);
    expect(before.y * z.scale + z.y).toBeCloseTo(p.y);
  });

  it("stops at the limits, the point still put", () => {
    const t: Transform = { scale: 2, x: -300, y: -100 };
    const p = { x: 200, y: 200 };
    const z = zoomAt(t, 4, p, limits);
    expect(z.scale).toBe(MAX_SCALE);
    const c = { x: (p.x - t.x) / t.scale, y: (p.y - t.y) / t.scale };
    expect(c.x * z.scale + z.x).toBeCloseTo(p.x);
    expect(zoomAt({ scale: 0.6, x: 0, y: 0 }, 0.1, p, limits).scale).toBe(0.5);
  });
});

describe("clamping", () => {
  it("never goes smaller than the fit or closer than 2.5 times", () => {
    expect(clampTransform({ scale: 0.2, x: 0, y: 0 }, content, viewport, limits)).toEqual({ scale: 0.5, x: 0, y: 0 });
    expect(clampTransform({ scale: 9, x: 0, y: 0 }, content, viewport, limits).scale).toBe(MAX_SCALE);
  });

  it("keeps the content on the screen", () => {
    // At 1×: 700×1000 in 350×500, so x in [-350, 0] and y in [-500, 0].
    expect(clampTransform({ scale: 1, x: 40, y: 30 }, content, viewport, limits)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(clampTransform({ scale: 1, x: -900, y: -900 }, content, viewport, limits)).toEqual({ scale: 1, x: -350, y: -500 });
    expect(clampTransform({ scale: 1, x: -100, y: -200 }, content, viewport, limits)).toEqual({ scale: 1, x: -100, y: -200 });
  });

  it("centers the content on an axis where it's smaller than the viewport", () => {
    // 1000×500 fitted in 500×500 is 250 tall: centered down, and it can't be dragged up or down.
    const wide = { w: 1000, h: 500 };
    const square = { w: 500, h: 500 };
    const l = zoomLimits(wide, square);
    expect(clampTransform({ scale: 0.5, x: 30, y: 0 }, wide, square, l)).toEqual({ scale: 0.5, x: 0, y: 125 });
  });
});

describe("panning with one finger", () => {
  it("moves the map while it can, and hands the rest of a vertical move to the page", () => {
    // At 1× the map can go from y 0 to -500.
    const t: Transform = { scale: 1, x: -100, y: -450 };
    expect(panBy(t, { x: 10, y: 30 }, content, viewport, limits)).toEqual({ t: { scale: 1, x: -90, y: -420 }, restY: 0 });
    // 80 up: 50 for the map, 30 for the page.
    expect(panBy(t, { x: 0, y: -80 }, content, viewport, limits)).toEqual({ t: { scale: 1, x: -100, y: -500 }, restY: -30 });
  });

  it("hands the whole vertical move to the page at the fit", () => {
    const fitted = fit(content, viewport);
    const step = panBy(fitted, { x: 5, y: 40 }, content, viewport, limits);
    expect(step.t).toEqual(fitted);
    expect(step.restY).toBe(40);
  });
});

describe("bringing a card into view", () => {
  const t: Transform = { scale: 1, x: 0, y: 0 };
  it("doesn't move what already shows", () => {
    expect(panIntoView(t, { x: 20, y: 20, w: 100, h: 60 }, viewport)).toEqual(t);
  });

  it("pans just enough", () => {
    expect(panIntoView(t, { x: 300, y: 600, w: 100, h: 60 }, viewport)).toEqual({ scale: 1, x: -58, y: -168 });
    expect(panIntoView({ scale: 1, x: -200, y: -200 }, { x: 20, y: 20, w: 100, h: 60 }, viewport)).toEqual({
      scale: 1,
      x: -12,
      y: -12,
    });
  });
});

it("writes the transform as CSS", () => {
  expect(transformCss({ scale: 0.5, x: 10, y: -4 })).toBe("translate(10px, -4px) scale(0.5)");
});
