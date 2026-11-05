import type {
  ContextBriefing,
  ContextCitation,
  ContextClaim,
  ContextEntity,
  ContextEntityKind,
  ContextItem,
  ContextLink,
  ContextPhoneRuns,
  ContextRecord,
  ContextRun,
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
  /** Radians, 0 pointing right, growing clockwise (SVG's y runs down). */
  angle: number;
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

/**
 * Lays the map out as rings around the book: what links to the book directly on the first ring, and
 * so on outward (a breadth-first tree over the links, either direction). The author always hangs
 * from the book, first, and sits at the top. Each leaf gets an equal share of the circle and a parent
 * sits in the middle of its children's share, so the drawing is the same every time. Links left over
 * after the tree are cross links; entities no link reaches hang loose from the book.
 */
export function radialLayout(
  entities: ContextEntity[],
  links: ContextLink[],
  radius: number,
  /** The centre: the book by default; a focused briefing's `focus` node. */
  rootId?: string,
): RadialLayout {
  if (entities.length === 0) return { nodes: [], edges: [], rings: [] };
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
  const rings = Array.from({ length: maxDepth }, (_, i) => (radius * (i + 1)) / maxDepth);

  const angle = new Map<string, number>();
  const firstChild = children.get(root)?.[0];
  const firstShare = firstChild ? ((leaves.get(firstChild) ?? 1) / total) * 2 * Math.PI : 0;
  const assign = (id: string, from: number, to: number) => {
    angle.set(id, (from + to) / 2);
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
    const a = angle.get(entity.id) ?? 0;
    const r = d === 0 ? 0 : rings[d - 1]!;
    return {
      entity,
      depth: d,
      angle: a,
      x: round(Math.cos(a) * r),
      y: round(Math.sin(a) * r),
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
  return { nodes, edges, rings };
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

/** Where a node's label goes: outward from the centre. */
export function labelPlacement(n: { angle: number; depth: number }): {
  anchor: "start" | "middle" | "end";
  dx: number;
  dy: number;
} {
  if (n.depth === 0) return { anchor: "middle", dx: 0, dy: 26 };
  const c = Math.cos(n.angle);
  const s = Math.sin(n.angle);
  if (c > 0.35) return { anchor: "start", dx: 10, dy: 4 };
  if (c < -0.35) return { anchor: "end", dx: -10, dy: 4 };
  return { anchor: "middle", dx: 0, dy: s < 0 ? -12 : 20 };
}

/**
 * How many characters a label's line can hold before the edge of a `size`-square map centred on 0,0,
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

/** Splits a label into at most two lines of about `width` characters, with an ellipsis if it runs over. */
export function wrapLabel(text: string, width = 16): string[] {
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
  if (lines.length <= 2) return lines.map(cut);
  // More than two lines: the second ends at a word, with an ellipsis.
  return [cut(lines[0]!), `${cut(lines[1]!).replace(/…$/, "")}…`];
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

/** On a phone, its paid runs left today; null on the computer, which has no limit. */
export function phoneRunsLine(phone: ContextPhoneRuns | null | undefined): string | null {
  if (!phone) return null;
  return phone.left <= 0
    ? `This phone has started its ${phone.limit} for today; the computer can make one any time.`
    : `This phone can start ${phone.left} more today.`;
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
