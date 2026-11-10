/**
 * The page's side of the iPhone app's copy (ios/README.md, "The copy"). The app keeps answers from
 * the computer on disk, a queue of changes made while it couldn't be reached, and one JSON record
 * that belongs to the page. It knows nothing about books or highlights: the page decides what to
 * download, what a waiting change means, and how the queue is sent.
 */

export type OutboxMethod = "PUT" | "POST" | "PATCH" | "DELETE";

/** What the page needs to show a waiting change before it is sent. The app only stores it. */
export interface OutboxMeta {
  /** "" when the page never saw which document an annotation belongs to. */
  docId: string;
  docTitle?: string;
  docAuthor?: string;
  sectionTitle?: string | null;
}

export interface NewOutboxEntry {
  /** One entry per key: a later one with the same key takes the earlier one's place in the queue. */
  key: string;
  method: OutboxMethod;
  /** The request as it will be sent, e.g. `/api/documents/abc/progress`. */
  path: string;
  body?: unknown;
  meta: OutboxMeta;
}

/** One change waiting to be sent to the computer. */
export interface OutboxEntry extends NewOutboxEntry {
  seq: number;
  /** When it was queued (ISO-8601). */
  at: string;
}

/** A book the reader chose to download. */
export interface KeptBook {
  /** The file version the copy holds; another one on the computer means download it again. */
  revisionId: string;
  title: string;
  sections: number;
  /**
   * Each section's id and the length of its text, in reading order: how far through the book a
   * place is, weighted as the computer weights it (API.md: `percent` is by characters).
   */
  weights?: Array<[string, number]>;
  at: string;
  /** False while a download is under way or was cut short; the next sync finishes it. */
  complete: boolean;
}

/** A change the computer refused for good, kept so its words aren't lost. */
export interface FailedChange {
  entry: OutboxEntry;
  code: string;
  message: string;
  at: string;
}

/** The page's own record, stored by the app as it is and removed with the downloads. */
export interface ClientRecord {
  v: 1;
  kept: Record<string, KeptBook>;
  /** Covers already in the copy: document id to the cover's URL. */
  covers: Record<string, string>;
  lastSyncedAt: string | null;
  failed: FailedChange[];
}

export function emptyClient(): ClientRecord {
  return { v: 1, kept: {}, covers: {}, lastSyncedAt: null, failed: [] };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The stored record, or an empty one when there is none or it is another version's. */
export function readClient(raw: unknown): ClientRecord {
  if (!isRecord(raw) || raw.v !== 1) return emptyClient();
  return {
    v: 1,
    kept: isRecord(raw.kept) ? (raw.kept as Record<string, KeptBook>) : {},
    covers: isRecord(raw.covers) ? (raw.covers as Record<string, string>) : {},
    lastSyncedAt: typeof raw.lastSyncedAt === "string" ? raw.lastSyncedAt : null,
    failed: Array.isArray(raw.failed) ? (raw.failed as FailedChange[]) : [],
  };
}

export interface CopyState {
  /** Changes when the downloads are removed. */
  generation: string;
  /** Whether the computer can be reached; null until the app has tried. */
  online: boolean | null;
  lastOnlineAt: string | null;
  /** The size of the stored answers. */
  bytes: number;
  entries: number;
  client: unknown;
  outbox: OutboxEntry[];
}

export interface CopyPort {
  state(): Promise<CopyState>;
  setClient(client: ClientRecord): Promise<void>;
  /** Take `tag` off every stored answer, and remove the answers left with no tag. */
  drop(tag: string): Promise<void>;
  /** Remove every stored answer and the page's record. The queue stays. */
  wipe(): Promise<void>;
  enqueue(entry: NewOutboxEntry): Promise<OutboxEntry>;
  remove(seq: number): Promise<void>;
  /** Try to reach the computer now. */
  probe(): Promise<void>;
}

/** The app's routes for its own page (never forwarded to the computer). */
export function nativePort(fetchImpl: typeof fetch = fetch.bind(globalThis)): CopyPort {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`/_app${path}`, {
      method,
      headers:
        body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`The app answered ${res.status} to ${method} /_app${path}.`);
    return (text ? JSON.parse(text) : undefined) as T;
  }
  return {
    state: () => call<CopyState>("GET", "/copy"),
    setClient: (client) => call<void>("PUT", "/copy/client", client),
    drop: (tag) => call<void>("POST", "/copy/drop", { tag }),
    wipe: () => call<void>("DELETE", "/copy"),
    enqueue: async (entry) => ({ ...entry, ...(await call<{ seq: number; at: string }>("POST", "/outbox", entry)) }),
    remove: (seq) => call<void>("DELETE", `/outbox/${seq}`),
    probe: () => call<void>("POST", "/probe"),
  };
}

/** The same rules in memory, for tests. */
export interface MemoryPort extends CopyPort {
  outbox: OutboxEntry[];
  client: unknown;
  online: boolean | null;
  dropped: string[];
  wipes: number;
  probes: number;
}

export function memoryPort(now: () => string = () => new Date().toISOString()): MemoryPort {
  let next = 1;
  const port: MemoryPort = {
    outbox: [],
    client: null,
    online: true,
    dropped: [],
    wipes: 0,
    probes: 0,
    state: async () => ({
      generation: `g${port.wipes}`,
      online: port.online,
      lastOnlineAt: null,
      bytes: 0,
      entries: 0,
      client: port.client,
      outbox: port.outbox.map((e) => ({ ...e })),
    }),
    setClient: async (client) => {
      port.client = JSON.parse(JSON.stringify(client));
    },
    drop: async (tag) => {
      port.dropped.push(tag);
    },
    wipe: async () => {
      port.wipes += 1;
      port.client = null;
    },
    enqueue: async (entry) => {
      const at = now();
      const i = port.outbox.findIndex((e) => e.key === entry.key);
      if (i >= 0) {
        const replaced = { ...entry, seq: port.outbox[i]!.seq, at };
        port.outbox[i] = replaced;
        return { ...replaced };
      }
      const added = { ...entry, seq: next++, at };
      port.outbox.push(added);
      return { ...added };
    },
    remove: async (seq) => {
      port.outbox = port.outbox.filter((e) => e.seq !== seq);
    },
    probe: async () => {
      port.probes += 1;
    },
  };
  return port;
}
