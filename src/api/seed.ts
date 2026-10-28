/**
 * Seed library for the mock adapter: public-domain texts (see seed/LICENSE.md), parsed with the
 * same code that handles dropped files, so the seed exercises the real path.
 */

import bacon from "./seed/bacon-two-essays.md?raw";
import janeEyre from "./seed/jane-eyre-chapters-1-3.txt?raw";
import giftOfTheMagi from "./seed/the-gift-of-the-magi.txt?raw";
import { parseMarkdown, parsePlainText, type ParsedDocument } from "./text-to-html";
import type { DocumentFormat } from "./types";

export interface SeedDocument {
  id: string;
  format: DocumentFormat;
  parsed: ParsedDocument;
  author?: string;
  publishedAt?: string;
  addedAt: string;
  /** Where the file sits in the preview library's folder tree. */
  relPath: string;
}

/** The preview library's one source: a pretend reads folder. */
export const READS_SOURCE = { id: "reads", name: "Reads" } as const;

/** Splits Bacon's two-essay file into one Markdown document per `##` essay. */
function baconEssays(): { title: string; md: string }[] {
  const parts = bacon.split(/^## /m).slice(1);
  return parts.map((part) => {
    const nl = part.indexOf("\n");
    const title = part.slice(0, nl).trim();
    const body = part.slice(nl + 1);
    return { title, md: `# ${title}\n\nFrom *Essays or Counsels, Civil and Moral*\n\n${body}` };
  });
}

export function buildSeed(): SeedDocument[] {
  const jane = parsePlainText("jane-eyre-chapters-1-3.txt", janeEyre);
  const gift = parsePlainText("the-gift-of-the-magi.txt", giftOfTheMagi);
  const [truth, studies] = baconEssays();

  const docs: SeedDocument[] = [
    {
      id: "jane-eyre",
      format: "txt",
      parsed: { ...jane, title: "Jane Eyre", subtitle: "An Autobiography — chapters I–III" },
      author: jane.author,
      publishedAt: jane.year ? String(jane.year) : undefined,
      addedAt: "2026-10-22T19:30:00.000Z",
      relPath: "Novels/Jane Eyre.txt",
    },
    {
      id: "gift-of-the-magi",
      format: "txt",
      parsed: { ...gift, subtitle: "A short story" },
      author: gift.author,
      publishedAt: gift.year ? String(gift.year) : undefined,
      addedAt: "2026-10-20T08:15:00.000Z",
      relPath: "Stories/The Gift of the Magi.txt",
    },
  ];
  if (truth) {
    docs.push({
      id: "bacon-of-truth",
      format: "md",
      parsed: parseMarkdown("of-truth.md", truth.md, { splitOnH2: false }),
      author: "Francis Bacon",
      publishedAt: "1625",
      addedAt: "2026-10-16T12:00:00.000Z",
      relPath: "Essays/Bacon/Of Truth.md",
    });
  }
  if (studies) {
    docs.push({
      id: "bacon-of-studies",
      format: "md",
      parsed: parseMarkdown("of-studies.md", studies.md, { splitOnH2: false }),
      author: "Francis Bacon",
      publishedAt: "1625",
      addedAt: "2026-10-16T12:05:00.000Z",
      relPath: "Essays/Bacon/Of Studies.md",
    });
  }
  return docs;
}
