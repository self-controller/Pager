import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useListScroll } from "@/tools/context/useListScroll";

// The Assistant page's list and a book's Context share one page: where the page is scrolled when
// one replaces the other.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
let scrollY: number;
let scrollTo: ReturnType<typeof vi.fn>;
const realScrollTo = window.scrollTo;

function Page({ docId }: { docId: string | null }) {
  useListScroll(docId);
  return null;
}

async function show(docId: string | null) {
  await act(async () => root.render(<Page docId={docId} />));
}

/** The reader's finger: the page is at `top` and says so. */
async function scrolled(top: number) {
  scrollY = top;
  await act(async () => window.dispatchEvent(new Event("scroll")));
}

/** Where the hook last put the page. */
function put(): unknown {
  return scrollTo.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  scrollY = 0;
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
  // The page goes where it is put, without a scroll event: the tests send those themselves.
  scrollTo = vi.fn((to: { top: number }) => {
    scrollY = to.top;
  });
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.scrollTo = realScrollTo;
  delete (window as { scrollY?: number }).scrollY;
});

describe("useListScroll", () => {
  it("leaves the page alone when it first shows, on the list or in a book", async () => {
    await show(null);
    expect(scrollTo).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    root = createRoot(host);
    // A tab switch back to a book's Context restores that tab's own scroll.
    await show("darwin");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("opens a book's Context at its top, from a scrolled list", async () => {
    await show(null);
    await scrolled(420);
    await show("darwin");
    expect(put()).toEqual({ top: 0, behavior: "instant" });
  });

  it("brings the list back where it was left", async () => {
    await show(null);
    await scrolled(420);
    await show("darwin");
    await show(null);
    expect(put()).toEqual({ top: 420, behavior: "instant" });
  });

  it("puts the list at its top when it was never scrolled, however far the briefing was", async () => {
    await show(null);
    await show("darwin");
    // The briefing is long, and its Map tab scrolls the page down by itself.
    await scrolled(1800);
    scrollTo.mockClear();
    await show(null);
    // Without this the short list arrived with an offset past its end.
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(put()).toEqual({ top: 0, behavior: "instant" });
  });

  it("doesn't take a book's scroll for the list's", async () => {
    await show(null);
    await scrolled(420);
    await show("darwin");
    await scrolled(1800);
    await show(null);
    expect(put()).toEqual({ top: 420, behavior: "instant" });
  });

  it("follows the list again after a visit to a book", async () => {
    await show(null);
    await show("darwin");
    await show(null);
    await scrolled(250);
    await show("eliot");
    await show(null);
    expect(put()).toEqual({ top: 250, behavior: "instant" });
  });

  it("opens another book at its top too", async () => {
    await show("darwin");
    await scrolled(900);
    await show("eliot");
    expect(put()).toEqual({ top: 0, behavior: "instant" });
  });

  it("does nothing while the same page stays", async () => {
    await show("darwin");
    await show("darwin");
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
