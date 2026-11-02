import { describe, expect, it } from "vitest";
import { chromeStep, holdChrome, initialChromeScroll, type ChromeScroll } from "@/components/reader/scrollChrome";

function run(tops: number[], state: ChromeScroll = initialChromeScroll(), max = 5000, now = 1000) {
  const shows: (boolean | null)[] = [];
  for (const top of tops) {
    const r = chromeStep(state, { top, max, now });
    state = r.state;
    shows.push(r.show);
  }
  return { state, shows };
}

describe("chrome that follows the scroll", () => {
  it("hides after 10 px down and shows after 10 px up", () => {
    expect(run([100, 104, 109]).shows).toEqual([false, null, null]); // from 0 to 100 is past 10
    const s = initialChromeScroll(200);
    expect(run([204, 209, 210], s).shows).toEqual([null, null, false]);
    expect(run([196, 191, 190], s).shows).toEqual([null, null, true]);
  });

  it("starts counting again when the direction turns", () => {
    const s = initialChromeScroll(200);
    expect(run([208, 202, 209, 211], s).shows).toEqual([null, null, null, null]);
  });

  it("always shows at the top, rubber-banding past it included", () => {
    const s = initialChromeScroll(300);
    expect(run([0], s).shows).toEqual([true]);
    expect(run([-30], s).shows).toEqual([true]);
  });

  it("doesn't take the bounce back from the bottom for scrolling up", () => {
    const s = initialChromeScroll(980);
    const { shows } = run([1000, 1040, 1020, 1000], s, 1000);
    expect(shows).toEqual([false, null, null, null]);
  });

  it("holds still for a while after a chapter turn", () => {
    const held = holdChrome(initialChromeScroll(0), 1000);
    expect(run([400], held, 5000, 1200).shows).toEqual([null]);
    const after = run([400], held, 5000, 1200).state;
    expect(chromeStep(after, { top: 420, max: 5000, now: 1600 }).show).toBe(false);
  });
});
