import { useEffect, useRef, type RefObject } from "react";
import { flushSync } from "react-dom";
import { Copy, MessageSquareText, Share, Trash2, type LucideIcon } from "lucide-react";
import type { Annotation } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { copyText } from "@/lib/clipboard";
import { cx } from "@/lib/cx";
import { useIsPhone } from "@/lib/useIsPhone";
import { AnnotationPopover, ColorSwatches, FloatingPanel, NoteEditor, TagEditor } from "./AnnotationPopover";
import { indexText, rangeForOffsets } from "./dom";
import { READ_LINE_PX, type ChapterScroll } from "./useChapterScroll";
import type { useReaderAnnotations } from "./useReaderAnnotations";

type Notes = ReturnType<typeof useReaderAnnotations>;
type Popover = NonNullable<Notes["popover"]>;

const TRAY_ID = "highlight-tray";
/** The highlighted words rest at least this far above the tray. */
const TRAY_CLEARANCE_PX = 24;
/** How long the chapter takes to carry the words clear of the tray. */
const TRAY_LIFT_MS = 320;

const quoteClasses = "line-clamp-3 border-l-2 border-[var(--hl-yellow-line)] pl-2.5 font-serif text-[14px] leading-5 text-fg-2";

/**
 * How far the chapter must scroll for an annotation's words to sit clear above a tray whose top is
 * at `trayTop`: 0 when they already do. Never so far that their first line leaves the top of the
 * reading box (`boxTop`), so a passage taller than the room shows from its start.
 */
export function liftForTray(words: { top: number; bottom: number }, trayTop: number, boxTop: number): number {
  const need = words.bottom - (trayTop - TRAY_CLEARANCE_PX);
  if (need <= 0) return 0;
  return Math.max(0, Math.min(need, words.top - (boxTop + READ_LINE_PX)));
}

/** The box of the annotation's words in the section rendered in `root`, in viewport px. */
function wordsBox(root: HTMLElement, sectionId: string, annotation: Annotation): { top: number; bottom: number } | null {
  const index = indexText(root);
  let top = Infinity;
  let bottom = -Infinity;
  for (const seg of annotation.anchor.segments) {
    if (seg.sectionId !== sectionId) continue;
    const box = rangeForOffsets(index, seg.start, seg.end)?.getBoundingClientRect();
    if (!box || (box.width === 0 && box.height === 0)) continue;
    top = Math.min(top, box.top);
    bottom = Math.max(bottom, box.bottom);
  }
  return bottom > top ? { top, bottom } : null;
}

function TrayAction({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md bg-surface-2 text-[12px] leading-4 font-semibold transition-hover pressable hover:bg-surface-3",
        danger && "text-error",
      )}
    >
      <Icon size={20} strokeWidth={1.75} aria-hidden />
      {label}
    </button>
  );
}

function TrayBody({ popover }: { popover: Popover }) {
  const { annotation } = popover;
  const { toast } = useToast();
  const quote = annotation.anchor.quote;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  // Rendered before the tap ends, so the note's text area takes focus while the tap still counts
  // (in the iPhone app the keyboard only rises then).
  const editNote = () => flushSync(() => popover.onEditNote());
  return (
    <div className="flex flex-col gap-3 px-5 pt-1 pb-3">
      {/* The dots, not their targets, line up with the column. */}
      <div className="-mx-1">
        <ColorSwatches value={annotation.color} onChange={popover.onColor} onRemove={popover.onDelete} />
      </div>
      <div className="flex gap-2">
        <TrayAction icon={MessageSquareText} label="Note" onClick={editNote} />
        <TrayAction
          icon={Copy}
          label="Copy"
          onClick={() => void copyText(quote).then((ok) => toast({ message: ok ? "Copied" : "Couldn't copy that" }))}
        />
        {canShare && (
          // A share sheet the reader closes rejects; that is not an error to show.
          <TrayAction icon={Share} label="Share" onClick={() => void navigator.share({ text: quote }).catch(() => {})} />
        )}
        <TrayAction icon={Trash2} label="Delete" onClick={popover.onDelete} danger />
      </div>

      {annotation.anchor.status === "fuzzy" && (
        <div className="flex items-start gap-2 rounded-sm bg-surface-2 p-2.5 text-[13px] leading-[18px]">
          <span className="flex-1 text-fg-2">
            The words here changed a little since you marked them. You first marked: “{annotation.anchor.originalQuote}”
          </span>
          <Button size="sm" variant="secondary" onClick={popover.onAcceptAnchor}>
            Looks right
          </Button>
        </div>
      )}

      {annotation.body && (
        <button
          type="button"
          onClick={editNote}
          title="Edit note"
          className="-mx-2 rounded-sm p-2 text-left font-serif text-[15px] leading-[22px] whitespace-pre-wrap transition-hover hover:bg-surface-hover"
        >
          {annotation.body}
        </button>
      )}

      <div className="border-t border-detail pt-2.5">
        <TagEditor tags={annotation.tags} onChange={popover.onTags} />
      </div>
    </div>
  );
}

/**
 * A highlight's editor on a phone: a tray docked at the bottom, the page live behind it, colours
 * first (as YouVersion's verse tray). `onShown` hears where the tray's top rests once it has opened,
 * so the reader can carry the words clear of it.
 */
export function HighlightTray({
  popover,
  onShown,
}: {
  popover: Popover | null;
  onShown?: (annotation: Annotation, trayTop: number) => void;
}) {
  // What it showed last stays through its way out, after the highlight is closed or removed.
  const last = useRef(popover);
  if (popover) last.current = popover;
  const shown = popover ?? last.current;
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  const openId = popover?.annotation.id;

  // After the Sheet's own effect has opened the dialog, so it can be measured.
  useEffect(() => {
    const el = document.getElementById(TRAY_ID);
    const open = last.current;
    if (!openId || !el || !open) return;
    // Where it rests: its box now is still on its way in.
    const top = window.innerHeight - (parseFloat(getComputedStyle(el).bottom) || 0) - el.offsetHeight;
    onShownRef.current?.(open.annotation, top);
  }, [openId]);

  return (
    <Sheet open={Boolean(popover)} onClose={() => popover?.onClose()} title="Highlight" modal={false} id={TRAY_ID}>
      {shown && <TrayBody key={shown.annotation.id} popover={shown} />}
    </Sheet>
  );
}

export interface NoteSheetContent {
  /** A new one for each note opened, so the text area starts afresh. */
  key: string;
  title: string;
  quote: string;
  initial: string;
}

/**
 * A note's editor on a phone: a sheet with the quoted words, the text area and Save in the title
 * row, where the keyboard can't cover it. ✕, Esc and the scrim cancel.
 */
export function NoteSheet({
  note,
  onSave,
  onCancel,
}: {
  note: NoteSheetContent | null;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const last = useRef(note);
  if (note) last.current = note;
  const shown = note ?? last.current;
  const area = useRef<HTMLTextAreaElement>(null);
  const save = () => onSave(area.current?.value.trim() ?? "");
  return (
    <Sheet
      open={Boolean(note)}
      onClose={onCancel}
      title={shown?.title ?? "Note"}
      action={
        <Button size="sm" variant="primary" className="px-3" onClick={save}>
          Save
        </Button>
      }
    >
      {shown && (
        <div key={shown.key} className="flex flex-col gap-3 px-5 pt-1 pb-4">
          <blockquote className={quoteClasses}>{shown.quote}</blockquote>
          {/* 16px: a smaller field makes iOS zoom the page when it takes focus. */}
          <textarea
            ref={area}
            defaultValue={shown.initial}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
            }}
            rows={4}
            aria-label="Note"
            placeholder="Write a note in your own words…"
            className="w-full resize-none rounded-sm bg-surface p-2.5 font-serif text-[16px] leading-6 shadow-[inset_0_0_0_1px_var(--detail)] placeholder:text-fg-3 focus-visible:shadow-[inset_0_0_0_1px_var(--accent),var(--focus-ring)]"
          />
        </div>
      )}
    </Sheet>
  );
}

/**
 * Where highlights and notes are edited. On a phone: a tray for a highlight, a sheet for a note. On
 * larger screens: the floating cards beside the words. `chapter` is the scroll layout's chapter, or
 * null in the Pages layout, where nothing scrolls.
 */
export function AnnotationEditors({
  notes,
  bodyRef,
  sectionId,
  chapter,
}: {
  notes: Notes;
  bodyRef: RefObject<HTMLElement | null>;
  sectionId: string | undefined;
  chapter: ChapterScroll | null;
}) {
  const phone = useIsPhone();
  const { popover, draft, editing } = notes;

  if (!phone) {
    return (
      <>
        {draft && (
          <FloatingPanel x={draft.x} y={draft.y} onClose={notes.cancelNote} label="New note">
            <blockquote className={cx("mb-2", quoteClasses)}>{draft.selection.text}</blockquote>
            <NoteEditor initial="" onSave={notes.saveNote} onCancel={notes.cancelNote} />
          </FloatingPanel>
        )}
        {popover && (
          <AnnotationPopover
            annotation={popover.annotation}
            x={popover.x}
            y={popover.y}
            onClose={popover.onClose}
            onColor={popover.onColor}
            onNote={popover.onNote}
            onDelete={popover.onDelete}
            onAcceptAnchor={popover.onAcceptAnchor}
            onTags={popover.onTags}
          />
        )}
      </>
    );
  }

  const note: NoteSheetContent | null = editing
    ? { key: `edit:${editing.id}`, title: "Note", quote: editing.quote, initial: editing.body }
    : draft
      ? {
          key: `new:${draft.selection.start}:${draft.selection.end}`,
          title: "New note",
          quote: draft.selection.text,
          initial: "",
        }
      : null;

  return (
    <>
      <HighlightTray
        popover={popover}
        onShown={(annotation, trayTop) => {
          const root = bodyRef.current;
          const box = chapter?.box();
          const words = root && sectionId ? wordsBox(root, sectionId, annotation) : null;
          // The tap that opened the tray has ended by now; glideBy does nothing under a finger.
          if (chapter && box && words) chapter.glideBy(liftForTray(words, trayTop, box.top), TRAY_LIFT_MS);
        }}
      />
      <NoteSheet
        note={note}
        onSave={editing ? notes.saveEdit : notes.saveNote}
        onCancel={editing ? notes.cancelEdit : notes.cancelNote}
      />
    </>
  );
}
