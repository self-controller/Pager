import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "@/lib/cx";
import { IconButton } from "./Button";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** "center" for modals, "left"/"right" for side sheets (table of contents, tools on mobile), "full" for the whole window. */
  placement?: "center" | "left" | "right" | "full";
  className?: string;
  /** Hide the visible header (title is still announced). */
  bare?: boolean;
}

/**
 * Native <dialog> with showModal(): focus trapping, Esc to close and inert background for free.
 */
export function Dialog({ open, onClose, title, children, placement = "center", className, bare }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // React's autoFocus runs before the dialog is shown, so it lands nowhere; focus the first field now.
      el.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select, [data-autofocus]")?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      // React passes a nested dialog's close and cancel up to this one's handlers (a full-screen view
      // inside the tool sheet would close the sheet too): answer only this dialog's own.
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself, outside its content box) closes it.
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        "fixed m-0 max-w-none bg-elevated p-0 text-fg backdrop:bg-scrim elevation",
        placement === "center" &&
          "top-1/2 right-auto bottom-auto left-1/2 h-auto max-h-[calc(100dvh-32px)] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-md",
        placement === "left" && "top-0 right-auto bottom-0 left-0 h-dvh max-h-none w-[min(360px,90vw)]",
        placement === "right" && "top-0 right-0 bottom-0 left-auto h-dvh max-h-none w-[min(var(--size-tool-panel),100vw)]",
        placement === "full" &&
          "inset-0 h-dvh max-h-none w-screen pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      {open && (
        <div className="flex h-full max-h-[inherit] flex-col">
          {!bare && (
            <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-detail pr-2 pl-5">
              <h2 className="truncate font-display text-[17px] leading-6 font-bold">{title}</h2>
              <IconButton icon={X} label="Close" onClick={onClose} />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      )}
    </dialog>
  );
}
