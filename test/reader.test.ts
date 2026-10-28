import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { offsetFromPage, pageCountFor, pageForLeft, pageFromOffset, scrollLeftFor } from "@/components/reader/pagination";
import { getTools, registerTool } from "@/tools/registry";
import { readSelection } from "@/tools/useSelection";

describe("page arithmetic", () => {
  const w = 600;
  const gap = 64;
  it("counts the columns the content made", () => {
    expect(pageCountFor(600, w, gap)).toBe(1);
    expect(pageCountFor(600 + 64 + 600, w, gap)).toBe(2);
    expect(pageCountFor(3 * 600 + 2 * 64 + 0.4, w, gap)).toBe(3);
    expect(pageCountFor(0, 0, gap)).toBe(1);
  });

  it("finds the page a point in the content is on, and where to scroll for a page", () => {
    expect(pageForLeft(0, w, gap)).toBe(0);
    expect(pageForLeft(599, w, gap)).toBe(0);
    expect(pageForLeft(600 + 64, w, gap)).toBe(1);
    expect(pageForLeft(600 + 20, w, gap)).toBe(0); // inside the gap still counts as the page before
    expect(pageForLeft(600 + 40, w, gap)).toBe(1);
    expect(pageForLeft(-5, w, gap)).toBe(0);
    expect(scrollLeftFor(2, w, gap)).toBe(2 * 664);
    expect(scrollLeftFor(-1, w, gap)).toBe(0);
  });

  it("turns pages into a 0–1 offset and back", () => {
    expect(offsetFromPage(0, 1)).toBe(1);
    expect(offsetFromPage(0, 5)).toBe(0);
    expect(offsetFromPage(2, 5)).toBe(0.5);
    expect(offsetFromPage(4, 5)).toBe(1);
    expect(pageFromOffset(0, 5)).toBe(0);
    expect(pageFromOffset(0.5, 5)).toBe(2);
    expect(pageFromOffset(1, 5)).toBe(4);
    expect(pageFromOffset(1.7, 5)).toBe(4);
    expect(pageFromOffset(Number.NaN, 5)).toBe(0);
    expect(pageFromOffset(0.3, 1)).toBe(0);
    for (const count of [1, 2, 7, 40]) for (let p = 0; p < count; p++) expect(pageFromOffset(offsetFromPage(p, count), count)).toBe(p);
  });
});

describe("tool registry", () => {
  it("registers, replaces by id, and unregisters", () => {
    const icon = () => createElement("span");
    const off = registerTool({ id: "t", label: "One", icon });
    registerTool({ id: "t", label: "Two", icon });
    expect(getTools().map((t) => t.label)).toEqual(["Two"]);
    off(); // the first registration was already replaced, so this is a no-op
    expect(getTools()).toHaveLength(1);
    getTools().forEach((t) => registerTool(t)());
    expect(getTools()).toHaveLength(0);
  });
});

describe("selection offsets", () => {
  it("maps a DOM selection to character offsets within the section", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>Hello <em>brave</em> world</p><p>Second</p>";
    document.body.appendChild(root);
    const em = root.querySelector("em")!.firstChild!;
    const second = root.querySelectorAll("p")[1]!.firstChild!;
    const range = document.createRange();
    range.setStart(em, 0);
    range.setEnd(second, 3);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const result = readSelection(root, "s0");
    expect(result).toMatchObject({ sectionId: "s0", start: 6, end: 20 });
    expect(root.textContent!.slice(result!.start, result!.end)).toBe("brave worldSec");
    root.remove();
  });

  it("ignores selections outside the body", () => {
    const root = document.createElement("div");
    root.textContent = "inside";
    const other = document.createElement("p");
    other.textContent = "outside";
    document.body.append(root, other);
    const range = document.createRange();
    range.selectNodeContents(other);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    expect(readSelection(root, "s0")).toBeNull();
    root.remove();
    other.remove();
  });
});
