/** Where a field can take focus: the top modal dialog when one is open (the rest of the page is inert). */
function host(): Element {
  try {
    const modals = document.querySelectorAll("dialog[open]:modal");
    return modals[modals.length - 1] ?? document.body;
  } catch {
    return document.body;
  }
}

/**
 * The old way to copy: a hidden text area, selected, and `document.execCommand("copy")`. It works
 * where the page is not a secure context, but only inside a tap. Focus goes back where it was.
 */
export function copyWithTextArea(text: string): boolean {
  if (typeof document.execCommand !== "function") return false;
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement("textarea");
  area.value = text;
  area.readOnly = true;
  area.setAttribute("aria-hidden", "true");
  // On screen (a hidden field can't be selected) but unseen; 16px so iOS doesn't zoom to it.
  area.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px";
  let ok = false;
  try {
    host().appendChild(area);
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, text.length);
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  before?.focus({ preventScroll: true });
  return ok;
}

/**
 * Puts `text` on the clipboard and says whether it got there. The iPhone app's page is served on its
 * own scheme, which may not be a secure context: then `navigator.clipboard` is missing or refuses,
 * and the text area does it. Call it straight from a tap.
 */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  // Straight to the fallback, while the tap still counts.
  if (!clipboard?.writeText || window.isSecureContext === false) return copyWithTextArea(text);
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return copyWithTextArea(text);
  }
}
