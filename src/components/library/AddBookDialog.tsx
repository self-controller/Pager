import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { CircleAlert, CircleCheck, FileText, Info, LoaderCircle, Upload } from "lucide-react";
import { api } from "@/api";
import { useImportPath, useJob, useUploadFile } from "@/api/hooks";
import { ApiError, ErrorCodes, type IngestJob } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { cx } from "@/lib/cx";

const ACCEPT = ".epub,.txt,.md,.markdown,.html,.htm,.docx";

interface Item {
  key: string;
  label: string;
  job?: IngestJob;
  error?: string;
}

function errorMessage(err: unknown): { text: string; calm: boolean } {
  if (err instanceof ApiError) return { text: err.message, calm: err.code === ErrorCodes.unsupported };
  return { text: "Something went wrong. Try again in a moment.", calm: false };
}

function JobRow({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const { data: job } = useJob(item.job?.id, item.job);
  const status = item.error ? "error" : (job?.status ?? "queued");
  const docId = job?.documentIds[0];
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-fg-2">
        <FileText size={16} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] leading-5 font-medium">{item.label}</div>
        <div className={cx("text-[13px] leading-[18px]", status === "error" ? "text-error" : "text-fg-2")}>
          {status === "error"
            ? (item.error ?? job?.error ?? "Couldn't read this file.")
            : status === "done"
              ? job && job.documentIds.length > 1
                ? `Added ${job.documentIds.length} books`
                : "Added"
              : "Copying…"}
        </div>
      </div>
      {status === "done" && docId && job?.documentIds.length === 1 && (
        <Link to={`/read/${encodeURIComponent(docId)}`} onClick={onOpen} className="text-[14px] font-semibold text-accent hover:underline">
          Open
        </Link>
      )}
      {status === "done" && <CircleCheck size={18} className="shrink-0 text-fg-2" aria-hidden />}
      {status === "error" && <CircleAlert size={18} className="shrink-0 text-error" aria-hidden />}
      {(status === "queued" || status === "processing") && (
        <LoaderCircle size={18} className="shrink-0 animate-spin text-fg-2 motion-reduce:animate-none" aria-label="Working" />
      )}
    </li>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** The folder files land in ("" is the library root). */
  dir: string;
  pendingFiles: File[];
  onPendingTaken: () => void;
}

/** Add books to a folder: copy from a path on this machine, or drop or choose files. */
export function AddBookDialog({ open, onClose, dir, pendingFiles, onPendingTaken }: Props) {
  const pathId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [pathNote, setPathNote] = useState<{ text: string; calm: boolean } | null>(null);
  const [over, setOver] = useState(false);
  const importPath = useImportPath(dir);
  const upload = useUploadFile(dir);
  const where = dir ? dir.split("/").pop()! : "Library";

  const update = (key: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const uploadFiles = (files: File[]) => {
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      setItems((list) => [{ key, label: file.name }, ...list]);
      upload.mutateAsync(file).then(
        (job) => update(key, { job }),
        (err: unknown) => update(key, { error: errorMessage(err).text }),
      );
    }
  };

  useEffect(() => {
    if (open && pendingFiles.length) {
      uploadFiles(pendingFiles);
      onPendingTaken();
    }
  }, [open, pendingFiles]);

  useEffect(() => {
    if (!open) {
      setPathNote(null);
      setOver(false);
      setItems([]);
    }
  }, [open]);

  const submitPath = (e: FormEvent) => {
    e.preventDefault();
    const value = path.trim();
    if (!value) return;
    setPathNote(null);
    importPath.mutate(value, {
      onSuccess: (job) => {
        setItems((list) => [{ key: `path-${job.id}`, label: value.split("/").pop() || value, job }, ...list]);
        setPath("");
      },
      onError: (err) => setPathNote(errorMessage(err)),
    });
  };

  return (
    <Dialog open={open} onClose={onClose} title={`Add to ${where}`}>
      <div className="flex flex-col gap-5 p-5">
        <form onSubmit={submitPath} className="flex flex-col gap-2">
          <label htmlFor={pathId} className="text-[15px] leading-5 font-semibold">
            Copy from a path
          </label>
          <div className="flex gap-2">
            <input
              id={pathId}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="~/Downloads/persuasion.epub  or  ~/Books"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              className="h-10 min-w-0 flex-1 rounded-sm bg-surface px-3 font-mono text-[14px] shadow-[inset_0_0_0_1px_var(--detail)] placeholder:text-fg-3 focus-visible:shadow-[inset_0_0_0_1px_var(--accent),var(--focus-ring)]"
            />
            <Button type="submit" variant="primary" disabled={!path.trim() || importPath.isPending}>
              {importPath.isPending ? "Copying…" : "Copy"}
            </Button>
          </div>
          <p className="text-[13px] leading-[18px] text-fg-2">
            The file, or a folder's books, is copied into {dir ? `“${where}”` : "your library"}. The original stays where it is.
          </p>
          {pathNote && (
            <p
              role="status"
              className={cx("flex gap-2 rounded-sm px-3 py-2 text-[13px] leading-[18px]", pathNote.calm ? "bg-surface-2 text-fg" : "bg-surface-2 text-error")}
            >
              {pathNote.calm ? <Info size={16} className="mt-px shrink-0" aria-hidden /> : <CircleAlert size={16} className="mt-px shrink-0" aria-hidden />}
              <span>{pathNote.text}</span>
            </p>
          )}
        </form>

        <div className="flex items-center gap-3 text-[13px] text-fg-3" aria-hidden>
          <span className="h-px flex-1 bg-detail" />
          or
          <span className="h-px flex-1 bg-detail" />
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(false);
            uploadFiles(Array.from(e.dataTransfer.files));
          }}
          className={cx(
            "flex flex-col items-center gap-3 rounded-md border border-dashed px-4 py-7 text-center transition-hover",
            over ? "border-accent bg-accent-bg/40" : "border-[var(--bg-quaternary)]",
          )}
        >
          <Upload size={22} className="text-fg-2" aria-hidden />
          <div>
            <div className="text-[15px] leading-5 font-semibold">Drop files here</div>
            <div className="mt-0.5 text-[13px] leading-[18px] text-fg-2">
              {api.mode === "mock" ? "Preview mode reads .txt, .md and .html in the browser. EPUB and Word need the backend." : "EPUB, Markdown, HTML, plain text or Word"}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            Choose files
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              uploadFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>

        {items.length > 0 && (
          <ul aria-label="Added" className="-my-2 divide-y divide-detail">
            {items.map((item) => (
              <JobRow key={item.key} item={item} onOpen={onClose} />
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
