import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

/** A quiet room, not an error: icon in a soft circle, a line of text, maybe one action. */
export function EmptyState({ icon: Icon, title, children, action }: Props) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-surface-2 text-fg-2">
        <Icon size={24} strokeWidth={1.75} aria-hidden />
      </div>
      <h2 className="font-display text-[17px] leading-6 font-semibold text-fg">{title}</h2>
      {children && <div className="mt-1.5 max-w-[380px] text-[15px] leading-[22px] text-fg-2">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
