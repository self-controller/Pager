import { useState } from "react";
import { offline } from "@/api";
import { dropStoredSections } from "@/cache";
import { offlineLabel } from "@/components/shell/OfflineLine";
import { Button } from "@/components/ui/Button";
import { formatBytes, formatWhen } from "@/lib/format";
import { useOffline, type OfflineState } from "@/offline";
import type { FailedChange } from "@/offline/port";

/** "Offline · synced 2:14 pm", or how the connection to the computer stands. */
function statusLine(state: OfflineState): string {
  const away = offlineLabel(state);
  if (away) return away;
  if (state.online === null) return "Looking for your computer…";
  const when = formatWhen(state.client.lastSyncedAt);
  return when ? `Connected to your computer · synced ${when}` : "Connected to your computer";
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The words of a change the computer refused: the highlighted text, or the note. */
function wordsOf(change: FailedChange): string {
  const body = change.entry.body as { selectedText?: unknown; body?: unknown } | undefined;
  const quote = typeof body?.selectedText === "string" ? body.selectedText : "";
  const note = typeof body?.body === "string" ? body.body : "";
  return [quote, note].filter(Boolean).join("\n\n");
}

/**
 * Settings → This iPhone, in the iPhone app: whether the computer can be reached and when the copy
 * was last brought up to date, the changes waiting to be sent, any the computer refused (with their
 * words, to copy out), and how much room the downloaded books take.
 */
export function PhoneCopySettings() {
  const state = useOffline();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!state.available || !offline) return null;
  const runtime = offline;
  const books = Object.values(state.client.kept);
  const waiting = state.outbox.length;
  const failed = state.client.failed;

  const removeAll = () => {
    setBusy(true);
    // The chapters the page keeps between launches go too.
    void dropStoredSections();
    void runtime
      .removeAll()
      .catch(() => {})
      .finally(() => {
        setBusy(false);
        setConfirm(false);
      });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-[15px] leading-5 font-medium">Your computer</span>
        <span role="status" className="text-[13px] leading-[18px] text-fg-2">
          {statusLine(state)}
        </span>
        {waiting > 0 && (
          <span className="text-[13px] leading-[18px] text-fg-2">
            {plural(waiting, "change", "changes")} waiting to send. {waiting === 1 ? "It goes" : "They go"} to your computer the
            next time Pager reaches it.
          </span>
        )}
        {state.online === false && (
          <div className="pt-1">
            <Button size="sm" variant="secondary" onClick={() => void runtime.probe().catch(() => {})}>
              Try again
            </Button>
          </div>
        )}
      </div>

      {failed.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[15px] leading-5 font-medium">
            {plural(failed.length, "change", "changes")} couldn't be saved
          </span>
          <span className="text-[13px] leading-[18px] text-fg-2">
            Your computer refused {failed.length === 1 ? "it" : "them"}: the passage may have changed, or the book was removed.
            The words are kept here until you discard them.
          </span>
          <ul className="flex flex-col gap-2">
            {failed.map((change, i) => {
              const words = wordsOf(change);
              return (
                <li key={`${change.entry.seq}-${change.at}`} className="flex flex-col gap-2 rounded-sm bg-surface-2 p-3">
                  {change.entry.meta.docTitle && (
                    <span className="font-byline text-[12px] leading-4 text-fg-2">{change.entry.meta.docTitle}</span>
                  )}
                  <span className="line-clamp-4 font-serif text-[14px] leading-5 whitespace-pre-line">
                    {words || "A change with no text."}
                  </span>
                  <span className="text-[12px] leading-4 text-fg-2">{change.message}</span>
                  <div className="flex gap-2">
                    {words && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void navigator.clipboard?.writeText(words).catch(() => {})}
                      >
                        Copy
                      </Button>
                    )}
                    <Button size="sm" variant="tertiary" onClick={() => void runtime.discardFailed(i).catch(() => {})}>
                      Discard
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-[15px] leading-5 font-medium">Downloaded books</span>
        <span className="text-[13px] leading-[18px] text-fg-2">
          {books.length === 0
            ? "None yet. In the Library, open a book's menu and choose Download to read it when your computer can't be reached."
            : `${plural(books.length, "book", "books")} on this iPhone, ${formatBytes(state.bytes)} with the library's lists and covers.`}
        </span>
        {books.length > 0 &&
          (confirm ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[14px]">Remove every downloaded book from this iPhone?</span>
              <Button size="sm" variant="tertiary" onClick={() => setConfirm(false)} disabled={busy}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={removeAll} disabled={busy}>
                Remove
              </Button>
            </div>
          ) : (
            <div className="pt-1">
              <Button size="sm" variant="secondary" onClick={() => setConfirm(true)}>
                Remove all downloads
              </Button>
            </div>
          ))}
      </div>
    </div>
  );
}
