import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chapterTitle,
  inlineMarkdown,
  makeExcerpt,
  markdownToHtml,
  parseFile,
  parseMarkdown,
  parsePlainText,
  textToHtml,
  titleCase,
} from "@/api/text-to-html";

const seed = (name: string) => readFileSync(resolve(process.cwd(), "src/api/seed", name), "utf8");

describe("titles", () => {
  it("title-cases all-caps titles and leaves mixed case alone", () => {
    expect(titleCase("THE GIFT OF THE MAGI")).toBe("The Gift of the Magi");
    expect(titleCase("Already Fine")).toBe("Already Fine");
  });

  it("keeps Roman numerals uppercase in chapter headings", () => {
    expect(chapterTitle("CHAPTER II")).toBe("Chapter II");
    expect(chapterTitle("Chapter 12.")).toBe("Chapter 12");
    expect(chapterTitle("PART ONE")).toBe("Part One");
    expect(chapterTitle("CHAPTER IV. THE STORM")).toBe("Chapter IV: The Storm");
  });
});

describe("plain text", () => {
  it("splits Jane Eyre into three chapters and reads the byline", () => {
    const doc = parsePlainText("jane-eyre-chapters-1-3.txt", seed("jane-eyre-chapters-1-3.txt"));
    expect(doc.kind).toBe("book");
    expect(doc.title).toBe("Jane Eyre");
    expect(doc.author).toBe("Charlotte Brontë");
    expect(doc.year).toBe(1847);
    expect(doc.sections.map((s) => s.title)).toEqual(["Chapter I", "Chapter II", "Chapter III"]);
    expect(doc.sections[0]!.html.startsWith("<p>There was no possibility of taking a walk that day.")).toBe(true);
    expect(doc.wordCount).toBeGreaterThan(7000);
  });

  it("treats a story without chapters as one article", () => {
    const doc = parsePlainText("the-gift-of-the-magi.txt", seed("the-gift-of-the-magi.txt"));
    expect(doc.kind).toBe("article");
    expect(doc.title).toBe("The Gift of the Magi");
    expect(doc.author).toBe("O. Henry");
    expect(doc.sections).toHaveLength(1);
    expect(doc.excerpt.startsWith("One dollar and eighty-seven cents.")).toBe(true);
  });

  it("joins hard-wrapped lines and escapes markup", () => {
    expect(textToHtml("one\ntwo\n\n<b>three</b>")).toBe("<p>one two</p>\n<p>&lt;b&gt;three&lt;/b&gt;</p>");
  });

  it("falls back to the file name for a title", () => {
    const doc = parsePlainText(
      "my-notes_v2.txt",
      "A first line that is long enough to be a paragraph rather than a title, clearly.\nMore.",
    );
    expect(doc.title).toBe("My notes v2");
  });
});

describe("markdown", () => {
  it("renders block structure", () => {
    const html = markdownToHtml("## Heading\n\nA *para*\nwrapped.\n\n- one\n- two\n\n> quoted\n\n---\n\n```\n<code>\n```");
    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain("<p>A <em>para</em> wrapped.</p>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<blockquote><p>quoted</p></blockquote>");
    expect(html).toContain("<hr>");
    expect(html).toContain("<pre><code>&lt;code&gt;</code></pre>");
  });

  it("renders inline syntax and only safe link schemes", () => {
    expect(inlineMarkdown("**b** and `x<y` and [ok](https://a.b) and [bad](javascript:alert(1))")).toBe(
      '<strong>b</strong> and <code>x&lt;y</code> and <a href="https://a.b">ok</a> and [bad](javascript:alert(1))',
    );
  });

  it("takes the title from # and a short following line as subtitle", () => {
    const doc = parseMarkdown("x.md", "# Of Truth\n\nFrom *Essays*\n\nWHAT is truth? said jesting Pilate.");
    expect(doc.title).toBe("Of Truth");
    expect(doc.subtitle).toBe("From Essays");
    expect(doc.sections[0]!.html).toBe("<p>WHAT is truth? said jesting Pilate.</p>");
  });

  it("splits on ## when there are several, making a book", () => {
    const doc = parseMarkdown("bacon.md", seed("bacon-two-essays.md"));
    expect(doc.kind).toBe("book");
    expect(doc.sections.map((s) => s.title)).toEqual(["Of Truth", "Of Studies"]);
  });
});

describe("parseFile", () => {
  it("takes <title> and <body> from HTML", () => {
    const doc = parseFile("a.html", "<html><head><title>Hello</title></head><body><p>Hi</p></body></html>", "html");
    expect(doc.title).toBe("Hello");
    expect(doc.sections[0]!.html).toBe("<p>Hi</p>");
  });
});

describe("excerpt", () => {
  it("cuts on a word boundary", () => {
    expect(makeExcerpt("alpha beta gamma delta", 12)).toBe("alpha beta…");
  });
});
