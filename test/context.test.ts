import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createHttpApi } from "@/api/http";
import { createMockApi } from "@/api/mock";
import { ApiError, ErrorCodes, type ContextBriefing, type ContextEntity, type ContextLink } from "@/api/types";
import {
  citationView,
  costLabel,
  crossPath,
  distinctCitations,
  entityDates,
  formatYear,
  generatedLabel,
  isFolded,
  itemsAbout,
  labelChars,
  labelPlacement,
  linksOf,
  MIN_PLACE_SPAN,
  orderedSections,
  outlineTransform,
  parseYear,
  placeLabels,
  placePoints,
  placesView,
  projectPoint,
  radialLayout,
  recordHref,
  safeHref,
  scaleAt,
  SECTION_ORDER,
  timelineRows,
  timelineScale,
  usableLinks,
  viewShows,
  viewsFor,
  wrapLabel,
} from "@/tools/context/model";

/** The real, verified briefings from the agent runs (server/tests/fixtures/context/samples). */
function sample(name: string): ContextBriefing {
  return JSON.parse(
    readFileSync(join(process.cwd(), "server/tests/fixtures/context/samples", `${name}.briefing.json`), "utf8"),
  ) as ContextBriefing;
}
const darwin = sample("darwin-general");
const scholar = sample("darwin-scholar");
const austen = sample("austen-general");
const nietzsche = sample("nietzsche-general");

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("context api: http adapter", () => {
  it("calls the four Context routes", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, {}));
    const api = createHttpApi("/api", fetchMock as unknown as typeof fetch);
    await api.getContextStatus();
    await api.getContextBriefing("doc 1", "scholar");
    await api.startContextBriefing("doc 1", { level: "student", refresh: true });
    await api.getContextRun("run/2");
    const calls = fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
    expect(calls).toEqual([
      "GET /api/tools/context/status",
      "GET /api/tools/context/briefings/doc%201?level=scholar",
      "POST /api/tools/context/briefings/doc%201",
      "GET /api/tools/context/runs/run%2F2",
    ]);
    expect(JSON.parse(fetchMock.mock.calls[2]![1]!.body as string)).toEqual({ level: "student", refresh: true });
    expect((fetchMock.mock.calls[2]![1]!.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("passes a 202 run through and keeps the server's error codes", async () => {
    const run = {
      id: "r1",
      docId: "d",
      level: "general",
      status: "running",
      stage: "queued",
      startedAt: "2026-11-05T12:00:00.000Z",
    };
    const answers = [
      jsonResponse(202, { briefing: null, run }),
      jsonResponse(429, {
        error: { code: "limit_reached", message: "This phone has started 10 new briefings in the last 24 hours." },
      }),
      jsonResponse(503, { error: { code: "not_configured", message: "Context needs an API key on the computer." } }),
    ];
    const api = createHttpApi("/api", vi.fn(async () => answers.shift()!) as unknown as typeof fetch);
    expect(await api.startContextBriefing("d", { level: "general" })).toEqual({ briefing: null, run });
    const limit = await api.startContextBriefing("d", { level: "general" }).catch((e: unknown) => e);
    expect(limit).toBeInstanceOf(ApiError);
    expect(limit).toMatchObject({ code: ErrorCodes.limitReached, status: 429 });
    const key = await api.startContextBriefing("d", { level: "general" }).catch((e: unknown) => e);
    expect(key).toMatchObject({ code: ErrorCodes.notConfigured, status: 503 });
  });
});

describe("context api: mock", () => {
  it("answers unsupported for all four: there is no model or catalogue in the browser", async () => {
    const api = createMockApi({ storage: null });
    const calls = [
      api.getContextStatus(),
      api.getContextBriefing("jane-eyre", "general"),
      api.startContextBriefing("jane-eyre", {}),
      api.getContextRun("r"),
    ];
    for (const c of calls) {
      const e = await c.catch((err: unknown) => err);
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe(ErrorCodes.unsupported);
      expect((e as ApiError).message).toMatch(/Context needs Pager running on your computer/);
    }
  });
});

describe("context: sections and folds", () => {
  it("puts context first and folds the rest", () => {
    expect(SECTION_ORDER).toEqual(["overview", "readFirst", "moment", "situation", "conversation", "terms", "furtherReading"]);
    expect(SECTION_ORDER.filter(isFolded)).toEqual(["conversation", "terms", "furtherReading"]);
    expect(orderedSections(darwin).map((s) => s.kind)).toEqual([
      "overview",
      "moment",
      "situation",
      "conversation",
      "terms",
      "furtherReading",
    ]);
  });

  it("orders sections whatever order they arrive in, and leaves out empty ones", () => {
    const shuffled: ContextBriefing = {
      ...darwin,
      sections: [...darwin.sections].reverse().concat([
        { kind: "readFirst", items: [] },
        { kind: "readFirst", items: darwin.sections[1]!.items },
      ]),
    };
    expect(orderedSections(shuffled).map((s) => s.kind)).toEqual([
      "overview",
      "readFirst",
      "moment",
      "situation",
      "conversation",
      "terms",
      "furtherReading",
    ]);
  });

  it("finds what the briefing says about an entity", () => {
    expect(itemsAbout(austen, "entail").map((r) => `${r.kind}:${r.item.heading}`)).toEqual([
      "moment:Entailed estates and eldest sons",
      "terms:Entail",
    ]);
    expect(linksOf(austen, "author").map((l) => l.relation)).toEqual([
      "wrote",
      "drafted the book at",
      "revised the book at",
      "helped secure publisher for",
    ]);
  });
});

describe("context: which graphics show", () => {
  it("shows each graphic only when the counts support it", () => {
    expect(viewsFor(darwin)).toEqual(["briefing", "map", "timeline"]);
    expect(viewsFor(scholar)).toEqual(["briefing", "map", "timeline"]);
    expect(viewsFor(austen)).toEqual(["briefing", "map", "timeline", "places"]);
    expect(viewsFor(nietzsche)).toEqual(["briefing", "map", "timeline"]);
  });

  it("needs two places with coordinates, three dates, and two links among three nodes", () => {
    const one = { ...austen, entities: austen.entities.filter((e) => e.id !== "chawton") };
    expect(placePoints(one).length).toBe(1);
    expect(viewsFor(one)).not.toContain("places");
    const twoDates = {
      ...darwin,
      entities: darwin.entities.map((e) =>
        ["wallace", "lyell", "hooker", "malthus"].includes(e.id) ? { ...e, facts: undefined } : e,
      ),
    };
    expect(viewsFor(twoDates)).not.toContain("timeline");
    const oneLink = { ...darwin, links: darwin.links.slice(0, 1) };
    expect(viewsFor(oneLink)).not.toContain("map");
    const dangling = { ...darwin, links: darwin.links.map((l) => ({ ...l, to: "nobody" })) };
    expect(usableLinks(dangling)).toEqual([]);
    expect(viewsFor(dangling)).toEqual(["briefing", "timeline"]);
    expect(viewsFor({ ...darwin, entities: [], links: [] })).toEqual(["briefing"]);
  });

  it("ignores bad coordinates and years", () => {
    const e = (id: string, coordinates: [number, number]): ContextEntity => ({
      id,
      kind: "place",
      name: id,
      wikidata: null,
      record: null,
      facts: { coordinates, source: "https://www.wikidata.org/wiki/Q1" },
    });
    expect(
      placePoints({ ...austen, entities: [e("a", [91, 0]), e("b", [0, 181]), e("c", [Number.NaN, 0]), e("d", [10, 10])] }).map(
        (p) => p.entity.id,
      ),
    ).toEqual(["d"]);
    expect([parseYear("1859"), parseYear("-427"), parseYear("c. 1850"), parseYear(""), parseYear(undefined)]).toEqual([
      1859,
      -427,
      null,
      null,
      null,
    ]);
    expect(formatYear(-427)).toBe("427 BCE");
  });
});

describe("context: the connection map", () => {
  it("roots the tree at the book, hangs the author from it at the top, and places everything", () => {
    const layout = radialLayout(darwin.entities, usableLinks(darwin), 100);
    const node = (id: string) => layout.nodes.find((n) => n.entity.id === id)!;
    expect(layout.nodes.length).toBe(darwin.entities.length);
    expect(node("book")).toMatchObject({ depth: 0, x: 0, y: 0, parent: null });
    // Darwin's links never join the author to the book: the map does, from the book itself.
    expect(node("author")).toMatchObject({ depth: 1, parent: "book" });
    expect(layout.edges.find((e) => e.kind === "author")).toMatchObject({ from: "book", to: "author", link: null });
    expect(node("author").x).toBeCloseTo(0, 5);
    expect(node("author").y).toBeLessThan(0);
    expect(node("murray")).toMatchObject({ depth: 1, parent: "book" });
    expect(node("lyell")).toMatchObject({ depth: 2, parent: "murray" });
    expect(node("wallace")).toMatchObject({ depth: 2, parent: "author" });
    expect(layout.rings).toEqual([50, 100]);
    for (const n of layout.nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
      expect(Math.hypot(n.x, n.y)).toBeCloseTo(n.depth === 0 ? 0 : layout.rings[n.depth - 1]!, 0);
    }
  });

  it("keeps every sourced link, as the tree or as a cross link, and hangs loose nodes from the book", () => {
    const links = usableLinks(scholar);
    const layout = radialLayout(scholar.entities, links, 120);
    const sourced = layout.edges.filter((e) => e.link);
    expect(sourced.length).toBe(links.length);
    expect(new Set(sourced.map((e) => e.link))).toEqual(new Set(links));
    // Nietzsche's "God is dead" is in the text but no link reaches it.
    const n = radialLayout(nietzsche.entities, usableLinks(nietzsche), 100);
    expect(n.edges.find((e) => e.to === "god-dead")).toMatchObject({ from: "book", kind: "loose", link: null });
    expect(n.nodes.find((x) => x.entity.id === "god-dead")!.depth).toBe(1);
    // An explicit "wrote" link is used as is; no second author edge.
    expect(radialLayout(austen.entities, usableLinks(austen), 100).edges.filter((e) => e.kind === "author")).toEqual([]);
  });

  it("is the same every time and gives siblings their own angles", () => {
    const a = radialLayout(austen.entities, usableLinks(austen), 100);
    const b = radialLayout(austen.entities, usableLinks(austen), 100);
    expect(a).toEqual(b);
    const angles = a.nodes.filter((n) => n.depth > 0).map((n) => `${n.depth}:${n.angle.toFixed(4)}`);
    expect(new Set(angles).size).toBe(angles.length);
  });

  it("copes with a cycle, a self-link and no book", () => {
    const ent = (id: string): ContextEntity => ({ id, kind: "person", name: id, wikidata: null, record: null });
    const claim = { text: "x", inferred: false, spoiler: false, citations: [] };
    const link = (from: string, to: string): ContextLink => ({ from, to, relation: "knew", claim });
    const layout = radialLayout(
      [ent("a"), ent("b"), ent("c")],
      [link("a", "b"), link("b", "c"), link("c", "a"), link("a", "a")],
      60,
    );
    expect(layout.nodes[0]).toMatchObject({ depth: 0, parent: null });
    expect(layout.edges.filter((e) => e.kind === "tree").length).toBe(2);
    expect(layout.edges.filter((e) => e.kind === "cross").length).toBe(1);
    expect(radialLayout([], [], 10)).toEqual({ nodes: [], edges: [], rings: [] });
  });

  it("puts labels outward and wraps long names", () => {
    expect(labelPlacement({ angle: 0, depth: 1 }).anchor).toBe("start");
    expect(labelPlacement({ angle: Math.PI, depth: 1 }).anchor).toBe("end");
    expect(labelPlacement({ angle: -Math.PI / 2, depth: 1 })).toMatchObject({ anchor: "middle" });
    expect(labelPlacement({ angle: -Math.PI / 2, depth: 1 }).dy).toBeLessThan(0);
    expect(wrapLabel("Pride and Prejudice", 16)).toEqual(["Pride and", "Prejudice"]);
    expect(wrapLabel("First Impressions (early draft)", 16)).toEqual(["First", "Impressions…"]);
    expect(wrapLabel("Lyell", 16)).toEqual(["Lyell"]);
    expect(crossPath({ x: 10, y: 0 }, { x: 0, y: 10 })).toBe("M10 0Q1.75 1.75 0 10");
    // A node near the left edge of a 360 map, its label running left: room for few characters.
    expect(labelChars({ x: -104, y: 0 }, { anchor: "end", dx: -10 }, 360, 11.5, 14)).toBe(9);
    expect(labelChars({ x: 0, y: -100 }, { anchor: "middle", dx: 0 }, 360, 11.5, 14)).toBe(14);
    expect(labelChars({ x: 170, y: 0 }, { anchor: "start", dx: 10 }, 360, 11.5, 14)).toBe(5);
    // Every label of Darwin's map fits inside a 360 map.
    const layout = radialLayout(darwin.entities, usableLinks(darwin), 360 / 2 - 76);
    for (const n of layout.nodes) {
      const place = labelPlacement(n);
      const width = Math.max(...wrapLabel(n.entity.name, labelChars(n, place, 360, 11.5, 14)).map((l) => l.length)) * 11.5 * 0.56;
      const x0 = place.anchor === "start" ? n.x + place.dx : place.anchor === "end" ? n.x + place.dx - width : n.x - width / 2;
      expect([n.entity.name, x0 >= -180 && x0 + width <= 180]).toEqual([n.entity.name, true]);
    }
  });
});

describe("context: the timeline", () => {
  it("lists dated entities by start, with spans where Wikidata has an end", () => {
    const rows = timelineRows(darwin);
    expect(rows.map((r) => r.entity.id)).toEqual(["malthus", "lyell", "author", "hooker", "wallace", "book"]);
    expect(rows.find((r) => r.entity.id === "author")).toMatchObject({ start: 1809, end: 1882 });
    expect(rows.find((r) => r.entity.id === "book")).toMatchObject({ start: 1859, end: null });
    expect(entityDates(rows[0]!.entity)).toBe("1766–1834");
  });

  it("pads the scale to round years with a handful of ticks", () => {
    const scale = timelineScale(timelineRows(darwin));
    // 1766 (Malthus) to 1913 (Wallace): 50-year steps are the first that fit six ticks.
    expect(scale).toEqual({ min: 1750, max: 1950, ticks: [1750, 1800, 1850, 1900, 1950] });
    expect(scaleAt(scale, 1750)).toBe(0);
    expect(scaleAt(scale, 1950)).toBe(1);
    const tight = timelineScale([{ entity: darwin.entities[0]!, start: 1859, end: null }]);
    expect(tight.min).toBeLessThan(1859);
    expect(tight.max).toBeGreaterThan(1859);
  });

  it("drops an end before its start", () => {
    const odd = {
      ...darwin,
      entities: darwin.entities.map((e) => (e.id === "author" ? { ...e, facts: { ...e.facts!, end: "1700" } } : e)),
    };
    expect(timelineRows(odd).find((r) => r.entity.id === "author")!.end).toBeNull();
  });
});

describe("context: the places map", () => {
  it("frames two nearby villages in their region and keeps the box's aspect", () => {
    const points = placePoints(austen);
    expect(points.map((p) => p.entity.id)).toEqual(["chawton", "steventon"]);
    const view = placesView(points, 1.25);
    expect(view.latSpan).toBeCloseTo(MIN_PLACE_SPAN, 5);
    const k = Math.cos((51.18 * Math.PI) / 180);
    expect((view.lonSpan * k) / view.latSpan).toBeCloseTo(1.25, 1);
    for (const p of points) {
      const at = projectPoint(view, 400, 320, p.lat, p.lon);
      expect(at.x).toBeGreaterThan(150);
      expect(at.x).toBeLessThan(250);
      expect(at.y).toBeGreaterThan(130);
      expect(at.y).toBeLessThan(190);
    }
  });

  it("keeps labels off each other: flips one to the other side, or moves it down", () => {
    // Steventon and Chawton, a few pixels apart.
    const labels = placeLabels(
      [
        { x: 180, y: 160, lines: 1 },
        { x: 196, y: 166, lines: 1 },
      ],
      360,
    );
    // Each away from the other: "Steventon ● ● Chawton".
    expect(labels[0]).toEqual({ side: "left", dy: 4 });
    expect(labels[1]).toEqual({ side: "right", dy: 4 });
    // Three in a column: the third can't go either way, so it goes a line down.
    const three = placeLabels(
      [
        { x: 180, y: 160, lines: 1 },
        { x: 182, y: 162, lines: 1 },
        { x: 181, y: 164, lines: 1 },
      ],
      360,
    );
    expect(three.map((l) => `${l.side}:${l.dy}`)).toEqual(["left:4", "right:4", "left:18"]);
    // Near the right edge, labels go left.
    expect(placeLabels([{ x: 340, y: 50, lines: 1 }], 360)[0]!.side).toBe("left");
  });

  it("projects the outline with the same numbers as the points", () => {
    const view = placesView(
      [
        { lat: 0, lon: 0 },
        { lat: 10, lon: 20 },
      ],
      1,
    );
    const m = /matrix\(([^ ]+) 0 0 ([^ ]+) ([^ ]+) ([^ ]+)\)/
      .exec(outlineTransform(view, 300, 300))!
      .slice(1)
      .map(Number);
    const [a, d, e, f] = m as [number, number, number, number];
    // The outline is in hundredths of a degree with y = −latitude.
    const viaOutline = { x: a * 2000 + e, y: d * -1000 + f };
    const viaPoint = projectPoint(view, 300, 300, 10, 20);
    expect(viaOutline.x).toBeCloseTo(viaPoint.x, 1);
    expect(viaOutline.y).toBeCloseTo(viaPoint.y, 1);
  });
});

describe("context: what each view shows", () => {
  it("shows an entity's details only in a view that has it", () => {
    expect(viewShows(austen, "map", "henry")).toBe(true);
    expect(viewShows(austen, "timeline", "henry")).toBe(false);
    expect(viewShows(austen, "timeline", "burney")).toBe(true);
    expect(viewShows(austen, "places", "chawton")).toBe(true);
    expect(viewShows(austen, "places", "author")).toBe(false);
  });
});

describe("context: citations and labels", () => {
  it("links pages, records and the book's own front matter", () => {
    expect(
      citationView({
        kind: "page",
        url: "https://www.darwinproject.ac.uk/x",
        title: "Letter",
        author: "DCP",
        year: "2009",
        quote: "q",
        record: null,
      }),
    ).toEqual({
      title: "Letter",
      meta: "DCP · 2009",
      href: "https://www.darwinproject.ac.uk/x",
      fromBook: false,
    });
    expect(
      citationView({
        kind: "record",
        url: null,
        title: "Origin",
        author: null,
        year: null,
        quote: null,
        record: { kind: "wikidata", value: "Q20124" },
      }).href,
    ).toBe("https://www.wikidata.org/wiki/Q20124");
    expect(
      citationView({
        kind: "book",
        url: null,
        title: "Introduction by Elisabeth Förster-Nietzsche",
        author: null,
        year: null,
        quote: "q",
        record: null,
      }),
    ).toMatchObject({
      fromBook: true,
      href: null,
    });
    expect(
      citationView({ kind: "page", url: "javascript:alert(1)", title: "x", author: null, year: null, quote: "q", record: null })
        .href,
    ).toBeNull();
  });

  it("builds record links and refuses anything but http(s)", () => {
    expect(recordHref({ kind: "isbn", value: "978-0-14-143951-8" })).toBe("https://openlibrary.org/isbn/9780141439518");
    expect(recordHref({ kind: "olid", value: "OL1179009W" })).toBe("https://openlibrary.org/works/OL1179009W");
    expect(recordHref({ kind: "olid", value: "/books/OL7353617M" })).toBe("https://openlibrary.org/books/OL7353617M");
    expect(recordHref({ kind: "doi", value: "https://doi.org/10.1111/j.1095-8312.2012.02030.x" })).toBe(
      "https://doi.org/10.1111/j.1095-8312.2012.02030.x",
    );
    expect(recordHref({ kind: "url", value: "file:///etc/passwd" })).toBeNull();
    expect(safeHref("http://example.org/a b")).toBe("http://example.org/a%20b");
  });

  it("shows a page cited twice for one claim once", () => {
    const claim = scholar.sections.find((s) => s.kind === "situation")!.items.find((i) => i.disagreement)!.claims[0]!;
    expect(claim.citations.length).toBe(2);
    expect(distinctCitations(claim.citations).length).toBe(1);
  });

  it("formats cost and date", () => {
    expect(costLabel(0)).toBeNull();
    expect(costLabel(0.004)).toBe("less than a cent");
    expect(costLabel(0.2345)).toBe("$0.23");
    expect(generatedLabel("2026-11-05T21:51:06.293Z", "en-GB")).toBe("Generated 5 November 2026");
  });
});
