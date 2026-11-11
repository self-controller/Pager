/**
 * Where the reader last was in each chapter of each book, kept on this device (localStorage). A
 * chapter turn opens the chapter there, so turning ahead to peek and back again lands on the same
 * words, not at the chapter's end. `null` is the chapter's start; a chapter never read has no entry.
 */

export interface Spot {
  blockId: string;
  offset: number;
}

interface Book {
  /** Last used, for dropping the oldest books. */
  at: number;
  /** In the order they were last written: the oldest first. */
  spots: Record<string, Spot | null>;
}

const KEY = "pager.chapterSpots";
export const MAX_BOOKS = 100;
export const MAX_CHAPTERS = 300;

let books: Record<string, Book> = load();

function isSpot(v: unknown): v is Spot | null {
  if (v === null) return true;
  return (
    typeof v === "object" &&
    typeof (v as Spot).blockId === "string" &&
    typeof (v as Spot).offset === "number" &&
    Number.isFinite((v as Spot).offset)
  );
}

/** Reads the stored spots, dropping anything malformed. */
export function parseSpots(raw: string | null): Record<string, Book> {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as unknown;
    if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
    const out: Record<string, Book> = {};
    for (const [docId, book] of Object.entries(data as Record<string, unknown>)) {
      if (typeof book !== "object" || book === null) continue;
      const { at, spots } = book as Partial<Book>;
      if (typeof spots !== "object" || spots === null) continue;
      const kept: Record<string, Spot | null> = {};
      for (const [sectionId, spot] of Object.entries(spots)) {
        if (isSpot(spot)) kept[sectionId] = spot ? { blockId: spot.blockId, offset: spot.offset } : null;
      }
      out[docId] = { at: typeof at === "number" ? at : 0, spots: kept };
    }
    return out;
  } catch {
    return {};
  }
}

function load(): Record<string, Book> {
  try {
    return parseSpots(typeof localStorage === "undefined" ? null : localStorage.getItem(KEY));
  } catch {
    return {};
  }
}

function store(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(books));
  } catch {
    // Private mode or full storage: the spots last for this session only.
  }
}

/** The reader is at `spot` in a chapter (null: its start). */
export function rememberSpot(docId: string, sectionId: string, spot: Spot | null): void {
  const book = books[docId];
  // Re-inserted so the key order stays oldest-written first.
  const spots = { ...book?.spots };
  delete spots[sectionId];
  spots[sectionId] = spot ? { blockId: spot.blockId, offset: spot.offset } : null;
  const ids = Object.keys(spots);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_CHAPTERS))) delete spots[id];
  books = { ...books, [docId]: { at: Date.now(), spots } };
  const docIds = Object.keys(books);
  if (docIds.length > MAX_BOOKS) {
    docIds
      .sort((a, b) => books[a]!.at - books[b]!.at)
      .slice(0, docIds.length - MAX_BOOKS)
      .forEach((id) => delete books[id]);
  }
  store();
}

/** Forgets a chapter's spot: a turn then opens it as for a chapter not read yet. */
export function forgetSpot(docId: string, sectionId: string): void {
  const book = books[docId];
  if (!book || !(sectionId in book.spots)) return;
  const spots = { ...book.spots };
  delete spots[sectionId];
  books = { ...books, [docId]: { ...book, spots } };
  store();
}

/** Where the reader last was in a chapter: a spot, null for its start, undefined if never read. */
export function spotFor(docId: string, sectionId: string): Spot | null | undefined {
  const spot = books[docId]?.spots[sectionId];
  return spot === undefined ? undefined : spot && { ...spot };
}

/** Forgets every spot (tests). */
export function resetChapterSpots(): void {
  books = {};
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored to remove.
  }
}
