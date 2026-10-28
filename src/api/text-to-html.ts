/**
 * Plain text and Markdown → reading sections. The mock adapter uses this for seed texts and for
 * files dropped in the browser. The real backend does its own parsing (EPUB, PDF, ...); this
 * only has to be good enough for the shell to be useful before the backend exists.
 */

import type { DocumentKind } from "./types";

export interface ParsedSection {
  title: string;
  html: string;
}

export interface ParsedDocument {
  title: string;
  subtitle?: string;
  author?: string;
  /** Four-digit year found in a "by Author (1847)" line. */
  year?: number;
  kind: DocumentKind;
  sections: ParsedSection[];
  excerpt: string;
  wordCount: number;
}

export type TextFormat = "txt" | "md" | "html";

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "the", "to", "up"]);

/** "THE GIFT OF THE MAGI" → "The Gift of the Magi". Leaves mixed-case input alone. */
export function titleCase(s: string): string {
  if (s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
  return s
    .toLowerCase()
    .split(/(\s+)/)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Inline Markdown: code, links (http/https/mailto only), bold, italic. Input is raw text. */
export function inlineMarkdown(raw: string): string {
  const codeSpans: string[] = [];
  let s = raw.replace(/`([^`]+)`/g, (_, code: string) => {
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(
    /\[([^\]]+)\]\(((?:https?:|mailto:)[^)\s]+)\)/g,
    (_, text: string, href: string) => `<a href="${href}">${text}</a>`,
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codeSpans[Number(i)] ?? "");
}

/** Joins hard-wrapped lines into paragraphs; blank lines separate paragraphs. */
export function textToHtml(text: string): string {
  return splitBlocks(text)
    .map((block) => `<p>${escapeHtml(block.join(" ").replace(/\s+/g, " ").trim())}</p>`)
    .join("\n");
}

function splitBlocks(text: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim() === "") {
      if (current.length) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

/** A small block-level Markdown renderer: headings, paragraphs, quotes, lists, rules, fences. */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${inlineMarkdown(para.join(" ").replace(/\s+/g, " ").trim())}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.type}>${list.items.map((i) => `<li>${inlineMarkdown(i)}</li>`).join("")}</${list.type}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${markdownToHtml(quote.join("\n"))}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (/^```/.test(line)) {
      flushAll();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i] ?? "")) code.push(lines[i++] ?? "");
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inlineMarkdown(heading[2] ?? "")}</h${level}>`);
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      out.push("<hr>");
      continue;
    }

    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1] ?? "");
      continue;
    } else if (quote.length) {
      flushQuote();
    }

    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const type = ul ? "ul" : "ol";
      if (list && list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push((ul ?? ol)![1] ?? "");
      continue;
    }

    if (line.trim() === "") {
      flushPara();
      flushList();
      continue;
    }

    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    para.push(line);
  }
  flushAll();
  return out.join("\n");
}

/** Strips tags for excerpts and word counts. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

export function makeExcerpt(text: string, max = 200): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).replace(/[,;:.\s]+$/, "")}…`;
}

/** Lines like "CHAPTER I", "Chapter 12", "BOOK II", "PART ONE" standing alone. */
const CHAPTER_RE =
  /^(chapter|book|part|letter)\s+([ivxlcdm]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b[.:]?\s*(.*)$/i;
const BYLINE_RE = /^by\s+(.+?)(?:\s*\((\d{4})\))?\s*$/i;

/** "CHAPTER II." → "Chapter II"; "PART ONE" → "Part One". Roman numerals stay uppercase. */
export function chapterTitle(line: string): string {
  const m = CHAPTER_RE.exec(line.trim());
  if (!m) return titleCase(line.trim());
  const [, word = "", num = "", rest = ""] = m;
  const label = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  const number = /^[ivxlcdm]+$/i.test(num) ? num.toUpperCase() : num.charAt(0).toUpperCase() + num.slice(1).toLowerCase();
  return rest.trim() ? `${label} ${number}: ${titleCase(rest.trim())}` : `${label} ${number}`;
}

function filenameTitle(name: string): string {
  const base = name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  const spaced = base.replace(/[-_]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : "Untitled";
}

/**
 * Parses a plain-text file. Looks for a short title line and a "by Author (year)" line at the
 * top, then splits on chapter headings. Two or more chapters make it a book.
 */
export function parsePlainText(name: string, text: string): ParsedDocument {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  const skipBlank = () => {
    while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  };

  skipBlank();
  let title = filenameTitle(name);
  let author: string | undefined;
  let year: number | undefined;

  const first = (lines[i] ?? "").trim();
  const next = (lines[i + 1] ?? "").trim();
  if (first && first.length <= 80 && next === "" && !CHAPTER_RE.test(first)) {
    title = titleCase(first);
    i++;
    skipBlank();
  }
  const by = BYLINE_RE.exec((lines[i] ?? "").trim());
  if (by) {
    author = by[1];
    year = by[2] ? Number(by[2]) : undefined;
    i++;
  }

  const sections: { title: string; body: string[] }[] = [];
  let current: { title: string; body: string[] } = { title: "", body: [] };
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const prevBlank = (lines[i - 1] ?? "").trim() === "";
    const nextBlank = (lines[i + 1] ?? "").trim() === "";
    if (CHAPTER_RE.test(line.trim()) && prevBlank && nextBlank) {
      if (current.title || current.body.some((l) => l.trim())) sections.push(current);
      current = { title: chapterTitle(line), body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.title || current.body.some((l) => l.trim())) sections.push(current);

  const chapters = sections.filter((s) => s.title);
  const isBook = chapters.length >= 2;
  const parsedSections: ParsedSection[] = isBook
    ? sections.map((s, idx) => ({
        title: s.title || (idx === 0 ? "Opening" : `Part ${idx + 1}`),
        html: textToHtml(s.body.join("\n")),
      }))
    : [{ title, html: textToHtml(sections.map((s) => (s.title ? `${s.title}\n\n` : "") + s.body.join("\n")).join("\n\n")) }];

  return finish({ title, author, year, kind: isBook ? "book" : "article", sections: parsedSections });
}

/**
 * Parses a Markdown file. The first `#` heading is the title; an italic or plain line right
 * after it becomes the subtitle. Two or more `##` headings with a leading `#` make it a book
 * whose sections are the `##` parts.
 */
export function parseMarkdown(name: string, md: string, opts: { splitOnH2?: boolean } = {}): ParsedDocument {
  const text = md.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  let title = filenameTitle(name);
  let subtitle: string | undefined;
  let start = 0;

  const h1 = lines.findIndex((l) => /^#\s+/.test(l));
  if (h1 >= 0 && lines.slice(0, h1).every((l) => l.trim() === "")) {
    title = lines[h1]!.replace(/^#\s+/, "").trim();
    start = h1 + 1;
    let j = start;
    while (j < lines.length && (lines[j] ?? "").trim() === "") j++;
    const candidate = (lines[j] ?? "").trim();
    const isBlockSyntax = /^(#|>|[-*+]\s|\d+[.)]\s|```)/.test(candidate);
    if (candidate && !isBlockSyntax && candidate.length <= 200 && (lines[j + 1] ?? "").trim() === "") {
      subtitle = htmlToText(inlineMarkdown(candidate));
      start = j + 1;
    }
  }

  const rest = lines.slice(start);
  const h2Indexes = rest.map((l, idx) => (/^##\s+/.test(l) ? idx : -1)).filter((idx) => idx >= 0);
  const split = opts.splitOnH2 ?? h2Indexes.length >= 2;

  let sections: ParsedSection[];
  if (split && h2Indexes.length >= 2) {
    sections = [];
    const preamble = rest.slice(0, h2Indexes[0]).join("\n").trim();
    if (preamble) sections.push({ title: "Opening", html: markdownToHtml(preamble) });
    h2Indexes.forEach((startIdx, n) => {
      const end = h2Indexes[n + 1] ?? rest.length;
      const heading = rest[startIdx]!.replace(/^##\s+/, "").trim();
      sections.push({ title: heading, html: markdownToHtml(rest.slice(startIdx + 1, end).join("\n")) });
    });
  } else {
    sections = [{ title, html: markdownToHtml(rest.join("\n")) }];
  }

  return finish({ title, subtitle, kind: sections.length >= 2 ? "book" : "article", sections });
}

/** Minimal HTML file handling: takes <title> and <body>. The client sanitises before render. */
export function parseHtmlFile(name: string, html: string): ParsedDocument {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const title = htmlToText(titleMatch?.[1] ?? h1Match?.[1] ?? "") || filenameTitle(name);
  return finish({ title, kind: "article", sections: [{ title, html: bodyMatch?.[1] ?? html }] });
}

export function parseFile(name: string, text: string, format: TextFormat): ParsedDocument {
  if (format === "md") return parseMarkdown(name, text);
  if (format === "html") return parseHtmlFile(name, text);
  return parsePlainText(name, text);
}

export function formatFromName(name: string): TextFormat | null {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "txt" || ext === "text") return "txt";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "html" || ext === "htm") return "html";
  return null;
}

function finish(doc: Omit<ParsedDocument, "excerpt" | "wordCount">): ParsedDocument {
  const allText = doc.sections.map((s) => htmlToText(s.html)).join(" ");
  return { ...doc, excerpt: makeExcerpt(allText), wordCount: countWords(allText) };
}
