import { describe, it, expect } from "vitest";
import { sectionContentVersion } from "./versions";

/*
 * U12 (Release 4, spec 4.7): deleting a lesson removes its further-reading
 * links with it, so the delete's base covers them, but only when the lesson
 * has some: a lesson without links keeps the base it had before Release 4,
 * so a course page opened before the deploy can still delete it.
 */

const ROW = {
  narrative: { en: { title: "T" } },
  structure: null,
  structureDraft: null,
  parts: null,
  video: null,
  documentIds: ["d2", "d1"],
};

describe("sectionContentVersion and further reading", () => {
  it("is unchanged for a lesson without links", () => {
    const before = sectionContentVersion(ROW);
    expect(sectionContentVersion({ ...ROW, linkIds: [] })).toBe(before);
    expect(sectionContentVersion({ ...ROW, linkIds: undefined })).toBe(before);
  });

  it("changes when a link is added or removed, whatever their order", () => {
    const none = sectionContentVersion(ROW);
    const one = sectionContentVersion({ ...ROW, linkIds: ["l1"] });
    const two = sectionContentVersion({ ...ROW, linkIds: ["l1", "l2"] });
    expect(one).not.toBe(none);
    expect(two).not.toBe(one);
    expect(sectionContentVersion({ ...ROW, linkIds: ["l2", "l1"] })).toBe(two);
  });

  it("keeps links and documents apart: a document id is no link id", () => {
    expect(sectionContentVersion({ ...ROW, documentIds: ["d1", "d2", "x"] })).not.toBe(
      sectionContentVersion({ ...ROW, linkIds: ["x"] })
    );
  });
});
