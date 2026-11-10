import { act, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPENING_WAIT_MS, useOpeningFade } from "@/components/reader/useOpeningFade";

// The hook as ReaderPage uses it: its value after each commit is what a painted frame could show.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
/** The value at each commit, in order. */
let commits: (string | undefined)[];

function Probe({ ready }: { ready: boolean }) {
  const opening = useOpeningFade(ready);
  useLayoutEffect(() => {
    commits.push(opening);
  });
  return <div data-opening={opening} />;
}

/** Ready only after a layout effect of the mount sets state, as a cached chapter's placement does. */
function PlacedInLayout() {
  const [placed, setPlaced] = useState(false);
  useLayoutEffect(() => setPlaced(true), []);
  return <Probe ready={placed} />;
}

const shown = () => host.firstElementChild?.getAttribute("data-opening") ?? undefined;
const render = (el: React.ReactNode) => act(async () => root.render(el));
const pass = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
  commits = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("useOpeningFade", () => {
  it("neither holds nor fades text that is ready at the mount", async () => {
    await render(<Probe ready />);
    expect(shown()).toBeUndefined();
    await pass(OPENING_WAIT_MS + 1000);
    expect(shown()).toBeUndefined();
    // Never "in", and "wait" only in the commit that no frame shows.
    expect(commits).toEqual(["wait", undefined]);
  });

  it("neither holds nor fades text placed by a layout effect of the mount", async () => {
    await render(<PlacedInLayout />);
    expect(shown()).toBeUndefined();
    await pass(OPENING_WAIT_MS + 1000);
    expect(commits.filter((c) => c === "in")).toEqual([]);
    expect(commits.at(-1)).toBeUndefined();
  });

  it("holds text that is ready later, then fades it in, then is done", async () => {
    await render(<Probe ready={false} />);
    expect(shown()).toBe("wait");
    await pass(100); // frames have been painted
    expect(shown()).toBe("wait");
    await render(<Probe ready />);
    expect(shown()).toBe("in");
    await pass(100);
    expect(shown()).toBe("in");
    await pass(100);
    expect(shown()).toBeUndefined();
  });

  it("holds text that is ready one frame after the mount", async () => {
    await render(<Probe ready={false} />);
    await pass(17);
    await render(<Probe ready />);
    expect(shown()).toBe("in");
  });

  it("shows text that is never ready after the wait", async () => {
    await render(<Probe ready={false} />);
    await pass(OPENING_WAIT_MS - 1);
    expect(shown()).toBe("wait");
    await pass(1);
    expect(shown()).toBe("in");
    await pass(200);
    expect(shown()).toBeUndefined();
  });
});
