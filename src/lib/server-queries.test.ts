import { afterEach, describe, it, expect, vi } from "vitest";
import type { CourseContent, StageKey } from "@/lib/cms/types";
import type { LessonPlan } from "@/lib/cms/sections/learner-path";

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

type Enrolment = (typeof enrollments)[number] & { sectionsCompleted?: unknown };
const learnerEnrolments = vi.fn((): Enrolment[] => enrollments);

const membershipFindMany = vi.fn(async () => [
  {
    user: {
      id: "u1",
      name: "Ana",
      email: "ana@example.test",
      enrollments: learnerEnrolments(),
      compCards: [],
    },
  },
]);
const membershipCount = vi.fn(async () => 1);
const auditFindMany = vi.fn(async (): Promise<unknown[]> => []);
const enrollmentFindMany = vi.fn(async () => learnerEnrolments());
vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: { findMany: membershipFindMany, count: membershipCount },
    auditLog: { findMany: auditFindMany },
    courseEnrollment: { findMany: enrollmentFindMany },
    cohort: { count: async () => 0 },
    organisation: { count: async () => 0 },
    course: { count: async () => 0 },
  },
}));
const currentUser = vi.fn(async (): Promise<{ id: string } | null> => null);
vi.mock("@/lib/auth-helpers", () => ({
  getCurrentUser: () => currentUser(),
  getProjectMemberships: async () => [{ role: "FACILITATOR" }],
}));

// The lesson plans of the courses created in the CMS (spec 3.3): none by
// default, as for the bundled courses.
const lessonPlans = vi.fn(async (): Promise<Map<string, LessonPlan>> => new Map());
vi.mock("@/lib/cms/lesson-plans", () => ({
  getLessonPlans: () => lessonPlans(),
}));

afterEach(() => {
  learnerEnrolments.mockImplementation(() => enrollments);
  auditFindMany.mockImplementation(async () => []);
  currentUser.mockImplementation(async () => null);
  lessonPlans.mockImplementation(async () => new Map());
  vi.restoreAllMocks();
});

const NARRATIVE: StageKey[] = ["context", "concept", "behaviour", "reflection"];
vi.mock("@/lib/cms", () => ({
  getCourse: async (_project: string, slug: string) =>
    ({
      slug,
      title: slug,
      stages: NARRATIVE.map((key) => ({ key, title: key })),
    }) as unknown as CourseContent,
}));

const { getProjectLearners, getAdminCounts, getLearnerEnrollments } = await import(
  "./server-queries"
);

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

/*
 * U11 (spec 6, D64): a course created in the CMS is counted against its
 * lesson plan — the lessons its learners get, in their order, its own ("s-…")
 * included — and a lesson the learner finished keeps counting once hidden.
 */
const OWN = "s-abcdefgh";
const OWN2 = "s-ijklmnop";
const lesson = (id: string, label: string) =>
  ({ id, kind: id.startsWith("s-") ? "section" : "stage", label }) as LessonPlan["lessons"][number];
/** saying-no, reordered: its own lesson second; Behaviour hidden. */
const sayingNoPlan: LessonPlan = {
  lessons: [
    lesson("context", "Warm-up"),
    lesson(OWN, "Your boundary"),
    lesson("concept", "The idea"),
    lesson(OWN2, "Try it"),
  ],
  unseen: ["behaviour"],
};
const flexible = (stagesCompleted: string[], sectionsCompleted: string[] | null): Enrolment => ({
  course: { slug: "saying-no" },
  stagesCompleted,
  sectionsCompleted,
  completedAt: null,
  updatedAt: day(4),
  scenarioRoot: null,
  scenarioFollowup: null,
  simulationCorrect: null,
  assessment: null,
});

describe("getProjectLearners, for a course with lessons of its own", () => {
  it("counts the lesson plan's lessons, its own included, and a finished lesson no longer shown", async () => {
    lessonPlans.mockImplementation(async () => new Map([["saying-no", sayingNoPlan]]));
    learnerEnrolments.mockImplementation(() => [
      flexible(["CONTEXT", "BEHAVIOUR"], [OWN]),
    ]);
    const [learner] = (await getProjectLearners("en")) ?? [];
    // context, OWN and the hidden behaviour done, of 4 shown + behaviour = 3 of 5.
    expect(learner.progressPct).toBe(60);
  });

  it("puts the learner on the plan's next lesson, by its step name", async () => {
    lessonPlans.mockImplementation(async () => new Map([["saying-no", sayingNoPlan]]));
    learnerEnrolments.mockImplementation(() => [flexible(["CONTEXT", "CONCEPT"], [OWN])]);
    const [learner] = (await getProjectLearners("en")) ?? [];
    expect(learner.currentStage).toBe(OWN2);
    expect(learner.currentStageLabel).toBe("Try it");
  });

  it("has no step name for a bundled course's lesson (the view names it), nor once complete", async () => {
    const [learner] = (await getProjectLearners("en")) ?? [];
    expect(learner.currentStage).toBe("reflection");
    expect(learner.currentStageLabel).toBeNull();
    lessonPlans.mockImplementation(async () => new Map([["saying-no", sayingNoPlan]]));
    learnerEnrolments.mockImplementation(() => [
      { ...flexible(["CONTEXT"], [OWN]), completedAt: day(5) },
    ]);
    const [done] = (await getProjectLearners("en")) ?? [];
    expect(done.currentStage).toBe("complete");
    expect(done.currentStageLabel).toBeNull();
  });

  it("counts against what the course shows when the plans can't be read, and still lists the learner", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    lessonPlans.mockImplementation(async () => {
      throw new Error("database down");
    });
    const [learner] = (await getProjectLearners("en")) ?? [];
    expect(learner.progressPct).toBe(88);
    expect(console.error).toHaveBeenCalled();
  });

  it("adds time on lessons of the course's own to the total, under their own id", async () => {
    auditFindMany.mockImplementation(async () => [
      { actorId: "u1", action: "stage.time", metadata: { stage: "context", seconds: 60 } },
      { actorId: "u1", action: "stage.time", metadata: { stage: OWN, seconds: 90 } },
    ]);
    const [learner] = (await getProjectLearners("en")) ?? [];
    expect(learner.secondsTotal).toBe(150);
    expect(learner.secondsByStage).toEqual({ context: 60, [OWN]: 90 });
  });
});

describe("getLearnerEnrollments", () => {
  it("lists the lessons finished, its own included, and when the learner was last in the course", async () => {
    currentUser.mockImplementation(async () => ({ id: "u1" }));
    learnerEnrolments.mockImplementation(() => [flexible(["CONTEXT", "CONCEPT"], [OWN, "nonsense"])]);
    expect(await getLearnerEnrollments()).toEqual([
      {
        slug: "saying-no",
        stages: ["context", "concept", OWN],
        stagesCompleted: 3,
        completed: false,
        updatedAt: day(4).toISOString(),
      },
    ]);
  });

  it("is null for a guest", async () => {
    expect(await getLearnerEnrollments()).toBeNull();
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
