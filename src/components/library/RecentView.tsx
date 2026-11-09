import type { MouseEvent } from "react";
import { History } from "lucide-react";
import type { TreeFile } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import type { LibraryView } from "@/state/settings";
import { listClass, type Target } from "./FolderView";
import { FileItem, type ItemCommand, type Point } from "./items";

interface Props {
  /** Opened books from the whole library, last read first (`recentFiles`). */
  files: TreeFile[];
  view: LibraryView;
  onCommand: (command: ItemCommand, target: Target, at?: Point) => void;
  onBackgroundMenu: (at: Point) => void;
  /** Switches the library to Folders, for when nothing has been read yet. */
  onBrowse: () => void;
}

/** The books read lately, wherever they sit in the folders, in a fixed order. */
export function RecentView({ files, view, onCommand, onBackgroundMenu, onBrowse }: Props) {
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    onBackgroundMenu({ x: e.clientX, y: e.clientY });
  };
  return (
    <div className="min-h-[50vh] px-1 pb-10" onContextMenu={onContextMenu}>
      {files.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nothing read yet"
          action={
            <Button variant="secondary" onClick={onBrowse}>
              Browse folders
            </Button>
          }
        >
          Books you open show up here, the last one first.
        </EmptyState>
      ) : (
        <div role="list" aria-label="Recently read" className={listClass(view)}>
          {files.map((f) => (
            <FileItem
              key={f.path}
              file={f}
              view={view}
              onCommand={(c, at) => onCommand(c, { kind: "file", path: f.path, name: f.name, file: f }, at)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
