import { useMemo, type KeyboardEvent } from "react";
import type { ContextBriefing, ContextEntityKind } from "@/api/types";
import {
  crossPath,
  KIND_LABELS,
  labelPlacement,
  mapRoot,
  radialLayout,
  usableLinks,
  labelChars,
  wrapLabel,
  type MapEdge,
  type MapNode,
} from "./model";
import { useWidth } from "./parts";

interface Props {
  briefing: ContextBriefing;
  focus: string | null;
  onFocus: (id: string | null) => void;
  /** The tallest it may be (full screen); in the panel it is as tall as it is wide. */
  maxHeight?: number;
}

const LABEL = {
  fontFamily: "var(--font-ui)",
  paintOrder: "stroke",
  stroke: "var(--bg-primary)",
  strokeWidth: 3,
  strokeLinejoin: "round",
} as const;

/** The connection map: a radial tree with the book at the centre and its author at the top. */
export function ConnectionMap({ briefing, focus, onFocus, maxHeight }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(320);
  const size = Math.max(240, Math.min(width, maxHeight ?? width));
  const margin = size < 420 ? 76 : 110;
  const radius = Math.max(40, size / 2 - margin);
  const layout = useMemo(
    () => radialLayout(briefing.entities, usableLinks(briefing), radius, mapRoot(briefing)),
    [briefing, radius],
  );
  const at = useMemo(() => new Map(layout.nodes.map((n) => [n.entity.id, n])), [layout]);
  const touching = (e: MapEdge) => focus !== null && (e.from === focus || e.to === focus);
  const kinds = [...new Set(briefing.entities.map((e) => e.kind))];
  const small = size < 480;

  return (
    <div ref={ref} className="flex w-full flex-col items-center">
      <svg
        role="group"
        aria-label={`Connection map: ${layout.nodes.length} people, works, ideas and places around the book`}
        width={size}
        height={size}
        viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
        className="max-w-full touch-manipulation select-none"
        onClick={(e) => {
          if (e.target === e.currentTarget) onFocus(null);
        }}
      >
        {layout.rings.map((r) => (
          <circle key={r} r={r} fill="none" stroke="var(--detail)" strokeDasharray="2 4" />
        ))}
        {layout.edges.map((e, i) => {
          const a = at.get(e.from);
          const b = at.get(e.to);
          if (!a || !b) return null;
          const hot = touching(e);
          const stroke = hot ? "var(--accent)" : e.kind === "author" ? "var(--fg-secondary)" : "var(--fg-tertiary)";
          const common = {
            stroke,
            strokeWidth: hot ? 1.75 : e.kind === "author" ? 1.5 : 1,
            strokeDasharray: e.kind === "loose" ? "1.5 3" : e.kind === "cross" ? "4 3" : undefined,
            fill: "none",
            opacity: hot || e.kind !== "cross" ? 1 : 0.7,
          };
          return e.kind === "cross" ? (
            <path key={i} d={crossPath(a, b)} {...common} />
          ) : (
            <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} />
          );
        })}
        {/* Relations on the lines only where there's room; the detail card lists them anyway. */}
        {focus &&
          !small &&
          layout.edges.filter(touching).map((e, i) => {
            const a = at.get(e.from);
            const b = at.get(e.to);
            if (!a || !b || !e.link) return null;
            const m =
              e.kind === "cross"
                ? { x: (a.x + b.x) * 0.425, y: (a.y + b.y) * 0.425 }
                : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            return (
              <text
                key={`r${i}`}
                x={m.x}
                y={m.y + 3}
                textAnchor="middle"
                fontSize={small ? 10 : 11.5}
                fill="var(--accent)"
                style={LABEL}
              >
                {e.link.relation.length > 26 ? `${e.link.relation.slice(0, 25)}…` : e.link.relation}
              </text>
            );
          })}
        {layout.nodes.map((n) => (
          <Node
            key={n.entity.id}
            node={n}
            focused={focus === n.entity.id}
            dim={focus !== null && focus !== n.entity.id}
            small={small}
            size={size}
            onFocus={onFocus}
          />
        ))}
      </svg>
      <Legend kinds={kinds} />
    </div>
  );
}

function Node({
  node,
  focused,
  dim,
  small,
  size,
  onFocus,
}: {
  node: MapNode;
  focused: boolean;
  dim: boolean;
  small: boolean;
  size: number;
  onFocus: (id: string | null) => void;
}) {
  const e = node.entity;
  const root = node.depth === 0;
  const place = labelPlacement(node);
  const fontSize = root ? (small ? 12.5 : 14) : small ? 11.5 : 13;
  // Wrapped to the room on its side, so a long name never runs off the map.
  const lines = wrapLabel(e.name, labelChars(node, place, size, fontSize, root ? 20 : small ? 14 : 18));
  const r = root ? 9 : e.id === "author" ? 7 : 5.5;
  const color = focused ? "var(--accent)" : "var(--fg-primary)";
  const select = () => onFocus(focused ? null : e.id);
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      select();
    }
  };
  // Lines above the node when the label sits above it.
  const startY = place.dy < 0 ? place.dy - (lines.length - 1) * (fontSize + 1) : place.dy;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={focused}
      aria-label={`${e.name}, ${KIND_LABELS[e.kind].toLowerCase()}`}
      transform={`translate(${node.x} ${node.y})`}
      onClick={select}
      onKeyDown={onKey}
      className="cursor-pointer outline-none [&:focus-visible>.ring]:opacity-100"
      opacity={dim ? 0.55 : 1}
    >
      <circle r={18} fill="transparent" />
      <circle className="ring" r={r + 5} fill="none" stroke="var(--accent)" strokeWidth={2} opacity={focused ? 1 : 0} />
      <Shape kind={e.kind} r={r} color={color} solid={root || e.id === "author" || focused} />
      <text
        textAnchor={place.anchor}
        fontSize={fontSize}
        fontWeight={root || e.id === "author" ? 600 : 400}
        fill={focused ? "var(--accent)" : "var(--fg-primary)"}
        style={LABEL}
      >
        {lines.map((l, i) => (
          <tspan key={i} x={place.dx} y={startY + i * (fontSize + 1)}>
            {l}
          </tspan>
        ))}
      </text>
    </g>
  );
}

/** One shape per kind, so the map reads in black and white. */
function Shape({ kind, r, color, solid }: { kind: ContextEntityKind; r: number; color: string; solid: boolean }) {
  const fill = solid ? color : "var(--bg-primary)";
  const p = { fill, stroke: color, strokeWidth: 1.5 };
  switch (kind) {
    case "work":
      return <rect x={-r} y={-r} width={2 * r} height={2 * r} rx={1} {...p} />;
    case "place":
      return <path d={`M0 ${-r * 1.25}L${r * 1.25} 0L0 ${r * 1.25}L${-r * 1.25} 0Z`} {...p} />;
    case "event":
      return <path d={`M0 ${-r * 1.2}L${r * 1.15} ${r * 0.9}L${-r * 1.15} ${r * 0.9}Z`} {...p} />;
    case "institution":
      return <rect x={-r} y={-r} width={2 * r} height={2 * r} rx={r * 0.5} {...p} fill={solid ? color : "var(--bg-secondary)"} />;
    case "idea":
    case "movement":
      return <circle r={r} {...p} strokeDasharray={kind === "movement" ? "2 1.5" : undefined} />;
    case "person":
    default:
      return <circle r={r} {...p} fill={solid ? color : "var(--fg-secondary)"} stroke={solid ? color : "var(--fg-secondary)"} />;
  }
}

function Legend({ kinds }: { kinds: ContextEntityKind[] }) {
  return (
    <ul
      className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 px-3 font-sans text-[11.5px] leading-4 text-fg-2"
      aria-label="Key"
    >
      {kinds.map((k) => (
        <li key={k} className="flex items-center gap-1">
          <svg width={12} height={12} viewBox="-6 -6 12 12" aria-hidden>
            <Shape kind={k} r={4} color="var(--fg-primary)" solid={false} />
          </svg>
          {KIND_LABELS[k]}
        </li>
      ))}
    </ul>
  );
}
