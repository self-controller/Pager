import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/** A 600px reading column inside 20px page gutters (none on phones). */
export function CenterColumn({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="md:px-5">
      <div className={cx("mx-auto w-full max-w-[var(--size-center)]", className)}>{children}</div>
    </div>
  );
}

/** A wider column for browsing (the library), 1040px. */
export function WideColumn({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="md:px-5">
      <div className={cx("mx-auto w-full max-w-[var(--size-library)]", className)}>{children}</div>
    </div>
  );
}

/**
 * Page title row. On phones it is a sticky 56px top bar; on larger screens it is a
 * plain heading at the top of the column (or hidden, for pages that open straight into content).
 */
export function PageHeader({
  title,
  actions,
  hideTitleOnDesktop,
}: {
  title: string;
  actions?: ReactNode;
  hideTitleOnDesktop?: boolean;
}) {
  return (
    <>
      <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-detail bg-surface px-4 md:hidden">
        <h1 className="flex-1 truncate font-display text-[19px] leading-6 font-semibold">{title}</h1>
        {actions}
      </header>
      {!hideTitleOnDesktop && (
        <div className="hidden items-center justify-between gap-3 px-3 pt-8 pb-2 md:flex">
          <h1 className="font-display text-[24px] leading-8 font-bold">{title}</h1>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
    </>
  );
}

/** Small section heading with an optional trailing link ("See all"). */
export function SectionHeading({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 pt-6 pb-2">
      <h2 className="font-display text-[15px] leading-5 font-semibold text-fg">{children}</h2>
      {trailing}
    </div>
  );
}
