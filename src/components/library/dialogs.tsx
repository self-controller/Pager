import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Folder, FolderOpen } from "lucide-react";
import { useCreateFile, useCreateFolder, useDeleteEntry, useMoveEntry } from "@/api/hooks";
import { ApiError, type TreeFolder } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/lib/cx";
import { readHref } from "@/lib/links";
import type { Target } from "./FolderView";
import { allFolders, baseOf, joinPath, parentOf, stemOf } from "./tree";

const inputClass =
  "h-10 w-full rounded-sm bg-surface px-3 text-[15px] shadow-[inset_0_0_0_1px_var(--detail)] placeholder:text-fg-3 focus-visible:shadow-[inset_0_0_0_1px_var(--accent),var(--focus-ring)]";

function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Try again in a moment.";
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[14px] leading-5 font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}

function Footer({ error, pending, submitLabel, onClose, danger }: { error: unknown; pending: boolean; submitLabel: string; onClose: () => void; danger?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="rounded-sm bg-surface-2 px-3 py-2 text-[13px] leading-[18px] text-error">
          {errorText(error)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="tertiary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending} className={cx(danger && "bg-error hover:bg-error")}>
          {pending ? "…" : submitLabel}
        </Button>
      </div>
    </div>
  );
}

/** A new Markdown file: title and author go into its front matter, then it opens. */
export function NewFileDialog({ open, dir, onClose }: { open: boolean; dir: string; onClose: () => void }) {
  const titleId = useId();
  const authorId = useId();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const create = useCreateFile();
  const navigate = useNavigate();
  useEffect(() => {
    if (open) {
      setTitle("");
      setAuthor("");
      create.reset();
    }
  }, [open]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate({ dir, title: title.trim(), ...(author.trim() ? { author: author.trim() } : {}) }, {
      onSuccess: ({ document }) => {
        onClose();
        navigate(readHref(document));
      },
    });
  };
  return (
    <Dialog open={open} onClose={onClose} title="New file">
      <form onSubmit={submit} className="flex flex-col gap-4 p-5">
        <Field id={titleId} label="Title">
          <input id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus autoComplete="off" placeholder="What is it called?" className={inputClass} />
        </Field>
        <Field id={authorId} label="Author (optional)">
          <input id={authorId} value={author} onChange={(e) => setAuthor(e.target.value)} autoComplete="off" placeholder="Who wrote it?" className={inputClass} />
        </Field>
        <p className="text-[13px] leading-[18px] text-fg-2">
          A Markdown file is made in {dir ? `“${baseOf(dir)}”` : "your library"} and opened. Write in it with any editor; the reader follows your edits.
        </p>
        <Footer error={create.error} pending={create.isPending} submitLabel="Create and open" onClose={onClose} />
      </form>
    </Dialog>
  );
}

export function NewFolderDialog({ open, dir, onClose }: { open: boolean; dir: string; onClose: () => void }) {
  const id = useId();
  const [name, setName] = useState("");
  const create = useCreateFolder();
  useEffect(() => {
    if (open) {
      setName("");
      create.reset();
    }
  }, [open]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate({ dir, name: name.trim() }, { onSuccess: onClose });
  };
  return (
    <Dialog open={open} onClose={onClose} title="New folder">
      <form onSubmit={submit} className="flex flex-col gap-4 p-5">
        <Field id={id} label="Name">
          <input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" placeholder="Novels" className={inputClass} />
        </Field>
        <Footer error={create.error} pending={create.isPending} submitLabel="Create" onClose={onClose} />
      </form>
    </Dialog>
  );
}

/** Rename a file (its extension is kept) or a folder. */
export function RenameDialog({ open, target, onClose }: { open: boolean; target: Target | null; onClose: () => void }) {
  const id = useId();
  const [name, setName] = useState("");
  const move = useMoveEntry();
  const ext = target?.kind === "file" ? stemOf(target.name).ext : "";
  useEffect(() => {
    if (open && target) {
      setName(target.kind === "file" ? stemOf(target.name).stem : target.name);
      move.reset();
    }
  }, [open, target]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!target || !name.trim()) return;
    const to = joinPath(parentOf(target.path), `${name.trim()}${ext}`);
    if (to === target.path) return onClose();
    move.mutate({ from: target.path, to }, { onSuccess: onClose });
  };
  return (
    <Dialog open={open} onClose={onClose} title={target?.kind === "folder" ? "Rename folder" : "Rename file"}>
      <form onSubmit={submit} className="flex flex-col gap-4 p-5">
        <Field id={id} label="Name">
          <div className="flex items-center gap-2">
            <input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" onFocus={(e) => e.target.select()} className={inputClass} />
            {ext && <span className="shrink-0 font-mono text-[13px] text-fg-2">{ext}</span>}
          </div>
        </Field>
        {target?.kind === "file" && target.file.doc && (
          <p className="text-[13px] leading-[18px] text-fg-2">Highlights and your place in the book stay with it.</p>
        )}
        <Footer error={move.error} pending={move.isPending} submitLabel="Rename" onClose={onClose} />
      </form>
    </Dialog>
  );
}

/** Pick a folder to move a file or folder into. */
export function MoveDialog({ open, target, root, onClose }: { open: boolean; target: Target | null; root: TreeFolder | undefined; onClose: () => void }) {
  const [dest, setDest] = useState<string | null>(null);
  const move = useMoveEntry();
  const { toast } = useToast();
  useEffect(() => {
    if (open) {
      setDest(null);
      move.reset();
    }
  }, [open]);
  const from = target ? parentOf(target.path) : "";
  const folders = root
    ? allFolders(root).filter((f) => !target || (f.path !== target.path && !f.path.startsWith(`${target.path}/`) && f.path !== from))
    : [];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!target || dest === null) return;
    move.mutate(
      { from: target.path, to: joinPath(dest, target.name) },
      {
        onSuccess: () => {
          onClose();
          toast({ message: `Moved to ${dest ? baseOf(dest) : "Library"}` });
        },
      },
    );
  };
  return (
    <Dialog open={open} onClose={onClose} title={`Move ${target?.kind === "folder" ? "folder" : "file"}`}>
      <form onSubmit={submit} className="flex flex-col gap-4 p-5">
        <p className="text-[14px] leading-5 text-fg-2">
          Where should <span className="font-semibold text-fg">{target?.kind === "file" && target.file.doc ? target.file.doc.title : target?.name}</span> go?
        </p>
        <div role="radiogroup" aria-label="Folder" className="max-h-[50vh] overflow-y-auto rounded-sm shadow-[inset_0_0_0_1px_var(--detail)]">
          {folders.length === 0 && <p className="px-3 py-4 text-[14px] text-fg-2">There is no other folder to move it to yet.</p>}
          {folders.map((f) => {
            const depth = f.path ? f.path.split("/").length : 0;
            const selected = dest === f.path;
            return (
              <button
                key={f.path || "/"}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setDest(f.path)}
                className={cx(
                  "flex h-10 w-full items-center gap-2 px-3 text-left text-[14px] transition-hover hover:bg-surface-hover",
                  selected && "bg-accent-bg/60 font-semibold",
                )}
                style={{ paddingLeft: 12 + depth * 18 }}
              >
                {selected ? <FolderOpen size={16} className="text-accent" aria-hidden /> : <Folder size={16} className="text-fg-2" aria-hidden />}
                <span className="truncate">{f.path ? f.name : "Library"}</span>
              </button>
            );
          })}
        </div>
        <Footer error={move.error} pending={move.isPending || dest === null} submitLabel="Move" onClose={onClose} />
      </form>
    </Dialog>
  );
}

/** Confirm a delete. Files go to the library's trash folder; nothing is lost for good. */
export function DeleteDialog({ open, target, onClose }: { open: boolean; target: Target | null; onClose: () => void }) {
  const remove = useDeleteEntry();
  const { toast } = useToast();
  useEffect(() => {
    if (open) remove.reset();
  }, [open]);
  const count = target?.kind === "folder" ? target.folder.fileCount : 1;
  const label = target?.kind === "file" && target.file.doc ? target.file.doc.title : target?.name;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!target) return;
    remove.mutate(target.path, {
      onSuccess: () => {
        onClose();
        toast({ message: `Moved “${label}” to the trash` });
      },
    });
  };
  return (
    <Dialog open={open} onClose={onClose} title={target?.kind === "folder" ? "Delete folder" : "Delete file"}>
      <form onSubmit={submit} className="flex flex-col gap-4 p-5">
        <p className="text-[15px] leading-[22px]">
          Delete <span className="font-semibold">{label}</span>
          {target?.kind === "folder" ? ` and the ${count === 1 ? "book" : `${count} books`} in it` : ""}?
        </p>
        <p className="text-[13px] leading-[18px] text-fg-2">
          The file moves to the <code className="font-mono">.trash</code> folder inside your library, so it can be put back. Highlights are kept and return with it.
        </p>
        <Footer error={remove.error} pending={remove.isPending} submitLabel="Delete" onClose={onClose} danger />
      </form>
    </Dialog>
  );
}
