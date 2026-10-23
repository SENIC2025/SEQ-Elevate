import { describe, expect, it } from "vitest";
import { edgeBlanks } from "./link-blanks";

describe("edgeBlanks", () => {
  it("counts the blanks a link's words start and end with: spaces, no-break spaces, tabs, other whitespace", () => {
    expect(edgeBlanks("Feedbackbogen ")).toEqual({ lead: 0, trail: 1 });
    expect(edgeBlanks(" \u00a0the guide\t\u2003 ")).toEqual({ lead: 2, trail: 3 });
    expect(edgeBlanks("the  guide")).toEqual({ lead: 0, trail: 0 });
    expect(edgeBlanks("")).toEqual({ lead: 0, trail: 0 });
    // Only blanks: all of it, both ways.
    expect(edgeBlanks("   ")).toEqual({ lead: 3, trail: 3 });
    // Characters that show nothing, or show blank, are not whitespace: they stay in the words.
    expect(edgeBlanks("\u200Bguide\u2800")).toEqual({ lead: 0, trail: 0 });
  });

  it("reads a long text in time in proportion to its blanks", () => {
    const text = `${" a".repeat(200_000)}x`;
    const started = performance.now();
    expect(edgeBlanks(text)).toEqual({ lead: 1, trail: 0 });
    expect(edgeBlanks(`${" ".repeat(400_000)}x${" ".repeat(400_000)}`)).toEqual({ lead: 400_000, trail: 400_000 });
    expect(performance.now() - started).toBeLessThan(200);
  });
});
