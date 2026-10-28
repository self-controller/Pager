import { cx } from "@/lib/cx";

/** A thin track with a brown fill: how much of a book has been read. */
export function ProgressBar({
  percent,
  label,
  className,
  trackClassName,
}: {
  /** 0–1; undefined draws an empty track. */
  percent: number | undefined;
  label?: string;
  className?: string;
  trackClassName?: string;
}) {
  const value = percent === undefined ? 0 : Math.min(1, Math.max(0, percent));
  return (
    <div className={cx("flex items-center gap-2", className)}>
      <div
        role="progressbar"
        aria-label="Read"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        className={cx("h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3", trackClassName)}
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${value * 100}%` }} />
      </div>
      {label !== undefined && <span className="shrink-0 font-byline text-[11px] leading-4 tabular-nums text-fg-2">{label}</span>}
    </div>
  );
}
