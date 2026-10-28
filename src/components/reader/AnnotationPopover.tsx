import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, Trash2, X } from "lucide-react";
import type { Annotation, HighlightColor } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { cx } from "@/lib/cx";
import { HIGHLIGHT_COLORS } from "./useHighlightPainting";

const SWATCH: Record<HighlightColor, string> = {
  yellow: "var(--hl-yellow-line)",
  green: "var(--hl-green-line)",
  blue: "var(--hl-blue-line)",
  pink: "var(--hl-pink-line)",
  purple: "var(--hl-purple-line)",
};

export function ColorSwatches({ value, onChange }: { value: HighlightColor | null; onChange: (c: HighlightColor) => void }) {
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label="Highlight colour">
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          title={c}
          onClick={() => onChange(c)}
          className={cx(
            "flex size-7 items-center justify-center rounded-full transition-hover pressable",
            value === c ? "ring-2 ring-fg ring-offset-2 ring-offset-[var(--bg-elevated)]" : "hover:scale-110",
          )}
          style={{ background: SWATCH[c] }}
        >
          {value === c && <Check size={14} strokeWidth={3} className="text-white" aria-hidden />}
        </button>
      ))}
    </div>
  );
}

/**
 * A panel pinned to a viewport point (a click or a selection). Closes on Esc, outside clicks and
 * scrolling, since a fixed panel would drift away from its words.
 */
export function FloatingPanel({
  x,
  y,
  onClose,
  children,
  label,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, x - width / 2), window.innerWidth - width - 8);
    const below = y + 16 + height < window.innerHeight - 8;
    setStyle({ left, top: below ? y + 16 : Math.max(8, y - 16 - height) });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onMove = () => onClose();
    // Registered after the opening click has finished propagating.
    const t = window.setTimeout(() => {
      document.addEventListener("pointerdown", onDown);
      window.addEventListener("scroll", onMove, { passive: true });
      window.addEventListener("reader:pagechange", onMove);
      window.addEventListener("resize", onMove);
    });
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onMove);
      window.removeEventListener("reader:pagechange", onMove);
      window.removeEventListener("resize", onMove);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className="fixed z-40 w-[320px] rounded-md bg-elevated p-3 elevation"
      style={style}
    >
      {children}
    </div>
  );
}

/** Textarea for a note, saved with ⌘/Ctrl+Enter. */
export function NoteEditor({
  initial,
  onSave,
  onCancel,
  saveLabel = "Save note",
}: {
  initial: string;
  onSave: (body: string) => void;
  onCancel: () => void;
  saveLabel?: string;
}) {
  const [body, setBody] = useState(initial);
  return (
    <div className="flex flex-col gap-2">
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(body.trim());
        }}
        rows={4}
        placeholder="Write a note in your own words…"
        className="w-full resize-y rounded-sm bg-surface p-2.5 font-serif text-[15px] leading-[22px] shadow-[inset_0_0_0_1px_var(--detail)] placeholder:text-fg-3 focus-visible:shadow-[inset_0_0_0_1px_var(--accent),var(--focus-ring)]"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="tertiary" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={() => onSave(body.trim())}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

/** Trimmed, without a leading "#", single-spaced; empty strings dropped (the server's rule). */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, "").replace(/\s+/g, " ").slice(0, 63);
}

/** Adds a tag unless it is already there (case-insensitively), keeping the server's limit of 50. */
export function addTag(tags: string[], raw: string): string[] {
  const tag = normalizeTag(raw);
  if (!tag || tags.length >= 50 || tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return tags;
  return [...tags, tag];
}

/** Tags as removable chips plus an input: Enter or comma adds, Backspace on empty removes the last. */
export function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const next = addTag(tags, draft);
    if (next !== tags) onChange(next);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex h-7 items-center gap-0.5 rounded-full bg-surface-2 pr-1 pl-2.5 text-[13px] font-medium"
        >
          #{t}
          <button
            type="button"
            aria-label={`Remove tag ${t}`}
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="flex size-5 items-center justify-center rounded-full text-fg-2 hover:bg-surface-3 hover:text-fg"
          >
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(",")) {
            const next = addTag(tags, v.slice(0, -1));
            if (next !== tags) onChange(next);
            setDraft("");
          } else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => draft && commit()}
        placeholder={tags.length ? "Add tag" : "Add a tag"}
        aria-label="Add a tag"
        className="h-7 min-w-[90px] flex-1 rounded-full bg-transparent px-2 text-[13px] placeholder:text-fg-3 focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]"
      />
    </div>
  );
}

interface Props {
  annotation: Annotation;
  x: number;
  y: number;
  onClose: () => void;
  onColor: (color: HighlightColor) => void;
  onNote: (body: string | null) => void;
  onDelete: () => void;
  onAcceptAnchor: () => void;
  onTags: (tags: string[]) => void;
}

/** Opens on a click on painted text: colour, note, tags, delete, and confirming a fuzzy re-anchor. */
export function AnnotationPopover({ annotation, x, y, onClose, onColor, onNote, onDelete, onAcceptAnchor, onTags }: Props) {
  const [editing, setEditing] = useState(false);
  const fuzzy = annotation.anchor.status === "fuzzy";

  return (
    <FloatingPanel x={x} y={y} onClose={onClose} label="Highlight">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <ColorSwatches value={annotation.color} onChange={onColor} />
          <button
            type="button"
            onClick={onDelete}
            aria-label="Remove highlight"
            title="Remove highlight"
            className="flex size-8 items-center justify-center rounded-sm text-fg-2 transition-hover hover:bg-surface-2 hover:text-fg"
          >
            <Trash2 size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        {fuzzy && (
          <div className="flex items-start gap-2 rounded-sm bg-surface-2 p-2.5 text-[13px] leading-[18px]">
            <span className="flex-1 text-fg-2">
              The words here changed a little since you marked them. You first marked: “{annotation.anchor.originalQuote}”
            </span>
            <Button size="sm" variant="secondary" onClick={onAcceptAnchor}>
              Looks right
            </Button>
          </div>
        )}

        {editing ? (
          <NoteEditor
            initial={annotation.body ?? ""}
            onCancel={() => setEditing(false)}
            onSave={(body) => {
              onNote(body || null);
              setEditing(false);
            }}
          />
        ) : annotation.body ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-sm p-2 text-left font-serif text-[15px] leading-[22px] whitespace-pre-wrap transition-hover hover:bg-surface-hover"
            title="Edit note"
          >
            {annotation.body}
          </button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)} className="self-start">
            Add a note
          </Button>
        )}

        <div className="border-t border-detail pt-2.5">
          <TagEditor tags={annotation.tags} onChange={onTags} />
        </div>
      </div>
    </FloatingPanel>
  );
}
