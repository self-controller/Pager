/**
 * Zoom and pan for the card map: pure math, no DOM. A transform maps the content to the screen as
 * `screen = content * scale + (x, y)`, which is CSS `translate(x, y) scale(scale)` with origin 0 0.
 */

export interface Transform {
  x: number;
  y: number;
  scale: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Limits {
  minScale: number;
  maxScale: number;
}

/** The closest a map can come: 2.5 times its real size. */
export const MAX_SCALE = 2.5;

/** The transform that shows all the content, centered, `padding` in from the viewport's edges. */
export function fit(content: Size, viewport: Size, padding = 0): Transform {
  const w = Math.max(1, viewport.w - 2 * padding);
  const h = Math.max(1, viewport.h - 2 * padding);
  const scale = Math.min(w / Math.max(1, content.w), h / Math.max(1, content.h));
  return { scale, x: (viewport.w - content.w * scale) / 2, y: (viewport.h - content.h * scale) / 2 };
}

/** The zoom's limits for this content: from the fit (never smaller) to 2.5 times its real size. */
export function zoomLimits(content: Size, viewport: Size): Limits {
  const min = fit(content, viewport).scale;
  return { minScale: min, maxScale: Math.max(min, MAX_SCALE) };
}

/**
 * Zooms by `factor` about a screen point: the content under it stays under it. With `limits`, the
 * scale stops at them (and the point still stays put).
 */
export function zoomAt(t: Transform, factor: number, point: Point, limits?: Limits): Transform {
  let scale = t.scale * factor;
  if (limits) scale = Math.min(limits.maxScale, Math.max(limits.minScale, scale));
  const k = scale / t.scale;
  return { scale, x: point.x - (point.x - t.x) * k, y: point.y - (point.y - t.y) * k };
}

/** One axis's allowed offsets: the content can't leave the viewport, and one smaller than it stays centered. */
function axis(offset: number, size: number, view: number): number {
  if (size <= view) return (view - size) / 2;
  return Math.min(0, Math.max(view - size, offset));
}

/**
 * Keeps a transform within the limits and the content on the screen: the scale between the limits
 * (about the viewport's centre), the content's edges never inside the viewport's unless it's smaller
 * than the viewport on that axis, where it's centered.
 */
export function clampTransform(t: Transform, content: Size, viewport: Size, limits: Limits): Transform {
  const scale = Math.min(limits.maxScale, Math.max(limits.minScale, t.scale));
  const s = scale === t.scale ? t : zoomAt(t, scale / t.scale, { x: viewport.w / 2, y: viewport.h / 2 });
  return {
    scale,
    x: axis(s.x, content.w * scale, viewport.w),
    y: axis(s.y, content.h * scale, viewport.h),
  };
}

/**
 * One step of a one-finger pan: the transform moved by `d` and kept on the screen. At the map's edge
 * it stops there, and at the fit it doesn't move: the page is never scrolled from here.
 */
export function panBy(t: Transform, d: Point, content: Size, viewport: Size, limits: Limits): Transform {
  return clampTransform({ scale: t.scale, x: t.x + d.x, y: t.y + d.y }, content, viewport, limits);
}

/** Whether two transforms show the same thing, within a pixel and a fraction of a percent. */
export function sameTransform(a: Transform, b: Transform): boolean {
  return Math.abs(a.scale / b.scale - 1) < 0.005 && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
}

/** Whether a transform is (about) the fitted one. */
export function isFit(t: Transform, content: Size, viewport: Size): boolean {
  return sameTransform(t, fit(content, viewport));
}

/**
 * The smallest pan that brings a content rect into the viewport, `margin` in from its edges (a card
 * reached with the keyboard). A rect too big for it shows its top-left.
 */
export function panIntoView(t: Transform, rect: Rect, viewport: Size, margin = 8): Transform {
  const along = (offset: number, start: number, length: number, lo: number, hi: number) => {
    const a = start * t.scale + offset;
    const b = a + length * t.scale;
    if (a < lo || b - a > hi - lo) return offset + lo - a;
    if (b > hi) return offset + hi - b;
    return offset;
  };
  return {
    scale: t.scale,
    x: along(t.x, rect.x, rect.w, margin, viewport.w - margin),
    y: along(t.y, rect.y, rect.h, margin, viewport.h - margin),
  };
}

/** The transform as CSS. */
export function transformCss(t: Transform): string {
  return `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
}
