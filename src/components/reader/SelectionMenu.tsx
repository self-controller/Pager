import { Highlighter, Link2, MessageSquareText } from "lucide-react";
import type { HighlightColor } from "@/api/types";
import { useSelectionActions } from "@/tools/registry";
import type { TextSelection, ToolContext } from "@/tools/types";

const DOT: Record<HighlightColor, string> = {
  yellow: "var(--hl-yellow-line)",
  green: "var(--hl-green-line)",
  blue: "var(--hl-blue-line)",
  pink: "var(--hl-pink-line)",
  purple: "var(--hl-purple-line)",
};

const item = "flex h-8 items-center gap-1.5 rounded-xs px-2 text-[13px] font-semibold transition-hover hover:bg-white/15";

/**
 * Floating bar over selected text: Highlight and Note, then any actions registered by tools.
 * Rendered outside the reading body, so it never adds text to the section's DOM.
 */
export function SelectionMenu({
  selection,
  context,
  color,
  onHighlight,
  onNote,
  onReattach,
}: {
  selection: TextSelection | null;
  context: ToolContext;
  color: HighlightColor;
  onHighlight?: (selection: TextSelection) => void;
  onNote?: (selection: TextSelection) => void;
  /** While moving a highlight by hand, the only action offered. */
  onReattach?: (selection: TextSelection) => void;
}) {
  const actions = useSelectionActions();
  if (!selection?.rect) return null;
  if (onReattach) {
    return (
      <div
        role="toolbar"
        aria-label="Selection actions"
        className="fixed z-30 flex -translate-x-1/2 -translate-y-full rounded-sm bg-[var(--tooltip-bg)] p-1 text-[var(--tooltip-fg)] shadow-lg"
        style={{ top: Math.max(8, selection.rect.top - 8), left: selection.rect.left + selection.rect.width / 2 }}
        onMouseDown={(e) => e.preventDefault()}
      >
        <button type="button" className={item} onClick={() => onReattach(selection)}>
          <Link2 size={16} aria-hidden />
          Reattach here
        </button>
      </div>
    );
  }
  if (!onHighlight && !onNote && actions.length === 0) return null;
  const { top, left, width } = selection.rect;
  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="fixed z-30 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-sm bg-[var(--tooltip-bg)] p-1 text-[var(--tooltip-fg)] shadow-lg"
      style={{ top: Math.max(8, top - 8), left: left + width / 2 }}
      onMouseDown={(e) => e.preventDefault() /* keep the selection */}
    >
      {onHighlight && (
        <button type="button" className={item} onClick={() => onHighlight(selection)}>
          <span className="flex size-4 items-center justify-center">
            <Highlighter size={16} aria-hidden />
          </span>
          Highlight
          <span aria-hidden className="ml-0.5 size-2.5 rounded-full" style={{ background: DOT[color] }} />
        </button>
      )}
      {onNote && (
        <button type="button" className={item} onClick={() => onNote(selection)}>
          <MessageSquareText size={16} aria-hidden />
          Note
        </button>
      )}
      {actions.length > 0 && (onHighlight || onNote) && <span aria-hidden className="mx-0.5 h-5 w-px bg-white/20" />}
      {actions.map(({ tool, action }) => {
        const Icon = action.icon;
        return (
          <button
            key={`${tool.id}:${action.id}`}
            type="button"
            onClick={() => void action.run({ ...context, selection })}
            className={item}
          >
            {Icon && <Icon size={16} aria-hidden />}
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
