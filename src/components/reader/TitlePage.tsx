import { ListTree } from "lucide-react";
import type { DocumentDetail } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { formatPublished } from "@/lib/format";

/**
 * The first page of every document: title, subtitle, author, date. It sits outside the section
 * body (marked data-atom), so the body's text and every offset into it are untouched.
 */
export function TitlePage({ doc, onOpenToc }: { doc: DocumentDetail; onOpenToc?: () => void }) {
  const chapters = doc.toc.length;
  const published = formatPublished(doc.publishedAt);
  return (
    <section className="title-page" data-atom aria-label="Title page">
      <h1 className="title-page-title" dir="auto">
        {doc.title}
      </h1>
      {doc.subtitle && (
        <p className="title-page-subtitle" dir="auto">
          {doc.subtitle}
        </p>
      )}
      {doc.author && <p className="title-page-author">{doc.author}</p>}
      <p className="title-page-meta">
        {[published, chapters > 1 ? `${chapters} chapters` : null].filter(Boolean).join(" · ")}
      </p>
      {onOpenToc && chapters > 1 && (
        <div className="mt-6">
          <Button variant="secondary-outline" size="sm" icon={ListTree} onClick={onOpenToc}>
            Contents
          </Button>
        </div>
      )}
    </section>
  );
}
