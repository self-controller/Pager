import type { CSSProperties } from "react";
import { cx } from "@/lib/cx";
import { hueFor, initials } from "@/lib/format";

function tint(key: string): CSSProperties {
  return { "--hue": hueFor(key) } as CSSProperties;
}

/** Small square tile with a name's initials on a stable tint. */
export function SourceIcon({ name, id, size = 24 }: { name: string; id: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="tint inline-flex shrink-0 items-center justify-center rounded-xs font-semibold outline outline-1 -outline-offset-1 outline-detail"
      style={{ ...tint(id), width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {initials(name).slice(0, 2)}
    </span>
  );
}

/** Generated book cover used when a document has no cover image. */
export function Cover({
  title,
  author,
  id,
  coverUrl,
  className,
}: {
  title: string;
  author?: string;
  id: string;
  coverUrl?: string;
  className?: string;
}) {
  if (coverUrl) {
    return (
      <img
        src={coverUrl}
        alt=""
        className={cx("aspect-[5/7] rounded-xs object-cover outline outline-1 -outline-offset-1 outline-detail", className)}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={cx(
        "tint relative flex aspect-[5/7] flex-col justify-between overflow-hidden rounded-xs p-2 outline outline-1 -outline-offset-1 outline-detail",
        className,
      )}
      style={tint(id)}
    >
      <span className="absolute inset-y-0 left-0 w-[3px] bg-black/10" />
      <span className="line-clamp-4 font-serif text-[11px] leading-[13px] font-semibold">{title}</span>
      {author && <span className="line-clamp-2 font-serif text-[8px] leading-[10px] opacity-75">{author}</span>}
    </div>
  );
}
