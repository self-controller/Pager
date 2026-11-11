import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentDetail } from "@/api/types";
import { ReaderTopBar } from "@/components/reader/ReaderTopBar";
import { TocDrawer } from "@/components/reader/TocDrawer";
import { moveInside, stepBack, trailOf, TRAIL_MAX, type Here } from "@/components/reader/trail";

// A visit to a book is one history step, so one Back from outside the page (the iPhone's edge swipe)
// leaves the book; the reader's own Back arrow still goes back through the book first.

const at = (path: string, state: unknown = null): Here => {
  const [pathname, hash = ""] = path.split("#");
  return { pathname: pathname!, hash: hash && `#${hash}`, state };
};

describe("a move inside the book", () => {
  it("replaces the visit's history step, and puts the place left on the trail", () => {
    const move = moveInside(at("/read/b/c1", { tabSwitch: true }), "/read/b/c2", { page: 0 });
    expect(move.replace).toBe(true);
    expect(move.state).toEqual({ page: 0, trail: [{ to: "/read/b/c1", state: { tabSwitch: true } }] });
  });

  it("adds to the trail it finds, oldest first, each place with the state it was opened with", () => {
    const first = moveInside(at("/read/b/c1"), "/read/b/c2", { page: 0 });
    const second = moveInside(at("/read/b/c2", first.state), "/read/b/c5#note-3", { jump: true });
    expect(trailOf(second.state)).toEqual([
      { to: "/read/b/c1", state: null },
      // Without the trail it carried: the trail is kept once, on the place the reader is at.
      { to: "/read/b/c2", state: { page: 0 } },
    ]);
    const third = moveInside(at("/read/b/c5#note-3", second.state), "/read/b/c6", { page: 0 });
    expect(trailOf(third.state).map((s) => s.to)).toEqual(["/read/b/c1", "/read/b/c2", "/read/b/c5#note-3"]);
  });

  it("adds nothing when it opens the place the reader is at (its chapter in Contents), and keeps the trail", () => {
    const first = moveInside(at("/read/b/c1"), "/read/b/c2", { page: 0 });
    const again = moveInside(at("/read/b/c2", first.state), "/read/b/c2", { jump: true });
    expect(again.state).toEqual({ jump: true, trail: [{ to: "/read/b/c1", state: null }] });
    // With no trail behind it either, the state is just the new one.
    expect(moveInside(at("/read/b/c1"), "/read/b/c1", { jump: true }).state).toEqual({ jump: true });
  });

  it("keeps the latest places only", () => {
    let here = at("/read/b/c0");
    for (let i = 1; i <= TRAIL_MAX + 10; i++) {
      const to = `/read/b/c${i}`;
      here = at(to, moveInside(here, to, { page: 0 }).state);
    }
    const trail = trailOf(here.state);
    expect(trail).toHaveLength(TRAIL_MAX);
    expect(trail[0]?.to).toBe("/read/b/c10");
    expect(trail[trail.length - 1]?.to).toBe(`/read/b/c${TRAIL_MAX + 9}`);
  });

  it("reads no trail from a state that has none, or a broken one", () => {
    expect(trailOf(null)).toEqual([]);
    expect(trailOf({ jump: true })).toEqual([]);
    expect(trailOf({ trail: "c1" })).toEqual([]);
    expect(trailOf({ trail: [{ to: "/read/b/c1", state: null }, 3, { state: null }] })).toEqual([
      { to: "/read/b/c1", state: null },
    ]);
  });
});

describe("the Back arrow's step", () => {
  it("is the place before, opened as it was, with the rest of the trail behind it", () => {
    const first = moveInside(at("/read/b/c1", { tabSwitch: true }), "/read/b/c2", { page: 0 });
    const second = moveInside(at("/read/b/c2", first.state), "/read/b/c3", { page: 0 });
    const back = stepBack(second.state)!;
    expect(back).toEqual({
      to: "/read/b/c2",
      replace: true,
      state: { page: 0, trail: [{ to: "/read/b/c1", state: { tabSwitch: true } }] },
    });
    // And once more: the place the book was opened at, exactly as it was opened.
    expect(stepBack(back.state)).toEqual({ to: "/read/b/c1", replace: true, state: { tabSwitch: true } });
  });

  it("is none for a book just opened: Back leaves the book", () => {
    expect(stepBack(null)).toBeNull();
    expect(stepBack({ jump: true })).toBeNull();
    expect(stepBack(stepBack(moveInside(at("/read/b/c1"), "/read/b/c2", { page: 0 }).state)!.state)).toBeNull();
  });

  it("opens a place that had no state with none", () => {
    const move = moveInside(at("/read/b/c1"), "/read/b/c2", { page: 0 });
    expect(stepBack(move.state)).toEqual({ to: "/read/b/c1", replace: true, state: null });
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const book: DocumentDetail = {
  id: "b",
  kind: "book",
  format: "epub",
  title: "Middlemarch",
  author: "George Eliot",
  sourceId: "s",
  sourceName: "Uploads",
  addedAt: "2026-01-01T00:00:00Z",
  saved: false,
  toc: [
    { id: "c1", title: "Chapter I", index: 0, depth: 0 },
    { id: "c2", title: "Chapter II", index: 1, depth: 0 },
    { id: "c3", title: "Chapter III", index: 2, depth: 0 },
  ],
};

describe("in the reader", () => {
  let root: Root;
  let host: HTMLElement;
  let router: ReturnType<typeof createMemoryRouter>;

  /** The library, then the book opened from it at chapter I: two history steps. */
  async function open(contents = false) {
    function Reader() {
      const location = router.state.location;
      return (
        <>
          <ReaderTopBar doc={book} chapter="A chapter" percent={0} toolsOpen={false} onToggleTools={() => {}} />
          <TocDrawer
            doc={book}
            currentId={location.pathname.split("/").pop()}
            open={contents}
            onClose={() => {}}
            linkOptions={(to, state) => moveInside(location, to, state)}
          />
        </>
      );
    }
    router = createMemoryRouter(
      [
        { path: "/", element: <p>library</p> },
        { path: "/read/:docId/:sectionId", element: <Reader /> },
      ],
      { initialEntries: ["/", { pathname: "/read/b/c1", state: { tabSwitch: true } }], initialIndex: 1 },
    );
    await act(async () => root.render(<RouterProvider router={router} />));
  }

  /** The reader's `move` (ReaderPage): a chapter turn, a link, the back pill. */
  async function move(to: string, state: Record<string, unknown>) {
    await act(async () => router.navigate(to, moveInside(router.state.location, to, state)));
  }

  const where = () => router.state.location.pathname + router.state.location.hash;
  const pressBack = () => act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Back"]')!.click());
  /** One Back from outside the page: the iPhone's swipe from the left edge, a browser's button. */
  const systemBack = () => act(async () => router.navigate(-1));

  beforeEach(() => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: false,
          media: query,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
        }) as unknown as MediaQueryList,
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("one Back from outside leaves the book, however many chapters were turned", async () => {
    await open();
    await move("/read/b/c2", { page: 0 });
    await move("/read/b/c3", { page: 0 });
    expect(where()).toBe("/read/b/c3");
    await systemBack();
    // It used to land on chapter II.
    expect(where()).toBe("/");
    expect(host.textContent).toBe("library");
  });

  it("the Back arrow goes back through the chapters first, then leaves the book", async () => {
    await open();
    await move("/read/b/c2", { page: 0 });
    await move("/read/b/c3#note-1", { jump: true });
    await pressBack();
    expect(where()).toBe("/read/b/c2");
    // Opened as it was: at its first page, as a turn forward into it left it.
    expect(router.state.location.state).toMatchObject({ page: 0 });
    await pressBack();
    expect(where()).toBe("/read/b/c1");
    expect(router.state.location.state).toEqual({ tabSwitch: true });
    await pressBack();
    expect(where()).toBe("/");
  });

  it("the arrow's steps add none to the history either: a Back from outside still leaves", async () => {
    await open();
    await move("/read/b/c2", { page: 0 });
    await move("/read/b/c3", { page: 0 });
    await pressBack();
    expect(where()).toBe("/read/b/c2");
    await systemBack();
    expect(where()).toBe("/");
  });

  it("a chapter picked in Contents is a move inside the book too", async () => {
    await open(true);
    const link = Array.from(document.querySelectorAll<HTMLAnchorElement>("a")).find((a) =>
      a.textContent?.includes("Chapter III"),
    )!;
    await act(async () => link.click());
    expect(where()).toBe("/read/b/c3");
    expect(router.state.location.state).toEqual({ jump: true, trail: [{ to: "/read/b/c1", state: { tabSwitch: true } }] });
    // The arrow goes back to where Contents was opened from; the system's Back leaves the book.
    await pressBack();
    expect(where()).toBe("/read/b/c1");
    await move("/read/b/c3", { jump: true });
    await systemBack();
    expect(where()).toBe("/");
  });
});
