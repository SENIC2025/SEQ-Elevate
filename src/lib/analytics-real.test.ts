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
/** When the fixtures' learners started: long before any date the tests count from. */
const LONG_AGO = new Date("2020-01-01T00:00:00Z");
const enrolment = (
  stagesCompleted: string[],
  completedAt: Date | null,
  sectionsCompleted: string[] | null = null,
  dates: { enrolledAt?: Date; updatedAt?: Date } = {}
) => ({
  course: { slug: "asking-for-help" },
  stagesCompleted,
  sectionsCompleted,
  completedAt,
  enrolledAt: dates.enrolledAt ?? LONG_AGO,
  updatedAt: dates.updatedAt ?? now,
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
/** A date filter as the queries write it ({ gte }), or none. */
type Since = { gte?: Date } | undefined;
const since = (at: Date, filter: Since) => !filter?.gte || at >= filter.gte;

/*
 * The database, stood in for: each read answers the fixtures, by the date
 * filters the query asks for (enrolments, events, badges), as Postgres would.
 */
const membershipFindMany = vi.fn();
type MembershipQuery = {
  select: { user: { select: { enrollments: { where?: { enrolledAt?: Since } } } } };
};
const auditEvents = vi.fn(
  (): { actorId: string; action: string; metadata: unknown; createdAt: Date }[] => []
);
const auditFindMany = vi.fn(async (query: { where: { createdAt?: Since } }): Promise<unknown[]> =>
  auditEvents().filter((ev) => since(ev.createdAt, query.where.createdAt))
);
const badgesAwarded = vi.fn((): Date[] => [LONG_AGO]);
const badgeCount = vi.fn(
  async (query: { where: { awardedAt?: Since } }) =>
    badgesAwarded().filter((at) => since(at, query.where.awardedAt)).length
);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: {
      findMany: membershipFindMany.mockImplementation(async (query: MembershipQuery) => {
        const from = query.select.user.select.enrollments.where?.enrolledAt;
        return learnersOf().map((m) => ({
          ...m,
          user: { ...m.user, enrollments: m.user.enrollments.filter((e) => since(e.enrolledAt, from)) },
        }));
      }),
    },
    auditLog: { findMany: auditFindMany },
    userBadge: { count: badgeCount },
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
  auditEvents.mockImplementation(() => []);
  badgesAwarded.mockImplementation(() => [LONG_AGO]);
  lessonPlans.mockImplementation(async () => new Map());
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
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

const { buildRealAnalytics: readAnalytics } = await import("./analytics-real");
/** The figures, or null when there are none; a read that failed fails the test. */
const analyticsFor = async (...args: Parameters<typeof readAnalytics>) => {
  const data = await readAnalytics(...args);
  if (data === "unreadable") throw new Error("the statistics read failed");
  return data;
};
const { statisticsMembershipsInScope } = await import("./scope");

/** An ADMIN's scope: the whole project. */
const PROJECT_SCOPE: Scope = { kind: "project", viewerId: "admin", viewerOrganisationId: null };
const ORG_A: Scope = { kind: "organisation", viewerId: "fac-a", organisationId: "org-a" };
const NONE: Scope = { kind: "none" };
/** The statistics as an ADMIN reads them with no start date (STATS_FROM=off): most tests. */
const buildRealAnalytics = (locale: "en") => analyticsFor(PROJECT_SCOPE, locale, null);

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
    auditEvents.mockImplementation(() => [
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
    await analyticsFor(ORG_A, "en", null);
    expect(lastQuery().where).toEqual(statisticsMembershipsInScope(ORG_A, null));
    expect(JSON.stringify(lastQuery().where)).toContain('"organisationId":"org-a"');
  });

  it("answers null for no scope, without asking the database", async () => {
    membershipFindMany.mockClear();
    auditFindMany.mockClear();
    expect(await analyticsFor(NONE, "en", null)).toBeNull();
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

/*
 * UC2 (D83, spec 7.3): the statistics count from STATS_FROM (stats-from.ts):
 * only enrolments made since then, and only the time, video answers, course
 * opens and badges recorded since then. A learner's position, progress and
 * last activity come from what is counted. A failure is logged, without
 * learner data, so a broken filter doesn't pass for "no statistics yet".
 */
describe("the statistics' start date", () => {
  const FROM = new Date("2026-12-01T00:00:00+01:00");
  const before = (ms: number) => new Date(FROM.getTime() - ms);
  const after = (ms: number) => new Date(FROM.getTime() + ms);
  const lastMembershipQuery = () => lastQuery() as unknown as MembershipQuery & { where: unknown };
  /** One learner, who started on the date, and was last in the course a second later. */
  const startedOnTheDate = () =>
    learnersOf.mockImplementation(() => [
      one("since", [enrolment(["CONTEXT"], null, null, { enrolledAt: FROM, updatedAt: after(1000) })]),
    ]);

  it("asks for the learners, enrolments, events and badges since STATS_FROM", async () => {
    vi.stubEnv("STATS_FROM", "2026-11-02T08:00:00Z");
    const at = new Date("2026-11-02T08:00:00Z");
    startedOnTheDate();
    auditFindMany.mockClear();
    badgeCount.mockClear();
    expect(await analyticsFor(PROJECT_SCOPE, "en")).not.toBeNull();
    expect(lastMembershipQuery().where).toEqual(statisticsMembershipsInScope(PROJECT_SCOPE, at));
    expect(lastMembershipQuery().select.user.select.enrollments.where).toEqual({ enrolledAt: { gte: at } });
    expect(auditFindMany.mock.calls.at(-1)?.[0].where.createdAt).toEqual({ gte: at });
    expect(badgeCount.mock.calls.at(-1)?.[0].where.awardedAt).toEqual({ gte: at });
  });

  it("counts from 1 December 2026 when STATS_FROM is unset", async () => {
    vi.stubEnv("STATS_FROM", "");
    await analyticsFor(PROJECT_SCOPE, "en");
    expect(lastMembershipQuery().where).toEqual(statisticsMembershipsInScope(PROJECT_SCOPE, FROM));
  });

  it("counts everything with STATS_FROM=off, as before", async () => {
    vi.stubEnv("STATS_FROM", "off");
    auditFindMany.mockClear();
    badgeCount.mockClear();
    expect(await analyticsFor(PROJECT_SCOPE, "en")).not.toBeNull();
    expect(lastMembershipQuery().where).toEqual(statisticsMembershipsInScope(PROJECT_SCOPE, null));
    expect(lastMembershipQuery().select.user.select.enrollments).not.toHaveProperty("where");
    expect(auditFindMany.mock.calls.at(-1)?.[0].where).not.toHaveProperty("createdAt");
    expect(badgeCount.mock.calls.at(-1)?.[0].where).not.toHaveProperty("awardedAt");
  });

  it("takes the date it is given over the setting (the page shows the date it counts from)", async () => {
    vi.stubEnv("STATS_FROM", "off");
    await analyticsFor(PROJECT_SCOPE, "en", FROM);
    expect(lastMembershipQuery().where).toEqual(statisticsMembershipsInScope(PROJECT_SCOPE, FROM));
  });

  it("leaves out an enrolment made before the date, and picks the latest among those since", async () => {
    learnersOf.mockImplementation(() => [
      one("both", [
        // Finished before the date, and touched last.
        enrolment(["CONTEXT", "CONCEPT", "BEHAVIOUR", "REFLECTION"], before(86_400_000), null, {
          enrolledAt: before(2 * 86_400_000),
          updatedAt: after(2 * 86_400_000),
        }),
        // Started since, halfway.
        enrolment(["CONTEXT", "CONCEPT"], null, null, { enrolledAt: after(1000), updatedAt: after(1000) }),
      ]),
    ]);
    const data = await analyticsFor(PROJECT_SCOPE, "en", FROM);
    expect(data?.learners).toHaveLength(1);
    expect(data?.learners[0].completed).toBe(false);
    expect(data?.learners[0].progressPct).toBe(50);
    expect(data?.kpis.completed).toBe(0);
  });

  it("has nothing to show when every enrolment was made before the date", async () => {
    learnersOf.mockImplementation(() => [
      one("early", [enrolment(["CONTEXT"], null, null, { enrolledAt: before(1), updatedAt: after(1000) })]),
    ]);
    expect(await analyticsFor(PROJECT_SCOPE, "en", FROM)).toBeNull();
  });

  it("counts only the time and course opens recorded since the date", async () => {
    learnersOf.mockImplementation(() => [
      one("timed", [enrolment(["CONTEXT"], null, null, { enrolledAt: after(1000), updatedAt: after(1000) })]),
    ]);
    auditEvents.mockImplementation(() => [
      { actorId: "timed", action: "stage.time", metadata: { stage: "context", seconds: 600 }, createdAt: before(1) },
      { actorId: "timed", action: "stage.time", metadata: { stage: "context", seconds: 60 }, createdAt: after(5000) },
      { actorId: "timed", action: "course.opened", metadata: null, createdAt: before(1) },
    ]);
    const data = await analyticsFor(PROJECT_SCOPE, "en", FROM);
    expect(data?.learners[0].secondsByStage[0]).toBe(60);
    expect(data?.learners[0].secondsTotal).toBe(60);
    expect(data?.heatmap.flat().reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("counts only the badges awarded since the date", async () => {
    startedOnTheDate();
    badgesAwarded.mockImplementation(() => [before(1), FROM, after(1)]);
    expect((await analyticsFor(PROJECT_SCOPE, "en", FROM))?.kpis.badges).toBe(2);
    expect((await analyticsFor(PROJECT_SCOPE, "en", null))?.kpis.badges).toBe(3);
  });

  it("logs a failure without learner data, and answers that the read failed, not that no one started", async () => {
    // Review R2: a null here read as "no learner has started" on the page.
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    membershipFindMany.mockImplementationOnce(async () => {
      throw new TypeError("lena@example.com: column missing");
    });
    expect(await readAnalytics(PROJECT_SCOPE, "en", FROM)).toBe("unreadable");
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]).toEqual(["[statistics] failed: TypeError"]);
  });
});
