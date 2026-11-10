import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, copyWithTextArea } from "@/lib/clipboard";

// Copying where the page is not a secure context (the iPhone app's own scheme): the text area way.

type Clipboard = { writeText: (text: string) => Promise<void> } | undefined;

function setClipboard(value: Clipboard) {
  Object.defineProperty(navigator, "clipboard", { value, configurable: true });
}

function setSecure(value: boolean) {
  Object.defineProperty(window, "isSecureContext", { value, configurable: true });
}

/** Stands in for `document.execCommand`, noting what was selected when it ran. */
function fakeExec(result: boolean | (() => never)) {
  const seen: { command?: string; text?: string; selected?: string; focused?: boolean } = {};
  const exec = vi.fn((command: string) => {
    const area = document.querySelector("textarea");
    seen.command = command;
    seen.text = area?.value;
    seen.selected = area?.value.slice(area.selectionStart ?? 0, area.selectionEnd ?? 0);
    seen.focused = document.activeElement === area;
    return typeof result === "function" ? result() : result;
  });
  (document as unknown as { execCommand: unknown }).execCommand = exec;
  return { exec, seen };
}

const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalSecure = Object.getOwnPropertyDescriptor(window, "isSecureContext");

afterEach(() => {
  if (original) Object.defineProperty(navigator, "clipboard", original);
  else delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  if (originalSecure) Object.defineProperty(window, "isSecureContext", originalSecure);
  else delete (window as unknown as { isSecureContext?: unknown }).isSecureContext;
  delete (document as unknown as { execCommand?: unknown }).execCommand;
  document.body.innerHTML = "";
});

describe("copyText", () => {
  it("uses the clipboard API where it works", async () => {
    const writeText = vi.fn(async () => {});
    setClipboard({ writeText });
    setSecure(true);
    const { exec } = fakeExec(true);
    expect(await copyText("a full man")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("a full man");
    expect(exec).not.toHaveBeenCalled();
  });

  it("falls back to a hidden text area when there is no clipboard API", async () => {
    setClipboard(undefined);
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    const { exec, seen } = fakeExec(true);
    expect(await copyText("a full man")).toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(seen).toEqual({ command: "copy", text: "a full man", selected: "a full man", focused: true });
    // Nothing is left behind, and focus is back where it was.
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("falls back at once where the page is not a secure context", async () => {
    const writeText = vi.fn(async () => {});
    setClipboard({ writeText });
    setSecure(false);
    const { exec } = fakeExec(true);
    expect(await copyText("words")).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("falls back when the clipboard API refuses", async () => {
    setClipboard({ writeText: vi.fn(async () => Promise.reject(new Error("NotAllowedError"))) });
    setSecure(true);
    const { exec, seen } = fakeExec(true);
    expect(await copyText("words")).toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(seen.text).toBe("words");
  });

  it("says so when nothing could copy", async () => {
    setClipboard(undefined);
    fakeExec(false);
    expect(await copyText("words")).toBe(false);
    fakeExec(() => {
      throw new Error("no");
    });
    expect(copyWithTextArea("words")).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
    delete (document as unknown as { execCommand?: unknown }).execCommand;
    expect(copyWithTextArea("words")).toBe(false);
  });
});
