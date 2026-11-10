/**
 * Development only: a stand-in for the iPhone app's copy, so reading with the computer unreachable
 * can be tried in a browser against the real backend. It follows the same rules as the app
 * (ios/README.md, "The copy"): which answers are kept, what is answered while offline, the queue
 * and the page's record. Turn it on with `?devcopy=1` (off with `?devcopy=0`); then in the console:
 *
 *   __pagerDev.offline(true)    // the computer can't be reached
 *   __pagerDev.offline(false)   // it can again: the queue is sent
 *
 * Pictures aren't covered: an <img> loads straight from the backend, not through this.
 */
import { KEEP_HEADER, SHELL_TAG } from "./ops";
import type { ClientRecord, CopyPort, CopyState, NewOutboxEntry, OutboxEntry } from "./port";

const ON = "pager.dev.copy";
const OFFLINE = "pager.dev.copy.offline";
const OUTBOX = "pager.dev.copy.outbox";
const CLIENT = "pager.dev.copy.client";
const INDEX = "pager.dev.copy.index";
const REACHED = "pager.dev.copy.reached";
const CACHE = "pager-dev-copy";

/** The lists the app always keeps (the same paths as `PhoneCopy.lists` in the app). */
export const KEPT_LISTS = [
  "/api/documents",
  "/api/tree",
  "/api/highlights",
  "/api/tags",
  "/api/health",
  "/api/settings",
  "/api/presets",
  "/api/tools/context/briefings",
];

interface Stored {
  tags: string[];
  size: number;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function unavailable(): Response {
  return new Response(JSON.stringify({ error: { code: "unavailable", message: "Pager can't reach your computer right now." } }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

export interface DevCopy {
  port: CopyPort;
  fetch: typeof fetch;
}

/** The stand-in, when this is a development build with it switched on; otherwise null. */
export function devCopyLink(): DevCopy | null {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return null;
  const flag = new URLSearchParams(window.location.search).get("devcopy");
  if (flag === "1") localStorage.setItem(ON, "1");
  if (flag === "0") localStorage.removeItem(ON);
  if (localStorage.getItem(ON) !== "1" || typeof caches === "undefined") return null;

  const real = window.fetch.bind(window);
  const offline = () => localStorage.getItem(OFFLINE) === "1";
  const bodies = () => caches.open(CACHE);

  const devFetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      window.location.origin,
    );
    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) return real(input, init);
    const key = url.pathname + url.search;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const tag = headers.get(KEEP_HEADER);
    headers.delete(KEEP_HEADER);
    const forward = () => real(input, { ...init, headers });

    if (method !== "GET") return offline() ? unavailable() : forward();
    if (offline()) {
      const hit = await (await bodies()).match(key);
      if (!hit) return unavailable();
      const kept = new Headers(hit.headers);
      kept.set("x-pager-offline", "1");
      return new Response(hit.body, { status: 200, headers: kept });
    }
    const res = await forward();
    write(REACHED, new Date().toISOString());
    const index = read<Record<string, Stored>>(INDEX, {});
    const list = KEPT_LISTS.includes(url.pathname);
    if (res.status === 200 && (tag || index[key] || list)) {
      const copy = res.clone();
      const size = (await copy.clone().arrayBuffer()).byteLength;
      await (await bodies()).put(key, copy);
      const tags = new Set(index[key]?.tags ?? []);
      if (tag) tags.add(tag);
      if (list) tags.add(SHELL_TAG);
      const latest = read<Record<string, Stored>>(INDEX, {});
      latest[key] = { tags: [...tags], size };
      write(INDEX, latest);
    }
    return res;
  };

  const port: CopyPort = {
    state: async (): Promise<CopyState> => {
      const index = read<Record<string, Stored>>(INDEX, {});
      const stored = Object.values(index);
      return {
        generation: "dev",
        online: !offline(),
        lastOnlineAt: read<string | null>(REACHED, null),
        bytes: stored.reduce((sum, e) => sum + e.size, 0),
        entries: stored.length,
        client: read<unknown>(CLIENT, null),
        outbox: read<OutboxEntry[]>(OUTBOX, []),
      };
    },
    setClient: async (client: ClientRecord) => write(CLIENT, client),
    drop: async (tag) => {
      const index = read<Record<string, Stored>>(INDEX, {});
      const cache = await bodies();
      for (const [key, entry] of Object.entries(index)) {
        if (!entry.tags.includes(tag)) continue;
        entry.tags = entry.tags.filter((t) => t !== tag);
        if (entry.tags.length === 0) {
          delete index[key];
          await cache.delete(key);
        }
      }
      write(INDEX, index);
    },
    wipe: async () => {
      await caches.delete(CACHE);
      localStorage.removeItem(INDEX);
      localStorage.removeItem(CLIENT);
    },
    enqueue: async (entry: NewOutboxEntry) => {
      const outbox = read<OutboxEntry[]>(OUTBOX, []);
      const at = new Date().toISOString();
      const i = outbox.findIndex((e) => e.key === entry.key);
      const saved: OutboxEntry =
        i >= 0
          ? { ...entry, seq: outbox[i]!.seq, at }
          : { ...entry, seq: outbox.reduce((max, e) => Math.max(max, e.seq), 0) + 1, at };
      if (i >= 0) outbox[i] = saved;
      else outbox.push(saved);
      write(OUTBOX, outbox);
      return saved;
    },
    remove: async (seq) =>
      write(
        OUTBOX,
        read<OutboxEntry[]>(OUTBOX, []).filter((e) => e.seq !== seq),
      ),
    probe: async () => {},
  };

  (window as unknown as { __pagerDev?: unknown }).__pagerDev = {
    /** Pretend the computer can't be reached (true) or can again (false), as the app would tell the page. */
    offline(on = true) {
      if (on) localStorage.setItem(OFFLINE, "1");
      else localStorage.removeItem(OFFLINE);
      (window as unknown as { __pager?: { online?: (up: boolean) => void } }).__pager?.online?.(!on);
    },
    state: () => port.state(),
  };

  return { port, fetch: devFetch };
}
