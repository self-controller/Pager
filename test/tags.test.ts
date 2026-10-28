import { describe, expect, it } from "vitest";
import { addTag, normalizeTag } from "@/components/reader/AnnotationPopover";

describe("tags", () => {
  it("normalises like the server: trim, drop a leading #, single spaces", () => {
    expect(normalizeTag("  #money  ")).toBe("money");
    expect(normalizeTag("##two   words")).toBe("two words");
    expect(normalizeTag("x".repeat(80))).toHaveLength(63);
  });

  it("adds new tags only, case-insensitively, up to 50", () => {
    expect(addTag(["Money"], "money")).toEqual(["Money"]);
    expect(addTag(["a"], " b ")).toEqual(["a", "b"]);
    expect(addTag(["a"], "  ")).toEqual(["a"]);
    const fifty = Array.from({ length: 50 }, (_, i) => `t${i}`);
    expect(addTag(fifty, "one more")).toBe(fifty);
  });
});
