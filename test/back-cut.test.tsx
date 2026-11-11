import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBrowserRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cutUnmarkedBack, markTransition } from "@/lib/pageTransition";

// A Back the app didn't start (the iPhone's edge swipe, a browser's Back button), with the real
// router: it must show its page with no view transition after the system's own animation.

const happyDOM = (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM;
const browserUrl = window.location.href;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type WithTransitions = { startViewTransition?: unknown };

let root: Root;
let host: HTMLElement;
let router: ReturnType<typeof createBrowserRouter>;
let stop: (() => void) | undefined;
/** Each view transition the page was asked for. */
let transitions: Mock<() => void>;
/** The session's history as the browser keeps it: each entry's address and state, and where we are. */
let entries: { url: string; state: unknown }[];
let at: number;
/** The document's own prototype, where a browser keeps the API (happy-dom's isn't `Document.prototype`). */
const proto = Object.getPrototypeOf(document) as WithTransitions;

const here = () => ({ url: window.location.pathname + window.location.search, state: window.history.state as unknown });

/** What the page shows. */
const shown = () => host.textContent;

/** A stand-in for the browser's API: runs the update, and ends when it has. */
function startViewTransition(update: () => unknown) {
  transitions();
  const done = Promise.resolve().then(update);
  const ended = done.then(
    () => {},
    () => {},
  );
  return { updateCallbackDone: ended, ready: ended, finished: ended, skipTransition() {} };
}

async function mount({ cut }: { cut: boolean }) {
  // As App.tsx does: before the router is made.
  stop = cut ? cutUnmarkedBack() : undefined;
  router = createBrowserRouter([
    { path: "/assistant", element: <Assistant /> },
    { path: "/", element: <p>library</p> },
    { path: "/read", element: <p>book</p> },
  ]);
  await act(async () => root.render(<RouterProvider router={router} />));
  entries = [here()];
  at = 0;
}

/** The Assistant page's two faces, on one path. */
function Assistant() {
  return <p>{new URLSearchParams(useLocation().search).has("doc") ? "briefing" : "list"}</p>;
}

async function go(to: string, options?: { viewTransition?: boolean }) {
  await act(async () => {
    await router.navigate(to, options);
    // A view transition's update and end.
    await new Promise((done) => setTimeout(done, 10));
  });
  entries = [...entries.slice(0, at + 1), here()];
  at += 1;
}

/**
 * The browser moves through its history: the address and state change, and the page hears popstate
 * and nothing else. (happy-dom's own `history.back()` goes nowhere, so the test moves by hand. A
 * scripted event also has no pause between its listeners, where a browser lets React render: that
 * the page is the new one inside the event was measured in Chromium, not here.)
 */
async function traverse(delta: number): Promise<void> {
  at += delta;
  const entry = entries[at]!;
  await act(async () => {
    window.history.replaceState(entry.state, "", entry.url);
    window.dispatchEvent(new PopStateEvent("popstate", { state: entry.state }));
    await new Promise((done) => setTimeout(done, 30));
  });
}

/** The system's Back: the iPhone's edge swipe, a browser's button. */
const systemBack = () => traverse(-1);

/** The tab was left once and come back to (tab switches crossfade), then a briefing was opened. */
async function inABriefingAfterATabSwitch() {
  await go("/", { viewTransition: true });
  await go("/assistant", { viewTransition: true });
  await go("/assistant?doc=darwin");
  expect(shown()).toBe("briefing");
  transitions.mockClear();
}

beforeEach(() => {
  happyDOM.setURL("http://localhost/assistant");
  transitions = vi.fn<() => void>();
  // On the prototype, where a browser has it: the cut hides it with a property of the document's own.
  Object.defineProperty(proto, "startViewTransition", { configurable: true, writable: true, value: startViewTransition });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  router.dispose();
  stop?.();
  host.remove();
  delete proto.startViewTransition;
  delete (document as unknown as WithTransitions).startViewTransition;
  happyDOM.setURL(browserUrl);
});

describe("a Back the app didn't start", () => {
  it("is given a view transition by the router once the tab has been left, which is the flash", async () => {
    // The router's own rule, without the cut: if it changes, this says so.
    await mount({ cut: false });
    await inABriefingAfterATabSwitch();
    await systemBack();
    // A briefing back to its list, on one path: the router transitions it because the tab was left.
    expect(transitions).toHaveBeenCalledTimes(1);
    expect(shown()).toBe("list");
  });

  it("shows its page with no view transition", async () => {
    await mount({ cut: true });
    await inABriefingAfterATabSwitch();
    await systemBack();
    expect(transitions).not.toHaveBeenCalled();
    expect(shown()).toBe("list");
    expect(router.state.location.search).toBe("");
  });

  it("gives the API back afterwards: a tab switch still crossfades", async () => {
    await mount({ cut: true });
    await inABriefingAfterATabSwitch();
    await systemBack();
    expect(Object.hasOwn(document, "startViewTransition")).toBe(false);
    expect(typeof (document as unknown as WithTransitions).startViewTransition).toBe("function");
    await go("/", { viewTransition: true });
    expect(transitions).toHaveBeenCalledTimes(1);
    expect(shown()).toBe("library");
  });

  it("cuts across tabs too, and a Forward as well", async () => {
    await mount({ cut: true });
    await go("/", { viewTransition: true });
    transitions.mockClear();
    await systemBack();
    expect(shown()).toBe("list");
    await traverse(1);
    expect(shown()).toBe("library");
    expect(transitions).not.toHaveBeenCalled();
  });
});

describe("the reader's own Back", () => {
  it("still slides: a Back marked by the app keeps its view transition", async () => {
    await mount({ cut: true });
    await go("/", { viewTransition: true });
    await go("/read", { viewTransition: true });
    transitions.mockClear();
    // ReaderTopBar's goBack: the mark, then navigate(-1), which the page hears as a popstate too.
    markTransition("pop");
    await traverse(-1);
    expect(transitions).toHaveBeenCalledTimes(1);
    expect(shown()).toBe("library");
  });
});

describe("where there are no view transitions", () => {
  it("leaves the page alone", async () => {
    delete proto.startViewTransition;
    await mount({ cut: true });
    await go("/assistant?doc=darwin");
    await systemBack();
    expect(shown()).toBe("list");
    expect(Object.hasOwn(document, "startViewTransition")).toBe(false);
  });
});
