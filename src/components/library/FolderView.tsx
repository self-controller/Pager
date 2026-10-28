import type { MouseEvent, ReactNode } from "react";
import { FolderOpen } from "lucide-react";
import type { TreeFile, TreeFolder } from "@/api/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { cx } from "@/lib/cx";
import type { LibrarySort, LibraryView } from "@/state/settings";
import { FileItem, FolderItem, ItemSkeleton, type ItemCommand, type Point } from "./items";
import { sortFiles } from "./tree";

/** What a menu or dialog acts on. */
export type Target = { kind: "folder"; path: string; name: string; folder: TreeFolder } | { kind: "file"; path: string; name: string; file: TreeFile };

interface Props {
  folder: TreeFolder;
  view: LibraryView;
  sort: LibrarySort;
  onCommand: (command: ItemCommand, target: Target, at?: Point) => void;
  onBackgroundMenu: (at: Point) => void;
  /** Buttons shown when the folder is empty (for touch and keyboard users). */
  emptyActions: ReactNode;
  /** From a phone: files are added on the computer, so the empty folder says so. */
  readOnly?: boolean;
}

const listClass = (view: LibraryView) =>
  view === "compact" ? "flex flex-col" : "grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1 max-md:grid-cols-[repeat(auto-fill,minmax(130px,1fr))]";

/** One folder's contents: folders first, then books in the chosen order. */
export function FolderView({ folder, view, sort, onCommand, onBackgroundMenu, emptyActions, readOnly }: Props) {
  const files = sortFiles(folder.files, sort);
  const empty = folder.folders.length === 0 && files.length === 0;
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    onBackgroundMenu({ x: e.clientX, y: e.clientY });
  };
  return (
    <div className="min-h-[50vh] px-1 pb-10" onContextMenu={onContextMenu}>
      {empty ? (
        <EmptyState icon={FolderOpen} title="Nothing here yet" action={emptyActions}>
          {readOnly ? "Add books to this folder on your computer." : "Right-click anywhere to add a book, start a new file or make a folder."}
        </EmptyState>
      ) : (
        <div role="list" aria-label="Folder contents" className={cx(listClass(view))}>
          {folder.folders.map((f) => (
            <FolderItem key={f.path} folder={f} view={view} onCommand={(c, at) => onCommand(c, { kind: "folder", path: f.path, name: f.name, folder: f }, at)} />
          ))}
          {files.map((f) => (
            <FileItem key={f.path} file={f} view={view} onCommand={(c, at) => onCommand(c, { kind: "file", path: f.path, name: f.name, file: f }, at)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FolderSkeleton({ view }: { view: LibraryView }) {
  return (
    <div role="status" aria-label="Loading" className={cx("px-1", listClass(view))}>
      {Array.from({ length: view === "compact" ? 6 : 8 }, (_, i) => (
        <ItemSkeleton key={i} view={view} />
      ))}
    </div>
  );
}
