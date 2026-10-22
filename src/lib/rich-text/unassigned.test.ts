import { describe, it, expect } from "vitest";
import { UNASSIGNED_CLASS } from "./unassigned";

/*
 * The code points Unicode 16.0 leaves unassigned (link-text.ts, D104): link
 * text reads them alike in a browser of a newer Unicode and on the server.
 */

describe("UNASSIGNED_CLASS", () => {
  const unassigned = new RegExp(`^${UNASSIGNED_CLASS}$`, "u");

  it("holds code points Unicode 16 leaves unassigned, Unicode 17's among them, and no other", () => {
    // U+0378 unassigned; U+1AD0 and U+16FF4, of Unicode 17; noncharacters.
    for (const cp of [0x378, 0x1ad0, 0x16ff4, 0x20c1, 0xa7f1, 0x323b0, 0xfffe, 0x10ffff]) {
      expect(unassigned.test(String.fromCodePoint(cp)), cp.toString(16)).toBe(true);
    }
    // Assigned in Unicode 16: letters, marks, symbols, a surrogate, private use;
    // and code points invisible by default, which link text reads as nothing.
    for (const cp of [0x61, 0x3b1, 0x332, 0x217c, 0x1d52, 0x2122, 0x1f600, 0x1d41a, 0xd800, 0xe000, 0x2065, 0xfff0, 0xe0002]) {
      expect(unassigned.test(String.fromCodePoint(cp)), cp.toString(16)).toBe(false);
    }
  });

  it("is generated from Unicode 16.0, and agrees with the runtime's while that is its Unicode", async () => {
    const { rangesText, unassignedRanges } = await import("../../../scripts/unassigned-code-points");
    if (process.versions.unicode !== "16.0") return expect.soft(process.versions.unicode, "the table is Unicode 16.0's").toBe("16.0");
    const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("./unassigned.ts", import.meta.url), "utf8"));
    const written = source.slice(source.indexOf("const RANGES = `") + 16, source.indexOf("`;")).trim().split(/\s+/).join(" ");
    expect(written).toBe(rangesText(unassignedRanges()));
  }, 30_000);
});
