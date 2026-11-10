import { cx } from "@/lib/cx";
import { formatWhen } from "@/lib/format";
import { useOffline, type OfflineState } from "@/offline";

/** "Offline · synced 2:14 pm" while the iPhone app can't reach the computer; null otherwise. */
export function offlineLabel(state: OfflineState, now: Date = new Date()): string | null {
  if (!state.available || state.online !== false) return null;
  const when = formatWhen(state.client.lastSyncedAt ?? state.lastOnlineAt, now);
  return when ? `Offline · synced ${when}` : "Offline · not synced yet";
}

/**
 * The quiet line: one small, muted line saying the app is reading from its own copy, and from when.
 * It shows in the Library and in Settings, never inside the reader.
 */
export function OfflineLine({ className }: { className?: string }) {
  const label = offlineLabel(useOffline());
  if (!label) return null;
  return (
    <p role="status" className={cx("font-byline text-[12px] leading-4 text-fg-2", className)}>
      {label}
    </p>
  );
}
