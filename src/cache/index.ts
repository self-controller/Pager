/**
 * The app's own cache between launches: one persister over IndexedDB, started by App.tsx beside
 * its QueryClient. Pages reach it through these functions, which do nothing when it was never
 * started (the built-in mock, tests).
 */
import type { QueryClient } from "@tanstack/react-query";
import { API_VERSION } from "@/api/types";
import { cacheStamp, createPersister, type Persister } from "./persist";
import { idbCacheStore } from "./store";

let persister: Persister | null = null;
let restored: Promise<void> = Promise.resolve();

/** Start keeping `client`'s queries, and begin putting the stored ones back. Call once. */
export function startStoredCache(client: QueryClient): void {
  if (persister) return;
  persister = createPersister(client, { store: idbCacheStore(), stamp: cacheStamp(API_VERSION) });
  restored = persister.restore().then(
    () => {},
    () => {},
  );
}

/** Settles when the stored queries are in the client (at once when there is no store). Never rejects. */
export function storedCacheRestored(): Promise<void> {
  return restored;
}

/**
 * Forget everything stored, and store nothing more until the page loads again: this phone is no
 * longer paired, or was just paired, and another computer's library must never show. What is in
 * memory (on screen) stays.
 */
export function wipeStoredCache(): Promise<void> {
  return persister?.wipe().catch(() => {}) ?? Promise.resolve();
}

/** Forget the stored chapters ("Remove all downloads"). */
export function dropStoredSections(): Promise<void> {
  return persister?.dropSections().catch(() => {}) ?? Promise.resolve();
}
