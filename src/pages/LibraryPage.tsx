import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { FilePlus2, FolderPlus, FolderX, LayoutGrid, PencilLine, Plus, Rows3, Trash2, ArrowRightToLine, BookOpen, FolderOpen } from "lucide-react";
import { useCanChangeFiles, useSearchDocuments, useTree } from "@/api/hooks";
import { AddBookDialog } from "@/components/library/AddBookDialog";
import { Breadcrumbs } from "@/components/library/Breadcrumbs";
import { DeleteDialog, MoveDialog, NewFileDialog, NewFolderDialog, RenameDialog } from "@/components/library/dialogs";
import { FolderSkeleton, FolderView, type Target } from "@/components/library/FolderView";
import type { ItemCommand, Point } from "@/components/library/items";
import { LibraryToolbar } from "@/components/library/LibraryToolbar";
import { SearchResults } from "@/components/library/SearchResults";
import { cleanRel, describeFolder, folderAt, parentOf } from "@/components/library/tree";
import { useFileDrop } from "@/components/library/useFileDrop";
import { PageHeader, WideColumn } from "@/components/shell/Page";
import { Button } from "@/components/ui/Button";
import { ContextMenu, type MenuEntry, type MenuState } from "@/components/ui/ContextMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { ServiceError } from "@/components/ui/ServiceError";
import { readHref } from "@/lib/links";
import { updateSettings, useSettings } from "@/state/settings";

type DialogState =
  | { kind: "add"; files: File[] }
  | { kind: "newFile" }
  | { kind: "newFolder" }
  | { kind: "rename"; target: Target }
  | { kind: "move"; target: Target }
  | { kind: "delete"; target: Target };

function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true'], dialog[open]"));
}

/** The library: your reads folder, browsed folder by folder, with search across every file. */
export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const path = cleanRel(params.get("path") ?? "");
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);
  const searchRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  // From a phone the library is read-only: files are added, renamed, moved and deleted on the computer.
  const canChange = useCanChangeFiles();

  const tree = useTree();
  const searching = q.trim().length > 0;
  const search = useSearchDocuments(q);
  const folder = tree.data ? folderAt(tree.data.root, path) : undefined;

  // Typing goes into ?q= after a pause; the folder stays in the URL for when the search is cleared.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const value = draft.trim();
      if (value === q.trim()) return;
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set("q", value);
          else next.delete("q");
          return next;
        },
        { replace: true },
      );
    }, 250);
    return () => window.clearTimeout(t);
  }, [draft, q, setParams]);

  const goTo = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next) p.set("path", next);
          else p.delete("path");
          p.delete("q");
          return p;
        },
        { replace: false },
      );
      setDraft("");
    },
    [setParams],
  );

  // Dropping files anywhere on the page adds them to the folder being looked at.
  const onDropFiles = useCallback((files: File[]) => canChange && setDialog({ kind: "add", files }), [canChange]);
  const dragging = useFileDrop(onDropFiles) && canChange;

  // Keys a file manager answers to: "/" searches, Backspace goes up a folder.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || menu || dialog) return;
      if (e.key === "/" && !isTyping(e.target)) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Backspace" && !isTyping(e.target) && path && !searching) {
        e.preventDefault();
        goTo(parentOf(path));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, dialog, path, searching, goTo]);

  useEffect(() => {
    document.title = path ? `${path.split("/").pop()} · Pager` : "Pager";
    return () => {
      document.title = "Pager";
    };
  }, [path]);

  const closeMenu = useCallback(() => setMenu(null), []);

  const backgroundItems = useMemo<MenuEntry[]>(
    () => [
      ...(canChange
        ? ([
            { id: "add", label: "Add a book…", icon: Plus, onSelect: () => setDialog({ kind: "add", files: [] }) },
            { id: "newFile", label: "New file…", icon: FilePlus2, onSelect: () => setDialog({ kind: "newFile" }) },
            { id: "newFolder", label: "New folder…", icon: FolderPlus, onSelect: () => setDialog({ kind: "newFolder" }) },
            "separator",
          ] satisfies MenuEntry[])
        : []),
      { id: "compact", label: "Compact view", icon: Rows3, checked: settings.libraryView === "compact", onSelect: () => updateSettings({ libraryView: "compact" }) },
      { id: "detailed", label: "Detailed view", icon: LayoutGrid, checked: settings.libraryView === "detailed", onSelect: () => updateSettings({ libraryView: "detailed" }) },
    ],
    [settings.libraryView, canChange],
  );

  const openTarget = useCallback(
    (target: Target) => {
      if (target.kind === "folder") goTo(target.path);
      else if (target.file.doc) navigate(readHref(target.file.doc));
    },
    [goTo, navigate],
  );

  const itemsFor = useCallback(
    (target: Target): MenuEntry[] => [
      { id: "open", label: "Open", icon: target.kind === "folder" ? FolderOpen : BookOpen, onSelect: () => openTarget(target), disabled: target.kind === "file" && !target.file.doc },
      ...(canChange
        ? ([
            { id: "rename", label: "Rename…", icon: PencilLine, hint: "F2", onSelect: () => setDialog({ kind: "rename", target }) },
            { id: "move", label: "Move to…", icon: ArrowRightToLine, onSelect: () => setDialog({ kind: "move", target }) },
            "separator",
            { id: "delete", label: "Delete…", icon: Trash2, hint: "Del", danger: true, onSelect: () => setDialog({ kind: "delete", target }) },
          ] satisfies MenuEntry[])
        : []),
    ],
    [openTarget, canChange],
  );

  const onCommand = useCallback(
    (command: ItemCommand, target: Target, at?: Point) => {
      if (command === "open") openTarget(target);
      else if (command === "rename") canChange && setDialog({ kind: "rename", target });
      else if (command === "delete") canChange && setDialog({ kind: "delete", target });
      else if (at) setMenu({ label: target.name, at, items: itemsFor(target) });
    },
    [openTarget, itemsFor, canChange],
  );

  const emptyActions = canChange && (
    <div className="flex flex-wrap justify-center gap-2">
      <Button variant="primary" icon={Plus} onClick={() => setDialog({ kind: "add", files: [] })}>
        Add a book
      </Button>
      <Button variant="secondary" icon={FilePlus2} onClick={() => setDialog({ kind: "newFile" })}>
        New file
      </Button>
      <Button variant="secondary" icon={FolderPlus} onClick={() => setDialog({ kind: "newFolder" })}>
        New folder
      </Button>
    </div>
  );

  const dialogTarget = dialog && "target" in dialog ? dialog.target : null;

  return (
    <WideColumn className="pb-10">
      <PageHeader title="Library" hideTitleOnDesktop />
      <LibraryToolbar
        q={draft}
        onQ={setDraft}
        view={settings.libraryView}
        onView={(view) => updateSettings({ libraryView: view })}
        sort={settings.librarySort}
        onSort={(sort) => updateSettings({ librarySort: sort })}
        searchRef={searchRef}
      />

      {searching ? (
        <SearchResults q={q} results={search.data} isPending={search.isPending} error={search.error} onRetry={() => void search.refetch()} />
      ) : tree.error ? (
        <ServiceError error={tree.error} onRetry={() => void tree.refetch()} />
      ) : tree.isPending ? (
        <>
          <Breadcrumbs path={path} onNavigate={goTo} />
          <FolderSkeleton view={settings.libraryView} />
        </>
      ) : !folder ? (
        <EmptyState
          icon={FolderX}
          title="This folder is gone"
          action={
            <Button variant="secondary" onClick={() => goTo("")}>
              Back to the library
            </Button>
          }
        >
          It may have been renamed or moved outside Pager.
        </EmptyState>
      ) : (
        <>
          <Breadcrumbs path={path} onNavigate={goTo} trailing={describeFolder(folder)} />
          <FolderView
            folder={folder}
            view={settings.libraryView}
            sort={settings.librarySort}
            onCommand={onCommand}
            onBackgroundMenu={(at) => setMenu({ label: "Library", at, items: backgroundItems })}
            emptyActions={emptyActions}
            readOnly={!canChange}
          />
        </>
      )}

      {menu && <ContextMenu {...menu} onClose={closeMenu} />}

      {canChange && (
        <>
          <AddBookDialog
            open={dialog?.kind === "add"}
            onClose={() => setDialog(null)}
            dir={path}
            pendingFiles={dialog?.kind === "add" ? dialog.files : []}
            onPendingTaken={() => setDialog((d) => (d?.kind === "add" ? { kind: "add", files: [] } : d))}
          />
          <NewFileDialog open={dialog?.kind === "newFile"} dir={path} onClose={() => setDialog(null)} />
          <NewFolderDialog open={dialog?.kind === "newFolder"} dir={path} onClose={() => setDialog(null)} />
          <RenameDialog open={dialog?.kind === "rename"} target={dialogTarget} onClose={() => setDialog(null)} />
          <MoveDialog open={dialog?.kind === "move"} target={dialogTarget} root={tree.data?.root} onClose={() => setDialog(null)} />
          <DeleteDialog open={dialog?.kind === "delete"} target={dialogTarget} onClose={() => setDialog(null)} />
        </>
      )}

      {dragging && dialog?.kind !== "add" && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-scrim">
          <div className="rounded-md bg-elevated px-6 py-4 text-[15px] font-semibold elevation">
            Drop to add to {path ? `“${path.split("/").pop()}”` : "your library"}
          </div>
        </div>
      )}
    </WideColumn>
  );
}
