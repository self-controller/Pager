import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextState, ContextStatus, DocumentDetail } from "@/api/types";
import { book } from "./offline-fakes";

// Context's section of the Assistant page: the book picker, and what a book's Context opens with.

const spy = vi.hoisted(() => ({ api: undefined as unknown }));
vi.mock("@/api", async (original) => ({
  ...(await original<typeof import("@/api")>()),
  get api() {
    return spy.api;
  },
}));

const { ContextHome } = await import("@/tools/context/ContextHome");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The library, most recently read first, as the server lists it. */
const LIBRARY = [
  book("eliot", "Middlemarch", 2, { author: "George Eliot" }),
  book("darwin", "On the Origin of Species", 2, { author: "Charles Darwin" }),
  book("austen", "Persuasion", 2, { author: "Jane Austen" }),
  book("woolf", "The Waves", 2, { author: "Virginia Woolf" }),
  book("mill", "On Liberty", 2, { author: "John Stuart Mill" }),
];

const STATUS: ContextStatus = { ready: true, model: "m", keyFile: "secrets.env", keyVariable: "ANTHROPIC_API_KEY", phone: null };
const NONE_YET: ContextState = { briefing: null, stale: false, run: null, cachedLevels: [] };

let root: Root;
let host: HTMLElement;
let phone: boolean;
/** Every call that reached the backend. */
let calls: string[];
let router: ReturnType<typeof createMemoryRouter>;

function mediaList(query: string): MediaQueryList {
  return {
    matches: query === "(max-width: 767px)" && phone,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  } as MediaQueryList;
}

/** Waits, in real time, for the page to get there. */
async function until(check: () => boolean, what: string) {
  const end = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > end) throw new Error(`never happened: ${what}`);
    await act(async () => new Promise((done) => setTimeout(done, 5)));
  }
}

function button(text: string, within: ParentNode = document): HTMLButtonElement | undefined {
  return Array.from(within.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
}

async function press(el: Element | undefined) {
  if (!el) throw new Error("nothing to press");
  await act(async () => (el as HTMLElement).click());
}

function picker(): HTMLDialogElement {
  const dialog = Array.from(document.querySelectorAll("dialog")).find((d) => d.getAttribute("aria-label") === "Choose a book");
  if (!dialog) throw new Error("no picker");
  return dialog;
}

const listBox = () => picker().querySelector<HTMLElement>("[data-picker-list]")!;
const field = () => picker().querySelector<HTMLInputElement>("input[type=search]")!;
const rows = () => Array.from(listBox().querySelectorAll("button"));

async function type(text: string) {
  const input = field();
  // Past React's own record of the value, so the change is seen as one.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  await act(async () => input.dispatchEvent(new Event("input", { bubbles: true })));
}

async function mount(at = "/assistant") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  router = createMemoryRouter([{ path: "assistant", element: <ContextHome /> }], { initialEntries: [at] });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  );
}

async function openPicker() {
  await until(() => Boolean(button("Choose a book", host)), "the list");
  await press(button("Choose a book", host));
  await until(() => picker().open, "the picker");
}

beforeEach(() => {
  phone = true;
  calls = [];
  vi.spyOn(window, "matchMedia").mockImplementation(mediaList);
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  spy.api = {
    mode: "http",
    listDocuments: async () => LIBRARY,
    listContextBriefings: async () => ({
      briefings: [
        { docId: "darwin", level: "general", focus: null, generatedAt: "2026-11-09T10:00:00.000Z" },
        { docId: "austen", level: "general", focus: null, generatedAt: "2026-11-08T10:00:00.000Z" },
      ],
    }),
    // A book's details never arrive in these tests: the page must not wait for them.
    getDocument: (id: string) => (calls.push(`document ${id}`), new Promise<DocumentDetail>(() => {})),
    getContextStatus: async () => (calls.push("status"), STATUS),
    getContextBriefing: async (id: string, level: string) => (calls.push(`briefing ${id} ${level}`), NONE_YET),
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("the book picker on a phone", () => {
  it("shows three rows in a box that scrolls, under a search field that stays", async () => {
    await mount();
    await openPicker();
    expect(picker().hasAttribute("data-sheet")).toBe(true);
    // Three rows of 56 px, however many books there are.
    expect(rows()).toHaveLength(LIBRARY.length);
    expect(rows().every((r) => r.style.height === "56px")).toBe(true);
    expect(listBox().style.height).toBe("168px");
    expect(listBox().classList.contains("overflow-y-auto")).toBe(true);
    // The field is beside the box, not in it: scrolling the books leaves it where it is.
    expect(listBox().contains(field())).toBe(false);
    // The library's order: the book read last is the first row.
    expect(rows()[0]?.textContent).toContain("Middlemarch");
  });

  it("keeps its height as the search narrows the list, down to nothing", async () => {
    await mount();
    await openPicker();
    await type("origin darwin");
    expect(rows().map((r) => r.textContent)).toEqual(["On the Origin of SpeciesCharles Darwin"]);
    expect(listBox().style.height).toBe("168px");
    await type("no such book");
    expect(rows()).toHaveLength(0);
    expect(listBox().textContent).toBe("Nothing in your library matches.");
    expect(listBox().style.height).toBe("168px");
  });

  it("stays to finish leaving when a book is picked, though the list behind it is gone", async () => {
    await mount();
    await openPicker();
    const sheet = picker();
    await press(button("Middlemarch", listBox()));
    // The page is the book's now, and the list (where the picker used to live) is no more.
    expect(router.state.location.search).toBe("?doc=eliot");
    expect(button("Choose a book", host)).toBeUndefined();
    // The sheet is still in the page, on its way out: it was removed in one frame before.
    expect(sheet.isConnected).toBe(true);
    expect(sheet.open).toBe(true);
    expect(sheet.hasAttribute("data-closing")).toBe(true);
    await until(() => !sheet.open, "the sheet's exit");
    expect(sheet.isConnected).toBe(true);
  });

  it("starts with an empty search each time it opens", async () => {
    await mount();
    await openPicker();
    await type("wav");
    expect(field().value).toBe("wav");
    await press(button("The Waves", listBox()));
    await until(() => !picker().open, "the sheet's exit");
    await act(async () => router.navigate("/assistant"));
    await openPicker();
    expect(field().value).toBe("");
    expect(rows()).toHaveLength(LIBRARY.length);
  });
});

describe("the book picker in a window on the computer", () => {
  it("shows seven rows, with the search field above them too", async () => {
    phone = false;
    await mount();
    await openPicker();
    expect(picker().hasAttribute("data-sheet")).toBe(false);
    expect(listBox().style.height).toBe("392px");
    expect(listBox().contains(field())).toBe(false);
  });
});

describe("opening a book's Context from the list", () => {
  it("fetches the listed books' briefings ahead, the newest first, after the status", async () => {
    await mount();
    await until(() => calls.includes("briefing austen general"), "the briefings fetched ahead");
    expect(calls).toEqual(["status", "briefing darwin general", "briefing austen general"]);
  });

  it("paints the book and its Context at once: no skeleton for its details or its briefing", async () => {
    await mount();
    await until(() => calls.includes("briefing austen general"), "the briefings fetched ahead");
    await press(button("On the Origin of Species", host));
    // The same frame as the tap. The book's details are still on their way (they never come here).
    expect(calls).toContain("document darwin");
    expect(host.querySelector("[aria-busy]")).toBeNull();
    expect(host.querySelector("h3")?.textContent).toBe("On the Origin of Species");
    expect(host.textContent).toContain("Charles Darwin");
    expect(button("Make a general briefing", host)).toBeDefined();
    // And at its top, wherever the list was.
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  });
});
