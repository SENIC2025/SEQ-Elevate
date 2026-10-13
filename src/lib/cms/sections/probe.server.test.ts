import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * The /dev/cms-check probe of the flexible editor's data (spec 2.1,
 * addendum 10): every created course whose lesson list, or any of whose
 * lessons' extra content, can't be read — the ones repairOutline resets.
 */

vi.mock("server-only", () => ({}));
const state: { courses: Record<string, unknown>[]; lessons: Record<string, unknown>[]; fail: boolean } = {
  courses: [],
  lessons: [],
  fail: false,
};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    course: {
      findMany: vi.fn(async () => {
        if (state.fail) throw new Error("column \"outline\" does not exist");
        return state.courses;
      }),
    },
    lesson: { findMany: vi.fn(async () => state.lessons) },
  },
}));

const { probeSectionData } = await import("./probe.server");

beforeEach(() => {
  state.courses = [];
  state.lessons = [];
  state.fail = false;
});

describe("probeSectionData", () => {
  it("lists the courses with a list or content that can't be read", async () => {
    state.courses = [
      { slug: "fine", outline: null },
      { slug: "bad-list", outline: { v: 2 } },
      { slug: "bad-parts", outline: { v: 1, sections: [] } },
    ];
    state.lessons = [
      { courseSlug: "fine", stageKey: "concept", parts: null },
      { courseSlug: "bad-parts", stageKey: "concept", parts: { v: 1, items: "x" } },
      { courseSlug: "bad-parts", stageKey: "s-abcdefgh", parts: { v: 1, items: [{ id: "main", type: "main" }] } },
    ];
    await expect(probeSectionData("seq-elevate")).resolves.toEqual({
      ok: true,
      checked: 3,
      unreadable: [
        { slug: "bad-list", outline: true, lessons: [] },
        { slug: "bad-parts", outline: false, lessons: ["concept"] },
      ],
    });
  });

  it("says so when the columns aren't there yet", async () => {
    state.fail = true;
    await expect(probeSectionData("seq-elevate")).resolves.toMatchObject({ ok: false });
  });
});
