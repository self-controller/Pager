import { act, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Annotation } from "@/api/types";
import { AnnotationEditors, liftForTray, NoteSheet } from "@/components/reader/AnnotationEditors";
import { ColorSwatches } from "@/components/reader/AnnotationPopover";
import { READ_LINE_PX } from "@/components/reader/useChapterScroll";
import { menuColors, useNativeMenu } from "@/components/reader/useNativeMenu";
import type { useReaderAnnotations } from "@/components/reader/useReaderAnnotations";
import { updateSettings } from "@/state/settings";
import type { TextSelection } from "@/tools/types";

// Where a highlight and its note are edited: the swatches, the phone's tray and note sheet, and the
// reader's half of the iPhone app's colour menu.

type Notes = ReturnType<typeof useReaderAnnotations>;
type Pager = { menu?: (item: string, color?: string) => void };

const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
env.IS_REACT_ACT_ENVIRONMENT = true;

const happyDOM = (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM;
const browserUrl = window.location.href;

let root: Root;
let host: HTMLElement;
let phone: boolean;
let postMessage: ReturnType<typeof vi.fn>;

function mediaList(query: string): MediaQueryList {
  return {
    matches: query === "(max-width: 767px)" ? phone : false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  } as MediaQueryList;
}

async function render(ui: ReactNode) {
  await act(async () => root.render(ui));
}

/** Inside the iPhone app: its scheme and its message handler. */
function asApp() {
  happyDOM.setURL("pager-app://localhost/read/doc");
  (window as unknown as { webkit?: unknown }).webkit = { messageHandlers: { pager: { postMessage } } };
}

/** The `selection` messages the page posted to the app. */
function selections(): unknown[] {
  return postMessage.mock.calls.map((c) => c[0]).filter((m) => (m as { t: string }).t === "selection");
}

const pager = () => (window as unknown as { __pager?: Pager }).__pager;

function selectWords(el: Element, start: number, end: number) {
  const range = document.createRange();
  range.setStart(el.firstChild!, start);
  range.setEnd(el.firstChild!, end);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

const annotation: Annotation = {
  id: "ann-0001",
  docId: "doc",
  kind: "highlight",
  color: "green",
  style: "highlight",
  body: null,
  tags: [],
  anchor: {
    status: "anchored",
    confidence: 1,
    revisionId: "rev",
    range: null,
    sectionId: "s1",
    segments: [{ sectionId: "s1", start: 0, end: 7 }],
    position: { start: 0, end: 7 },
    quote: "Reading",
    originalQuote: "Reading",
  },
  createdAt: "2026-11-10T00:00:00Z",
  updatedAt: "2026-11-10T00:00:00Z",
  deletedAt: null,
};

function notesWith(over: Partial<Notes>): Notes {
  return {
    annotations: [annotation],
    count: 1,
    reattachTo: () => {},
    highlightColor: "yellow",
    popover: null,
    draft: null,
    editing: null,
    onTextClick: () => false,
    highlight: () => {},
    startNote: () => {},
    saveNote: () => {},
    cancelNote: () => {},
    saveEdit: () => {},
    cancelEdit: () => {},
    ...over,
  };
}

function popoverFor(a: Annotation, over: Partial<NonNullable<Notes["popover"]>> = {}): NonNullable<Notes["popover"]> {
  return {
    annotation: a,
    x: 100,
    y: 100,
    onClose: () => {},
    onEditNote: () => {},
    onColor: () => {},
    onNote: () => {},
    onAcceptAnchor: () => {},
    onTags: () => {},
    onDelete: () => {},
    ...over,
  };
}

const editors = (notes: Notes) => <AnnotationEditors notes={notes} bodyRef={{ current: null }} sectionId="s1" chapter={null} />;

beforeEach(() => {
  phone = true;
  postMessage = vi.fn();
  vi.spyOn(window, "matchMedia").mockImplementation(mediaList);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  env.IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => root.unmount());
  host.remove();
  window.getSelection()?.removeAllRanges();
  updateSettings({ highlightColor: "yellow" });
  delete (window as unknown as { webkit?: unknown }).webkit;
  delete (window as unknown as { __pager?: unknown }).__pager;
  happyDOM.setURL(browserUrl);
  vi.restoreAllMocks();
});

describe("ColorSwatches", () => {
  const swatch = (color: string) => host.querySelector<HTMLButtonElement>(`[role=radio][data-color=${color}]`)!;

  it("removes on a tap on the checked colour, and changes on any other", async () => {
    const onChange = vi.fn();
    const onRemove = vi.fn();
    await render(<ColorSwatches value="green" onChange={onChange} onRemove={onRemove} />);
    expect(host.querySelectorAll("[role=radio]")).toHaveLength(5);
    expect(swatch("green").getAttribute("aria-checked")).toBe("true");
    // Its name says what a tap does.
    expect(swatch("green").getAttribute("aria-label")).toBe("green: remove highlight");
    expect(swatch("blue").getAttribute("aria-label")).toBe("blue");

    await act(async () => swatch("green").click());
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => swatch("blue").click());
    expect(onChange).toHaveBeenCalledWith("blue");
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("only changes when nothing can be removed", async () => {
    const onChange = vi.fn();
    await render(<ColorSwatches value="green" onChange={onChange} />);
    expect(swatch("green").getAttribute("aria-label")).toBe("green");
    await act(async () => swatch("green").click());
    expect(onChange).toHaveBeenCalledWith("green");
  });
});

describe("a highlight's editor", () => {
  const tray = () => document.querySelector<HTMLDialogElement>("dialog[data-tray]");

  it("is a tray on a phone: colours, then Note, Copy and Delete", async () => {
    const onDelete = vi.fn();
    const onColor = vi.fn();
    await render(editors(notesWith({ popover: popoverFor(annotation, { onDelete, onColor }) })));
    const el = tray()!;
    expect(el.open).toBe(true);
    expect(el.getAttribute("role")).toBe("dialog");
    expect(el.getAttribute("aria-label")).toBe("Highlight");
    // No floating card beside it.
    expect(document.querySelectorAll('[role="dialog"][aria-label="Highlight"]')).toHaveLength(1);
    const controls = Array.from(el.querySelectorAll("button, input")).map(
      (c) => c.getAttribute("role") ?? c.textContent ?? c.getAttribute("aria-label"),
    );
    expect(controls.slice(0, 5)).toEqual(["radio", "radio", "radio", "radio", "radio"]);
    // Share only where the browser can share.
    const share = typeof navigator.share === "function" ? ["Share"] : [];
    expect(controls.slice(5, 8 + share.length)).toEqual(["Note", "Copy", ...share, "Delete"]);
    // The tag field does not take focus as the tray opens (the keyboard would rise).
    expect(document.activeElement?.tagName).not.toBe("INPUT");

    await act(async () => el.querySelector<HTMLButtonElement>("[data-color=blue]")!.click());
    expect(onColor).toHaveBeenCalledWith("blue");
    await act(async () => el.querySelector<HTMLButtonElement>("[data-color=green]")!.click());
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("closes when its highlight goes, keeping what it showed through the way out", async () => {
    vi.useFakeTimers();
    try {
      await render(editors(notesWith({ popover: popoverFor(annotation) })));
      await render(editors(notesWith({ popover: null })));
      expect(tray()!.hasAttribute("data-closing")).toBe(true);
      expect(tray()!.querySelectorAll("[role=radio]")).toHaveLength(5);
      await act(async () => vi.advanceTimersByTime(400));
      expect(tray()!.open).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands its note to the note sheet, with the text area focused before the tap ends", async () => {
    const withNote = { ...annotation, body: "A thought." };
    function Reader() {
      const [state, setState] = useState<"tray" | "note">("tray");
      return editors(
        notesWith({
          popover: state === "tray" ? popoverFor(withNote, { onEditNote: () => setState("note") }) : null,
          editing: state === "note" ? { id: withNote.id, docId: "doc", quote: "Reading", body: "A thought." } : null,
        }),
      );
    }
    await render(<Reader />);
    const note = Array.from(tray()!.querySelectorAll("button")).find((b) => b.textContent === "Note")!;
    // A plain click, outside act: what is true when the handler returns is what the tap gets.
    env.IS_REACT_ACT_ENVIRONMENT = false;
    note.click();
    const sheet = document.querySelector<HTMLDialogElement>("dialog[data-sheet]:not([data-tray])")!;
    expect(sheet.open).toBe(true);
    expect(sheet.querySelector("h2")?.textContent).toBe("Note");
    const area = sheet.querySelector("textarea")!;
    expect(area.value).toBe("A thought.");
    expect(document.activeElement).toBe(area);
    env.IS_REACT_ACT_ENVIRONMENT = true;
    // The tray is on its way out under it.
    await act(async () => {});
    expect(tray()!.hasAttribute("data-closing")).toBe(true);
  });

  it("is the floating card on a desktop", async () => {
    phone = false;
    const onDelete = vi.fn();
    await render(editors(notesWith({ popover: popoverFor(annotation, { onDelete }) })));
    expect(document.querySelector("dialog")).toBeNull();
    const card = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Highlight"]')!;
    expect(card.tagName).toBe("DIV");
    expect(card.querySelector('button[aria-label="Remove highlight"]')).not.toBeNull();
    await act(async () => card.querySelector<HTMLButtonElement>("[data-color=green]")!.click());
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe("a new note", () => {
  const draft = { selection: { text: "maketh a full man", sectionId: "s1", start: 8, end: 25, rect: null }, x: 0, y: 0 };

  it("is a sheet on a phone, with Save in its title row", async () => {
    const saveNote = vi.fn();
    await render(editors(notesWith({ draft, saveNote })));
    const sheet = document.querySelector<HTMLDialogElement>("dialog[data-sheet]:not([data-tray])")!;
    expect(sheet.open).toBe(true);
    expect(sheet.querySelector("h2")?.textContent).toBe("New note");
    expect(sheet.querySelector("blockquote")?.textContent).toBe("maketh a full man");
    const area = sheet.querySelector("textarea")!;
    expect(document.activeElement).toBe(area);
    // Save sits beside the title, not in the body under the text area.
    const save = sheet.querySelector("h2")!.parentElement!.parentElement!.querySelector("button")!;
    expect(save.textContent).toBe("Save");
    expect(sheet.querySelector("[data-sheet-body]")!.querySelector("button")).toBeNull();
    area.value = "  Mine.  ";
    await act(async () => save.click());
    expect(saveNote).toHaveBeenCalledWith("Mine.");
  });

  it("is the floating panel on a desktop", async () => {
    phone = false;
    await render(editors(notesWith({ draft })));
    expect(document.querySelector("dialog")).toBeNull();
    const panel = document.querySelector<HTMLElement>('[role="dialog"][aria-label="New note"]')!;
    expect(panel.tagName).toBe("DIV");
    expect(Array.from(panel.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Cancel", "Save note"]);
  });
});

describe("the iPhone app's menu", () => {
  const highlight = vi.fn();

  function Reader({ onNote }: { onNote?: (selection: TextSelection) => void }) {
    const bodyRef = useRef<HTMLDivElement>(null);
    const [draft, setDraft] = useState<TextSelection | null>(null);
    useNativeMenu(bodyRef, "s1", {
      highlight,
      note: (selection) => {
        onNote?.(selection);
        setDraft(selection);
      },
    });
    return (
      <>
        <div ref={bodyRef}>
          <p>Reading maketh a full man.</p>
        </div>
        <NoteSheet
          note={draft ? { key: "new", title: "New note", quote: draft.text, initial: "" } : null}
          onSave={() => setDraft(null)}
          onCancel={() => setDraft(null)}
        />
      </>
    );
  }

  beforeEach(() => {
    highlight.mockClear();
    asApp();
  });

  it("lists the last-used colour first, then the rest in their order", () => {
    expect(menuColors("yellow")).toEqual(["yellow", "green", "blue", "pink", "purple"]);
    expect(menuColors("pink")).toEqual(["pink", "yellow", "green", "blue", "purple"]);
  });

  it("sends the colours with the items, and again when the last-used colour changes", async () => {
    updateSettings({ highlightColor: "blue" });
    await render(<Reader />);
    expect(selections()).toEqual([]);
    await act(async () => {
      selectWords(host.querySelector("p")!, 0, 7);
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(selections()).toEqual([
      { t: "selection", items: ["highlight", "note"], colors: ["blue", "yellow", "green", "pink", "purple"] },
    ]);
    await act(async () => updateSettings({ highlightColor: "pink" }));
    expect(selections().at(-1)).toEqual({
      t: "selection",
      items: ["highlight", "note"],
      colors: ["pink", "yellow", "green", "blue", "purple"],
    });
  });

  it("passes the colour the app picked to the reader, and only a colour it knows", async () => {
    await render(<Reader />);
    await act(async () => selectWords(host.querySelector("p")!, 0, 7));
    await act(async () => pager()?.menu?.("highlight", "green"));
    expect(highlight).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Reading", start: 0, end: 7 }), "green");
    await act(async () => pager()?.menu?.("highlight"));
    expect(highlight).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Reading" }), undefined);
    await act(async () => pager()?.menu?.("highlight", "red"));
    expect(highlight).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Reading" }), undefined);
    expect(highlight).toHaveBeenCalledTimes(3);
  });

  it("has the note sheet's text area focused by the time Note's call returns", async () => {
    const onNote = vi.fn();
    await render(<Reader onNote={onNote} />);
    await act(async () => selectWords(host.querySelector("p")!, 8, 25));
    const sheet = document.querySelector<HTMLDialogElement>("dialog[data-sheet]")!;
    expect(sheet.open).toBe(false);
    // As the app calls it: no act, nothing awaited. The keyboard rises only if focus lands here.
    env.IS_REACT_ACT_ENVIRONMENT = false;
    pager()?.menu?.("note");
    expect(onNote).toHaveBeenCalledTimes(1);
    expect(sheet.open).toBe(true);
    expect(sheet.querySelector("h2")?.textContent).toBe("New note");
    expect(sheet.querySelector("blockquote")?.textContent).toBe("maketh a full man");
    const area = sheet.querySelector("textarea");
    expect(area).not.toBeNull();
    expect(document.activeElement).toBe(area);
    env.IS_REACT_ACT_ENVIRONMENT = true;
  });
});

describe("liftForTray", () => {
  it("is nothing when the words already sit clear above the tray", () => {
    expect(liftForTray({ top: 300, bottom: 330 }, 500, 60)).toBe(0);
    // The clearance is 24px: words ending 30px above the tray are clear, 10px above are not.
    expect(liftForTray({ top: 440, bottom: 470 }, 500, 60)).toBe(0);
    expect(liftForTray({ top: 460, bottom: 490 }, 500, 60)).toBe(14);
  });

  it("carries covered words to 24px above the tray", () => {
    expect(liftForTray({ top: 600, bottom: 630 }, 500, 60)).toBe(154);
  });

  it("keeps the first line of a tall passage at the reading line", () => {
    const boxTop = 60;
    expect(liftForTray({ top: 200, bottom: 700 }, 500, boxTop)).toBe(200 - (boxTop + READ_LINE_PX));
    // Already above the reading line: it stays put.
    expect(liftForTray({ top: 40, bottom: 700 }, 500, boxTop)).toBe(0);
  });
});
