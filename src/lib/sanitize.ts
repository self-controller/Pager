import DOMPurify from "dompurify";
import { escapeHtml, htmlToText } from "@/api/text-to-html";

let configured = false;
let working: boolean | undefined;

function configure() {
  if (configured) return;
  // Links in documents open outside the reader and never get access to it.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.getAttribute("href")) {
      const href = node.getAttribute("href") ?? "";
      if (!href.startsWith("#")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    }
  });
  configured = true;
}

function purify(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
  });
}

/**
 * DOMPurify quietly returns its input when the DOM it runs on misbehaves. Check once that it
 * really strips a handler; if not, documents render as plain text rather than unsanitised HTML.
 */
function purifierWorks(): boolean {
  if (working === undefined) {
    const out = purify('<p onclick="x()">ok</p><script>x()</script><img src="x" onerror="x()">');
    working = DOMPurify.isSupported && !/onclick|onerror|<script/i.test(out) && out.includes("<p>ok</p>");
  }
  return working;
}

/**
 * Sanitises document HTML before it is rendered. The backend is expected to sanitise too; this
 * is defence in depth, because the app renders arbitrary files from disk.
 */
export function sanitizeHtml(html: string): string {
  configure();
  if (!purifierWorks()) return `<p>${escapeHtml(htmlToText(html))}</p>`;
  return purify(html);
}
