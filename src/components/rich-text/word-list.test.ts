import { describe, it, expect } from "vitest";
import {
  listTreeToHtml,
  nestListItems,
  parseWordMarker,
  type FlatListItem,
  type ListKind,
} from "./word-list";

// A point: level, kind and text (as the <p> paste-cleanup hands over).
const pt = (
  level: number,
  text: string,
  kind: ListKind = "bullet",
  extra: Partial<FlatListItem> = {}
): FlatListItem => ({ level, kind, html: `<p>${text}</p>`, ...extra });

const html = (items: FlatListItem[], maxDepth?: number) =>
  listTreeToHtml(nestListItems(items, maxDepth));

describe("parseWordMarker", () => {
  it.each([
    ["·", "bullet"],
    ["o", "bullet"],
    ["§", "bullet"],
    ["\uF0B7", "bullet"],
    ["•", "bullet"],
    ["-", "bullet"],
    ["Ø", "bullet"],
    ["ü", "bullet"],
    ["v", "bullet"],
    ["", "bullet"],
    ["1.", "number"],
    ["12)", "number"],
    ["(3)", "number"],
    ["7", "number"],
    ["1.2.", "number"],
    ["a.", "number"],
    ["B)", "number"],
    ["iv.", "number"],
  ])("%j is a %s", (marker, kind) => {
    expect(parseWordMarker(marker).kind).toBe(kind);
  });

  it("reads the start number from digits only, ignoring Word's spacing", () => {
    expect(parseWordMarker("3.\u00a0\u00a0\u00a0 ")).toEqual({
      kind: "number",
      start: 3,
    });
    expect(parseWordMarker("2.4.").start).toBe(4);
    expect(parseWordMarker("c.").start).toBe(1);
    expect(parseWordMarker("·").start).toBe(1);
  });

  it("clamps a start learners' lists can't show", () => {
    expect(parseWordMarker("999.").start).toBe(999);
    // Four digits aren't a Word list marker at all.
    expect(parseWordMarker("2024.").kind).toBe("bullet");
  });
});

describe("nestListItems", () => {
  it("keeps a flat list flat", () => {
    expect(html([pt(1, "A"), pt(1, "B"), pt(1, "C")])).toBe(
      "<ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ul>"
    );
  });

  it("nests deeper levels under the point above them, and comes back out", () => {
    expect(
      html([pt(1, "A"), pt(2, "A1"), pt(3, "A1a"), pt(2, "A2"), pt(1, "B")])
    ).toBe(
      "<ul><li><p>A</p><ul><li><p>A1</p><ul><li><p>A1a</p></li></ul></li>" +
        "<li><p>A2</p></li></ul></li><li><p>B</p></li></ul>"
    );
  });

  it("joins levels deeper than learners see to the deepest one, keeping the text", () => {
    const tree = nestListItems([
      pt(1, "A"),
      pt(2, "B"),
      pt(3, "C"),
      pt(4, "D"),
      pt(9, "E"),
    ]);
    expect(listTreeToHtml(tree)).toBe(
      "<ul><li><p>A</p><ul><li><p>B</p><ul><li><p>C</p></li>" +
        "<li><p>D</p></li><li><p>E</p></li></ul></li></ul></li></ul>"
    );
    expect(html([pt(1, "A"), pt(2, "B"), pt(3, "C")], 2)).toBe(
      "<ul><li><p>A</p><ul><li><p>B</p></li><li><p>C</p></li></ul></li></ul>"
    );
  });

  it("nests a skipped level only one step, with no empty points", () => {
    expect(html([pt(1, "A"), pt(3, "B"), pt(3, "C")])).toBe(
      "<ul><li><p>A</p><ul><li><p>B</p></li><li><p>C</p></li></ul></li></ul>"
    );
    // A list that starts below the top level starts at the top.
    expect(html([pt(2, "A"), pt(2, "B")])).toBe(
      "<ul><li><p>A</p></li><li><p>B</p></li></ul>"
    );
    expect(html([pt(2, "A"), pt(1, "B"), pt(2, "C")])).toBe(
      "<ul><li><p>A</p></li><li><p>B</p><ul><li><p>C</p></li></ul></li></ul>"
    );
  });

  it("gives numbered lists their start and bullets none", () => {
    expect(
      html([pt(1, "Three", "number", { start: 3 }), pt(1, "Four", "number")])
    ).toBe('<ol start="3"><li><p>Three</p></li><li><p>Four</p></li></ol>');
    expect(html([pt(1, "One", "number", { start: 1 })])).toBe(
      "<ol><li><p>One</p></li></ol>"
    );
    expect(html([pt(1, "Dot", "bullet", { start: 5 })])).toBe(
      "<ul><li><p>Dot</p></li></ul>"
    );
  });

  it("mixes bullets under numbers, as Word's default outline does", () => {
    expect(
      html([
        pt(1, "Step", "number"),
        pt(2, "note", "bullet"),
        pt(2, "note 2", "bullet"),
        pt(1, "Next step", "number"),
      ])
    ).toBe(
      "<ol><li><p>Step</p><ul><li><p>note</p></li><li><p>note 2</p></li></ul></li>" +
        "<li><p>Next step</p></li></ol>"
    );
  });

  it("starts a new list when the kind changes at the same level", () => {
    expect(
      html([pt(1, "a"), pt(1, "b"), pt(1, "one", "number"), pt(1, "c")])
    ).toBe(
      "<ul><li><p>a</p></li><li><p>b</p></li></ul>" +
        "<ol><li><p>one</p></li></ol><ul><li><p>c</p></li></ul>"
    );
  });

  it("starts a new top-level list for another Word list id", () => {
    expect(
      html([
        pt(1, "A", "number", { list: "l0" }),
        pt(1, "B", "number", { list: "l0" }),
        pt(1, "C", "number", { list: "l1", start: 1 }),
      ])
    ).toBe(
      "<ol><li><p>A</p></li><li><p>B</p></li></ol><ol><li><p>C</p></li></ol>"
    );
  });

  it("clamps out-of-range starts and levels", () => {
    expect(html([pt(1, "x", "number", { start: 5000 })])).toBe(
      '<ol start="999"><li><p>x</p></li></ol>'
    );
    expect(html([pt(1, "x", "number", { start: -2 })])).toBe(
      '<ol start="0"><li><p>x</p></li></ol>'
    );
    expect(html([pt(Number.NaN, "x"), pt(-3, "y")])).toBe(
      "<ul><li><p>x</p></li><li><p>y</p></li></ul>"
    );
  });

  it("returns nothing for no points", () => {
    expect(nestListItems([])).toEqual([]);
    expect(listTreeToHtml([])).toBe("");
  });
});
