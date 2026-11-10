import { useCallback, useMemo, useState, type RefObject } from "react";
import {
  newAnnotationId,
  useAnnotations,
  useCreateAnnotation,
  useDeleteAnnotation,
  useRestoreAnnotation,
  useUpdateAnnotation,
} from "@/api/hooks";
import { ApiError, type Annotation, type HighlightColor, type Section } from "@/api/types";
import { useToast } from "@/components/ui/Toast";
import { haptic } from "@/lib/native";
import { updateSettings, useSettings } from "@/state/settings";
import { textOffsetWithin } from "@/tools/useSelection";
import type { TextSelection } from "@/tools/types";
import { caretAt } from "./dom";
import { annotationsAt, useHighlightPainting, type PaintSurface } from "./useHighlightPainting";

export interface ActiveAnnotation {
  annotation: Annotation;
  x: number;
  y: number;
}

export interface NoteDraft {
  selection: TextSelection;
  x: number;
  y: number;
}

/** A highlight whose note is open in the phone's note sheet. */
export interface NoteEdit {
  id: string;
  docId: string;
  quote: string;
  body: string;
}

function message(err: unknown): string {
  return err instanceof ApiError ? err.message : "That didn't save. Try again in a moment.";
}

/**
 * Highlights and notes in the reader: paints them, creates them from a selection, and opens the
 * popover when painted text is clicked. All coordinates are the server's (API.md): sectionRange
 * offsets into the section's textContent, sent with the section's revisionId. `peeks` are the
 * neighbouring sections rendered beside it (scroll layout), painted but not interactive.
 */
export function useReaderAnnotations(
  docId: string | undefined,
  section: Section | undefined,
  bodyRef: RefObject<HTMLElement | null>,
  { peeks = [], surfaceKey = "" }: { peeks?: readonly [PaintSurface?, PaintSurface?]; surfaceKey?: string } = {},
) {
  const { toast } = useToast();
  const { highlightColor } = useSettings();
  const { data: annotations } = useAnnotations(docId);
  const create = useCreateAnnotation(docId);
  const update = useUpdateAnnotation();
  const remove = useDeleteAnnotation();
  const restore = useRestoreAnnotation();
  const [activeId, setActiveId] = useState<{ id: string; x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [editing, setEditing] = useState<NoteEdit | null>(null);

  useHighlightPainting(
    { ref: bodyRef, sectionId: section?.id, html: section?.html },
    peeks,
    annotations,
    activeId?.id ?? null,
    surfaceKey,
  );

  const active: ActiveAnnotation | null = useMemo(() => {
    const annotation = activeId && annotations?.find((a) => a.id === activeId.id);
    return annotation ? { annotation, x: activeId.x, y: activeId.y } : null;
  }, [activeId, annotations]);

  const count = annotations?.filter((a) => a.kind !== "bookmark").length ?? 0;

  const createFrom = useCallback(
    (sel: TextSelection, body?: string, color: HighlightColor = highlightColor) => {
      if (!docId || !section) return;
      create.mutate(
        {
          id: newAnnotationId(),
          revisionId: section.revisionId,
          sectionRange: { sectionId: sel.sectionId, start: sel.start, end: sel.end },
          selectedText: sel.text,
          color,
          kind: body ? "note" : "highlight",
          ...(body ? { body } : {}),
        },
        { onError: (err) => toast({ message: message(err) }) },
      );
      // On the tap, as the highlight paints at once: a soft "placed", or success for a saved note.
      haptic(body ? "success" : "soft");
      window.getSelection()?.removeAllRanges();
    },
    [docId, section, create, highlightColor, toast],
  );

  /** Opens the popover if painted text is under the click (and says so); otherwise closes it. */
  const onTextClick = useCallback(
    (x: number, y: number): boolean => {
      const root = bodyRef.current;
      if (!root || !section) return false;
      const caret = caretAt(document, x, y);
      if (!caret || !root.contains(caret.node)) {
        setActiveId(null);
        return false;
      }
      const hits = annotationsAt(annotations, section.id, textOffsetWithin(root, caret.node, caret.offset));
      const hit = hits[hits.length - 1];
      setActiveId(hit ? { id: hit.id, x, y } : null);
      return Boolean(hit);
    },
    [bodyRef, section, annotations],
  );

  const saveBody = (target: { id: string; docId: string }, body: string | null) => {
    update.mutate({ id: target.id, docId: target.docId, patch: { body, kind: body ? "note" : "highlight" } });
    if (body) haptic("success");
  };

  const popover = active && {
    ...active,
    onClose: () => setActiveId(null),
    /** On a phone the note opens in its own sheet, and the tray gives way to it. */
    onEditNote: () => {
      const { id, docId: owner, body, anchor } = active.annotation;
      setEditing({ id, docId: owner, quote: anchor.quote, body: body ?? "" });
      setActiveId(null);
    },
    onColor: (color: HighlightColor) => {
      updateSettings({ highlightColor: color });
      update.mutate({ id: active.annotation.id, docId: active.annotation.docId, patch: { color, style: "highlight" } });
    },
    onNote: (body: string | null) => saveBody(active.annotation, body),
    onAcceptAnchor: () =>
      update.mutate({ id: active.annotation.id, docId: active.annotation.docId, patch: { acceptAnchor: true } }),
    onTags: (tags: string[]) => update.mutate({ id: active.annotation.id, docId: active.annotation.docId, patch: { tags } }),
    onDelete: () => {
      const { id, docId: owner, body } = active.annotation;
      setActiveId(null);
      remove.mutate(
        { id, docId: owner },
        {
          onSuccess: () =>
            toast({
              message: body ? "Note removed" : "Highlight removed",
              action: { label: "Undo", onClick: () => restore.mutate({ id, docId: owner }) },
            }),
          onError: (err) => toast({ message: message(err) }),
        },
      );
    },
  };

  /** Moves a highlight (usually one the file edit orphaned) onto the selected words. */
  const reattachTo = useCallback(
    (target: { id: string; docId: string }, sel: TextSelection, done: () => void) => {
      if (!section) return;
      update.mutate(
        {
          id: target.id,
          docId: target.docId,
          patch: {
            reattach: {
              revisionId: section.revisionId,
              sectionRange: { sectionId: sel.sectionId, start: sel.start, end: sel.end },
              selectedText: sel.text,
            },
          },
        },
        {
          onSuccess: () => {
            toast({ message: "Reattached" });
            done();
          },
          onError: (err) => toast({ message: message(err) }),
        },
      );
      window.getSelection()?.removeAllRanges();
    },
    [section, update, toast],
  );

  return {
    annotations,
    count,
    reattachTo,
    highlightColor,
    popover,
    draft,
    editing,
    onTextClick,
    /** In `color` when one is named (the iPhone app's colour menu); it becomes the last-used colour. */
    highlight: (sel: TextSelection, color?: HighlightColor) => {
      if (color) updateSettings({ highlightColor: color });
      createFrom(sel, undefined, color);
    },
    startNote: (sel: TextSelection) =>
      setDraft({
        selection: sel,
        x: (sel.rect?.left ?? 0) + (sel.rect?.width ?? 0) / 2,
        y: (sel.rect?.top ?? 0) + (sel.rect?.height ?? 0),
      }),
    saveNote: (body: string) => {
      if (draft) createFrom(draft.selection, body || undefined);
      setDraft(null);
    },
    cancelNote: () => setDraft(null),
    saveEdit: (body: string) => {
      if (editing) saveBody(editing, body || null);
      setEditing(null);
    },
    cancelEdit: () => setEditing(null),
  };
}
