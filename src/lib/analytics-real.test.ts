import { describe, it, expect, vi } from "vitest";
import type { CourseContent, StageKey } from "@/lib/cms/types";

/*
 * The staff analytics from captured data, with the database and the course
 * content stood in for: two learners in a course created in the CMS, which
 * has four lessons rather than seven.
 */

vi.mock("server-only", () => ({}));

const now = new Date();
const enrolment = (stagesCompleted: string[], completedAt: Date | null) => ({
  course: { slug: "asking-for-help" },
  stagesCompleted,
  completedAt,
  updatedAt: now,
  assessment: null,
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: {
      findMany: async () => [
        {
          cohort: null,
          user: {
            id: "finished",
            name: "Ana",
            email: null,
            enrollments: [
              enrolment(["CONTEXT", "CONCEPT", "BEHAVIOUR", "REFLECTION"], now),
            ],
          },
        },
        {
          cohort: null,
          user: {
            id: "halfway",
            name: "Ben",
            email: null,
            enrollments: [enrolment(["CONTEXT", "CONCEPT", "BEHAVIOUR"], null)],
          },
        },
      ],
    },
    auditLog: { findMany: async () => [] },
    userBadge: { count: async () => 1 },
  },
}));

const NARRATIVE: StageKey[] = ["context", "concept", "behaviour", "reflection"];
vi.mock("@/lib/cms", () => ({
  getCourse: async (_project: string, slug: string) =>
    ({
      slug,
      title: slug,
      stages: NARRATIVE.map((key) => ({ key, title: key })),
    }) as unknown as CourseContent,
}));

const { buildRealAnalytics } = await import("./analytics-real");

describe("buildRealAnalytics", () => {
  it("counts completion against the course's own lessons", async () => {
    const data = await buildRealAnalytics("en");
    const byId = new Map(data?.learners.map((l) => [l.id, l]));
    expect(byId.get("finished")?.progressPct).toBe(100);
    // 3 of 4 lessons, not 3 of 7 (43%).
    expect(byId.get("halfway")?.progressPct).toBe(75);
    expect(data?.kpis.avgCompletionPct).toBe(88);
  });

  it("places the learner at the course's next lesson", async () => {
    const data = await buildRealAnalytics("en");
    const halfway = data?.learners.find((l) => l.id === "halfway");
    // Reflection (index 5 of the seven-step list), not Guided practice (3).
    expect(halfway?.currentStageIndex).toBe(5);
  });
});
