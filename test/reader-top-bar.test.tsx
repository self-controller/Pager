import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentDetail } from "@/api/types";
import { ReaderTopBar } from "@/components/reader/ReaderTopBar";

// The reader's top bar: a book's chapter is a pill that opens Contents, and a phone has no other way.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
let media: Record<string, boolean>;

function mediaList(query: string): MediaQueryList {
  return {
    matches: media[query] ?? false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  } as MediaQueryList;
}

const book: DocumentDetail = {
  id: "book",
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
  ],
};

async function renderBar({
  chapter,
  onOpenToc,
  doc = book,
  hidden,
  compact,
}: {
  chapter?: string;
  onOpenToc?: () => void;
  doc?: DocumentDetail;
  hidden?: boolean;
  compact?: ReactNode;
}) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <ReaderTopBar
            doc={doc}
            chapter={chapter}
            percent={0.25}
            onOpenToc={onOpenToc}
            toolsOpen={false}
            onToggleTools={() => {}}
            hidden={hidden}
            compact={compact}
          />
        ),
      },
    ],
    { initialEntries: ["/read/book/c1"] },
  );
  await act(async () => root.render(<RouterProvider router={router} />));
}

const icon = () => host.querySelector<HTMLButtonElement>('button[aria-label="Contents"]');
const pill = () => host.querySelector<HTMLButtonElement>('button[aria-label^="Contents: "]');
const header = () => host.querySelector<HTMLElement>("header.reader-top-bar")!;
const row = () => host.querySelector<HTMLElement>(".top-bar-row")!;
const compactLine = () => host.querySelector<HTMLElement>(".top-bar-compact")!;

beforeEach(() => {
  media = {};
  vi.spyOn(window, "matchMedia").mockImplementation(mediaList);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("the reader's top bar", () => {
  it("on a phone has no Contents icon, and the chapter pill opens Contents", async () => {
    media["(max-width: 767px)"] = true;
    const open = vi.fn();
    await renderBar({ chapter: "Chapter I", onOpenToc: open });
    expect(icon()).toBeNull();
    const button = pill();
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-label")).toBe("Contents: Chapter I");
    expect(button!.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button!.textContent).toContain("Middlemarch");
    expect(button!.querySelector("[data-chapter-pill]")?.textContent).toBe("Chapter I");
    await act(async () => button!.click());
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("on a desktop has both, and each opens Contents", async () => {
    const open = vi.fn();
    await renderBar({ chapter: "Chapter I", onOpenToc: open });
    expect(icon()).not.toBeNull();
    expect(pill()).not.toBeNull();
    await act(async () => pill()!.click());
    await act(async () => icon()!.click());
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("shows neither for a document that is not a book", async () => {
    for (const phone of [true, false]) {
      media["(max-width: 767px)"] = phone;
      await renderBar({});
      expect(icon()).toBeNull();
      expect(pill()).toBeNull();
      expect(host.querySelector("[data-chapter-pill]")).toBeNull();
      // The second line stays plain text: the author.
      expect(host.textContent).toContain("George Eliot");
    }
  });

  it("keeps the plain second line while a book's chapter is not known yet", async () => {
    media["(max-width: 767px)"] = true;
    await renderBar({ onOpenToc: () => {} });
    expect(pill()).toBeNull();
    expect(host.textContent).toContain("George Eliot");
  });

  it("hidden, its controls can't be reached but the header itself and its compact line can", async () => {
    await renderBar({ chapter: "Chapter I", onOpenToc: () => {}, hidden: true });
    expect(row().inert).toBe(true);
    expect(header().inert).toBe(false);
    expect(compactLine().inert).toBe(false);
    expect(compactLine().getAttribute("aria-hidden")).toBeNull();
  });

  it("while the bars show, the compact line is hidden from screen readers and can't be reached", async () => {
    await renderBar({ chapter: "Chapter I", onOpenToc: () => {} });
    expect(row().inert).toBe(false);
    expect(compactLine().inert).toBe(true);
    expect(compactLine().getAttribute("aria-hidden")).toBe("true");
  });

  it("the compact line names the chapter for a book and the title for a one-section document", async () => {
    await renderBar({ chapter: "Chapter I", onOpenToc: () => {}, hidden: true });
    expect(header().dataset.label).toBe("pill");
    expect(compactLine().textContent).toBe("Chapter I");

    const essay: DocumentDetail = { ...book, kind: "article", title: "On Reading", toc: [] };
    await renderBar({ doc: essay, hidden: true });
    expect(header().dataset.label).toBe("title");
    expect(compactLine().textContent).toBe("On Reading");
  });

  it("puts the compact node in the compact line, after the label", async () => {
    await renderBar({
      chapter: "Chapter I",
      onOpenToc: () => {},
      hidden: true,
      compact: <button type="button">Chapter 1 of 2</button>,
    });
    const content = compactLine().querySelector(".top-bar-compact-content")!;
    expect(content.lastElementChild?.textContent).toBe("Chapter 1 of 2");
    expect(content.firstElementChild?.textContent).toBe("Chapter I");
  });
});
