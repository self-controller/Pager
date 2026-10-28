import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export interface ToastOptions {
  message: string;
  action?: { label: string; onClick: () => void };
  /** Milliseconds; default 5000. */
  duration?: number;
}

interface ToastApi {
  toast: (options: ToastOptions) => void;
}

const Ctx = createContext<ToastApi>({ toast: () => {} });

export function useToast(): ToastApi {
  return useContext(Ctx);
}

/** One toast at a time, bottom centre (above the phone tab bar), in ink on paper. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(ToastOptions & { key: number }) | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const toast = useCallback((options: ToastOptions) => {
    window.clearTimeout(timer.current);
    setCurrent({ ...options, key: Date.now() });
    timer.current = window.setTimeout(() => setCurrent(null), options.duration ?? 5000);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--size-bottom-nav)+env(safe-area-inset-bottom)+12px)] z-50 flex justify-center px-4 md:bottom-6"
      >
        {current && (
          <div
            key={current.key}
            className="pointer-events-auto flex max-w-[480px] items-center gap-4 rounded-sm bg-[var(--tooltip-bg)] py-2.5 pr-2 pl-4 text-[14px] leading-5 text-[var(--tooltip-fg)] shadow-lg"
          >
            <span className="min-w-0 flex-1">{current.message}</span>
            {current.action && (
              <button
                type="button"
                onClick={() => {
                  current.action?.onClick();
                  setCurrent(null);
                }}
                className="shrink-0 rounded-xs px-2 py-1 font-semibold text-[var(--accent)] transition-hover hover:bg-white/10"
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
