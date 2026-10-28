import type { CSSProperties } from "react";
import { cx } from "@/lib/cx";

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={cx("skeleton", className)} style={style} />;
}
