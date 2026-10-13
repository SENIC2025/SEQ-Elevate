import { describe, it, expect, beforeEach, vi } from "vitest";
import type { StoredScenario } from "./structure";

/**
 * Learners build a created course from getDbCourse. An editor's draft of an
 * interactive stage (Lesson.structureDraft) must never reach it: not as a
 * stage of its own, and not mixed into the stage learners already have.
 */

type LessonRow = Record<string, unknown>;
const rows: { lessons: LessonRow[] } = { lessons: [] };
const findMany = vi.fn(async (args: { select?: Record<string, boolean> }) =>
  // Like Prisma: with a `select`, only the selected columns come back.
  rows.lessons.map((row) =>
    args.select
      ? Object.fromEntries(
          Object.entries(row).filter(([key]) => args.select![key])
        )
      : row
  )
);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    course: {
      findFirst: async () => ({
        slug: "my-course",
        cluster: "communication",
        durationMinutes: 15,
        meta: { en: { title: "My course", tagline: "t", clusterLabel: "c" } },
      }),
    },
    lesson: { findMany },
  },
}));

const { getDbCourse } = await import("./db-course");

const live: StoredScenario = {
  kind: "scenario",
  setup: { en: "Live setup" },
  question: { en: "Live question" },
  followupQuestion: {},
  choices: [
    { id: "c1", quality: "best", text: { en: "Live A" }, outcome: { en: "Fine." } },
    { id: "c2", quality: "poor", text: { en: "Live B" }, outcome: { en: "Not fine." } },
  ],
};
const draft: StoredScenario = {
  ...live,
  setup: { en: "DRAFT setup" },
  choices: [{ ...live.choices[0], text: { en: "DRAFT choice" } }],
};

const lesson = (stageKey: string, cols: LessonRow): LessonRow => ({
  id: stageKey,
  projectId: "seq-elevate",
  courseSlug: "my-course",
  stageKey,
  video: null,
  narrative: null,
  structure: null,
  structureDraft: null,
  ...cols,
});

beforeEach(() => {
  rows.lessons = [];
  findMany.mockClear();
});

describe("getDbCourse and drafts", () => {
  it("doesn't even read the draft column", async () => {
    await getDbCourse("seq-elevate", "my-course", "en");
    const args = findMany.mock.calls[0][0];
    // Exactly the columns learners need (spec 3.4): never the draft, nor a
    // lesson's extra content (Lesson.parts), which no learner reads before
    // Release 2.
    expect(args.select, "only the columns learners need").toEqual({
      stageKey: true,
      narrative: true,
      structure: true,
    });
  });

  it("leaves out a stage that only has a draft", async () => {
    rows.lessons = [lesson("scenario", { structureDraft: draft })];
    const course = await getDbCourse("seq-elevate", "my-course", "en");
    expect(course?.stages.map((s) => s.key)).toEqual([
      "context",
      "concept",
      "behaviour",
      "reflection",
    ]);
    expect(JSON.stringify(course)).not.toContain("DRAFT");
  });

  it("shows the saved stage, not the draft beside it", async () => {
    rows.lessons = [lesson("scenario", { structure: live, structureDraft: draft })];
    const course = await getDbCourse("seq-elevate", "my-course", "en");
    const scenario = course?.stages.find((s) => s.key === "scenario")?.scenario;
    expect(scenario?.setup).toBe("Live setup");
    expect(scenario?.choices.map((c) => c.text)).toEqual(["Live A", "Live B"]);
    expect(JSON.stringify(course)).not.toContain("DRAFT");
  });
});
