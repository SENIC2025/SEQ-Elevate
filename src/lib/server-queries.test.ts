import { describe, it, expect, vi } from "vitest";
import type { CourseContent, StageKey } from "@/lib/cms/types";

/*
 * The facilitator's per-learner progress, with the database, the sign-in
 * and the course content stood in for: one learner who finished a course
 * created in the CMS (four lessons) and is halfway through another.
 */

const day = (n: number) => new Date(Date.UTC(2026, 9, n));

const enrollments = [
  {
    course: { slug: "asking-for-help" },
    stagesCompleted: ["CONTEXT", "CONCEPT", "BEHAVIOUR", "REFLECTION"],
    completedAt: day(2),
    updatedAt: day(2),
    scenarioRoot: null,
    scenarioFollowup: null,
    simulationCorrect: null,
    assessment: null,
  },
  {
    course: { slug: "saying-no" },
    stagesCompleted: ["CONTEXT", "CONCEPT", "BEHAVIOUR"],
    completedAt: null,
    updatedAt: day(3),
    scenarioRoot: null,
    scenarioFollowup: null,
    simulationCorrect: null,
    assessment: null,
  },
];

const membershipFindMany = vi.fn(async () => [
  {
    user: {
      id: "u1",
      name: "Ana",
      email: "ana@example.test",
      enrollments,
      compCards: [],
    },
  },
]);
const membershipCount = vi.fn(async () => 1);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: { findMany: membershipFindMany, count: membershipCount },
    auditLog: { findMany: async () => [] },
    cohort: { count: async () => 0 },
    organisation: { count: async () => 0 },
    course: { count: async () => 0 },
  },
}));
vi.mock("@/lib/auth-helpers", () => ({
  getCurrentUser: async () => null,
  getProjectMemberships: async () => [{ role: "FACILITATOR" }],
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

const { getProjectLearners, getAdminCounts } = await import("./server-queries");

describe("getProjectLearners", () => {
  it("counts each course against its own lessons", async () => {
    const [learner] = (await getProjectLearners("en")) ?? [];
    // 4 of 4 plus 3 of 4 = 7 of 8 lessons (was 7 of 14 = 50%).
    expect(learner.progressPct).toBe(88);
    expect(learner.needsAttention).toBe(false);
  });

  it("puts the learner on the course's next lesson", async () => {
    const [learner] = (await getProjectLearners("en")) ?? [];
    // Three lessons done in a four-lesson course: Reflection is next, not
    // "Guided practice", a step this course doesn't have.
    expect(learner.currentStage).toBe("reflection");
  });
});

/*
 * Staff who opened a learner page before Release 0 still hold the LEARNER
 * role it gave everyone. The roster and the admin's Learners figure ask the
 * database only for people who hold no staff role in the project as well.
 */
const LEARNERS_ONLY = {
  projectId: "seq-elevate",
  role: "LEARNER",
  user: {
    memberships: {
      none: {
        projectId: "seq-elevate",
        role: { in: expect.arrayContaining(["FACILITATOR", "ADMIN", "CONTENT_EDITOR"]) },
      },
    },
  },
};

describe("who the facilitator roster lists", () => {
  it("leaves out staff who still hold an old LEARNER role", async () => {
    membershipFindMany.mockClear();
    await getProjectLearners("en");
    expect(membershipFindMany).toHaveBeenCalledTimes(1);
    expect(membershipFindMany.mock.calls[0]).toEqual([
      expect.objectContaining({ where: LEARNERS_ONLY }),
    ]);
  });
});

describe("getAdminCounts", () => {
  it("counts learners without staff who still hold an old LEARNER role", async () => {
    membershipCount.mockClear();
    await expect(getAdminCounts()).resolves.toMatchObject({ users: 1 });
    expect(membershipCount).toHaveBeenCalledTimes(1);
    expect(membershipCount.mock.calls[0]).toEqual([{ where: LEARNERS_ONLY }]);
  });
});
