import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronDown, Waypoints } from "lucide-react";
import type { ContextBriefing, ContextItem, ContextSection, ContextSectionKind } from "@/api/types";
import { cx } from "@/lib/cx";
import {
  entityById,
  focusName,
  orderedSections,
  isFolded,
  itemAnchor,
  relationLine,
  sectionTitle,
  safeHref,
  recordHref,
  type ItemRef,
} from "./model";
import { Claim, ExternalLink, INFERRED_NOTE, SpoilerFold } from "./parts";

interface Props {
  briefing: ContextBriefing;
  /** Entities the connection map shows: an item about one gets an "On the map" link. */
  onMap: ReadonlySet<string>;
  onShowOnMap: (entityId: string) => void;
  /** An item to open its fold for, scroll to and flash (from the map's "In the briefing"). */
  reveal: (ItemRef & { nonce: number }) | null;
}

/** The briefing as a document: context first, the rest folded. Every claim shows its sources. */
export function BriefingView({ briefing, onMap, onShowOnMap, reveal }: Props) {
  const sections = orderedSections(briefing);
  const author = entityById(briefing, "author")?.name ?? "The author";
  const relate = (item: ContextItem) => relationLine(briefing, item, author);
  const [open, setOpen] = useState<ReadonlySet<ContextSectionKind>>(new Set());

  useEffect(() => {
    if (!reveal) return;
    setOpen((o) => new Set([...o, reveal.kind]));
    const id = itemAnchor(reveal.kind, reveal.index);
    let timer = 0;
    const frame = requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      el.classList.remove("context-flash");
      void el.offsetWidth;
      el.classList.add("context-flash");
      timer = window.setTimeout(() => el.classList.remove("context-flash"), 3000);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [reveal]);

  const anyInferred = JSON.stringify(briefing.sections).includes('"inferred":true');
  const focused = Boolean(briefing.focus);

  return (
    <div className="flex flex-col">
      {briefing.littleKnown && (
        <p className="mx-5 mt-4 rounded-sm bg-surface-2 px-3 py-2.5 font-sans text-[13.5px] leading-5 text-fg">
          {focused
            ? `Not much is known about ${focusName(briefing)} in connection with this book.`
            : "Not much is known about this book's context."}
        </p>
      )}
      {sections.map((s) =>
        isFolded(s.kind, focused) ? (
          <FoldedSection
            key={s.kind}
            title={sectionTitle(s.kind, briefing)}
            section={s}
            open={open.has(s.kind)}
            onToggle={() =>
              setOpen((o) => {
                const next = new Set(o);
                if (next.has(s.kind)) next.delete(s.kind);
                else next.add(s.kind);
                return next;
              })
            }
            onMap={onMap}
            onShowOnMap={onShowOnMap}
            relate={relate}
          />
        ) : (
          <section key={s.kind} aria-labelledby={`context-h-${s.kind}`} className="border-b border-detail px-5 pt-5 pb-5">
            <h3 id={`context-h-${s.kind}`} className="pb-3 font-display text-[17px] leading-6 font-semibold">
              {sectionTitle(s.kind, briefing)}
            </h3>
            <Items section={s} onMap={onMap} onShowOnMap={onShowOnMap} relate={relate} />
          </section>
        ),
      )}
      {anyInferred && (
        <p className="px-5 pt-4 font-sans text-[12px] leading-4 text-fg-3">
          <span className="font-semibold tracking-wide uppercase">Inferred</span>: {INFERRED_NOTE}
        </p>
      )}
    </div>
  );
}

function FoldedSection({
  title,
  section,
  open,
  onToggle,
  onMap,
  onShowOnMap,
  relate,
}: {
  title: string;
  section: ContextSection;
  open: boolean;
  onToggle: () => void;
  onMap: ReadonlySet<string>;
  onShowOnMap: (id: string) => void;
  relate: (item: ContextItem) => string | null;
}) {
  const body = `context-body-${section.kind}`;
  return (
    <section className="border-b border-detail">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={body}
          onClick={onToggle}
          className="flex w-full items-center gap-2 px-5 py-4 text-left transition-hover hover:bg-surface-hover"
        >
          <span className="flex-1 font-display text-[17px] leading-6 font-semibold">{title}</span>
          <span className="font-sans text-[13px] text-fg-3 tabular-nums">{section.items.length}</span>
          <ChevronDown size={18} aria-hidden className={cx("text-fg-2 transition-transform", open && "rotate-180")} />
        </button>
      </h3>
      {open && (
        <div id={body} className="px-5 pb-5">
          <Items section={section} onMap={onMap} onShowOnMap={onShowOnMap} relate={relate} />
        </div>
      )}
    </section>
  );
}

function Items({
  section,
  onMap,
  onShowOnMap,
  relate,
}: {
  section: ContextSection;
  onMap: ReadonlySet<string>;
  onShowOnMap: (id: string) => void;
  relate: (item: ContextItem) => string | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      {section.items.map((item, i) => (
        <Item
          key={i}
          id={itemAnchor(section.kind, i)}
          kind={section.kind}
          item={item}
          onMap={onMap}
          onShowOnMap={onShowOnMap}
          relate={relate}
        />
      ))}
    </div>
  );
}

function Item({
  id,
  kind,
  item,
  onMap,
  onShowOnMap,
  relate,
}: {
  id: string;
  kind: ContextSectionKind;
  item: ContextItem;
  onMap: ReadonlySet<string>;
  onShowOnMap: (id: string) => void;
  relate: (item: ContextItem) => string | null;
}) {
  // The overview's one item is the book itself: "The book" above it says enough.
  const showHeading = kind !== "overview";
  const relation = relate(item);
  const mapped = item.entity && onMap.has(item.entity) ? item.entity : null;
  const content = (
    <div className="flex flex-col gap-3">
      {item.work && <WorkLine item={item} />}
      {(item.readNote || item.timeEstimate) && (
        <p className="font-sans text-[13px] leading-[18px] text-fg-2">
          {[item.readNote, item.timeEstimate].filter(Boolean).join(" · ")}
        </p>
      )}
      {item.suits && <p className="font-sans text-[13px] leading-[18px] text-fg-2">{item.suits}</p>}
      {item.claims.map((c, i) => (
        <Claim key={i} claim={c} />
      ))}
      {item.disagreement && <Disagreement d={item.disagreement} />}
    </div>
  );
  return (
    <article id={id} className="scroll-mt-16 rounded-sm">
      {(showHeading || mapped) && (
        <header className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {showHeading && (
            <h4 className="font-display text-[15.5px] leading-[22px] font-semibold">
              {/* The author's conversation: "Jane Austen took her title from / Fanny Burney". */}
              {relation && <span className="block font-sans text-[12.5px] leading-[18px] font-normal text-fg-2">{relation}</span>}
              {item.heading}
            </h4>
          )}
          {mapped && (
            <button
              type="button"
              onClick={() => onShowOnMap(mapped)}
              className="ml-auto inline-flex items-center gap-1 font-sans text-[12px] leading-[18px] font-semibold text-accent hover:text-accent-hover"
            >
              <Waypoints size={13} aria-hidden />
              On the map
            </button>
          )}
        </header>
      )}
      {item.spoiler ? <SpoilerFold>{content}</SpoilerFold> : content}
    </article>
  );
}

/** "Essay on the Principle of Population · Thomas Malthus, 1798 · Open Library ↗" */
function WorkLine({ item }: { item: ContextItem }) {
  const w = item.work!;
  const href = safeHref(w.resolvedUrl) ?? recordHref(w.record);
  const by = [w.authors.join(", "), w.year].filter(Boolean).join(", ");
  return (
    <p className="font-sans text-[13px] leading-[18px] text-fg-2">
      <cite className="font-serif text-[14.5px] text-fg not-italic">{w.title}</cite>
      {by && <span> · {by}</span>}
      {href && (
        <>
          {" · "}
          <ExternalLink href={href}>
            {recordName(href)}
            <ArrowUpRight size={12} className="ml-0.5 inline align-[-1px]" aria-hidden />
          </ExternalLink>
        </>
      )}
    </p>
  );
}

function recordName(href: string): string {
  const host = new URL(href).hostname.replace(/^www\./, "");
  if (host === "openlibrary.org") return "Open Library";
  if (host === "doi.org") return "DOI";
  if (host === "wikidata.org") return "Wikidata";
  return host;
}

/** Scholars disagree: both sides, each with its own sources. */
function Disagreement({ d }: { d: NonNullable<ContextItem["disagreement"]> }) {
  return (
    <div role="group" aria-label="Scholars disagree" className="flex flex-col gap-3 rounded-sm bg-surface-2/60 p-3">
      <div>
        <p className="font-sans text-[11.5px] leading-4 font-semibold tracking-wide text-fg-2 uppercase">Scholars disagree</p>
        <p className="mt-1 font-serif text-[14.5px] leading-[1.5]">{d.summary}</p>
      </div>
      {d.sides.map((side, i) => (
        <div key={i} className="flex flex-col gap-2 border-l-2 border-fg-3 pl-3">
          <p className="font-sans text-[13px] leading-[18px] font-semibold text-fg">{side.position}</p>
          {side.claims.map((c, j) => (
            <Claim key={j} claim={c} size="sm" />
          ))}
        </div>
      ))}
    </div>
  );
}
