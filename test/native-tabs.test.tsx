import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The hook's wiring, in a router, as the iPhone app runs it: messages out, the app's calls in.

// The Book tab's link without the documents query: the book read last is "doc".
vi.mock("@/components/shell/useBookTab", () => ({
  useNavTargets: () => (item: { to: string }) => (item.to === "/read" ? "/read/doc" : item.to),
}));

const happyDOM = (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM;
const browserUrl = window.location.href;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let postMessage: ReturnType<typeof vi.fn>;
let root: Root;
let host: HTMLElement;
let seen: { pathname: string; state: unknown }[];

function tabs(): unknown[] {
  return postMessage.mock.calls.map((c) => c[0]).filter((m) => (m as { t: string }).t === "tabs");
}

function pager() {
  return (window as unknown as { __pager: { tab(t: string): void; tabBar(p: number): void } }).__pager;
}

async function mount(initial: string) {
  const { useNativeTabs } = await import("@/components/shell/useNativeTabs");
  function Shell() {
    useNativeTabs();
    const { pathname, state } = useLocation();
    seen.push({ pathname, state });
    return <Outlet />;
  }
  const router = createMemoryRouter(
    [
      { path: "pair", element: <p>pair</p> },
      { element: <Shell />, children: [{ path: "*", element: <p>page</p> }] },
    ],
    { initialEntries: [initial] },
  );
  await act(async () => root.render(<RouterProvider router={router} />));
  return router;
}

beforeEach(() => {
  happyDOM.setURL("pager-app://localhost/");
  postMessage = vi.fn();
  (window as unknown as { webkit?: unknown }).webkit = { messageHandlers: { pager: { postMessage } } };
  vi.resetModules();
  seen = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  // happy-dom has no smooth scrolling and no frames to wait for.
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete (window as unknown as { webkit?: unknown }).webkit;
  delete (window as unknown as { __pager?: unknown }).__pager;
  delete document.documentElement.dataset.readerChrome;
  delete document.documentElement.dataset.sheetOpen;
  document.documentElement.style.removeProperty("--native-tab-bar");
  happyDOM.setURL(browserUrl);
});

describe("useNativeTabs", () => {
  it("says which tab the page is in, and answers a tap with that tab's last page", async () => {
    const router = await mount("/");
    expect(tabs()).toEqual([{ t: "tabs", tab: "library", hidden: false }]);

    await act(async () => pager().tab("highlights"));
    expect(router.state.location.pathname).toBe("/highlights");
    expect(seen.at(-1)?.state).toEqual({ tabSwitch: true });
    expect(tabs().at(-1)).toEqual({ t: "tabs", tab: "highlights", hidden: false });

    // A book from Highlights selects Book; Highlights opens its list again.
    await act(async () => router.navigate("/read/doc/s1"));
    expect(tabs().at(-1)).toEqual({ t: "tabs", tab: "book", hidden: false });
    await act(async () => pager().tab("highlights"));
    expect(router.state.location.pathname).toBe("/highlights");
    // Book: the book read last, by its link.
    await act(async () => pager().tab("book"));
    expect(router.state.location.pathname).toBe("/read/doc");
    expect(tabs().at(-1)).toEqual({ t: "tabs", tab: "book", hidden: false });
  });

  it("hides the bar with the reader's chrome", async () => {
    await mount("/read/doc/s1");
    const html = document.documentElement;
    html.dataset.readerChrome = "hidden";
    await act(async () => {});
    expect(tabs().at(-1)).toEqual({ t: "tabs", tab: "book", hidden: true });
    delete html.dataset.readerChrome;
    await act(async () => {});
    expect(tabs().at(-1)).toEqual({ t: "tabs", tab: "book", hidden: false });
  });

  it("hides the bar while a sheet is open", async () => {
    await mount("/");
    const html = document.documentElement;
    html.dataset.sheetOpen = "";
    await act(async () => {});
    expect(tabs().at(-1)).toEqual({ t: "tabs", tab: "library", hidden: true });
    delete html.dataset.sheetOpen;
    await act(async () => {});
    expect(tabs().at(-1)).toEqual({ t: "tabs", tab: "library", hidden: false });
  });

  it("hides the bar under a tray, whose mark leaves the page live", async () => {
    await mount("/");
    const html = document.documentElement;
    html.dataset.sheetOpen = "tray";
    await act(async () => {});
    expect(tabs().at(-1)).toEqual({ t: "tabs", tab: "library", hidden: true });
    delete html.dataset.sheetOpen;
    await act(async () => {});
    expect(tabs().at(-1)).toEqual({ t: "tabs", tab: "library", hidden: false });
  });

  it("brings the bar back only when both the chrome and a sheet clear", async () => {
    await mount("/read/doc/s1");
    const html = document.documentElement;
    html.dataset.readerChrome = "hidden";
    html.dataset.sheetOpen = "";
    await act(async () => {});
    expect(tabs().at(-1)).toEqual({ t: "tabs", tab: "book", hidden: true });
    delete html.dataset.readerChrome;
    await act(async () => {});
    expect(tabs().at(-1)).toEqual({ t: "tabs", tab: "book", hidden: true });
    html.dataset.readerChrome = "hidden";
    delete html.dataset.sheetOpen;
    await act(async () => {});
    expect(tabs().at(-1)).toEqual({ t: "tabs", tab: "book", hidden: true });
    delete html.dataset.readerChrome;
    await act(async () => {});
    expect(tabs().at(-1)).toEqual({ t: "tabs", tab: "book", hidden: false });
  });

  it("keeps the bar's footprint the app sends", async () => {
    await mount("/");
    await act(async () => pager().tabBar(83));
    expect(document.documentElement.style.getPropertyValue("--native-tab-bar")).toBe("83px");
  });

  it("hides the bar and lets go of the app's calls on leaving the shell", async () => {
    const router = await mount("/settings");
    await act(async () => router.navigate("/pair"));
    expect(tabs().at(-1)).toEqual({ t: "tabs", tab: null, hidden: true });
    expect(pager().tab).toBeUndefined();
  });
});

describe("a book reopened by a tab switch", () => {
  async function chromeOn(entry: { pathname: string; state?: unknown }) {
    const { useReaderChrome } = await import("@/components/reader/useReaderChrome");
    let visible: boolean | undefined;
    function Reader() {
      [visible] = useReaderChrome("doc");
      return null;
    }
    const router = createMemoryRouter([{ path: "*", element: <Reader /> }], { initialEntries: [entry] });
    await act(async () => root.render(<RouterProvider router={router} />));
    return { visible: () => visible, router };
  }

  beforeEach(() => {
    // A touch screen: a book opens with its chrome hidden.
    const real = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((q: string) =>
      q === "(pointer: coarse)" ? ({ matches: true } as MediaQueryList) : real.call(window, q),
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("starts with its chrome showing, and keeps it through its own turns", async () => {
    const { visible, router } = await chromeOn({ pathname: "/read/doc/s1", state: { tabSwitch: true } });
    expect(visible()).toBe(true);
    await act(async () => router.navigate("/read/doc/s2", { state: { page: 0 } }));
    expect(visible()).toBe(true);
  });

  it("opens as usual otherwise, chrome hidden", async () => {
    const { visible } = await chromeOn({ pathname: "/read/doc/s1" });
    expect(visible()).toBe(false);
  });
});
