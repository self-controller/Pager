// @vitest-environment jsdom
// DOMPurify does not sanitise correctly under happy-dom; jsdom behaves like a browser here.
import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "@/lib/sanitize";

describe("sanitizeHtml", () => {
  it("removes scripts, event handlers and javascript: URLs", () => {
    const out = sanitizeHtml(
      '<p onclick="steal()">Hi<script>alert(1)</script></p><img src="x.png" onerror="steal()"><a href="javascript:alert(1)">x</a><style>body{}</style>',
    );
    expect(out).not.toMatch(/script|onclick|onerror|javascript:|<style/i);
    expect(out).toContain("<p>Hi</p>");
    expect(out).toContain('<img src="x.png">');
  });

  it("keeps reading markup and opens external links safely", () => {
    const out = sanitizeHtml('<h2>T</h2><p><em>a</em> <a href="https://example.com">link</a> <a href="#fn1">1</a></p>');
    expect(out).toContain("<h2>T</h2>");
    expect(out).toContain("<em>a</em>");
    expect(out).toMatch(/<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">link<\/a>/);
    expect(out).toContain('<a href="#fn1">1</a>');
  });

  it("drops forms and inline styles", () => {
    const out = sanitizeHtml('<form action="/x"><input name="a"></form><p style="color:red">x</p>');
    expect(out).toBe("<p>x</p>");
  });
});
