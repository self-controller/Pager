import type { PagerApi } from "@/api/client";
import {
  ApiError,
  ErrorCodes,
  type Annotation,
  type DocumentSummary,
  type JournalEvent,
  type UpdateAnnotation,
} from "@/api/types";
import {
  annotationPath,
  annotationsPath,
  applyPatch,
  byLastOpened,
  createKey,
  deleteKey,
  fieldsOf,
  hasProgress,
  newAnnotationId,
  optimisticProgress,
  overlayAnnotations,
  overlayHighlights,
  overlayProgress,
  overlayTree,
  patchKey,
  pendingOps,
  percentAt,
  progressKey,
  progressPath,
  provisional,
  type NewAnnotation,
  type QueuedProgress,
} from "./ops";
import type { CopyPort, NewOutboxEntry, OutboxEntry, OutboxMeta } from "./port";
import type { OfflineStore } from "./state";

export interface OfflineApiOptions {
  now?: () => string;
  /** Settles once the queue has been read from the app; reads and writes wait for it. */
  ready?: Promise<unknown>;
  /** Every event of the live stream, as the UI gets it. */
  onEvent?: (event: JournalEvent) => void;
}

/** The computer wasn't reached: the request may wait in the queue. */
export function unreachable(err: unknown): boolean {
  return err instanceof ApiError && err.code === ErrorCodes.unavailable;
}

function needsComputer(message: string): ApiError {
  return new ApiError(ErrorCodes.unavailable, message);
}

/** Put `saved` where the entry with its key is, or at the end. */
export function upsert(outbox: OutboxEntry[], saved: OutboxEntry): OutboxEntry[] {
  const i = outbox.findIndex((e) => e.key === saved.key);
  if (i < 0) return [...outbox, saved];
  const next = [...outbox];
  next[i] = saved;
  return next;
}

/**
 * The API as the iPhone app's page uses it. Reads show the changes still waiting to be sent. A
 * reading place or a highlight saved while the computer can't be reached goes into the app's queue
 * and is answered as if it had been saved; `replayOutbox` sends the queue later. Everything else
 * passes through.
 */
export function createOfflineApi(
  inner: PagerApi,
  port: CopyPort,
  store: OfflineStore,
  options: OfflineApiOptions = {},
): PagerApi {
  const now = options.now ?? (() => new Date().toISOString());
  /** Annotations the UI has listed, so a change to one can be answered without the computer. */
  const seen = new Map<string, Annotation>();

  const ready = options.ready ?? Promise.resolve();
  /** The waiting changes, once the queue has been read. */
  const ops = async () => {
    await ready;
    return pendingOps(store.get().outbox);
  };
  const offline = () => store.get().online === false;
  const queued = (key: string) => store.get().outbox.find((e) => e.key === key);
  /** An annotation with a change waiting: later changes wait behind it, in order. */
  const waiting = (id: string) => Boolean(queued(createKey(id)) ?? queued(patchKey(id)) ?? queued(deleteKey(id)));

  async function enqueue(entry: NewOutboxEntry): Promise<OutboxEntry> {
    const saved = await port.enqueue(entry);
    store.update((s) => ({ outbox: upsert(s.outbox, saved) }));
    return saved;
  }

  async function dequeue(seq: number): Promise<void> {
    await port.remove(seq);
    store.update((s) => ({ outbox: s.outbox.filter((e) => e.seq !== seq) }));
  }

  /** Send now when the computer may be reachable; queue when it isn't, or when sending finds it isn't. */
  async function sendOrQueue<T>(mustQueue: () => boolean, send: () => Promise<T>, queue: () => Promise<T>): Promise<T> {
    await ready;
    if (mustQueue() || offline()) return queue();
    try {
      return await send();
    } catch (err) {
      if (!unreachable(err)) throw err;
      return queue();
    }
  }

  function remember<A extends Annotation>(list: A[]): A[] {
    for (const a of list) seen.set(a.id, a);
    return list;
  }

  /** The book's and chapter's names for the Highlights list, from the copy when it has them. */
  async function describe(docId: string, input: NewAnnotation): Promise<OutboxMeta> {
    try {
      const doc = await inner.getDocument(docId);
      const sectionId = input.sectionRange?.sectionId;
      return {
        docId,
        docTitle: doc.title,
        ...(doc.author ? { docAuthor: doc.author } : {}),
        sectionTitle: doc.toc.find((t) => t.id === sectionId)?.title ?? null,
      };
    } catch {
      return { docId };
    }
  }

  async function queuePatch(id: string, patch: UpdateAnnotation): Promise<Annotation> {
    if (patch.reattach || patch.acceptAnchor)
      throw needsComputer("Moving a highlight needs your computer. Try again when it can be reached.");
    const create = queued(createKey(id));
    if (create) {
      // Not sent yet: change what will be sent.
      const body = { ...(create.body as NewAnnotation), ...fieldsOf(patch) };
      const saved = await enqueue({ key: create.key, method: create.method, path: create.path, body, meta: create.meta });
      return provisional(create.meta.docId, body, saved.at);
    }
    const before = seen.get(id);
    if (!before) throw needsComputer("That change needs your computer. Try again when it can be reached.");
    const earlier = queued(patchKey(id));
    const body = { ...(earlier?.body as UpdateAnnotation | undefined), ...fieldsOf(patch) };
    const saved = await enqueue({
      key: patchKey(id),
      method: "PATCH",
      path: annotationPath(id),
      body,
      meta: { docId: before.docId },
    });
    return applyPatch(before, body, saved.at);
  }

  return {
    ...inner,

    getDocument: async (id) => overlayProgress(await inner.getDocument(id), await ops()),

    listDocuments: async (query) => {
      const pending = await ops();
      const list = await inner.listDocuments(query);
      if (!hasProgress(pending)) return list;
      const out: DocumentSummary[] = list.map((d) => overlayProgress(d, pending));
      if (!query?.history) return out;
      // A book first opened while offline isn't in the computer's history yet.
      for (const op of pending) {
        if (op.type !== "progress" || out.some((d) => d.id === op.docId)) continue;
        try {
          out.push(overlayProgress<DocumentSummary>(await inner.getDocument(op.docId), pending));
        } catch {
          // Not in the copy: it shows once the computer has the place.
        }
      }
      return byLastOpened(out);
    },

    getTree: async () => overlayTree(await inner.getTree(), await ops()),

    saveProgress: (id, update) =>
      sendOrQueue(
        () => false,
        async () => {
          const saved = await inner.saveProgress(id, update);
          // An older place still waiting would only be refused later.
          const stale = queued(progressKey(id));
          if (stale) await dequeue(stale.seq);
          return saved;
        },
        async () => {
          // A downloaded book's place is weighted as the computer will weight it, so the Library
          // shows the same number before and after it is sent.
          const weights = store.get().client.kept[id]?.weights;
          const percent = (weights && percentAt(weights, update.sectionId, update.offset)) ?? update.percent;
          const body: QueuedProgress = { ...update, percent, updatedAt: now() };
          await enqueue({ key: progressKey(id), method: "PUT", path: progressPath(id), body, meta: { docId: id } });
          return optimisticProgress(id, body);
        },
      ),

    listAnnotations: async (docId) =>
      remember(overlayAnnotations(remember(await inner.listAnnotations(docId)), await ops(), docId)),

    listHighlights: async (query) => remember(overlayHighlights(remember(await inner.listHighlights(query)), await ops(), query)),

    createAnnotation: (docId, input) => {
      const withId: NewAnnotation = { ...input, id: input.id ?? newAnnotationId() };
      return sendOrQueue(
        () => false,
        () => inner.createAnnotation(docId, withId),
        async () => {
          const meta = await describe(docId, withId);
          const saved = await enqueue({
            key: createKey(withId.id),
            method: "POST",
            path: annotationsPath(docId),
            body: withId,
            meta,
          });
          const made = provisional(docId, withId, saved.at);
          seen.set(made.id, made);
          return made;
        },
      );
    },

    updateAnnotation: (id, patch) =>
      sendOrQueue(
        () => waiting(id),
        () => inner.updateAnnotation(id, patch),
        () => queuePatch(id, patch),
      ),

    deleteAnnotation: (id) =>
      sendOrQueue(
        () => waiting(id),
        () => inner.deleteAnnotation(id),
        async () => {
          const docId = seen.get(id)?.docId ?? queued(createKey(id))?.meta.docId ?? "";
          await enqueue({ key: deleteKey(id), method: "DELETE", path: annotationPath(id), meta: { docId } });
        },
      ),

    restoreAnnotation: async (id) => {
      await ready;
      const removal = queued(deleteKey(id));
      if (removal) {
        // The delete was never sent: take it back out of the queue.
        await dequeue(removal.seq);
        const create = queued(createKey(id));
        const back = create ? provisional(create.meta.docId, create.body as NewAnnotation, create.at) : seen.get(id);
        if (back) return back;
        throw needsComputer("Pager couldn't bring that back. Try again when your computer can be reached.");
      }
      if (offline()) throw needsComputer("Bringing that back needs your computer. Try again when it can be reached.");
      return inner.restoreAnnotation(id);
    },

    subscribe: (onEvent) =>
      inner.subscribe((event) => {
        onEvent(event);
        options.onEvent?.(event);
      }),
  };
}
