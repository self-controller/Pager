import { Redo2, Undo2 } from "lucide-react";
import { pillParts, pillText, type Pill } from "./useJumpHistory";

/**
 * The way back after a jump, bottom-left over the page: "Back to p. 42", then "Return to p. 87"
 * once used, and so on ("Back", "Return to Chapter 3" in the scroll layout). It exists only after a jump, and stays when the chrome hides: it's the
 * safety net for a jump the reader didn't mean. The button is 44px tall; the pill inside, 32px.
 */
export function BackPill({ pill, onClick }: { pill: Pill; onClick: () => void }) {
  const Icon = pill.kind === "back" ? Undo2 : Redo2;
  const { lead, chapter } = pillParts(pill);
  const paged = pill.page !== undefined;
  return (
    <button
      // A new key on each flip replays the entrance, so the change of direction is seen.
      key={pill.kind}
      type="button"
      onClick={onClick}
      aria-label={pillText(pill)}
      title={pillText(pill)}
      className="back-pill group pointer-events-auto flex h-11 max-w-full items-center"
    >
      <span className="back-pill-face flex h-8 min-w-0 items-center gap-1.5 rounded-full pr-3.5 pl-2.5 font-sans text-[13px] leading-4 font-semibold text-accent elevation transition-hover group-hover:text-accent-hover">
        <Icon size={16} strokeWidth={2} className="shrink-0" aria-hidden />
        <span className="shrink-0 tabular-nums">{lead}</span>
        {chapter && (
          <>
            {paged && (
              <span className="shrink-0 text-fg-3" aria-hidden>
                ·
              </span>
            )}
            <span className="min-w-0 truncate font-medium">{chapter}</span>
          </>
        )}
      </span>
    </button>
  );
}
