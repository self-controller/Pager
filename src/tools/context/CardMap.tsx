import { useEffect, useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { ContextBriefing } from "@/api/types";
import { IconButton } from "@/components/ui/Button";
import { cx } from "@/lib/cx";
import {
  CARD,
  cardLayout,
  cardMaxWidth,
  cardText,
  entityRole,
  mapRoot,
  radialTree,
  relationSpot,
  routeEdge,
  usableLinks,
  visibleSegment,
  type CardNode,
  type CardPicture,
  type MapEdge,
  type NodeImage,
} from "./model";
import { useTextMeasure, useWidth } from "./parts";

interface Props {
  briefing: ContextBriefing;
  focus: string | null;
  onFocus: (id: string | null) => void;
  /** The stage's height: the map fills it (it grows only when the cards can't fit). */
  height: number;
  /** Pictures by entity id: a round one on the card's right, the book's cover as a small portrait. */
  images?: Map<string, NodeImage>;
  /** The tapped card's details, floating over the map on the side away from it. */
  detail: ReactNode;
}

/** The longest relation shown on a line; the detail lists them whole. */
const RELATION_CHARS = 34;

function relationText(r: string): string {
  return r.length > RELATION_CHARS ? `${r.slice(0, RELATION_CHARS - 1)}…` : r;
}

/**
 * The card map (Phase 6), where there's room (the Assistant page, a full screen): each node a card
 * with what it is to the author over its name ("Concept: Eternal recurrence") and its picture, laid
 * on ovals around the book's card (`cardLayout`), with the lines between them. A tapped card's details
 * float over the map with their own scroll, so nothing in the page moves.
 */
export function CardMap({ briefing, focus, onFocus, height, images, detail }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(960);
  const measure = useTextMeasure();
  // Pictures that didn't load: the card goes on without one.
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const tree = useMemo(() => radialTree(briefing.entities, usableLinks(briefing), mapRoot(briefing)), [briefing]);
  const maxW = cardMaxWidth(width);
  const cards = useMemo(
    () =>
      new Map(
        tree.nodes.map((n) => {
          const id = n.entity.id;
          const image = broken.has(id) ? undefined : images?.get(id);
          // The library's cover has no credit: a portrait, as covers are.
          const picture: CardPicture = image ? (id === "book" && !image.credit ? "cover" : "round") : null;
          const text = cardText(n.entity.name, entityRole(n.entity), { picture, root: n.depth === 0, maxW, measure });
          return [id, { ...text, picture, image }];
        }),
      ),
    [tree, images, broken, maxW, measure],
  );
  const layout = useMemo(() => cardLayout(tree, cards, width, height), [tree, cards, width, height]);
  const H = layout.height;
  const at = useMemo(() => new Map(layout.nodes.map((n) => [n.entity.id, n])), [layout]);
  // Each line goes round the other cards; a straight one's relation sits in the part that shows.
  const routes = useMemo(
    () =>
      layout.edges.map((e) => {
        const a = at.get(e.from);
        const b = at.get(e.to);
        if (!a || !b) return null;
        const others = layout.nodes.filter((n) => n !== a && n !== b);
        const route = routeEdge(a, b, others, e.kind === "cross");
        // A straight line's relation tries the middle of the part that shows first.
        const seg = route.d.includes("L") ? visibleSegment(a, b) : null;
        const along = seg ? [{ x: (seg.x1 + seg.x2) / 2, y: (seg.y1 + seg.y2) / 2 }, ...route.along] : route.along;
        const text = e.link ? relationText(e.link.relation) : null;
        return { d: route.d, text, along, textW: text ? measure(text, 12.5, 500) + 6 : 0 };
      }),
    [layout, at, measure],
  );
  // The tapped card's relations, each where it's clear of the cards and of those placed before it.
  const spots = useMemo(() => {
    const out = new Map<number, { x: number; y: number }>();
    if (!focus) return out;
    const taken: { x: number; y: number; w: number; h: number }[] = [...layout.nodes];
    layout.edges.forEach((e, i) => {
      const route = routes[i];
      if (!route?.text || (e.from !== focus && e.to !== focus)) return;
      const spot = relationSpot(route.along, route.textW, taken);
      if (!spot) return;
      out.set(i, spot);
      taken.push({ ...spot, w: route.textW, h: 16 });
    });
    return out;
  }, [focus, layout, routes]);
  const picked = focus ? at.get(focus) : undefined;
  const touching = (e: MapEdge) => focus !== null && (e.from === focus || e.to === focus);
  // The tapped card and the ones it links to stay clear; the rest fade.
  const near = useMemo(() => {
    if (!focus) return null;
    const ids = new Set([focus]);
    for (const e of layout.edges) if (e.from === focus || e.to === focus) ids.add(e.from === focus ? e.to : e.from);
    return ids;
  }, [focus, layout.edges]);

  // Esc closes the details first (and not the full-screen dialog around the map).
  useEffect(() => {
    if (!focus) return;
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onFocus(null);
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [focus, onFocus]);

  const side = picked && picked.x > 0 ? "left" : "right";

  return (
    <div ref={ref} className="context-map w-full">
      <div
        role="group"
        aria-label={`Connection map: ${layout.nodes.length} people, works, ideas and places around the book`}
        className="relative touch-manipulation select-none"
        style={{ height: H }}
        onClick={() => onFocus(null)}
      >
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0"
          width={width}
          height={H}
          viewBox={`${-width / 2} ${-H / 2} ${width} ${H}`}
        >
          {layout.edges.map((e, i) => {
            const route = routes[i];
            if (!route) return null;
            const hot = touching(e);
            const common = {
              stroke: hot ? "var(--accent)" : e.kind === "author" ? "var(--fg-secondary)" : "var(--fg-tertiary)",
              strokeWidth: hot ? 2 : e.kind === "author" ? 1.5 : 1.25,
              strokeDasharray: e.kind === "loose" ? "2 4" : e.kind === "cross" ? "5 4" : undefined,
              fill: "none",
              opacity: hot ? 1 : near ? 0.35 : e.kind === "cross" ? 0.7 : 1,
            };
            return <path key={i} d={route.d} {...common} />;
          })}
        </svg>

        {layout.nodes.map((n) => {
          const card = cards.get(n.entity.id)!;
          const focused = focus === n.entity.id;
          return (
            <Card
              key={n.entity.id}
              node={n}
              left={width / 2 + n.x - n.w / 2}
              top={H / 2 + n.y - n.h / 2}
              role={card.role}
              fullRole={entityRole(n.entity)}
              lines={card.lines}
              picture={card.picture}
              image={card.image}
              focused={focused}
              dim={near !== null && !near.has(n.entity.id)}
              onBroken={() => setBroken((b) => new Set(b).add(n.entity.id))}
              onSelect={() => onFocus(focused ? null : n.entity.id)}
            />
          );
        })}

        {/* The tapped card's relations, at the middle of the line that shows between the cards. */}
        {focus && (
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0"
            width={width}
            height={H}
            viewBox={`${-width / 2} ${-H / 2} ${width} ${H}`}
          >
            {layout.edges.map((_, i) => {
              const route = routes[i];
              const spot = spots.get(i);
              if (!spot || !route?.text) return null;
              return (
                <text
                  key={i}
                  x={spot.x}
                  y={spot.y + 4}
                  textAnchor="middle"
                  fontSize={12.5}
                  fontWeight={500}
                  fill="var(--accent)"
                  className="context-map-relation"
                >
                  {route.text}
                </text>
              );
            })}
          </svg>
        )}

        {focus && detail && (
          <div
            key={focus}
            role="region"
            aria-label="Details"
            onClick={(e) => e.stopPropagation()}
            className={cx(
              "context-detail absolute top-3 z-10 flex w-[360px] max-w-[calc(100%-24px)] flex-col rounded-md bg-elevated elevation",
              side === "left" ? "left-3" : "right-3",
            )}
            style={{ maxHeight: H - 24 }}
          >
            <div className="flex shrink-0 justify-end px-1.5 pt-1.5">
              <IconButton icon={X} label="Close the details" size="sm" onClick={() => onFocus(null)} />
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">{detail}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({
  node,
  left,
  top,
  role,
  fullRole,
  lines,
  picture,
  image,
  focused,
  dim,
  onBroken,
  onSelect,
}: {
  node: CardNode;
  left: number;
  top: number;
  /** The role's lines as shown (the colon after the last), and whole for the label. */
  role: string[];
  fullRole: string;
  lines: string[];
  picture: CardPicture;
  image: NodeImage | undefined;
  focused: boolean;
  dim: boolean;
  onBroken: () => void;
  onSelect: () => void;
}) {
  const e = node.entity;
  const root = node.depth === 0;
  return (
    <button
      type="button"
      aria-pressed={focused}
      aria-label={`${fullRole}: ${e.name}`}
      onClick={(ev) => {
        ev.stopPropagation();
        onSelect();
      }}
      className={cx(
        "absolute flex items-center gap-2.5 rounded-md bg-elevated text-left outline-none transition-[opacity,box-shadow] duration-150 hover:bg-surface-hover focus-visible:shadow-[0_0_0_2px_var(--accent)]",
        focused
          ? "shadow-[0_0_0_2px_var(--accent),0_4px_14px_rgb(0_0_0/0.10)]"
          : root || e.id === "author"
            ? "shadow-[0_0_0_1.5px_var(--fg-secondary),0_1px_3px_rgb(0_0_0/0.06)]"
            : "shadow-[0_0_0_1px_var(--detail),0_1px_3px_rgb(0_0_0/0.06)]",
        // Faded, the card stays opaque so no line shows through it: only its contents fade.
        dim && "[&>*]:opacity-40",
      )}
      style={{ left, top, width: node.w, height: node.h, padding: `${CARD.padY}px ${CARD.padX}px` }}
    >
      <span className="min-w-0 flex-1">
        <span className={cx("block font-sans text-[12px] leading-4 font-medium", focused ? "text-accent" : "text-fg-2")}>
          {role.map((l, i) => (
            <span key={i} className="block whitespace-nowrap">
              {l}
            </span>
          ))}
        </span>
        <span
          className={cx(
            "mt-0.5 block font-sans font-semibold text-fg",
            root ? "text-[16.5px] leading-[22px]" : "text-[14.5px] leading-[19px]",
          )}
        >
          {lines.map((l, i) => (
            <span key={i} className="block whitespace-nowrap">
              {l}
            </span>
          ))}
        </span>
      </span>
      {image && picture === "cover" && (
        <img
          src={image.url}
          alt=""
          onError={onBroken}
          className="h-[50px] w-[34px] shrink-0 rounded-xs bg-surface-2 object-cover shadow-[0_0_0_1px_var(--detail)]"
        />
      )}
      {image && picture === "round" && (
        <img
          src={image.url}
          alt=""
          onError={onBroken}
          className="size-11 shrink-0 rounded-full bg-surface-2 object-cover shadow-[0_0_0_1px_var(--detail)]"
          // A face or a cover's title sits near the top.
          style={{ objectPosition: e.kind === "person" || e.kind === "work" ? "50% 20%" : "50% 50%" }}
        />
      )}
    </button>
  );
}
