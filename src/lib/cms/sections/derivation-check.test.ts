import { describe, it, expect } from "vitest";
import { LEGACY_FIXTURES, STRAY_ROWS } from "./fixtures";
import { checkCourses, checkPlans, formatPlanReport, formatReport } from "./derivation-check";

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

/*
 * Release 2's pre-deploy check (spec 6, 10.6; scripts/r2-progress-check.ts):
 * every course Release 1 could publish, and every published course, must
 * get from Release 2's lesson plan exactly the lessons its learners get
 * today, all by their stage screens. Counts only.
 */
describe("checkPlans", () => {
  const OWN_OUTLINE = { v: 1, sections: [{ id: "s-abcdefgh", template: "text" }] };
  const OWN_ROW = { courseSlug: "own", stageKey: "s-abcdefgh", narrative: { en: { blocks: [{ kind: "paragraph", text: "x" }] } } };

  it("finds no difference for courses as Release 0 and Release 1 left them", () => {
    const courses = LEGACY_FIXTURES.map((f, i) => ({ slug: `c${i}`, outline: null, status: i % 2 ? "published" : "draft" }));
    const lessons = LEGACY_FIXTURES.flatMap((f, i) =>
      [...f.lessons, ...(i === 0 ? STRAY_ROWS : [])].map((l) => ({ ...l, courseSlug: `c${i}` }))
    );
    const result = checkPlans(courses, lessons);
    expect(result).toMatchObject({
      courses: LEGACY_FIXTURES.length,
      standard: LEGACY_FIXTURES.length,
      published: Math.floor(LEGACY_FIXTURES.length / 2),
      differences: 0,
      differing: [],
    });
    expect(formatPlanReport(result)).toMatch(/0 differences/);
  });

  it("leaves a draft using Release 2's lessons out, and counts a published one as a difference", () => {
    const result = checkPlans(
      [
        { slug: "own", outline: OWN_OUTLINE, status: "draft" },
        { slug: "own-live", outline: OWN_OUTLINE, status: "published" },
        { slug: "fine", outline: null, status: "published" },
      ],
      [OWN_ROW, { ...OWN_ROW, courseSlug: "own-live" }]
    );
    expect(result).toMatchObject({ courses: 3, standard: 1, published: 2, differences: 1, differing: ["own-live"] });
    expect(formatPlanReport(result)).toMatch(/1 difference\b/);
    expect(formatPlanReport(result)).not.toMatch(/own-live/);
    expect(formatPlanReport(result, { list: true })).toMatch(/own-live/);
  });
});
