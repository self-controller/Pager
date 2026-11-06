import type {
  ContextBriefing,
  ContextBriefingEntry,
  ContextCitation,
  ContextClaim,
  ContextEntity,
  ContextEntityKind,
  ContextItem,
  ContextLevel,
  ContextLink,
  ContextMedia,
  ContextMediaImage,
  ContextPhoneRuns,
  ContextRecord,
  ContextRun,
  ContextRunStep,
  ContextSection,
  ContextSectionKind,
} from "@/api/types";

/**
 * Pure helpers for the Context panel: section order and folds, which graphics the data supports, and
 * the layouts of the connection map, the timeline and the places map. No React, no DOM.
 */

// ---- Sections ----

/** Context first: the book, the rare pre-reading, the moment, the situation; then the rest. */
export const SECTION_ORDER: readonly ContextSectionKind[] = [
  "overview",
  "readFirst",
  "moment",
  "situation",
  "conversation",
  "terms",
  "furtherReading",
];

export const SECTION_TITLES: Record<ContextSectionKind, string> = {
  overview: "The book",
  readFirst: "Read first",
  moment: "The historical moment",
  situation: "The author's situation",
  conversation: "The author's conversation",
  terms: "Terms and names",
  furtherReading: "Further reading",
};

/** These sit behind a fold so the reader isn't overwhelmed; the others are open. A focused briefing is short: nothing is folded. */
const FOLDED: ReadonlySet<ContextSectionKind> = new Set(["conversation", "terms", "furtherReading"]);

export function isFolded(kind: ContextSectionKind, focused = false): boolean {
  return !focused && FOLDED.has(kind);
}

/**
 * A section's title. In a focused briefing ("Context for this") the overview is the focus itself and
 * the author's conversation is how it bears on this book.
 */
export function sectionTitle(kind: ContextSectionKind, b: Pick<ContextBriefing, "focus" | "sections" | "entities">): string {
  if (!b.focus) return SECTION_TITLES[kind];
  if (kind === "overview") return focusName(b);
  if (kind === "conversation") return "And this book";
  return SECTION_TITLES[kind];
}

/**
 * The relation above a conversation item: "Jane Austen took her title from" (its heading names the
 * other side). In a focused briefing the other side is always the focus, and the heading describes
 * the connection, so the phrase ends with the focus: "Charles Darwin read Malthus".
 */
export function relationLine(
  b: Pick<ContextBriefing, "focus" | "sections" | "entities">,
  item: Pick<ContextItem, "relation">,
  author: string,
): string | null {
  if (!item.relation) return null;
  return b.focus ? `${author} ${item.relation} ${focusName(b)}` : `${author} ${item.relation}`;
}

/** What a focused briefing is about, as the briefing names it: the overview's heading, else its `focus` node, else the selection. */
export function focusName(b: Pick<ContextBriefing, "focus" | "sections" | "entities">): string {
  const overview = b.sections.find((s) => s.kind === "overview")?.items[0]?.heading.trim();
  return overview || b.entities.find((e) => e.id === "focus")?.name || b.focus || "";
}

/** The briefing's sections in display order, whatever order they came in; empty and unknown ones left out. */
export function orderedSections(b: ContextBriefing): ContextSection[] {
  return SECTION_ORDER.flatMap((kind) => b.sections.filter((s) => s.kind === kind && s.items.length > 0));
}

/** The DOM id of an item, so the connection map can scroll the text to it. */
export function itemAnchor(kind: ContextSectionKind, index: number): string {
  return `context-${kind}-${index}`;
}

// ---- Which graphics show (decided from counts) ----

export type ContextView = "briefing" | "map" | "timeline" | "places";

export const VIEW_LABELS: Record<ContextView, string> = {
  briefing: "Briefing",
  map: "Map",
  timeline: "Timeline",
  places: "Places",
};

/** The connection map needs something to connect: three nodes and two sourced links. */
export const MIN_MAP_ENTITIES = 3;
export const MIN_MAP_LINKS = 2;
/** A timeline needs three dated entities; a places map two places with coordinates. */
export const MIN_TIMELINE = 3;
export const MIN_PLACES = 2;

export function parseYear(s: string | undefined | null): number | null {
  if (!s || !/^-?\d{1,4}$/.test(s.trim())) return null;
  return Number(s.trim());
}

/** "1859", "427 BCE". */
export function formatYear(y: number): string {
  return y < 0 ? `${-y} BCE` : String(y);
}

export function datedEntities(b: ContextBriefing): ContextEntity[] {
  return b.entities.filter((e) => parseYear(e.facts?.start) !== null);
}

export interface PlacePoint {
  entity: ContextEntity;
  lat: number;
  lon: number;
}

export function placePoints(b: ContextBriefing): PlacePoint[] {
  return b.entities.flatMap((entity) => {
    const c = entity.facts?.coordinates;
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[0]) > 90 || Math.abs(c[1]) > 180) return [];
    return [{ entity, lat: c[0], lon: c[1] }];
  });
}

/** Links whose two ends are both on the map. */
export function usableLinks(b: ContextBriefing): ContextLink[] {
  const ids = new Set(b.entities.map((e) => e.id));
  return b.links.filter((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to);
}

export function viewsFor(b: ContextBriefing): ContextView[] {
  const views: ContextView[] = ["briefing"];
  if (b.entities.length >= MIN_MAP_ENTITIES && usableLinks(b).length >= MIN_MAP_LINKS) views.push("map");
  if (datedEntities(b).length >= MIN_TIMELINE) views.push("timeline");
  if (placePoints(b).length >= MIN_PLACES) views.push("places");
  return views;
}

// ---- Entities: what the text and the links say about a node ----

export const KIND_LABELS: Record<ContextEntityKind, string> = {
  person: "Person",
  work: "Work",
  idea: "Idea",
  movement: "Movement",
  institution: "Institution",
  place: "Place",
  event: "Event",
};

/** What a node is to the author when its briefing gives no `role` (made before version 3). */
export const KIND_ROLES: Record<ContextEntityKind, string> = {
  person: "Person",
  work: "Work",
  idea: "Concept",
  movement: "Movement",
  institution: "Institution",
  place: "Place",
  event: "Event",
};

/** The role on a node's card ("Concept", "Rival theorist"): the briefing's, else "This book", "Author" or the kind's. */
export function entityRole(e: Pick<ContextEntity, "id" | "kind" | "role">): string {
  const role = e.role?.trim();
  if (role) return role;
  if (e.id === "book") return "This book";
  if (e.id === "author") return "Author";
  return KIND_ROLES[e.kind];
}

/** "1809–1882", "1859", "from 1788", or null. Places have no dates. */
export function entityDates(e: ContextEntity): string | null {
  const start = parseYear(e.facts?.start);
  const end = parseYear(e.facts?.end);
  if (start !== null && end !== null) return `${formatYear(start)}–${formatYear(end)}`;
  if (start !== null)
    return e.kind === "person"
      ? `born ${formatYear(start)}`
      : e.kind === "work"
        ? formatYear(start)
        : `from ${formatYear(start)}`;
  if (end !== null) return `until ${formatYear(end)}`;
  return null;
}

export function linksOf(b: ContextBriefing, id: string): ContextLink[] {
  return usableLinks(b).filter((l) => l.from === id || l.to === id);
}

export interface ItemRef {
  kind: ContextSectionKind;
  index: number;
  item: ContextItem;
}

/** The briefing's items about an entity, in display order. */
export function itemsAbout(b: ContextBriefing, id: string): ItemRef[] {
  return orderedSections(b).flatMap((s) =>
    s.items.flatMap((item, index) => (item.entity === id ? [{ kind: s.kind, index, item }] : [])),
  );
}

export function entityById(b: ContextBriefing, id: string | undefined | null): ContextEntity | undefined {
  return id ? b.entities.find((e) => e.id === id) : undefined;
}

// ---- The connection map: a radial tree rooted at the book ----

export type MapEdgeKind = "tree" | "cross" | "author" | "loose";

export interface MapNode {
  entity: ContextEntity;
  depth: number;
  /**
   * The ring it is drawn on (0 the centre): its depth, except that a leaf hanging straight from the
   * centre goes on the second ring when there is one, so the centre and its name have room.
   */
  ring: number;
  /** Radians, 0 pointing right, growing clockwise (SVG's y runs down). */
  angle: number;
  /** The share of the circle it and its children own, in radians. */
  span: number;
  /** A leaf: nothing hangs from it. */
  leaf: boolean;
  x: number;
  y: number;
  parent: string | null;
}

export interface MapEdge {
  from: string;
  to: string;
  /** `tree`: a sourced link that holds the tree up. `cross`: a sourced link drawn as a faint curve.
   * `author`: the book to its author, from the book itself (no claim). `loose`: an entity the text
   * mentions that no link reaches, hung from the book with no relation. */
  kind: MapEdgeKind;
  link: ContextLink | null;
}

export interface RadialLayout {
  nodes: MapNode[];
  edges: MapEdge[];
  /** Ring radii, innermost first. */
  rings: number[];
}

export interface RadialTree {
  /** In the briefing's order, all at 0,0: a layout places them. */
  nodes: MapNode[];
  edges: MapEdge[];
  /** How many rings. */
  rings: number;
  root: string;
}

/**
 * The map's tree, without positions: rings around the centre (the book, or a focused briefing's
 * `focus`), what links to it directly on the first ring, and so on outward (a breadth-first tree over
 * the links, either direction). The author always hangs from the book, first, and sits at the top.
 * Each leaf gets an equal share of the circle and a parent sits in the middle of its children's
 * share, so the drawing is the same every time. Links left over after the tree are cross links;
 * entities no link reaches hang loose from the centre. A leaf hanging from the centre (the author
 * aside) goes on the second ring when there is one.
 */
export function radialTree(entities: ContextEntity[], links: ContextLink[], rootId?: string): RadialTree {
  if (entities.length === 0) return { nodes: [], edges: [], rings: 0, root: "" };
  const byId = new Map(entities.map((e) => [e.id, e]));
  const root = rootId && byId.has(rootId) ? rootId : byId.has("book") ? "book" : entities[0]!.id;
  const usable = links.filter((l) => byId.has(l.from) && byId.has(l.to) && l.from !== l.to);

  const adjacent = new Map<string, { other: string; link: ContextLink | null }[]>();
  const connect = (a: string, b: string, link: ContextLink | null) => {
    if (!adjacent.has(a)) adjacent.set(a, []);
    adjacent.get(a)!.push({ other: b, link });
  };
  // The book and its author always hang together, whatever the centre.
  const authorLinked = usable.some((l) => (l.from === "book" && l.to === "author") || (l.from === "author" && l.to === "book"));
  if (byId.has("book") && byId.has("author") && !authorLinked) {
    connect("book", "author", null);
    connect("author", "book", null);
  }
  for (const l of usable) {
    connect(l.from, l.to, l);
    connect(l.to, l.from, l);
  }
  // The author first among the book's neighbours, so it takes the top of the circle.
  const firstAuthor = (list: { other: string; link: ContextLink | null }[]) =>
    [...list].sort((a, b) => Number(b.other === "author") - Number(a.other === "author"));

  const parent = new Map<string, string | null>([[root, null]]);
  const viaLink = new Map<string, ContextLink | null>();
  const depth = new Map<string, number>([[root, 0]]);
  const children = new Map<string, string[]>();
  const queue = [root];
  while (queue.length) {
    const id = queue.shift()!;
    for (const { other, link } of firstAuthor(adjacent.get(id) ?? [])) {
      if (parent.has(other)) continue;
      parent.set(other, id);
      viaLink.set(other, link);
      depth.set(other, depth.get(id)! + 1);
      children.set(id, [...(children.get(id) ?? []), other]);
      queue.push(other);
    }
  }
  const loose = entities.filter((e) => !parent.has(e.id)).map((e) => e.id);
  for (const id of loose) {
    parent.set(id, root);
    viaLink.set(id, null);
    depth.set(id, 1);
    children.set(root, [...(children.get(root) ?? []), id]);
  }

  const leaves = new Map<string, number>();
  const countLeaves = (id: string): number => {
    const kids = children.get(id) ?? [];
    const n = kids.length === 0 ? 1 : kids.reduce((sum, k) => sum + countLeaves(k), 0);
    leaves.set(id, n);
    return n;
  };
  const total = countLeaves(root);
  const maxDepth = Math.max(...depth.values());

  const angle = new Map<string, number>();
  const span = new Map<string, number>();
  const firstChild = children.get(root)?.[0];
  const firstShare = firstChild ? ((leaves.get(firstChild) ?? 1) / total) * 2 * Math.PI : 0;
  const assign = (id: string, from: number, to: number) => {
    angle.set(id, (from + to) / 2);
    span.set(id, to - from);
    let at = from;
    for (const k of children.get(id) ?? []) {
      const share = ((leaves.get(k) ?? 1) / (leaves.get(id) ?? 1)) * (to - from);
      assign(k, at, at + share);
      at += share;
    }
  };
  // Centre the first child (the author) at the top.
  const start = -Math.PI / 2 - firstShare / 2;
  assign(root, start, start + 2 * Math.PI);

  const nodes: MapNode[] = entities.map((entity) => {
    const d = depth.get(entity.id) ?? 1;
    const leaf = !(children.get(entity.id)?.length);
    const ring = d === 1 && leaf && maxDepth >= 2 && entity.id !== "author" ? 2 : d;
    return {
      entity,
      depth: d,
      ring,
      angle: angle.get(entity.id) ?? 0,
      span: span.get(entity.id) ?? 0,
      leaf,
      x: 0,
      y: 0,
      parent: parent.get(entity.id) ?? null,
    };
  });

  const edges: MapEdge[] = [];
  const treeLinks = new Set<ContextLink>();
  for (const [id, p] of parent) {
    if (p === null) continue;
    const link = viaLink.get(id) ?? null;
    if (link) treeLinks.add(link);
    const kind: MapEdgeKind = link ? "tree" : loose.includes(id) ? "loose" : "author";
    edges.push(link ? { from: link.from, to: link.to, kind, link } : { from: p, to: id, kind, link: null });
  }
  for (const l of usable) if (!treeLinks.has(l)) edges.push({ from: l.from, to: l.to, kind: "cross", link: l });
  return { nodes, edges, rings: maxDepth, root };
}

/**
 * The tree laid out on circles (`radialTree`), the outer ring at `radius`. With `inner`, the first
 * ring's smallest radius (so its nodes clear the centre's picture and name): at most 45% of
 * `radius`, and never less than an even share; the other rings spread evenly out to `radius`.
 */
export function radialLayout(
  entities: ContextEntity[],
  links: ContextLink[],
  radius: number,
  /** The centre: the book by default; a focused briefing's `focus` node. */
  rootId?: string,
  inner = 0,
): RadialLayout {
  const tree = radialTree(entities, links, rootId);
  if (tree.nodes.length === 0) return { nodes: [], edges: [], rings: [] };
  const n = tree.rings;
  const first = Math.max(radius / n, Math.min(inner, radius * 0.45));
  const rings = Array.from({ length: n }, (_, i) => (n === 1 ? radius : round(first + ((radius - first) * i) / (n - 1))));
  const nodes = tree.nodes.map((node) => {
    const r = node.ring === 0 ? 0 : rings[node.ring - 1]!;
    return { ...node, x: round(Math.cos(node.angle) * r), y: round(Math.sin(node.angle) * r) };
  });
  return { nodes, edges: tree.edges, rings };
}

function round(n: number): number {
  return Math.round(n * 100) / 100 || 0;
}

/** The map's centre: a focused briefing's `focus` node, else the book. */
export function mapRoot(b: Pick<ContextBriefing, "focus" | "entities">): string | undefined {
  return b.focus && b.entities.some((e) => e.id === "focus") ? "focus" : undefined;
}

/** A cross link's curve: a quadratic bend toward the centre, so it doesn't run along the tree's spokes. */
export function crossPath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return `M${a.x} ${a.y}Q${round(mx * 0.35)} ${round(my * 0.35)} ${b.x} ${b.y}`;
}

/**
 * Where a node's label goes: outward from the centre, clear of a node of radius `r` (by default the
 * plain shapes': 9 for the centre, 5.5 for the rest). The centre's name goes below it, or with
 * `centreAbove` (a map of pictures) above it, toward the author: only that line is there, so the first
 * ring's pictures below and beside it stay clear.
 */
export function labelPlacement(
  n: { angle: number; depth: number },
  r = n.depth === 0 ? 9 : 5.5,
  centreAbove = false,
): {
  anchor: "start" | "middle" | "end";
  dx: number;
  dy: number;
} {
  if (n.depth === 0) return { anchor: "middle", dx: 0, dy: centreAbove ? round(-(r + 6.5)) : round(r + 17) };
  const c = Math.cos(n.angle);
  const s = Math.sin(n.angle);
  if (c > 0.35) return { anchor: "start", dx: round(r + 4.5), dy: 4 };
  if (c < -0.35) return { anchor: "end", dx: round(-(r + 4.5)), dy: 4 };
  return { anchor: "middle", dx: 0, dy: s < 0 ? round(-(r + 6.5)) : round(r + 14.5) };
}

/**
 * How many characters a label's line can hold before the edge of a map `size` wide, centred on 0,0,
 * given where it is anchored (about 0.56 em a character in the system sans), from 5 to `max`.
 */
export function labelChars(
  n: { x: number; y: number },
  place: { anchor: "start" | "middle" | "end"; dx: number },
  size: number,
  fontSize: number,
  max: number,
): number {
  const half = size / 2;
  const x = n.x + place.dx;
  const room = place.anchor === "start" ? half - x : place.anchor === "end" ? x + half : 2 * Math.min(half - x, x + half);
  return Math.max(5, Math.min(max, Math.floor((room - 4) / (fontSize * 0.56))));
}

/** Splits a label into at most `maxLines` lines of about `width` characters, with an ellipsis if it runs over. */
export function wrapLabel(text: string, width = 16, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if (line.length + 1 + w.length <= width) line += ` ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  const cut = (l: string) => (l.length > width + 4 ? `${l.slice(0, width + 3)}…` : l);
  if (lines.length <= maxLines) return lines.map(cut);
  // More lines than that: the last one shown ends at a word, with an ellipsis.
  const kept = lines.slice(0, maxLines);
  return [...kept.slice(0, -1).map(cut), `${cut(kept.at(-1)!).replace(/…$/, "")}…`];
}

// ---- The small map's frame and its labels (the reader's panel, narrow places) ----

/** A text's width in px at a size and weight. */
export type Measure = (text: string, px: number, weight: number) => number;

/** About 0.56 em a character in the system sans (0.6 when bold): for tests, and until the fonts load. */
export const estimateWidth: Measure = (text, px, weight) => text.length * px * (weight >= 600 ? 0.6 : 0.56);

export interface MapFrame {
  /** The map's width and height. */
  w: number;
  h: number;
  /** What node and font sizes follow: the height the rings fit. */
  size: number;
  small: boolean;
  large: boolean;
  /** The outer ring's radius. */
  radius: number;
  /** Pictures in the nodes (from PICTURE_MAP_MIN tall, when there are any). */
  pictures: boolean;
  /** The first ring's smallest radius, so it clears the centre's picture and name. */
  inner: number;
}

/**
 * The small map's frame: as wide as its box and at most `maxHeight` tall (as tall as wide without
 * one). The rings fit the height; a wider box gives the names at the sides more room; with the width
 * the limit, no empty bands above and below.
 */
export function mapFrame(width: number, maxHeight: number | undefined, hasImages: boolean): MapFrame {
  const w = Math.max(240, width);
  const size = Math.max(240, Math.min(w, maxHeight ?? w));
  const small = size < 480;
  const large = size >= 640;
  // Room outside the outer ring for names: above and below (a picture and two lines), and at the sides.
  const above = small ? 60 : large ? 85 : 75;
  const beside = small ? 76 : large ? 115 : 105;
  const radius = Math.max(40, Math.min(size / 2 - above, w / 2 - beside));
  const h = Math.max(240, Math.min(size, Math.ceil(2 * (radius + above))));
  const pictures = hasImages && size >= PICTURE_MAP_MIN;
  const inner = pictures ? nodeRadius(size, "root", true) + nodeRadius(size, "node", true) + 44 : 0;
  return { w, h, size, small, large, radius, pictures, inner };
}

/** A label's font size on the small map. */
export function labelFont(root: boolean, frame: Pick<MapFrame, "small" | "large">): number {
  return root ? (frame.small ? 12.5 : frame.large ? 15.5 : 14) : frame.small ? 11.5 : frame.large ? 14 : 13;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A node's label as `mapLabels` placed it. */
export interface MapLabel {
  /** Where the node is drawn: where the layout put it, or moved within its share to make room. */
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  /** From the node: the anchor's x, and the first line's baseline. */
  dx: number;
  dy: number;
  lines: string[];
  fontSize: number;
  lineHeight: number;
  /** The words' box, in map coordinates. */
  box: Box;
}

type LabelSide = "right" | "left" | "above" | "below";

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/** How much of a box lies outside the map (centred on 0,0). */
function outsideArea(b: Box, w: number, h: number): number {
  const area = (b.x1 - b.x0) * (b.y1 - b.y0);
  return area - overlapArea(b, { x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2 });
}

function discBox(x: number, y: number, r: number): Box {
  return { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
}

/**
 * Places every name on the small map so that none sits on another name or on another node, inside
 * the map. Greedy: the centre, the author, the nodes with children (which stay where they are), then
 * the leaves. Each tries its outward side first (`labelPlacement`), then the two sides across, then
 * inward; a leaf that still finds no room moves within its share of the circle, or out a ring. When
 * nothing is clear, the least overlap wins.
 */
export function mapLabels(
  layout: RadialLayout,
  opts: {
    width: number;
    height: number;
    /** A node's radius (its shape's or its picture's). */
    radius: (n: MapNode) => number;
    fontSize: (n: MapNode) => number;
    weight: (n: MapNode) => number;
    /** Most characters on a line. */
    maxChars: (n: MapNode) => number;
    /** A map of pictures: the centre's name above it. */
    centreAbove?: boolean;
    measure?: Measure;
  },
): Map<string, MapLabel> {
  const measure = opts.measure ?? estimateWidth;
  const { width, height } = opts;
  const halfW = width / 2;
  // A node's footprint: a diamond or a triangle reaches a little past its radius.
  const reach = (n: MapNode) => opts.radius(n) * 1.25 + 1.5;
  const at = new Map(layout.nodes.map((n) => [n.entity.id, { x: n.x, y: n.y, r: reach(n), done: false, movable: canMove(n) }]));
  const placed: Box[] = [];
  const out = new Map<string, MapLabel>();

  function canMove(n: MapNode): boolean {
    return n.leaf && n.depth > 0 && n.entity.id !== "author";
  }

  const label = (n: MapNode, p: { x: number; y: number }, side: LabelSide, narrow: boolean): MapLabel => {
    const r = opts.radius(n);
    const fs = opts.fontSize(n);
    const lh = fs + 1;
    const anchor = side === "right" ? "start" : side === "left" ? "end" : "middle";
    const dx = side === "right" ? round(r + 4.5) : side === "left" ? round(-(r + 4.5)) : 0;
    const room =
      anchor === "start" ? halfW - (p.x + dx) : anchor === "end" ? p.x + dx + halfW : 2 * Math.min(halfW - p.x, p.x + halfW);
    const fit = Math.max(5, Math.min(opts.maxChars(n), Math.floor((room - 4) / (fs * 0.56))));
    // Narrow: a line a word (at least 7 characters), for a tight spot.
    const longest = Math.max(...n.entity.name.split(/\s+/).map((w) => w.length));
    const chars = narrow ? Math.min(fit, Math.max(7, longest)) : fit;
    const lines = wrapLabel(n.entity.name, chars, anchor === "middle" ? 2 : 3);
    const tw = Math.max(...lines.map((l) => measure(l, fs, opts.weight(n))));
    const k = lines.length;
    const dy =
      side === "above"
        ? round(-(r + 6.5) - (k - 1) * lh)
        : side === "below"
          ? round(r + fs + 2)
          : round(fs * 0.32 - ((k - 1) * lh) / 2);
    const x0 = anchor === "start" ? p.x + dx : anchor === "end" ? p.x + dx - tw : p.x - tw / 2;
    const box = { x0: x0 - 1, x1: x0 + tw + 1, y0: p.y + dy - fs * 0.8, y1: p.y + dy + (k - 1) * lh + fs * 0.25 };
    return { x: p.x, y: p.y, anchor, dx, dy, lines, fontSize: fs, lineHeight: lh, box };
  };

  const sidesFor = (n: MapNode, p: { x: number; y: number; angle: number }): LabelSide[] => {
    if (n.depth === 0) return opts.centreAbove ? ["above", "below", "right", "left"] : ["below", "above", "right", "left"];
    const place = labelPlacement({ angle: p.angle, depth: 1 });
    const outward: LabelSide = place.anchor === "start" ? "right" : place.anchor === "end" ? "left" : place.dy < 0 ? "above" : "below";
    const across: LabelSide[] = outward === "right" || outward === "left" ? ["above", "below"] : ["right", "left"];
    const inward: LabelSide = { right: "left", left: "right", above: "below", below: "above" }[outward] as LabelSide;
    return [outward, ...across, inward];
  };

  // Where a node may go: where it is; a leaf anywhere well inside its share, or out a ring; a node with
  // children a little to either side (its children's lines still fan out from it).
  const positions = (n: MapNode): { x: number; y: number; angle: number }[] => {
    const here = { x: n.x, y: n.y, angle: n.angle };
    if (n.depth === 0 || n.entity.id === "author" || n.span <= 0) return [here];
    const r = Math.hypot(n.x, n.y);
    const turn = (f: number, radius = r) => {
      const a = n.angle + f * n.span;
      return { x: round(Math.cos(a) * radius), y: round(Math.sin(a) * radius), angle: a };
    };
    if (!canMove(n)) return [here, turn(0.15), turn(-0.15)];
    const out = [here, turn(0.2), turn(-0.2), turn(0.38), turn(-0.38)];
    // Out a ring; on the outer ring, a little way into the margin (its name must still fit the map).
    const gap = layout.rings.length > 1 ? layout.rings[1]! - layout.rings[0]! : r / 2;
    const next = layout.rings[n.ring] ?? r + gap * 0.6;
    out.push(turn(0, next), turn(0.25, next), turn(-0.25, next));
    return out;
  };

  const cost = (n: MapNode, p: { x: number; y: number }, l: MapLabel): number => {
    let c = 4 * outsideArea(l.box, width, height);
    for (const b of placed) c += overlapArea(l.box, b);
    const own = discBox(p.x, p.y, reach(n));
    for (const [id, d] of at) {
      if (id === n.entity.id) continue;
      const disc = discBox(d.x, d.y, d.r);
      // A leaf not placed yet can still move out of the way: its node counts for less.
      c += overlapArea(l.box, disc) * (d.done || !d.movable ? 1 : 0.3);
      c += 4 * overlapArea(own, disc);
    }
    for (const b of placed) c += overlapArea(own, b);
    return c;
  };

  const rank = (n: MapNode) => (n.depth === 0 ? 0 : n.entity.id === "author" ? 1 : !n.leaf ? 2 : 3);
  const order = [...layout.nodes].sort((a, b) => rank(a) - rank(b) || a.ring - b.ring || a.angle - b.angle);
  for (const n of order) {
    let best: { l: MapLabel; c: number } | null = null;
    search: for (const p of positions(n)) {
      for (const side of sidesFor(n, p)) {
        for (const narrow of [false, true]) {
          const l = label(n, p, side, narrow);
          const c = cost(n, p, l);
          if (!best || c < best.c - 0.01) best = { l, c };
          if (c < 0.5) break search;
        }
      }
    }
    out.set(n.entity.id, best!.l);
    placed.push(best!.l.box);
    at.set(n.entity.id, { x: best!.l.x, y: best!.l.y, r: reach(n), done: true, movable: false });
  }
  return out;
}

/**
 * The small map as drawn: its frame, the rings, each node's radius and its label (`mapLabels`). The
 * node positions to draw are the labels' (a leaf may have moved to make room).
 */
export function smallMap(
  b: Pick<ContextBriefing, "entities" | "links" | "focus">,
  width: number,
  maxHeight: number | undefined,
  /** The entities with a picture to draw. */
  pictured: ReadonlySet<string>,
  measure?: Measure,
): { frame: MapFrame; layout: RadialLayout; labels: Map<string, MapLabel>; radius: (n: MapNode) => number } {
  const frame = mapFrame(width, maxHeight, pictured.size > 0);
  const layout = radialLayout(b.entities, usableLinks(b as ContextBriefing), frame.radius, mapRoot(b), frame.inner);
  const radius = (n: MapNode) =>
    nodeRadius(
      frame.size,
      n.depth === 0 ? "root" : n.entity.id === "author" ? "author" : "node",
      frame.pictures && pictured.has(n.entity.id),
    );
  const labels = mapLabels(layout, {
    width: frame.w,
    height: frame.h,
    radius,
    fontSize: (n) => labelFont(n.depth === 0, frame),
    weight: (n) => (n.depth === 0 || n.entity.id === "author" ? 600 : 400),
    maxChars: (n) => (n.depth === 0 ? 20 : frame.small ? 14 : frame.large ? 20 : 18),
    centreAbove: frame.pictures,
    measure,
  });
  return { frame, layout, labels, radius };
}

// ---- The card map (the Assistant page and full screen) ----

/** A card's measurements: padding, the picture, the role's and the name's type. */
export const CARD = {
  padX: 12,
  padY: 10,
  gap: 10,
  picture: 44,
  coverW: 34,
  coverH: 50,
  roleSize: 12,
  roleLine: 16,
  nameSize: 14.5,
  nameLine: 19,
  rootNameSize: 16.5,
  rootNameLine: 22,
  minW: 132,
} as const;

export type CardPicture = "round" | "cover" | null;

/** The widest a card may be on a stage this wide (the centre's 40 px more). */
export function cardMaxWidth(stageWidth: number): number {
  return Math.round(Math.min(260, Math.max(200, stageWidth * 0.19)));
}

/** Splits a text into at most `maxLines` lines no wider than `maxWidth`, with an ellipsis if it runs over. */
export function wrapToWidth(text: string, maxWidth: number, maxLines: number, measure: Measure, px: number, weight: number): string[] {
  const fits = (t: string) => measure(t, px, weight) <= maxWidth;
  const cut = (t: string) => {
    if (fits(t)) return t;
    let s = t;
    while (s.length > 1 && !fits(`${s}…`)) s = s.slice(0, -1).trimEnd();
    return `${s}…`;
  };
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if (fits(`${line} ${w}`)) line += ` ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines.map(cut);
  const kept = lines.slice(0, maxLines);
  const last = kept.at(-1)!;
  return [...kept.slice(0, -1).map(cut), cut(`${last}…`).replace(/……$/, "…")];
}

export interface CardText {
  /** The name's lines (one or two). */
  lines: string[];
  /** The role's lines, its colon after the last ("Geological hero and", "friend:"). */
  role: string[];
  w: number;
  h: number;
}

/** A card's text and size: the role over the name, the picture (if any) on the right. */
export function cardText(
  name: string,
  role: string,
  opts: { picture: CardPicture; root: boolean; maxW: number; measure?: Measure },
): CardText {
  const m = opts.measure ?? estimateWidth;
  const px = opts.root ? CARD.rootNameSize : CARD.nameSize;
  const lineH = opts.root ? CARD.rootNameLine : CARD.nameLine;
  const pic = opts.picture === "round" ? CARD.picture : opts.picture === "cover" ? CARD.coverW : 0;
  const maxW = opts.root ? opts.maxW + 40 : opts.maxW;
  const textMax = maxW - 2 * CARD.padX - (pic ? CARD.gap + pic : 0);
  const roleLines = wrapToWidth(`${role}:`, textMax, 2, m, CARD.roleSize, 500);
  const lines = wrapToWidth(name, textMax, 2, m, px, 600);
  const textW = Math.min(
    textMax,
    Math.max(...roleLines.map((l) => m(l, CARD.roleSize, 500)), ...lines.map((l) => m(l, px, 600))),
  );
  const w = Math.ceil(Math.min(maxW, Math.max(CARD.minW, 2 * CARD.padX + textW + (pic ? CARD.gap + pic : 0))));
  const picH = opts.picture === "round" ? CARD.picture : opts.picture === "cover" ? CARD.coverH : 0;
  const h = Math.ceil(2 * CARD.padY + Math.max(roleLines.length * CARD.roleLine + 2 + lines.length * lineH, picH));
  return { lines, role: roleLines, w, h };
}

export interface CardNode extends MapNode {
  w: number;
  h: number;
}

export interface CardLayout {
  /** Centred on 0,0, like the small map. */
  nodes: CardNode[];
  edges: MapEdge[];
  width: number;
  /** The height used: the stage's, or more when the cards needed it. */
  height: number;
}

/**
 * The card map: the radial tree on ovals that fill the stage, the centre's card fixed in the middle,
 * the first ring just clear of it, the last reaching the edges. Cards that still overlap are pushed
 * apart along their smaller overlap, a few hundred rounds at most, kept inside the stage; if they
 * don't fit, the stage grows taller and it starts again. Then it all spreads out from the centre to
 * fill the stage (at most 1.7 times). The same every time.
 */
export function cardLayout(
  tree: RadialTree,
  sizes: Map<string, { w: number; h: number }>,
  width: number,
  height: number,
  gap = { x: 18, y: 14 },
): CardLayout {
  const size = (id: string) => sizes.get(id) ?? { w: CARD.minW, h: 64 };
  const others = tree.nodes.filter((n) => n.ring > 0);
  const maxW = Math.max(CARD.minW, ...others.map((n) => size(n.entity.id).w));
  const maxH = Math.max(40, ...others.map((n) => size(n.entity.id).h));
  const root = size(tree.root);
  const margin = 6;
  let h = height;
  let pos: { x: number; y: number; w: number; h: number; fixed: boolean }[] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const rx1 = root.w / 2 + maxW / 2 + gap.x;
    const ry1 = root.h / 2 + maxH / 2 + gap.y;
    const rxN = Math.max(rx1, width / 2 - maxW / 2 - margin);
    const ryN = Math.max(ry1, h / 2 - maxH / 2 - margin);
    const n = Math.max(1, tree.rings);
    const ringAt = (k: number) => (n === 1 ? 1 : (k - 1) / (n - 1));
    pos = tree.nodes.map((node) => {
      const s = size(node.entity.id);
      if (node.ring === 0) return { x: 0, y: 0, w: s.w, h: s.h, fixed: true };
      const t = ringAt(node.ring);
      const rx = rx1 + (rxN - rx1) * t;
      const ry = ry1 + (ryN - ry1) * t;
      return { x: Math.cos(node.angle) * rx, y: Math.sin(node.angle) * ry, w: s.w, h: s.h, fixed: false };
    });
    if (separate(pos, width, h, gap, margin)) break;
    h = Math.round(h * 1.12);
  }
  // Spread out from the centre to fill the stage (a tree with few deep nodes leaves bands empty).
  // Spreading only moves cards apart, so none comes to overlap.
  const stretch = (half: number, at: (p: (typeof pos)[number]) => number, ext: (p: (typeof pos)[number]) => number) => {
    let k = MAX_STRETCH;
    for (const p of pos) if (!p.fixed && Math.abs(at(p)) > 1) k = Math.min(k, (half - margin - ext(p)) / Math.abs(at(p)));
    return Math.max(1, k);
  };
  const sx = stretch(width / 2, (p) => p.x, (p) => p.w / 2);
  const sy = stretch(h / 2, (p) => p.y, (p) => p.h / 2);
  for (const p of pos) {
    p.x *= sx;
    p.y *= sy;
  }
  const nodes = tree.nodes.map((node, i) => ({ ...node, x: round(pos[i]!.x), y: round(pos[i]!.y), w: pos[i]!.w, h: pos[i]!.h }));
  return { nodes, edges: tree.edges, width, height: h };
}

/** The most the card map spreads out from its centre to fill the stage. */
const MAX_STRETCH = 1.7;

/** Pushes overlapping cards apart, inside a stage; true when none overlap. */
function separate(
  pos: { x: number; y: number; w: number; h: number; fixed: boolean }[],
  width: number,
  height: number,
  gap: { x: number; y: number },
  margin: number,
): boolean {
  const clamp = (p: (typeof pos)[number]) => {
    if (p.fixed) return;
    const xMax = Math.max(0, width / 2 - p.w / 2 - margin);
    const yMax = Math.max(0, height / 2 - p.h / 2 - margin);
    p.x = Math.min(xMax, Math.max(-xMax, p.x));
    p.y = Math.min(yMax, Math.max(-yMax, p.y));
  };
  for (let round = 0; round < 400; round++) {
    let overlapping = false;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const a = pos[i]!;
        const b = pos[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const ox = (a.w + b.w) / 2 + gap.x - Math.abs(dx);
        const oy = (a.h + b.h) / 2 + gap.y - Math.abs(dy);
        if (ox <= 0.5 || oy <= 0.5) continue;
        overlapping = true;
        const [sa, sb] = a.fixed ? [0, 1] : b.fixed ? [1, 0] : [0.5, 0.5];
        // Along the smaller overlap; a tie in place goes by the order, so it's the same every time.
        if (ox / (a.w + b.w) < oy / (a.h + b.h)) {
          const sx = dx > 0 || (dx === 0 && j % 2 === 0) ? 1 : -1;
          a.x -= sx * ox * sa;
          b.x += sx * ox * sb;
        } else {
          const sy = dy > 0 || (dy === 0 && b.y >= 0) ? 1 : -1;
          a.y -= sy * oy * sa;
          b.y += sy * oy * sb;
        }
      }
    }
    for (const p of pos) clamp(p);
    if (!overlapping) return true;
  }
  return false;
}

export interface CardBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A line between two cards that goes round the others: straight when it can, else the gentlest curve
 * that keeps it off every other card. The curves pass through a point beside the line's middle (to
 * either side, further and further out) or just off a corner of a card in the way, as a quadratic or
 * a flatter cubic; the first clear one, by how far it strays, wins. A cross link always bends a
 * little, away from the centre first, so it reads apart from the tree's lines. `mid` is the line's
 * middle; `along`, points on it from the middle outward, for its relation's place.
 */
export function routeEdge(
  a: CardBox,
  b: CardBox,
  others: CardBox[],
  cross = false,
): { d: string; mid: { x: number; y: number }; along: { x: number; y: number }[] } {
  type Pt = { x: number; y: number };
  const along = (at: (t: number) => Pt) =>
    [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82].map((t) => {
      const p = at(t);
      return { x: round(p.x), y: round(p.y) };
    });
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  // The side away from the centre.
  const out = n.x * mid.x + n.y * mid.y >= 0 ? 1 : -1;
  const inside = (p: Pt, c: CardBox, pad: number) => Math.abs(p.x - c.x) < c.w / 2 + pad && Math.abs(p.y - c.y) < c.h / 2 + pad;
  const clear = (at: (t: number) => Pt) => {
    for (let i = 1; i < 48; i++) {
      const p = at(i / 48);
      if (inside(p, a, 0) || inside(p, b, 0)) continue;
      if (others.some((o) => inside(p, o, 6))) return false;
    }
    return true;
  };
  const line = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const straight = {
    d: `M${round(a.x)} ${round(a.y)}L${round(b.x)} ${round(b.y)}`,
    mid: { x: round(mid.x), y: round(mid.y) },
    along: along(line),
  };
  if (!cross && clear(line)) return straight;

  // Points for the curve's middle: beside the line's middle, and off the corners of the cards it crosses.
  const waypoints: Pt[] = [];
  for (const k of [30, 60, 90, 130, 180, 240, 310]) for (const s of [out, -out]) waypoints.push({ x: mid.x + n.x * k * s, y: mid.y + n.y * k * s });
  for (const o of others) {
    let crosses = false;
    for (let i = 1; i < 48 && !crosses; i++) crosses = inside(line(i / 48), o, 6);
    if (!crosses) continue;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) waypoints.push({ x: o.x + sx * (o.w / 2 + 16), y: o.y + sy * (o.h / 2 + 16) });
  }
  const stray = (w: Pt) => Math.hypot(w.x - mid.x, w.y - mid.y);
  waypoints.sort((p, q) => stray(p) - stray(q));

  for (const w of waypoints) {
    // A quadratic through w at its middle: its control point is 2w less the chord's middle.
    const q = { x: 2 * w.x - mid.x, y: 2 * w.y - mid.y };
    const quad = (t: number) => ({
      x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * q.x + t * t * b.x,
      y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * q.y + t * t * b.y,
    });
    if (clear(quad))
      return {
        d: `M${round(a.x)} ${round(a.y)}Q${round(q.x)} ${round(q.y)} ${round(b.x)} ${round(b.y)}`,
        mid: { x: round(w.x), y: round(w.y) },
        along: along(quad),
      };
    // A flatter cubic through w: both control points shifted by 4/3 of w's offset.
    const off = { x: ((w.x - mid.x) * 4) / 3, y: ((w.y - mid.y) * 4) / 3 };
    const c1 = { x: a.x + (b.x - a.x) / 3 + off.x, y: a.y + (b.y - a.y) / 3 + off.y };
    const c2 = { x: a.x + (2 * (b.x - a.x)) / 3 + off.x, y: a.y + (2 * (b.y - a.y)) / 3 + off.y };
    const cubic = (t: number) => ({
      x: (1 - t) ** 3 * a.x + 3 * (1 - t) ** 2 * t * c1.x + 3 * (1 - t) * t * t * c2.x + t ** 3 * b.x,
      y: (1 - t) ** 3 * a.y + 3 * (1 - t) ** 2 * t * c1.y + 3 * (1 - t) * t * t * c2.y + t ** 3 * b.y,
    });
    if (clear(cubic))
      return {
        d: `M${round(a.x)} ${round(a.y)}C${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(b.x)} ${round(b.y)}`,
        mid: { x: round(w.x), y: round(w.y) },
        along: along(cubic),
      };
  }
  // Nothing clears: straight, or a cross link's first bend.
  if (!cross) return straight;
  const w = waypoints[0]!;
  const q = { x: 2 * w.x - mid.x, y: 2 * w.y - mid.y };
  return {
    d: `M${round(a.x)} ${round(a.y)}Q${round(q.x)} ${round(q.y)} ${round(b.x)} ${round(b.y)}`,
    mid: { x: round(w.x), y: round(w.y) },
    along: along((t) => ({
      x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * q.x + t * t * b.x,
      y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * q.y + t * t * b.y,
    })),
  };
}

/**
 * Where a line's relation goes: the first of its points (from the middle out) where the words, `w`
 * wide, sit clear of every card; null when there's no such place (the details list it anyway).
 */
export function relationSpot(along: { x: number; y: number }[], w: number, cards: CardBox[]): { x: number; y: number } | null {
  const h = 16;
  return (
    along.find((p) => cards.every((c) => Math.abs(p.x - c.x) >= (w + c.w) / 2 + 2 || Math.abs(p.y - c.y) >= (h + c.h) / 2 + 2)) ??
    null
  );
}

/** The part of the line between two cards' centres that shows between them; null when they touch. */
export function visibleSegment(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): { x1: number; y1: number; x2: number; y2: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const exit = (c: { w: number; h: number }) =>
    Math.min(dx ? c.w / 2 / Math.abs(dx) : Infinity, dy ? c.h / 2 / Math.abs(dy) : Infinity);
  const t0 = exit(a);
  const t1 = 1 - exit(b);
  if (!(t0 < t1)) return null;
  return { x1: round(a.x + dx * t0), y1: round(a.y + dy * t0), x2: round(a.x + dx * t1), y2: round(a.y + dy * t1) };
}

// ---- Pictures and Wikipedia intros (Phase 5) ----

/** The briefing's Wikidata items, sorted and at most 40: what to ask the media route for. */
export function mediaIds(b: Pick<ContextBriefing, "entities">): string[] {
  const ids = b.entities.map((e) => e.wikidata).filter((q): q is string => typeof q === "string" && /^Q\d{1,11}$/.test(q));
  return [...new Set(ids)].sort().slice(0, 40);
}

/** A node's picture: Wikimedia's (with its credit), or for the book its own cover from the library (none). */
export interface NodeImage {
  url: string;
  width: number;
  height: number;
  credit: ContextMediaImage["credit"] | null;
}

/** Each entity's picture, by entity id. The book takes the library's cover first: it is this copy's. */
export function nodeImages(
  b: Pick<ContextBriefing, "entities">,
  media: Record<string, ContextMedia> | undefined,
  coverUrl?: string | null,
): Map<string, NodeImage> {
  const out = new Map<string, NodeImage>();
  for (const e of b.entities) {
    const img = e.wikidata ? media?.[e.wikidata]?.image : null;
    if (e.id === "book" && coverUrl) out.set(e.id, { url: coverUrl, width: 2, height: 3, credit: null });
    else if (img && img.url.startsWith("/api/assets/")) out.set(e.id, img);
  }
  return out;
}

/** An entity's Wikipedia intro, if Wikimedia had one. */
export function mediaSummary(e: Pick<ContextEntity, "wikidata">, media: Record<string, ContextMedia> | undefined) {
  return (e.wikidata && media?.[e.wikidata]?.summary) || null;
}

/** Below this height a map keeps its plain shapes: pictures would crowd the names (the card still shows them). */
export const PICTURE_MAP_MIN = 420;

/**
 * A node's radius on a map `size` tall. Plain shapes stay small (9 the centre, 7 the author, 5.5 the
 * rest); a picture needs room: 14 (18 the centre) up to 480 px, 24 (32) at 720 px, and at most 30 (40)
 * from 1000 px.
 */
export function nodeRadius(size: number, kind: "root" | "author" | "node", picture: boolean): number {
  if (!picture) return kind === "root" ? 9 : kind === "author" ? 7 : 5.5;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const t = clamp((size - 480) / 240);
  const more = clamp((size - 720) / 280);
  const r = kind === "root" ? 18 + 14 * t + 8 * more : 14 + 10 * t + 6 * more;
  return Math.round(r * 2) / 2;
}

/** "Henry Maull · Public domain", the picture's credit; "Wikimedia Commons" when it names neither. */
export function creditLine(credit: ContextMediaImage["credit"]): string {
  return [credit.artist, credit.license].filter(Boolean).join(" · ") || "Wikimedia Commons";
}

// ---- The timeline ----

export interface TimelineRow {
  entity: ContextEntity;
  start: number;
  end: number | null;
}

export function timelineRows(b: ContextBriefing): TimelineRow[] {
  return datedEntities(b)
    .map((entity) => ({ entity, start: parseYear(entity.facts?.start)!, end: parseYear(entity.facts?.end) }))
    .map((r) => (r.end !== null && r.end < r.start ? { ...r, end: null } : r))
    .sort((a, b) => a.start - b.start || (a.end ?? a.start) - (b.end ?? b.start) || a.entity.name.localeCompare(b.entity.name));
}

export interface TimelineScale {
  min: number;
  max: number;
  ticks: number[];
}

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];

/** A domain padded to round years, with four to six ticks. */
export function timelineScale(rows: TimelineRow[], maxTicks = 6): TimelineScale {
  const years = rows.flatMap((r) => (r.end === null ? [r.start] : [r.start, r.end]));
  let lo = Math.min(...years);
  let hi = Math.max(...years);
  if (!Number.isFinite(lo)) return { min: 0, max: 1, ticks: [] };
  if (hi - lo < 4) {
    lo -= 2;
    hi += 2;
  }
  const step = STEPS.find((s) => Math.ceil(hi / s) - Math.floor(lo / s) <= maxTicks) ?? 5000;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let y = min; y <= max; y += step) ticks.push(y);
  return { min, max, ticks };
}

/** 0–1 along the scale. */
export function scaleAt(scale: TimelineScale, year: number): number {
  return scale.max === scale.min ? 0 : (year - scale.min) / (scale.max - scale.min);
}

// ---- The places map (equirectangular, scaled by the cosine of the middle latitude) ----

/** The smallest area shown, in degrees of latitude: two villages still show their region. */
export const MIN_PLACE_SPAN = 4;

export interface PlacesView {
  minLon: number;
  maxLat: number;
  lonSpan: number;
  latSpan: number;
}

/** A view around the points, padded, at least MIN_PLACE_SPAN high, matching the box's aspect (width / height). */
export function placesView(points: { lat: number; lon: number }[], aspect: number): PlacesView {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const midLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const k = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  let latSpan = Math.max((Math.max(...lats) - Math.min(...lats)) * 1.5, MIN_PLACE_SPAN);
  let wide = Math.max((Math.max(...lons) - Math.min(...lons)) * k * 1.5, MIN_PLACE_SPAN);
  if (wide / latSpan > aspect) latSpan = wide / aspect;
  else wide = latSpan * aspect;
  latSpan = Math.min(latSpan, 170);
  const lonSpan = Math.min(wide / k, 360);
  const maxLat = Math.min(90, midLat + latSpan / 2);
  return { minLon: midLon - lonSpan / 2, maxLat, lonSpan, latSpan };
}

export function projectPoint(
  view: PlacesView,
  width: number,
  height: number,
  lat: number,
  lon: number,
): { x: number; y: number } {
  return { x: round(((lon - view.minLon) / view.lonSpan) * width), y: round(((view.maxLat - lat) / view.latSpan) * height) };
}

export interface PlaceLabel {
  side: "right" | "left";
  /** Baseline offset from the point. */
  dy: number;
}

/**
 * Labels that don't sit on each other. A label goes on the side away from its nearest neighbour (so
 * two close villages read "Steventon ● ● Chawton"), else to the right unless near the right edge; it
 * flips, or moves down a line, when a label already there would overlap.
 */
export function placeLabels(
  points: { x: number; y: number; lines: number }[],
  width: number,
  line = 14,
  labelWidth = 110,
): PlaceLabel[] {
  const out: PlaceLabel[] = points.map(() => ({ side: "right", dy: 4 }));
  const taken: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const box = (i: number, side: "right" | "left", dy: number) => {
    const p = points[i]!;
    const x0 = side === "right" ? p.x + 8 : p.x - 8 - labelWidth;
    return { x0, x1: x0 + labelWidth, y0: p.y + dy - line + 3, y1: p.y + dy + (p.lines - 1) * line + 3 };
  };
  const hits = (b: { x0: number; x1: number; y0: number; y1: number }) =>
    taken.some((t) => b.x0 < t.x1 && t.x0 < b.x1 && b.y0 < t.y1 && t.y0 < b.y1);
  const order = points.map((_, i) => i).sort((a, b) => points[a]!.y - points[b]!.y || points[a]!.x - points[b]!.x);
  for (const i of order) {
    const p = points[i]!;
    let near: { x: number; d: number } | null = null;
    for (const q of points) {
      if (q === p || Math.abs(q.x - p.x) > labelWidth || Math.abs(q.y - p.y) > line * 2) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (!near || d < near.d) near = { x: q.x, d };
    }
    const preferred: "right" | "left" =
      near && near.x !== p.x ? (near.x > p.x ? "left" : "right") : p.x < width * 0.62 ? "right" : "left";
    const other = preferred === "right" ? "left" : "right";
    let choice: PlaceLabel | null = null;
    for (let shift = 0; shift <= 4 && !choice; shift++) {
      for (const side of [preferred, other] as const) {
        const dy = 4 + shift * line;
        if (!hits(box(i, side, dy))) {
          choice = { side, dy };
          break;
        }
      }
    }
    out[i] = choice ?? { side: preferred, dy: 4 };
    taken.push(box(i, out[i]!.side, out[i]!.dy));
  }
  return out;
}

/** Whether a view shows an entity: the map all of them, the timeline the dated ones, the places map the placed ones. */
export function viewShows(b: ContextBriefing, view: ContextView, id: string): boolean {
  if (view === "timeline") return datedEntities(b).some((e) => e.id === id);
  if (view === "places") return placePoints(b).some((p) => p.entity.id === id);
  return b.entities.some((e) => e.id === id);
}

/** The SVG transform that puts the outline (hundredths of a degree, y = −latitude) into the view. */
export function outlineTransform(view: PlacesView, width: number, height: number): string {
  const sx = width / view.lonSpan;
  const sy = height / view.latSpan;
  return `matrix(${sx / 100} 0 0 ${sy / 100} ${-view.minLon * sx} ${view.maxLat * sy})`;
}

// ---- Citations ----

export function recordHref(r: ContextRecord | null | undefined): string | null {
  if (!r) return null;
  const v = r.value.trim();
  switch (r.kind) {
    case "isbn":
      return `https://openlibrary.org/isbn/${encodeURIComponent(v.replace(/[^0-9Xx]/g, ""))}`;
    case "olid": {
      const id = v.replace(/^https?:\/\/openlibrary\.org/, "").replace(/^\/(works|books|authors)\//, "");
      const path = /W$/.test(id) ? "works" : /A$/.test(id) ? "authors" : "books";
      return `https://openlibrary.org/${path}/${encodeURIComponent(id)}`;
    }
    case "doi":
      return `https://doi.org/${v.replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}`;
    case "wikidata":
      return `https://www.wikidata.org/wiki/${encodeURIComponent(v)}`;
    case "url":
      return safeHref(v);
  }
}

/** Only http(s) links leave the panel. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export interface CitationView {
  title: string;
  /** "Darwin Correspondence Project · 2009" */
  meta: string | null;
  href: string | null;
  /** A `book` citation: the part of the book it quotes ("Introduction"). */
  fromBook: boolean;
}

export function citationView(c: ContextCitation): CitationView {
  const meta = [c.author, c.year].filter((x): x is string => Boolean(x && x.trim())).join(" · ") || null;
  if (c.kind === "book") return { title: c.title, meta: null, href: null, fromBook: true };
  return { title: c.title, meta, href: safeHref(c.url) ?? recordHref(c.record), fromBook: false };
}

/** The same page cited twice for one claim shows once. */
export function distinctCitations(cs: ContextCitation[]): ContextCitation[] {
  const seen = new Set<string>();
  return cs.filter((c) => {
    const key = `${c.kind}|${c.url ?? ""}|${c.title}|${c.record?.value ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---- Runs, cost, dates ----

export const STAGE_TEXT: Record<ContextRun["stage"], string> = {
  queued: "Waiting for a free slot…",
  reading: "Reading the book's front matter…",
  researching: "Researching sources…",
  checking: "Checking every source…",
  done: "Done.",
  failed: "Stopped.",
};

/** "$0.23", "less than a cent", or null when there is no cost to show (agent-made briefings record $0). */
export function costLabel(usd: number | undefined | null): string | null {
  if (!usd || !Number.isFinite(usd) || usd <= 0) return null;
  if (usd < 0.01) return "less than a cent";
  return `$${usd.toFixed(2)}`;
}

/** "Generated 5 November 2026". */
export function generatedLabel(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Generated";
  return `Generated ${d.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}`;
}

export const LEVEL_LABELS = { general: "General", student: "Student", scholar: "Scholar" } as const;

/** What a briefing usually costs (prompts/book-context.md, Decision 6 and Phase 3). */
export const BOOK_COST = "$0.20–0.70";
export const FOCUS_COST = "$0.10–0.30";

/** "one run", "10 runs". */
function runsCount(n: number): string {
  return n === 1 ? "one run" : `${n} runs`;
}

/** On a phone, its paid runs left today; null on the computer, which has no limit. */
export function phoneRunsLine(phone: ContextPhoneRuns | null | undefined): string | null {
  if (!phone) return null;
  if (phone.limit <= 0) return "New briefings are made on the computer; this phone can open them.";
  return phone.left <= 0
    ? `This phone has used its ${runsCount(phone.limit)} for today; the computer can make one any time.`
    : `This phone can start ${phone.left} more today.`;
}

/** The Refresh dialog's line on a phone: "This phone has 7 of its 10 runs a day left." */
export function phoneRefreshLine(phone: ContextPhoneRuns): string {
  if (phone.limit <= 0) return "New briefings are made on the computer; this phone can open them.";
  if (phone.left <= 0) return `This phone has used its ${runsCount(phone.limit)} for today. The computer can make one any time.`;
  if (phone.limit === 1) return "This phone can still start its one run for today.";
  return `This phone has ${phone.left} of its ${phone.limit} runs a day left.`;
}

// ---- A run as it goes (Phase 4) ----

/** "darwin-online.org.uk" ("www." dropped); the text as given when it isn't a URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const SOURCE_NAMES = { openLibrary: "Open Library", wikidata: "Wikidata", crossref: "Crossref" } as const;

/** A step as one line: "Searched “Malthus Darwin 1838”", "Read plato.stanford.edu", "Looked up “Cecilia” in Open Library". */
export function stepText(step: ContextRunStep): string {
  switch (step.kind) {
    case "search":
      return step.ok ? `Searched “${step.query}”` : `A search for “${step.query}” failed`;
    case "read":
      return step.ok ? `Read ${hostOf(step.url)}` : `Couldn't read ${hostOf(step.url)}`;
    case "lookup":
      return step.ok
        ? `Looked up “${step.query}” in ${SOURCE_NAMES[step.source] ?? step.source}`
        : `Couldn't look up “${step.query}” in ${SOURCE_NAMES[step.source] ?? step.source}`;
  }
}

/** "3 searches · 5 pages read · 4 lookups", leaving out what there's none of; null for no steps. */
export function stepCounts(steps: ContextRunStep[] | undefined): string | null {
  if (!steps?.length) return null;
  const n = (kind: ContextRunStep["kind"]) => steps.filter((s) => s.kind === kind).length;
  const parts = [
    [n("search"), "search", "searches"],
    [n("read"), "page read", "pages read"],
    [n("lookup"), "catalogue lookup", "catalogue lookups"],
  ] as const;
  return parts
    .filter(([count]) => count > 0)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`)
    .join(" · ");
}

/** "0:42", "1:05", "12:30". */
export function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "Checking 31 sources behind 22 claims…" */
export function checkingText(c: { sources: number; claims: number }): string {
  const sources = c.sources === 1 ? "1 source" : `${c.sources} sources`;
  const claims = c.claims === 1 ? "1 claim" : `${c.claims} claims`;
  return `Checking ${sources} behind ${claims}…`;
}

/** The progress line: what the checker has before it once it has it, else the stage. */
export function runLine(run: Pick<ContextRun, "stage" | "checking"> | undefined): string {
  if (run?.stage === "checking" && run.checking) return checkingText(run.checking);
  return STAGE_TEXT[run?.stage ?? "queued"];
}

// ---- The Assistant page: briefings by book (Phase 4) ----

export interface BookBriefings {
  docId: string;
  /** Levels with a whole-book briefing, in General, Student, Scholar order. */
  levels: ContextLevel[];
  /** "Context for this" briefings: each focus once, newest first, with its levels. */
  focuses: { focus: string; levels: ContextLevel[] }[];
  /** The newest briefing's date, for the order. */
  latest: string;
}

const LEVEL_ORDER: ContextLevel[] = ["general", "student", "scholar"];

/** The server's list (newest first) grouped by book, the book with the newest briefing first. */
export function groupBriefings(entries: ContextBriefingEntry[]): BookBriefings[] {
  const books = new Map<string, BookBriefings>();
  for (const e of entries) {
    let b = books.get(e.docId);
    if (!b) {
      b = { docId: e.docId, levels: [], focuses: [], latest: e.generatedAt };
      books.set(e.docId, b);
    }
    if (e.generatedAt > b.latest) b.latest = e.generatedAt;
    if (e.focus === null) {
      if (!b.levels.includes(e.level)) b.levels.push(e.level);
      continue;
    }
    const key = focusKey(e.focus);
    const f = b.focuses.find((x) => focusKey(x.focus) === key);
    if (f) {
      if (!f.levels.includes(e.level)) f.levels.push(e.level);
    } else b.focuses.push({ focus: e.focus, levels: [e.level] });
  }
  const byLevel = (a: ContextLevel, b: ContextLevel) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b);
  return [...books.values()]
    .map((b) => ({
      ...b,
      levels: b.levels.sort(byLevel),
      focuses: b.focuses.map((f) => ({ ...f, levels: f.levels.sort(byLevel) })),
    }))
    .sort((a, b) => (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0));
}

// ---- "Context for this": a name or work selected in the book ----

/** Longer selections are refused, as the server does (server/src/briefing/focus.rs). */
export const FOCUS_MAX_CHARS = 120;
export const FOCUS_REFUSED = "Select a name or a title";

export interface FocusText {
  /** As shown and sent: "Malthus". */
  text: string;
  /** The cache key: "malthus". */
  key: string;
}

/** Quotes and punctuation that may cling to a selection's ends. */
const CLINGING = new Set([..."\"'“”‘’«»„‚`.,;:!?…—–-*_"]);

function trimClinging(s: string): string {
  const cs = [...s];
  let a = 0;
  let b = cs.length;
  while (a < b && CLINGING.has(cs[a]!)) a++;
  while (b > a && CLINGING.has(cs[b - 1]!)) b--;
  return cs.slice(a, b).join("").trim();
}

function stripUnbalanced(input: string): string {
  let s = input;
  for (;;) {
    const before = s;
    s = trimClinging(s);
    for (const [open, close] of [
      ["(", ")"],
      ["[", "]"],
    ] as const) {
      if (s.startsWith(open) && !s.includes(close)) s = s.slice(1).trim();
      if (s.endsWith(close) && !s.includes(open)) s = s.slice(0, -1).trim();
      if (s.startsWith(open) && s.endsWith(close) && s.split(open).length === 2) s = s.slice(1, -1).trim();
    }
    if (s === before) return s;
  }
}

/** The cache key for a focus as shown: lower case, curly apostrophes straightened. */
export function focusKey(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'");
}

/**
 * Cleans a selection the way the server does before it becomes a focus: spaces collapsed, clinging
 * quotes and punctuation and unbalanced brackets dropped, a possessive ’s removed ("“Malthus’s”" →
 * "Malthus"). Null when it can't be a name or a title: empty, over 120 characters, or no letter.
 */
export function normalizeFocus(raw: string): FocusText | null {
  const collapsed = raw.split(/\s+/).filter(Boolean).join(" ");
  if (!collapsed || [...collapsed].length > FOCUS_MAX_CHARS) return null;
  let text = stripUnbalanced(collapsed);
  // A possessive leaves at least three letters ("Ross's" → "Ross"; "It's" stays).
  if ([...text].length >= 5 && /['’][sS]$/.test(text)) text = stripUnbalanced(text.slice(0, -2));
  if (!/\p{L}/u.test(text)) return null;
  return { text, key: focusKey(text) };
}

/** Words that never name anything on their own. */
const STOPWORDS = new Set(
  (
    "the and but for nor not yet with from into onto upon this that these those his her hers its their them they she him " +
    "you your our who whom whose which what when where why how was were are has had have been being all any some one " +
    "very such than then there here shall will would could should may might must said says also only even more most " +
    "much many other into over under after before about"
  ).split(" "),
);

const HONORIFIC = /^(mr|mrs|miss|ms|dr|sir|lady|lord|st|saint) /;

/** For comparing names: no accents, case or punctuation, no leading article or title. */
function matchForm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(the|a|an) /, "")
    .replace(HONORIFIC, "");
}

const BRACKETED = /\([^)]*\)|\[[^\]]*\]/g;

/** How well an entity's name answers a selection: 3 the name, 2 without its brackets or the bracketed part, 1 a surname. */
function nameScore(e: ContextEntity, s: string): number {
  if (matchForm(e.name) === s) return 3;
  const bare = matchForm(e.name.replace(BRACKETED, " "));
  if (bare === s) return 2;
  if ([...e.name.matchAll(/\(([^)]*)\)/g)].some((m) => matchForm(m[1]!) === s)) return 2;
  // "Malthus" or "Robert Malthus" for "Thomas Robert Malthus": people only ("selection" isn't "Natural selection").
  if (e.kind === "person") {
    const words = bare.split(" ");
    const want = s.split(" ");
    if (want.length < words.length && words.slice(-want.length).join(" ") === s) return 1;
  }
  return 0;
}

/**
 * An item heading that is the selection, or names it as a capitalised word: past the first word ("…, then
 * Wallace"), or the first when another capitalised name follows ("Whewell and Bacon"), since a heading's
 * first word is capitalised anyway ("Species were thought…").
 */
function headingMatches(heading: string, s: string): boolean {
  if (matchForm(heading) === s || matchForm(heading.replace(BRACKETED, " ")) === s) return true;
  if ([...heading.matchAll(/\(([^)]*)\)/g)].some((m) => matchForm(m[1]!) === s)) return true;
  const tokens = heading
    .split(/[^\p{L}\p{N}'’]+/u)
    .map((t) => t.replace(/['’]s$/i, ""))
    .filter(Boolean);
  const forms = tokens.map((t) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, ""));
  const want = s.split(" ");
  const capital = (t: string | undefined) => Boolean(t && /^\p{Lu}/u.test(t));
  const namesLater = tokens.slice(want.length).some(capital);
  for (let i = namesLater ? 0 : 1; i + want.length <= forms.length; i++) {
    if (forms.slice(i, i + want.length).join(" ") === s && capital(tokens[i])) return true;
  }
  return false;
}

export interface BriefingMatch {
  /** The map node the selection names, if any. */
  entity?: ContextEntity;
  /** What the briefing says about it, in display order. */
  items: ItemRef[];
}

/**
 * Whether a whole-book briefing already covers a selected name or term: a map node by its name, a
 * surname ("Malthus" for "Thomas Robert Malthus"), the name without its brackets ("Entail" for
 * "Entail (fee tail)"), or an item's heading. Null for nothing found, and for one or two letters or
 * words that name nothing ("the").
 */
export function findInBriefing(b: ContextBriefing, text: string): BriefingMatch | null {
  const focus = normalizeFocus(text);
  if (!focus) return null;
  const s = matchForm(focus.text);
  if ((s.match(/\p{L}/gu) ?? []).length < 3) return null;
  if (s.split(" ").every((w) => STOPWORDS.has(w))) return null;
  const found = matchIn(b, s);
  if (found || s.includes(" ") || s.length < 6) return found;
  // One word, inflected: "entailed" for "Entail", "Bennets" for "Bennet".
  for (const stem of [s.replace(/(ed|es|ing)$/, ""), s.replace(/s$/, "")]) {
    if (stem !== s && stem.length >= 4 && !STOPWORDS.has(stem)) {
      const m = matchIn(b, stem);
      if (m) return m;
    }
  }
  return null;
}

function matchIn(b: ContextBriefing, s: string): BriefingMatch | null {
  let entity: ContextEntity | undefined;
  let best = 0;
  for (const e of b.entities) {
    const score = nameScore(e, s);
    // Ties go to the author (selecting "Darwin" in the Origin), then to the first named.
    if (score > best || (score === best && score > 0 && e.id === "author")) {
      best = score;
      entity = e;
    }
  }
  const seen = new Set<string>();
  const items: ItemRef[] = [];
  for (const ref of orderedSections(b).flatMap((sec) => sec.items.map((item, index) => ({ kind: sec.kind, index, item })))) {
    const about = entity && ref.item.entity === entity.id;
    if (!about && !headingMatches(ref.item.heading, s)) continue;
    const key = `${ref.kind}:${ref.index}`;
    if (!seen.has(key)) {
      seen.add(key);
      items.push(ref);
    }
  }
  if (!entity && items.length === 0) return null;
  return entity ? { entity, items } : { items };
}

export interface MatchClaim {
  claim: ContextClaim;
  /** The map link it backs, when it came from one ("Charles Darwin received an essay from Alfred Russel Wallace"). */
  link?: ContextLink;
  /** It sits in an item marked as a spoiler. */
  spoiler: boolean;
}

/**
 * The one claim the card shows for a match: the first about the item that names the selection, else
 * the node's first sourced link, else the first claim of the first item. An item's first claim is
 * often about something else ("Twenty years of delay, then Wallace" opens on the 1844 sketch).
 */
export function matchClaim(b: ContextBriefing, m: BriefingMatch, text: string): MatchClaim | null {
  const s = matchForm(normalizeFocus(text)?.text ?? text);
  const names = (t: string) => ` ${matchForm(t)} `.includes(` ${s} `) || (m.entity ? nameIn(m.entity.name, t) : false);
  for (const r of m.items) {
    const c = r.item.claims.find((c) => names(c.text));
    if (c) return { claim: c, spoiler: r.item.spoiler };
  }
  const link = m.entity ? linksOf(b, m.entity.id)[0] : undefined;
  if (link) return { claim: link.claim, link, spoiler: false };
  const first = m.items.find((r) => r.item.claims.length > 0);
  return first ? { claim: first.item.claims[0]!, spoiler: first.item.spoiler } : null;
}

/** Whether a sentence names an entity: its full name or, for a person, the surname. */
function nameIn(name: string, sentence: string): boolean {
  const t = ` ${matchForm(sentence)} `;
  const bare = matchForm(name.replace(BRACKETED, " "));
  if (t.includes(` ${bare} `)) return true;
  const last = bare.split(" ").pop();
  return Boolean(last && last.length >= 4 && t.includes(` ${last} `));
}
