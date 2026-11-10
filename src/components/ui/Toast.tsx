import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { isNativeApp } from "@/lib/native";

export interface ToastOptions {
  message: string;
  action?: { label: string; onClick: () => void };
  /** Milliseconds it stays; default 3000, or 5000 with an action (time to reach Undo). */
  duration?: number;
}

/** How long a plain notice stays, and one with an action. */
export const TOAST_MS = 3000;
export const TOAST_ACTION_MS = 5000;
/** The fade out (globals.css, `.toast[data-leaving]`); the toast is removed when it ends. */
export const TOAST_LEAVE_MS = 200;

interface ToastApi {
  toast: (options: ToastOptions) => void;
}

const Ctx = createContext<ToastApi>({ toast: () => {} });

export function useToast(): ToastApi {
  return useContext(Ctx);
}

/**
 * One toast at a time, bottom centre (above the phone tab bar), in the tooltip colours (the page's
 * colours inverted). It rises in, stays, fades out and is then removed; a new one replaces it at once.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(ToastOptions & { key: number; leaving: boolean }) | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const count = useRef(0);

  /** Fades the toast out, then removes it. */
  const leave = useCallback(() => {
    window.clearTimeout(timer.current);
    setCurrent((c) => c && { ...c, leaving: true });
    timer.current = window.setTimeout(() => setCurrent(null), TOAST_LEAVE_MS);
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      window.clearTimeout(timer.current);
      // A new key, so the element is a new one and comes in again.
      setCurrent({ ...options, key: ++count.current, leaving: false });
      timer.current = window.setTimeout(leave, options.duration ?? (options.action ? TOAST_ACTION_MS : TOAST_MS));
    },
    [leave],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={cx(
          "pointer-events-none fixed inset-x-0 bottom-[calc(var(--size-bottom-nav)+env(safe-area-inset-bottom)+12px)] z-50 flex justify-center px-4",
          // Above the tab bar; from 768px a browser has none, but the iPhone app keeps it (landscape).
          !isNativeApp() && "md:bottom-6",
        )}
      >
        {current && (
          <div
            key={current.key}
            data-leaving={current.leaving ? "" : undefined}
            className="toast pointer-events-auto flex max-w-[480px] items-center gap-4 rounded-sm bg-[var(--tooltip-bg)] py-2.5 pr-2 pl-4 text-[14px] leading-5 text-[var(--tooltip-fg)] shadow-lg"
          >
            <span className="min-w-0 flex-1">{current.message}</span>
            {current.action && (
              <button
                type="button"
                // Not twice, and not while it fades.
                disabled={current.leaving}
                onClick={() => {
                  current.action?.onClick();
                  leave();
                }}
                className="shrink-0 rounded-xs px-2 py-1 font-semibold text-[var(--tooltip-accent)] transition-hover hover:bg-[var(--tooltip-hover)]"
              >
                {current.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
