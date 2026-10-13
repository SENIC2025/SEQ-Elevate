import { describe, it, expect } from "vitest";
import { LEGACY_FIXTURES, STRAY_ROWS } from "./fixtures";
import { checkCourses, formatReport } from "./derivation-check";

/*
 * Smoke test of the pre-deploy derivation check's core (addendum 4): on
 * Release 0-shaped rows it finds no difference; a stored list or extra
 * content learners couldn't get is a difference; stray rows are reported
 * for information only.
 */

describe("checkCourses", () => {
  it("finds no difference for courses as Release 0 left them, and reports strays", () => {
    const courses = LEGACY_FIXTURES.map((f, i) => ({ slug: `c${i}`, outline: null }));
    const lessons = LEGACY_FIXTURES.flatMap((f, i) =>
      [...f.lessons, ...(i === 0 ? STRAY_ROWS : [])].map((l) => ({ ...l, courseSlug: `c${i}` }))
    );
    const result = checkCourses(courses, lessons);
    expect(result.differences).toBe(0);
    expect(result.reports).toHaveLength(LEGACY_FIXTURES.length);
    for (const r of result.reports) {
      expect(r.derived).toEqual(r.present);
      expect(r.reasons).toEqual([]);
    }
    expect(result.reports[0].stray.length).toBeGreaterThan(0);
    expect(formatReport(result)).toMatch(/0 differences/);
  });

  it("counts a course learners couldn't get as built as a difference", () => {
    const result = checkCourses(
      [
        { slug: "own", outline: { v: 1, sections: [{ id: "s-abcdefgh", template: "text" }] } },
        { slug: "fine", outline: null },
      ],
      [
        {
          courseSlug: "fine",
          stageKey: "concept",
          parts: { v: 1, items: [{ id: "main", type: "main" }, { id: "p-12345678", type: "text", blocks: {} }] },
        },
      ]
    );
    expect(result.differences).toBe(2);
    expect(result.reports.map((r) => r.reasons.map((x) => x.code))).toEqual([
      ["custom-section"],
      ["extra-parts"],
    ]);
    expect(formatReport(result)).toMatch(/2 differences/);
  });
});
