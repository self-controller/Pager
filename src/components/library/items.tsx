import type { KeyboardEvent, MouseEvent } from "react";
import { Link } from "react-router";
import { Ellipsis, FileText, Folder } from "lucide-react";
import type { TreeFile, TreeFolder } from "@/api/types";
import { IconButton } from "@/components/ui/Button";
import { longPressProps } from "@/components/ui/ContextMenu";
import { Cover } from "@/components/ui/Tiles";
import { cx } from "@/lib/cx";
import { formatShortDate } from "@/lib/format";
import { readHref } from "@/lib/links";
import type { LibraryView } from "@/state/settings";
import { ProgressBar } from "./ProgressBar";
import { describeFolder, progressOf, stemOf } from "./tree";

export type ItemCommand = "open" | "menu" | "rename" | "delete";
export type Point = { x: number; y: number };

interface ItemProps {
  view: LibraryView;
  onCommand: (command: ItemCommand, at?: Point) => void;
}

const moreButton =
  "relative z-[1] shrink-0 opacity-0 transition-hover group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100";

/** Right-click, long press, "⋯", and the keys a file manager answers to. */
function useItemHandlers(onCommand: ItemProps["onCommand"]) {
  const menuAt = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onCommand("menu", { x: e.clientX, y: e.clientY });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("stretched-link")) return;
    if (e.key === "F2") onCommand("rename");
    else if (e.key === "Delete") onCommand("delete");
    else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      const r = e.currentTarget.getBoundingClientRect();
      onCommand("menu", { x: r.left + 24, y: r.top + 24 });
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const more = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    onCommand("menu", { x: r.left, y: r.bottom + 4 });
  };
  return { onContextMenu: menuAt, onKeyDown, more, ...longPressProps((at) => onCommand("menu", at)) };
}

export function FolderItem({ folder, view, onCommand }: ItemProps & { folder: TreeFolder }) {
  const { more, ...handlers } = useItemHandlers(onCommand);
  const count = describeFolder(folder);
  if (view === "compact") {
    return (
      <div role="listitem" className="group relative flex h-10 items-center gap-3 rounded-sm px-2 transition-hover hover:bg-surface-hover" {...handlers}>
        <span className="flex w-5 shrink-0 justify-center text-fg-2">
          <Folder size={20} strokeWidth={1.75} fill="currentColor" className="opacity-80" aria-hidden />
        </span>
        <button type="button" onClick={() => onCommand("open")} className="stretched-link min-w-0 flex-1 truncate text-left text-[14px] leading-5 font-semibold text-fg">
          {folder.name}
        </button>
        <span className="hidden w-[160px] truncate text-[13px] text-fg-2 md:block">{count}</span>
        <span className="w-[132px] shrink-0" aria-hidden />
        <span className="hidden w-16 shrink-0 lg:block" aria-hidden />
        <IconButton icon={Ellipsis} label={`More for ${folder.name}`} size="sm" variant="quaternary" className={moreButton} onClick={more} />
      </div>
    );
  }
  return (
    <div role="listitem" className="group relative flex flex-col gap-2 rounded-md p-3 transition-hover hover:bg-surface-hover" {...handlers}>
      <div className="flex aspect-[5/7] w-full items-center justify-center rounded-xs bg-surface-2 text-fg-2 outline outline-1 -outline-offset-1 outline-detail">
        <Folder size={40} strokeWidth={1.25} fill="currentColor" className="opacity-70" aria-hidden />
      </div>
      <button type="button" onClick={() => onCommand("open")} className="stretched-link line-clamp-2 text-left font-serif text-[15px] leading-5 font-semibold text-fg">
        {folder.name}
      </button>
      <span className="truncate text-[12px] leading-4 text-fg-2">{count}</span>
      <IconButton icon={Ellipsis} label={`More for ${folder.name}`} size="sm" variant="quaternary" className={cx(moreButton, "absolute top-2 right-2 bg-elevated/80")} onClick={more} />
    </div>
  );
}

export function FileItem({ file, view, onCommand }: ItemProps & { file: TreeFile }) {
  const { more, ...handlers } = useItemHandlers(onCommand);
  const doc = file.doc;
  const title = doc?.title ?? stemOf(file.name).stem;
  const { percent, label } = progressOf(doc);
  const pending = !doc;
  const status = file.error ? "Couldn't read" : pending ? "Indexing…" : label;
  const href = doc ? readHref(doc) : undefined;
  const thumb = doc ? (
    <Cover title={doc.title} author={doc.author} id={doc.id} coverUrl={doc.coverUrl} className={view === "compact" ? "h-7 w-5 shrink-0" : "w-full"} />
  ) : (
    <span
      className={cx(
        "flex shrink-0 items-center justify-center rounded-xs bg-surface-2 text-fg-3 outline outline-1 -outline-offset-1 outline-detail",
        view === "compact" ? "h-7 w-5" : "aspect-[5/7] w-full",
      )}
    >
      <FileText size={view === "compact" ? 12 : 32} strokeWidth={1.5} aria-hidden />
    </span>
  );
  const name = href ? (
    <Link to={href} className={cx("stretched-link text-fg", view === "compact" ? "min-w-0 flex-1 truncate text-[14px] leading-5 font-medium" : "line-clamp-2 font-serif text-[15px] leading-5 font-semibold")}>
      {title}
    </Link>
  ) : (
    <span className={cx("text-fg-2", view === "compact" ? "min-w-0 flex-1 truncate text-[14px] leading-5" : "line-clamp-2 font-serif text-[15px] leading-5")} title={file.error}>
      {title}
    </span>
  );

  if (view === "compact") {
    return (
      <div role="listitem" className="group relative flex h-10 items-center gap-3 rounded-sm px-2 transition-hover hover:bg-surface-hover" {...handlers}>
        {thumb}
        {name}
        <span className="hidden w-[160px] truncate text-[13px] text-fg-2 md:block">{doc?.author ?? ""}</span>
        <div className="flex w-[132px] shrink-0 items-center gap-2">
          <ProgressBar percent={percent} className="flex-1" />
          <span className={cx("w-14 shrink-0 text-right font-byline text-[11px] leading-4 tabular-nums", status === "Couldn't read" ? "text-error" : "text-fg-2")}>{status}</span>
        </div>
        <span className="hidden w-16 shrink-0 text-right font-byline text-[12px] leading-4 text-fg-3 lg:block">
          {doc ? formatShortDate(doc.lastOpenedAt ?? doc.addedAt) : ""}
        </span>
        <IconButton icon={Ellipsis} label={`More for ${title}`} size="sm" variant="quaternary" className={moreButton} onClick={more} />
      </div>
    );
  }
  return (
    <div role="listitem" className="group relative flex flex-col gap-1.5 rounded-md p-3 transition-hover hover:bg-surface-hover" {...handlers}>
      {thumb}
      <div className="mt-1 flex min-h-10 flex-col gap-0.5">
        {name}
        <span className="truncate text-[12px] leading-4 text-fg-2">{doc?.author ?? (doc?.format ? doc.format.toUpperCase() : file.format.toUpperCase())}</span>
      </div>
      <ProgressBar percent={percent} label={status} />
      <IconButton icon={Ellipsis} label={`More for ${title}`} size="sm" variant="quaternary" className={cx(moreButton, "absolute top-2 right-2 bg-elevated/80")} onClick={more} />
    </div>
  );
}

export function ItemSkeleton({ view }: { view: LibraryView }) {
  if (view === "compact") {
    return (
      <div className="flex h-10 items-center gap-3 px-2" aria-hidden>
        <div className="skeleton h-7 w-5" />
        <div className="skeleton h-4 flex-1 max-w-[320px]" />
        <div className="skeleton hidden h-3 w-[120px] md:block" />
        <div className="skeleton h-[3px] w-[132px]" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 p-3" aria-hidden>
      <div className="skeleton aspect-[5/7] w-full" />
      <div className="skeleton h-4 w-4/5" />
      <div className="skeleton h-3 w-1/2" />
    </div>
  );
}
