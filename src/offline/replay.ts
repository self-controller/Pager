import type { PagerApi } from "@/api/client";
import { ApiError, ErrorCodes } from "@/api/types";
import { createdFields, parseEntry, type PendingOp } from "./ops";
import type { CopyPort, OutboxEntry } from "./port";
import type { OfflineStore } from "./state";

export interface ReplayResult {
  /** Changes the computer now has (or no longer needs). */
  sent: number;
  /** Changes it refused for good: kept in the page's record, with their words. */
  failed: number;
  /** True when the computer stopped answering: the rest waits for next time. */
  stopped: boolean;
}

type Outcome = "done" | "stop" | { code: string; message: string };

async function send(inner: PagerApi, op: PendingOp): Promise<void> {
  switch (op.type) {
    case "progress":
      await inner.saveProgress(op.docId, op.update);
      return;
    case "create":
      try {
        await inner.createAnnotation(op.docId, op.input);
      } catch (err) {
        // The computer already has this id with other fields: an earlier send arrived and the
        // highlight was changed afterwards. Send the fields as a change.
        if (!(err instanceof ApiError && err.status === 409 && err.code === "conflict")) throw err;
        await inner.updateAnnotation(op.id, createdFields(op.input));
      }
      return;
    case "patch":
      await inner.updateAnnotation(op.id, op.patch);
      return;
    case "delete":
      await inner.deleteAnnotation(op.id);
      return;
  }
}

function outcome(op: PendingOp, err: unknown): Outcome {
  if (!(err instanceof ApiError)) return "stop";
  // Not reached, or this phone isn't paired any more: keep everything for later.
  if (err.code === ErrorCodes.unavailable || err.code === ErrorCodes.unauthorized) return "stop";
  // A newer place was saved on another device: that one stands.
  if (op.type === "progress" && err.status === 409) return "done";
  // Already gone on the computer: nothing left to change, or no book to keep a place in.
  if (err.status === 404 && op.type !== "create") return "done";
  return { code: err.code, message: err.message };
}

/**
 * Send the queue to the computer, oldest first. Each change is removed once the computer has it or
 * no longer needs it. One it refuses for good (the passage is gone, the book was removed) moves to
 * the page's record with its words, so nothing is lost without a trace. `inner` is the plain API.
 */
export async function replayOutbox(
  inner: PagerApi,
  port: CopyPort,
  store: OfflineStore,
  now: () => string = () => new Date().toISOString(),
): Promise<ReplayResult> {
  const result: ReplayResult = { sent: 0, failed: 0, stopped: false };
  const drop = async (entry: OutboxEntry) => {
    await port.remove(entry.seq);
    store.update((s) => ({ outbox: s.outbox.filter((e) => e.seq !== entry.seq) }));
  };
  for (;;) {
    // Read again each time: a change made meanwhile joins the queue behind these.
    const entry = store.get().outbox[0];
    if (!entry) return result;
    const op = parseEntry(entry);
    if (!op) {
      await drop(entry);
      continue;
    }
    let ended: Outcome = "done";
    try {
      await send(inner, op);
    } catch (err) {
      ended = outcome(op, err);
    }
    if (ended === "stop") {
      result.stopped = true;
      return result;
    }
    if (ended === "done") {
      result.sent += 1;
    } else {
      result.failed += 1;
      const failure = { entry, code: ended.code, message: ended.message, at: now() };
      store.update((s) => ({ client: { ...s.client, failed: [...s.client.failed, failure] } }));
      await port.setClient(store.get().client);
    }
    await drop(entry);
  }
}
