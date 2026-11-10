import { describe, expect, it } from "vitest";
import {
  judgePress,
  OVERLAY_SELECTOR,
  pointerKind,
  scrollZone,
  swipeTurn,
  tapAction,
  turnMotion,
  zoneAt,
  type Press,
} from "@/components/reader/gestures";
import { pageAtScroll } from "@/components/reader/pagination";

const tap = (over: Partial<Press> = {}): Press => ({
  kind: "touch",
  dx: 0,
  dy: 0,
  ms: 90,
  scrolled: false,
  sinceScroll: Infinity,
  hadSelection: false,
  hadOverlay: false,
  ...over,
});

describe("judging a press", () => {
  it("lets a short, still press through as a tap", () => {
    expect(judgePress(tap())).toBe("tap");
    expect(judgePress(tap({ dx: 10, dy: -10 }))).toBe("tap"); // 14 px: inside the slop
    expect(judgePress(tap({ ms: 499 }))).toBe("tap");
  });

  it("drops a press that moved past the slop", () => {
    expect(judgePress(tap({ dx: 16 }))).toBe("ignore");
    expect(judgePress(tap({ kind: "mouse", dx: 12, dy: 12 }))).toBe("ignore");
  });

  it("never acts on a long touch press, but a slow mouse click is still a click", () => {
    expect(judgePress(tap({ ms: 500 }))).toBe("ignore");
    expect(judgePress(tap({ kind: "pen", ms: 900 }))).toBe("ignore");
    expect(judgePress(tap({ kind: "mouse", ms: 900 }))).toBe("tap");
  });

  it("drops the tap that ends a scroll", () => {
    expect(judgePress(tap({ scrolled: true }))).toBe("ignore");
    expect(judgePress(tap({ sinceScroll: 149 }))).toBe("ignore");
    expect(judgePress(tap({ sinceScroll: 150 }))).toBe("tap");
  });

  it("only dismisses when a selection or an overlay was open at the press", () => {
    expect(judgePress(tap({ hadSelection: true }))).toBe("dismiss");
    expect(judgePress(tap({ hadOverlay: true }))).toBe("dismiss");
    expect(judgePress(tap({ hadOverlay: true, dx: 40 }))).toBe("dismiss");
  });

  it("reads pointer types", () => {
    expect(pointerKind("touch")).toBe("touch");
    expect(pointerKind("pen")).toBe("pen");
    expect(pointerKind("mouse")).toBe("mouse");
    expect(pointerKind("")).toBe("mouse");
  });
});

describe("what counts as an open overlay", () => {
  const overlays = (html: string): number => {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    try {
      return document.querySelectorAll(OVERLAY_SELECTOR).length;
    } finally {
      host.remove();
    }
  };

  it("finds marked panels and open dialogs", () => {
    expect(overlays("<p>text</p>")).toBe(0);
    expect(overlays("<div data-reader-overlay></div>")).toBe(1);
    expect(overlays('<div role="dialog"></div>')).toBe(1);
    expect(overlays("<ol data-reader-overlay></ol><div role='dialog' data-reader-overlay></div>")).toBe(2);
    expect(overlays('<dialog open role="dialog" data-reader-overlay=""></dialog>')).toBe(1);
    expect(overlays("<dialog open></dialog>")).toBe(1);
  });

  it("skips a closed dialog, whatever it carries", () => {
    expect(overlays("<dialog></dialog>")).toBe(0);
    expect(overlays('<dialog role="dialog" data-reader-overlay=""></dialog>')).toBe(0);
    // What is inside a closed dialog isn't on screen, but nothing renders there (Sheet, Dialog).
    expect(overlays('<dialog role="dialog"></dialog><div data-reader-overlay></div>')).toBe(1);
  });
});

describe("tap zones", () => {
  it("splits touch into back, chrome band and forward at 37.5% and 62.5%", () => {
    expect(zoneAt(0, "touch")).toBe("prev");
    expect(zoneAt(0.37, "touch")).toBe("prev");
    expect(zoneAt(0.375, "touch")).toBe("centre");
    expect(zoneAt(0.5, "pen")).toBe("centre");
    expect(zoneAt(0.625, "touch")).toBe("centre");
    expect(zoneAt(0.63, "touch")).toBe("next");
    expect(zoneAt(1, "touch")).toBe("next");
  });

  it("keeps the mouse to the outer 18% on each side", () => {
    expect(zoneAt(0.1, "mouse")).toBe("prev");
    expect(zoneAt(0.2, "mouse")).toBeNull();
    expect(zoneAt(0.5, "mouse")).toBeNull();
    expect(zoneAt(0.9, "mouse")).toBe("next");
  });

  it("turns, toggles, or only hides the chrome", () => {
    expect(tapAction("centre", "touch", true)).toBe("toggle-chrome");
    expect(tapAction("centre", "touch", false)).toBe("toggle-chrome");
    // While the chrome shows, the first tap outside the band only hides it.
    expect(tapAction("next", "touch", true)).toBe("hide-chrome");
    expect(tapAction("prev", "pen", true)).toBe("hide-chrome");
    expect(tapAction("next", "touch", false)).toBe("next");
    expect(tapAction("prev", "touch", false)).toBe("prev");
    // A mouse turns whatever the chrome does, and never hides it.
    expect(tapAction("next", "mouse", true)).toBe("next");
    expect(tapAction("prev", "mouse", true)).toBe("prev");
    expect(tapAction(null, "mouse", true)).toBeNull();
  });
});

describe("taps in the Scroll layout", () => {
  it("makes every touch tap the chrome toggle, and a mouse click nothing", () => {
    expect(tapAction(scrollZone("touch"), "touch", false)).toBe("toggle-chrome");
    expect(tapAction(scrollZone("pen"), "pen", true)).toBe("toggle-chrome");
    expect(tapAction(scrollZone("mouse"), "mouse", true)).toBeNull();
  });
});

describe("swipes and page-turn motion", () => {
  it("turns on a horizontal swipe the pages can't follow themselves", () => {
    expect(swipeTurn(-60, 5, 200, 400)).toBe(1);
    expect(swipeTurn(60, -5, 200, 400)).toBe(-1);
    expect(swipeTurn(-30, 0, 100, 400)).toBe(0); // too short
    expect(swipeTurn(-60, 50, 200, 400)).toBe(0); // too diagonal
    expect(swipeTurn(-60, 0, 900, 400)).toBe(0); // too slow…
    expect(swipeTurn(-130, 0, 900, 400)).toBe(1); // …unless it crossed 30% of the page
  });

  it("cuts every turn under reduced motion", () => {
    expect(turnMotion("slide", false)).toBe("slide");
    expect(turnMotion("fade", false)).toBe("fade");
    expect(turnMotion("none", false)).toBe("none");
    expect(turnMotion("slide", true)).toBe("none");
    expect(turnMotion("fade", true)).toBe("none");
  });

  it("settles on the page nearest the scroll position", () => {
    const w = 600;
    const gap = 64;
    expect(pageAtScroll(0, w, gap, 5)).toBe(0);
    expect(pageAtScroll(331, w, gap, 5)).toBe(0);
    expect(pageAtScroll(333, w, gap, 5)).toBe(1);
    expect(pageAtScroll(2 * 664, w, gap, 5)).toBe(2);
    expect(pageAtScroll(99 * 664, w, gap, 5)).toBe(4);
    expect(pageAtScroll(-40, w, gap, 5)).toBe(0); // rubber-banding past the start
    expect(pageAtScroll(100, 0, gap, 5)).toBe(0);
  });
});
