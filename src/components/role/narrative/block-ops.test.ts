import { describe, it, expect } from "vitest";
import {
  moveBlock,
  insertBlock,
  duplicateBlock,
  removeBlock,
  restoreBlock,
  stripKey,
} from "./block-ops";

type B = { _key: string; kind: string; items?: string[] };
const a: B = { _key: "a", kind: "paragraph" };
const b: B = { _key: "b", kind: "callout" };
const c: B = { _key: "c", kind: "list", items: ["one", "two"] };
const list = [a, b, c];

describe("moveBlock", () => {
  it("swaps with the neighbour above or below", () => {
    expect(moveBlock(list, 1, -1)).toEqual([b, a, c]);
    expect(moveBlock(list, 1, 1)).toEqual([a, c, b]);
  });

  it("leaves the list alone at either end", () => {
    expect(moveBlock(list, 0, -1)).toBe(list);
    expect(moveBlock(list, 2, 1)).toBe(list);
  });

  it("ignores an index outside the list", () => {
    expect(moveBlock(list, 5, -1)).toBe(list);
    expect(moveBlock(list, -1, 1)).toBe(list);
  });

  it("never mutates its input", () => {
    moveBlock(list, 0, 1);
    expect(list).toEqual([a, b, c]);
  });
});

describe("insertBlock", () => {
  const n: B = { _key: "n", kind: "paragraph" };

  it("appends by default", () => {
    expect(insertBlock(list, n)).toEqual([a, b, c, n]);
  });

  it("inserts at an index", () => {
    expect(insertBlock(list, n, 0)).toEqual([n, a, b, c]);
    expect(insertBlock(list, n, 2)).toEqual([a, b, n, c]);
  });

  it("clamps an index outside the list", () => {
    expect(insertBlock(list, n, 99)).toEqual([a, b, c, n]);
    expect(insertBlock(list, n, -4)).toEqual([n, a, b, c]);
  });

  it("works on an empty list", () => {
    expect(insertBlock([], n, 3)).toEqual([n]);
  });
});

describe("duplicateBlock", () => {
  it("places the copy directly below, under the new key", () => {
    const out = duplicateBlock(list, "a", "a2");
    expect(out.map((x) => x._key)).toEqual(["a", "a2", "b", "c"]);
    expect(out[1]).toEqual({ _key: "a2", kind: "paragraph" });
  });

  it("deep-copies, so editing the copy leaves the original alone", () => {
    const out = duplicateBlock(list, "c", "c2");
    out[3].items!.push("three");
    expect(c.items).toEqual(["one", "two"]);
    expect(out[2].items).toEqual(["one", "two"]);
  });

  it("does nothing for an unknown key", () => {
    expect(duplicateBlock(list, "zz", "x")).toBe(list);
  });
});

describe("removeBlock / restoreBlock", () => {
  it("removes the block and says where it was", () => {
    const out = removeBlock(list, "b");
    expect(out.list).toEqual([a, c]);
    expect(out.removed).toEqual({ block: b, index: 1 });
  });

  it("undo puts it back in the same place", () => {
    const { list: without, removed } = removeBlock(list, "b");
    expect(restoreBlock(without, removed!)).toEqual([a, b, c]);
  });

  it("undo of the last block restores it at the end", () => {
    const { list: without, removed } = removeBlock(list, "c");
    expect(restoreBlock(without, removed!)).toEqual([a, b, c]);
  });

  it("an unknown key removes nothing", () => {
    const out = removeBlock(list, "zz");
    expect(out.list).toBe(list);
    expect(out.removed).toBeUndefined();
  });
});

describe("stripKey", () => {
  it("drops only the editor key", () => {
    expect(stripKey(c)).toEqual({ kind: "list", items: ["one", "two"] });
  });
});
