import { afterEach, describe, it, expect, vi } from "vitest";
import type { CourseContent, StageKey } from "@/lib/cms/types";
import type { LessonPlan } from "@/lib/cms/sections/learner-path";
import type { Scope } from "@/lib/scope";

/*
 * The staff analytics from captured data, with the database and the course
 * content stood in for: two learners in a course created in the CMS, which
 * has four lessons rather than seven.
 */

vi.mock("server-only", () => ({}));
// The scope module's per-request reads; these tests pass a scope directly.
vi.mock("@/lib/auth-helpers", () => ({
  getCurrentUser: async () => null,
  getProjectMemberships: async () => [],
}));

const now = new Date();
const enrolment = (
  stagesCompleted: string[],
  completedAt: Date | null,
  sectionsCompleted: string[] | null = null
) => ({
  course: { slug: "asking-for-help" },
  stagesCompleted,
  sectionsCompleted,
  completedAt,
  updatedAt: now,
  assessment: null,
});

const learnersOf = vi.fn(() => [
  {
    cohort: null,
    user: {
      id: "finished",
      name: "Ana",
      email: null,
      enrollments: [enrolment(["CONTEXT", "CONCEPT", "BEHAVIOUR", "REFLECTION"], now)],
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
]);
const membershipFindMany = vi.fn();
const auditFindMany = vi.fn(async (): Promise<unknown[]> => []);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: {
      findMany: membershipFindMany.mockImplementation(async () => learnersOf()),
    },
    auditLog: { findMany: auditFindMany },
    userBadge: { count: async () => 1 },
  },
}));

// The lesson plans of the courses created in the CMS (spec 3.3): none by
// default, as for the bundled courses.
const lessonPlans = vi.fn(async (): Promise<Map<string, LessonPlan>> => new Map());
vi.mock("@/lib/cms/lesson-plans", () => ({
  getLessonPlans: () => lessonPlans(),
}));

const defaultLearners = learnersOf.getMockImplementation()!;
afterEach(() => {
  learnersOf.mockImplementation(defaultLearners);
  auditFindMany.mockImplementation(async () => []);
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

const { buildRealAnalytics: analyticsFor } = await import("./analytics-real");
const { statisticsMembershipsInScope } = await import("./scope");

/** An ADMIN's scope: the whole project. */
const PROJECT_SCOPE: Scope = { kind: "project", viewerId: "admin", viewerOrganisationId: null };
const ORG_A: Scope = { kind: "organisation", viewerId: "fac-a", organisationId: "org-a" };
const NONE: Scope = { kind: "none" };
/** The statistics as an ADMIN reads them (most tests). */
const buildRealAnalytics = (locale: "en") => analyticsFor(PROJECT_SCOPE, locale);

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

/*
 * U11 (spec 6, D64, D70): a course created in the CMS is counted against
 * its lesson plan, its own lessons ("s-…") included; a learner whose next
 * lesson is one of those is counted beside the seven-step funnel
 * (funnelOther); time in them is in the total (secondsOther).
 */
const OWN = "s-abcdefgh";
const OWN2 = "s-ijklmnop";
const plan: LessonPlan = {
  lessons: [
    { id: "context", kind: "stage", label: "Context" },
    { id: OWN, kind: "section", label: "Your own" },
    { id: "concept", kind: "stage", label: "Concept" },
    { id: OWN2, kind: "section", label: "Try it" },
  ],
  unseen: ["reflection"],
};
const one = (id: string, enrollments: ReturnType<typeof enrolment>[]) => ({
  cohort: null,
  user: { id, name: id, email: null, enrollments },
});

describe("buildRealAnalytics, for a course with lessons of its own", () => {
  it("counts progress against the lesson plan, its own lessons and a finished hidden one included", async () => {
    lessonPlans.mockImplementation(async () => new Map([["asking-for-help", plan]]));
    learnersOf.mockImplementation(() => [
      one("own", [enrolment(["CONTEXT", "REFLECTION"], null, [OWN])]),
    ]);
    const data = await buildRealAnalytics("en");
    // context, OWN and the hidden reflection: 3 of 4 shown + reflection.
    expect(data?.learners[0].progressPct).toBe(60);
  });

  it("counts a learner whose next lesson is one of the course's own beside the funnel", async () => {
    lessonPlans.mockImplementation(async () => new Map([["asking-for-help", plan]]));
    learnersOf.mockImplementation(() => [
      one("onOwn", [enrolment(["CONTEXT"], null)]),
      one("onConcept", [enrolment(["CONTEXT"], null, [OWN])]),
    ]);
    const data = await buildRealAnalytics("en");
    const byId = new Map(data?.learners.map((l) => [l.id, l]));
    // Not a step of the seven: no index on it.
    expect(byId.get("onOwn")?.currentStageIndex).toBe(-1);
    expect(byId.get("onConcept")?.currentStageIndex).toBe(1);
    expect(data?.funnelOther).toEqual({ reached: 1, pct: 50 });
  });

  it("keeps a learner on the funnel's steps they finished while they are on one of the course's own lessons", async () => {
    // Review finding 6: Context done, now on a lesson of the course's own.
    // The funnel had them at no step at all ("Context 0 · 0%") and put the
    // biggest drop-off on a step with nobody before it.
    lessonPlans.mockImplementation(async () => new Map([["asking-for-help", plan]]));
    learnersOf.mockImplementation(() => [one("onOwn", [enrolment(["CONTEXT"], null)])]);
    const data = await buildRealAnalytics("en");
    expect(data?.learners[0].currentStageIndex).toBe(-1);
    expect(data?.funnel[0]).toEqual({ label: "Context", reached: 1, pct: 100 });
    expect(data?.funnel[1]).toEqual({ label: "Concept", reached: 0, pct: 0 });
    expect(data?.funnelOther).toEqual({ reached: 1, pct: 100 });
  });

  it("never puts a learner past the last step of a course that only has no lessons left (finding 5)", async () => {
    // The plan has no lesson (every one emptied or hidden); the learner
    // finished one before that and never completed the course.
    lessonPlans.mockImplementation(async () => new Map([["asking-for-help", { lessons: [], unseen: [OWN] }]]));
    learnersOf.mockImplementation(() => [one("emptied", [enrolment([], null, [OWN])])]);
    const data = await buildRealAnalytics("en");
    expect(data?.learners[0].currentStageIndex).not.toBe(7);
    expect(data?.learners[0].completed).toBe(false);
    expect(data?.funnel.at(-1)).toEqual({ label: "Completed", reached: 0, pct: 0 });
  });

  it("counts a step the learner finished ahead of the course's next one (a course in its own order)", async () => {
    // Concept before Context: done Concept, now on Context.
    lessonPlans.mockImplementation(async () =>
      new Map([
        [
          "asking-for-help",
          {
            lessons: [
              { id: "concept", kind: "stage", label: "Concept" },
              { id: "context", kind: "stage", label: "Context" },
            ],
            unseen: [],
          } satisfies LessonPlan,
        ],
      ])
    );
    learnersOf.mockImplementation(() => [one("reordered", [enrolment(["CONCEPT"], null)])]);
    const data = await buildRealAnalytics("en");
    expect(data?.learners[0].currentStageIndex).toBe(0);
    expect(data?.funnel.slice(0, 3).map((f) => f.reached)).toEqual([1, 1, 0]);
  });

  it("has nobody beside the funnel when every learner is on a standard lesson", async () => {
    const data = await buildRealAnalytics("en");
    expect(data?.funnelOther).toEqual({ reached: 0, pct: 0 });
  });

  it("adds time in lessons of the course's own to the total, as secondsOther", async () => {
    auditFindMany.mockImplementation(async () => [
      { actorId: "halfway", action: "stage.time", metadata: { stage: "context", seconds: 60 }, createdAt: now },
      { actorId: "halfway", action: "stage.time", metadata: { stage: OWN, seconds: 90 }, createdAt: now },
    ]);
    const data = await buildRealAnalytics("en");
    const halfway = data?.learners.find((l) => l.id === "halfway");
    expect(halfway?.secondsByStage).toEqual([60, 0, 0, 0, 0, 0, 0]);
    expect(halfway?.secondsOther).toBe(90);
    // The same total as the facilitator's view.
    expect(halfway?.secondsTotal).toBe(150);
  });

  it("counts by the stages each course shows when the plans can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    lessonPlans.mockImplementation(async () => {
      throw new Error("database down");
    });
    const data = await buildRealAnalytics("en");
    expect(data?.learners.find((l) => l.id === "halfway")?.progressPct).toBe(75);
    expect(console.error).toHaveBeenCalled();
  });
});

/** Every key at any depth of `value`. */
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  }
  return out;
}

const lastQuery = () => (membershipFindMany.mock.calls.at(-1) as unknown[] | undefined)?.[0] as Record<string, unknown>;

/*
 * FD-U10 (D74, D83, spec 3.4 SP9, 7.2): the statistics are read for the
 * viewer's scope, by the statistics filter: D53's learners, less anyone who
 * ever held a staff role and marked test accounts. (The start date is
 * Stream C's.)
 */
describe("whose data the statistics use", () => {
  // Staff who opened a learner page before Release 0 still hold the LEARNER
  // role it gave everyone; their test runs aren't learners' progress.
  it("leaves out staff, anyone who ever held a staff role, and test accounts", async () => {
    membershipFindMany.mockClear();
    await buildRealAnalytics("en");
    expect(membershipFindMany).toHaveBeenCalledTimes(1);
    expect(lastQuery().where).toEqual(statisticsMembershipsInScope(PROJECT_SCOPE, null));
    const [learners, neverStaff, notTest] = (lastQuery().where as { AND: unknown[] }).AND;
    expect(learners).toEqual({
      projectId: "seq-elevate",
      role: "LEARNER",
      user: {
        memberships: {
          none: {
            projectId: "seq-elevate",
            role: {
              in: expect.arrayContaining(["FACILITATOR", "ADMIN", "CONTENT_EDITOR", "PARTNER_ADMIN"]),
            },
          },
        },
      },
    });
    expect(neverStaff).toEqual({ user: { staffHistory: { none: { projectId: "seq-elevate" } } } });
    expect(notTest).toEqual({
      user: { profiles: { none: { projectId: "seq-elevate", testAccountAt: { not: null } } } },
    });
  });

  it("reads only the viewer's organisation for partner staff", async () => {
    await analyticsFor(ORG_A, "en");
    expect(lastQuery().where).toEqual(statisticsMembershipsInScope(ORG_A, null));
    expect(JSON.stringify(lastQuery().where)).toContain('"organisationId":"org-a"');
  });

  it("answers null for no scope, without asking the database", async () => {
    membershipFindMany.mockClear();
    auditFindMany.mockClear();
    expect(await analyticsFor(NONE, "en")).toBeNull();
    expect(membershipFindMany).not.toHaveBeenCalled();
    expect(auditFindMany).not.toHaveBeenCalled();
  });

  it("selects what it counts, never a reflection or the other answers", async () => {
    await buildRealAnalytics("en");
    const query = lastQuery();
    expect(query.include).toBeUndefined();
    const keys = keysOf(query.select);
    expect(keys.has("reflection")).toBe(false);
    expect(keys.has("responses")).toBe(false);
    expect(keys.has("compCards")).toBe(false);
    // Nothing of the user beyond who they are and their enrolments.
    const user = (query.select as { user: { select: Record<string, unknown> } }).user.select;
    expect(Object.keys(user).sort()).toEqual(["email", "enrollments", "id", "name"]);
  });
});
