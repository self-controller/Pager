import { matchPath } from "react-router";
import { useDocuments } from "@/api/hooks";
import { BOOK_PATH, type NavEntry } from "./nav";

/**
 * The Book tab's link: the book opened last, with no section, so the reader resumes at its saved
 * place (ReaderPage takes the section from `doc.progress`). The library ("/") while none has been
 * opened or the list is loading.
 *
 * It stays fresh on its own: the reader saves its place as soon as a book opens and again on the way
 * out, and every save (or a `progress.updated` from another device) invalidates the documents
 * queries, which refetches this one, since the tab bar or side nav always has it mounted.
 */
export function useBookTab(): string {
  const history = useDocuments({ history: true });
  const last = history.data?.[0];
  return last ? `${BOOK_PATH}/${encodeURIComponent(last.id)}` : "/";
}

/** Where a nav entry links: its own `to`, or for the Book tab the book read last. */
export function useNavTargets(): (item: NavEntry) => string {
  const book = useBookTab();
  return (item) => (item.to === BOOK_PATH ? book : item.to);
}

/** Whether `item` is the current tab: `match` (or `to`) as a prefix, "/" only exactly (`end`). */
export function isNavActive(item: NavEntry, pathname: string): boolean {
  return matchPath({ path: item.match ?? item.to, end: item.end ?? false }, pathname) !== null;
}
