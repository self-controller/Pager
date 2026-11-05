import { useEffect, useMemo, useState } from "react";
import type { ContextBriefing } from "@/api/types";
import { cx } from "@/lib/cx";
import { outlineTransform, placeLabels, placePoints, placesView, projectPoint, wrapLabel } from "./model";
import { useWidth } from "./parts";

interface Props {
  briefing: ContextBriefing;
  focus: string | null;
  onFocus: (id: string | null) => void;
  /** The tallest it may be (full screen). */
  maxHeight?: number;
}

type Outline = { LAND: string; BORDERS: string };
let outline: Outline | null = null;

/** The bundled land and border outline (Natural Earth), fetched from Pager's own files the first time a map shows. */
function useOutline(): Outline | null {
  const [o, setO] = useState<Outline | null>(outline);
  useEffect(() => {
    if (o) return;
    let live = true;
    void import("./world").then((m) => {
      outline = { LAND: m.LAND, BORDERS: m.BORDERS };
      if (live) setO(outline);
    });
    return () => {
      live = false;
    };
  }, [o]);
  return o;
}

const LABEL = {
  fontFamily: "var(--font-ui)",
  paintOrder: "stroke",
  stroke: "var(--bg-primary)",
  strokeWidth: 3,
  strokeLinejoin: "round",
} as const;

/** Places with Wikidata coordinates on a plain outline: no tiles, no network, nothing about the book leaves the computer. */
export function PlacesMap({ briefing, focus, onFocus, maxHeight }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(320);
  const height = Math.round(Math.min(maxHeight ?? Infinity, width * 0.8));
  const points = useMemo(() => placePoints(briefing), [briefing]);
  const view = useMemo(() => placesView(points, width / height), [points, width, height]);
  const o = useOutline();
  const small = width < 420;
  const placed = useMemo(
    () =>
      points.map((p) => {
        const at = projectPoint(view, width, height, p.lat, p.lon);
        return { p, at, lines: wrapLabel(p.entity.name, small ? 16 : 22) };
      }),
    [points, view, width, height, small],
  );
  const labels = useMemo(
    () =>
      placeLabels(
        placed.map((x) => ({ ...x.at, lines: x.lines.length })),
        width,
        14,
        small ? 100 : 140,
      ),
    [placed, width, small],
  );

  return (
    <div ref={ref} className="w-full">
      <svg
        role="group"
        aria-label={`Map of ${points.length} places`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block touch-manipulation bg-surface select-none"
        onClick={(e) => {
          if (e.target === e.currentTarget) onFocus(null);
        }}
      >
        {o && (
          <g transform={outlineTransform(view, width, height)} pointerEvents="none">
            <path d={o.LAND} fill="var(--bg-secondary)" fillRule="evenodd" />
            <path
              d={o.BORDERS}
              fill="none"
              stroke="var(--fg-tertiary)"
              strokeWidth={0.75}
              strokeDasharray="3 2"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )}
        {placed.map(({ p, at, lines }, k) => {
          const focused = focus === p.entity.id;
          const right = labels[k]!.side === "right";
          return (
            <g
              key={p.entity.id}
              role="button"
              tabIndex={0}
              aria-pressed={focused}
              aria-label={p.entity.name}
              transform={`translate(${at.x} ${at.y})`}
              className="cursor-pointer outline-none"
              onClick={() => onFocus(focused ? null : p.entity.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onFocus(focused ? null : p.entity.id);
                }
              }}
            >
              <circle r={16} fill="transparent" />
              <circle
                r={focused ? 6.5 : 5}
                fill={focused ? "var(--accent)" : "var(--fg-primary)"}
                stroke="var(--bg-primary)"
                strokeWidth={1.5}
              />
              <text
                textAnchor={right ? "start" : "end"}
                fontSize={small ? 12 : 13.5}
                fontWeight={600}
                fill={focused ? "var(--accent)" : "var(--fg-primary)"}
                style={LABEL}
              >
                {lines.map((l, i) => (
                  <tspan key={i} x={right ? 10 : -10} y={labels[k]!.dy + i * 14}>
                    {l}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 px-5 pt-2 font-sans text-[12.5px] leading-[18px]" aria-label="Places">
        {points.map((p) => (
          <li key={p.entity.id}>
            <button
              type="button"
              onClick={() => onFocus(focus === p.entity.id ? null : p.entity.id)}
              className={cx("font-medium hover:text-accent", focus === p.entity.id ? "text-accent" : "text-fg-2")}
            >
              {p.entity.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
