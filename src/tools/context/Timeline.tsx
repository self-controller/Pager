import type { ContextBriefing } from "@/api/types";
import { cx } from "@/lib/cx";
import { entityById, entityDates, formatYear, parseYear, scaleAt, timelineRows, timelineScale } from "./model";

interface Props {
  briefing: ContextBriefing;
  focus: string | null;
  onFocus: (id: string | null) => void;
}

/**
 * The timeline: one row per dated entity (Wikidata's dates, never the model's), lives as bars and
 * works or events as points, on one scale, with the book's year as a line across all of them.
 */
export function Timeline({ briefing, focus, onFocus }: Props) {
  const rows = timelineRows(briefing);
  const scale = timelineScale(rows);
  const book = entityById(briefing, "book");
  const bookYear = parseYear(book?.facts?.start);
  const pct = (y: number) => `${scaleAt(scale, y) * 100}%`;

  return (
    <div className="flex flex-col px-5 pt-3 pb-2">
      {/* The axis. */}
      <div className="relative ml-0 h-5 font-sans text-[11px] leading-4 text-fg-3 tabular-nums" aria-hidden>
        {scale.ticks.map((t, i) => (
          <span
            key={t}
            className="absolute top-0"
            style={{
              left: pct(t),
              transform: i === 0 ? "none" : i === scale.ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
            }}
          >
            {formatYear(t)}
          </span>
        ))}
      </div>
      <div className="relative">
        {/* Grid lines and the book's year, behind the rows. */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {scale.ticks.map((t) => (
            <span key={t} className="absolute top-0 bottom-0 w-px bg-[var(--detail)]" style={{ left: pct(t) }} />
          ))}
          {bookYear !== null && (
            <span className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 bg-accent/70" style={{ left: pct(bookYear) }} />
          )}
        </div>
        <ol className="relative flex flex-col" aria-label="Timeline">
          {rows.map((r) => {
            const isBook = r.entity.id === "book";
            const focused = focus === r.entity.id;
            const left = scaleAt(scale, r.start);
            const right = r.end !== null ? scaleAt(scale, r.end) : null;
            return (
              <li key={r.entity.id}>
                <button
                  type="button"
                  aria-pressed={focused}
                  onClick={() => onFocus(focused ? null : r.entity.id)}
                  className="group relative block w-full py-1.5 text-left"
                >
                  {/* The label starts at its mark, or ends at it in the right half, so it never runs off. It sits
                      on the page colour, so the grid and the book's line pass behind the words. */}
                  <span
                    className={cx(
                      "relative z-[1] block truncate font-sans text-[12.5px] leading-[18px]",
                      left > 0.5 && "text-right",
                    )}
                    style={left > 0.5 ? { paddingRight: `${(1 - (right ?? left)) * 100}%` } : { paddingLeft: `${left * 100}%` }}
                  >
                    <span className="context-label">
                      <span
                        className={cx("font-semibold", focused || isBook ? "text-accent" : "text-fg group-hover:text-accent")}
                      >
                        {r.entity.name}
                      </span>{" "}
                      <span className={cx("tabular-nums", focused ? "text-accent" : "text-fg-3")}>{entityDates(r.entity)}</span>
                    </span>
                  </span>
                  <span className="relative mt-1 block h-2">
                    {right !== null ? (
                      <span
                        className={cx("absolute top-0.5 h-1 rounded-full", focused || isBook ? "bg-accent" : "bg-fg-2")}
                        style={{ left: `${left * 100}%`, width: `max(4px, ${(right - left) * 100}%)` }}
                      />
                    ) : (
                      <span
                        className={cx(
                          "absolute top-0 size-2 -translate-x-1/2 rotate-45",
                          focused || isBook ? "bg-accent" : "bg-fg",
                        )}
                        style={{ left: `${left * 100}%` }}
                      />
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      {bookYear !== null && book && (
        <p className="mt-2 font-sans text-[11.5px] leading-4 text-fg-2">
          <span className="mr-1.5 inline-block h-2.5 w-[2px] translate-y-[1px] bg-accent/70 align-baseline" aria-hidden />
          {book.name}, {formatYear(bookYear)}
        </p>
      )}
    </div>
  );
}
