import { useId, useMemo, useState, type KeyboardEvent } from "react";
import type { ContextBriefing, ContextEntityKind } from "@/api/types";
import { crossPath, KIND_LABELS, smallMap, type MapEdge, type MapLabel, type MapNode, type NodeImage } from "./model";
import { useTextMeasure, useWidth } from "./parts";

interface Props {
  briefing: ContextBriefing;
  focus: string | null;
  onFocus: (id: string | null) => void;
  /** The tallest it may be (a narrow full screen); in the panel it is as tall as it is wide. */
  maxHeight?: number;
  /** Pictures by entity id (Phase 5): drawn in their nodes, clipped to the kind's shape. */
  images?: Map<string, NodeImage>;
}

const LABEL = {
  fontFamily: "var(--font-ui)",
  paintOrder: "stroke",
  stroke: "var(--bg-primary)",
  strokeWidth: 3,
  strokeLinejoin: "round",
} as const;

/**
 * The small connection map (the reader's panel, narrow places): a radial tree with the book at the
 * centre and its author at the top, every name placed clear of the others (`mapLabels`). Wide places
 * draw the card map instead (CardMap.tsx).
 */
export function ConnectionMap({ briefing, focus, onFocus, maxHeight, images }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(320);
  const measure = useTextMeasure();
  // Pictures that didn't load fall back to their shapes.
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const pictured = useMemo(
    () => new Set([...(images?.keys() ?? [])].filter((id) => !broken.has(id))),
    [images, broken],
  );
  const { frame, layout, labels, radius } = useMemo(
    () => smallMap(briefing, width, maxHeight, pictured, measure),
    [briefing, width, maxHeight, pictured, measure],
  );
  const { w, h, small, large } = frame;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  // Where each node is drawn: a leaf may have moved to make room for a name.
  const at = useMemo(() => new Map(layout.nodes.map((n) => [n.entity.id, labels.get(n.entity.id)!])), [layout, labels]);
  const touching = (e: MapEdge) => focus !== null && (e.from === focus || e.to === focus);
  const kinds = [...new Set(briefing.entities.map((e) => e.kind))];

  return (
    <div ref={ref} className="flex w-full flex-col items-center">
      <svg
        role="group"
        aria-label={`Connection map: ${layout.nodes.length} people, works, ideas and places around the book`}
        width={w}
        height={h}
        viewBox={`${-w / 2} ${-h / 2} ${w} ${h}`}
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
                fontSize={large ? 12.5 : 11.5}
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
            label={at.get(n.entity.id)!}
            r={radius(n)}
            focused={focus === n.entity.id}
            dim={focus !== null && focus !== n.entity.id}
            image={frame.pictures && pictured.has(n.entity.id) ? images?.get(n.entity.id) : undefined}
            clipId={`${uid}-clip-${n.entity.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
            onBroken={() => setBroken((b) => new Set(b).add(n.entity.id))}
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
  label,
  r,
  focused,
  dim,
  image,
  clipId,
  onBroken,
  onFocus,
}: {
  node: MapNode;
  /** Where it's drawn and its name's place and lines. */
  label: MapLabel;
  r: number;
  focused: boolean;
  dim: boolean;
  image: NodeImage | undefined;
  clipId: string;
  onBroken: () => void;
  onFocus: (id: string | null) => void;
}) {
  const e = node.entity;
  const root = node.depth === 0;
  const color = focused ? "var(--accent)" : "var(--fg-primary)";
  const select = () => onFocus(focused ? null : e.id);
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      select();
    }
  };
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={focused}
      aria-label={`${e.name}, ${KIND_LABELS[e.kind].toLowerCase()}`}
      transform={`translate(${label.x} ${label.y})`}
      onClick={select}
      onKeyDown={onKey}
      className="cursor-pointer outline-none focus-visible:[&>.ring]:opacity-100"
      opacity={dim ? (image ? 0.7 : 0.55) : 1}
    >
      <circle r={Math.max(18, r + 4)} fill="transparent" />
      <circle className="ring" r={r + 5} fill="none" stroke="var(--accent)" strokeWidth={2} opacity={focused && !image ? 1 : 0} />
      {image ? (
        <Picture kind={e.kind} r={r} image={image} clipId={clipId} focused={focused} onBroken={onBroken} />
      ) : (
        <Shape kind={e.kind} r={r} color={color} solid={root || e.id === "author" || focused} />
      )}
      <text
        textAnchor={label.anchor}
        fontSize={label.fontSize}
        fontWeight={root || e.id === "author" ? 600 : 400}
        fill={focused ? "var(--accent)" : "var(--fg-primary)"}
        style={LABEL}
      >
        {label.lines.map((l, i) => (
          <tspan key={i} x={label.dx} y={label.dy + i * label.lineHeight}>
            {l}
          </tspan>
        ))}
      </text>
    </g>
  );
}

/** Round for people, ideas and movements; a rounded square for works, places, events and institutions. */
function isRound(kind: ContextEntityKind): boolean {
  return kind === "person" || kind === "idea" || kind === "movement";
}

/** The outline a picture is clipped to (and ringed with). */
function Outline({
  kind,
  r,
  fill,
  stroke,
  strokeWidth,
}: {
  kind: ContextEntityKind;
  r: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}) {
  const paint = { fill, stroke, strokeWidth };
  return isRound(kind) ? <circle r={r} {...paint} /> : <rect x={-r} y={-r} width={2 * r} height={2 * r} rx={r * 0.22} {...paint} />;
}

/**
 * A picture filling its node. It covers the square, cropped from the bottom for people and works (a
 * face, a cover's title), evenly for the rest.
 */
function Picture({
  kind,
  r,
  image,
  clipId,
  focused,
  onBroken,
}: {
  kind: ContextEntityKind;
  r: number;
  image: NodeImage;
  clipId: string;
  focused: boolean;
  onBroken: () => void;
}) {
  const w = image.width > 0 ? image.width : 1;
  const h = image.height > 0 ? image.height : 1;
  const scale = Math.max((2 * r) / w, (2 * r) / h);
  const iw = w * scale;
  const ih = h * scale;
  const top = kind === "person" || kind === "work" ? 0.2 : 0.5;
  return (
    <>
      <clipPath id={clipId}>
        <Outline kind={kind} r={r} />
      </clipPath>
      <Outline kind={kind} r={r} fill="var(--bg-secondary)" />
      <image
        href={image.url}
        x={-iw / 2}
        y={-r - (ih - 2 * r) * top}
        width={iw}
        height={ih}
        preserveAspectRatio="xMidYMin slice"
        clipPath={`url(#${clipId})`}
        onError={onBroken}
      />
      <Outline
        kind={kind}
        r={r}
        fill="none"
        stroke={focused ? "var(--accent)" : "var(--fg-tertiary)"}
        strokeWidth={focused ? 3 : 1}
      />
    </>
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
