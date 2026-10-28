import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "@/lib/sanitize";

// This file runs under happy-dom, where DOMPurify returns markup unsanitised. The self-check in
// sanitizeHtml must notice and fall back to plain text instead of passing the HTML through.
describe("sanitizeHtml fallback", () => {
  it("renders plain text when the sanitiser can't be trusted", () => {
    const out = sanitizeHtml('<p onclick="steal()">Hello <b>there</b></p><script>alert(1)</script>');
    expect(out).not.toMatch(/onclick|<script|<b>/);
    expect(out).toMatch(/^<p>Hello there/);
  });
});
