import { describe, it, expect } from "vitest";
import { CONTENT_FIELDS, markContentLang } from "./content-lang";

/** Just enough of the DOM: the boxes a query finds, and their attributes. */
function box(lang?: string) {
  const attrs = new Map<string, string>(lang ? [["lang", lang]] : []);
  return {
    attrs,
    getAttribute: (n: string) => attrs.get(n) ?? null,
    setAttribute: (n: string, v: string) => void attrs.set(n, v),
  };
}

describe("markContentLang", () => {
  it("marks every text box with the language written in, and only the boxes", () => {
    const boxes = [box(), box("en"), box("de")];
    let asked = "";
    const root = {
      querySelectorAll: (q: string) => {
        asked = q;
        return boxes;
      },
    };
    markContentLang(root as unknown as ParentNode, "de");
    expect(asked).toBe(CONTENT_FIELDS);
    expect(CONTENT_FIELDS).toContain("textarea");
    expect(CONTENT_FIELDS).toContain('[contenteditable="true"]');
    expect(CONTENT_FIELDS).not.toContain("button");
    expect(boxes.map((b) => b.attrs.get("lang"))).toEqual(["de", "de", "de"]);
  });
});
