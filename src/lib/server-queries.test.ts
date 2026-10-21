import { afterEach, describe, it, expect, vi } from "vitest";
import type { CourseContent, StageKey } from "@/lib/cms/types";
import type { LessonPlan } from "@/lib/cms/sections/learner-path";
import type { Scope } from "@/lib/scope";

vi.mock("server-only", () => ({}));

/*
 * The facilitator's per-learner progress, with the database, the sign-in
 * and the course content stood in for: one learner who finished a course
 * created in the CMS (four lessons) and is halfway through another.
 */

const day = (n: number) => new Date(Date.UTC(2026, 9, n));

const enrollments = [
  {
    course: { slug: "asking-for-help", cluster: "communicationEi" },
    stagesCompleted: ["CONTEXT", "CONCEPT", "BEHAVIOUR", "REFLECTION"],
    completedAt: day(2),
    updatedAt: day(2),
    scenarioRoot: null,
    scenarioFollowup: null,
    simulationCorrect: null,
    assessment: null,
  },
  {
    course: { slug: "saying-no", cluster: "resilience" },
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

/** A learner whose enrollments are `list` (the last-updated one is current). */
const learnerOn = (list: unknown[]) => [
  {
    user: {
      id: "u1",
      name: "Ana",
      email: "ana@example.test",
      enrollments: list,
      compCards: [],
      profiles: [],
      staffHistory: [],
    },
  },
];
const membershipFindMany = vi.fn(async (): Promise<unknown[]> => learnerOn(learnerEnrolments()));
const membershipCount = vi.fn(async () => 1);
const auditFindMany = vi.fn(async (): Promise<unknown[]> => []);
const enrollmentFindMany = vi.fn(async () => learnerEnrolments());
const cohortCount = vi.fn(async () => 0);
const organisationCount = vi.fn(async () => 0);
const organisationFindFirst = vi.fn(async (): Promise<unknown> => ({ name: "Pro Arbeit" }));
const courseCount = vi.fn(async () => 0);
// The Comp Card template (Project.compCardTemplate): nothing hidden by default.
const projectFindUnique = vi.fn(async (): Promise<unknown> => ({ compCardTemplate: null }));
// The stored exercise of a created course's applied scenario (Lesson.structure): none by default.
const lessonFindMany = vi.fn(async (): Promise<unknown[]> => []);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: { findMany: membershipFindMany, count: membershipCount },
    auditLog: { findMany: auditFindMany },
    courseEnrollment: { findMany: enrollmentFindMany },
    cohort: { count: cohortCount },
    organisation: { count: organisationCount, findFirst: organisationFindFirst },
    course: { count: courseCount },
    project: { findUnique: projectFindUnique },
    lesson: { findMany: lessonFindMany },
  },
}));
const currentUser = vi.fn(async (): Promise<{ id: string } | null> => null);
const viewerRoles = vi.fn(async (): Promise<{ role: string }[]> => [{ role: "FACILITATOR" }]);
vi.mock("@/lib/auth-helpers", () => ({
  getCurrentUser: () => currentUser(),
  getProjectMemberships: () => viewerRoles(),
}));

// The lesson plans of the courses created in the CMS (spec 3.3): none by
// default, as for the bundled courses.
const lessonPlans = vi.fn(async (): Promise<Map<string, LessonPlan>> => new Map());
vi.mock("@/lib/cms/lesson-plans", () => ({
  getLessonPlans: () => lessonPlans(),
}));

afterEach(() => {
  learnerEnrolments.mockImplementation(() => enrollments);
  getCourse.mockImplementation(narrativeCourse);
  lessonFindMany.mockClear();
  lessonFindMany.mockImplementation(async () => []);
  viewerRoles.mockImplementation(async () => [{ role: "FACILITATOR" }]);
  projectFindUnique.mockImplementation(async () => ({ compCardTemplate: null }));
  auditFindMany.mockImplementation(async () => []);
  currentUser.mockImplementation(async () => null);
  lessonPlans.mockImplementation(async () => new Map());
  vi.restoreAllMocks();
});

const NARRATIVE: StageKey[] = ["context", "concept", "behaviour", "reflection"];
const narrativeCourse = async (_project: string, slug: string) =>
  ({
    slug,
    title: slug,
    stages: NARRATIVE.map((key) => ({ key, title: key })),
  }) as unknown as CourseContent;
const getCourse = vi.fn(narrativeCourse);
vi.mock("@/lib/cms", () => ({
  getCourse: (project: string, slug: string) => getCourse(project, slug),
}));

const { getProjectLearners: learnersFor, getAdminCounts, getLearnerEnrollments, scopeOrganisationName } = await import(
  "./server-queries"
);
const {
  cohortsInScope,
  learnerMembershipsInScope,
  organisationsInScope,
  statisticsMembershipsInScope,
  MATCH_NOTHING,
} = await import("./scope");

/** An ADMIN's scope (SENIC: no organisation of their own). */
const PROJECT_SCOPE: Scope = { kind: "project", viewerId: "admin", viewerOrganisationId: null };
/** A facilitator or partner admin of organisation A. */
const ORG_A: Scope = { kind: "organisation", viewerId: "fac-a", organisationId: "org-a" };
const NONE: Scope = { kind: "none" };

/** The roster as a facilitator of organisation A reads it (most tests). */
const getProjectLearners = (locale: "en" | "de" | "el") => learnersFor(ORG_A, locale);

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

  it("gives the skill cluster of the course they are on, for a validation", async () => {
    const [learner] = (await getProjectLearners("en")) ?? [];
    // The course they used last, not the first one or always Communication.
    expect(learner.currentCluster).toBe("resilience");
  });

  /*
   * A course created in the platform says its skill area in each
   * language's copy (meta), which an editor can change on the course page.
   * The `cluster` key it was given when it was made ("communication" when
   * it had none) never follows.
   */
  const onCreatedCourse = (cluster: string, meta: Record<string, object>) =>
    learnerOn([
      {
        ...enrollments[1],
        course: { slug: "created-course", cluster, meta },
      },
    ]);
  const copy = (clusterLabel: string) => ({ title: "Created", tagline: "", clusterLabel });

  it("follows a created course's skill area after it was renamed", async () => {
    // Made as "Teamwork", renamed to "Leadership" on the course page.
    membershipFindMany.mockImplementationOnce(async () =>
      onCreatedCourse("teamwork", { en: copy("Leadership") })
    );
    const [learner] = (await getProjectLearners("en")) ?? [];
    expect(learner.currentCluster).toBe("leadership");
  });

  it("starts on none for a created course with no skill area", async () => {
    // Its key is "communication", but it names no skill area: "Skill".
    membershipFindMany.mockImplementationOnce(async () =>
      onCreatedCourse("communication", { en: copy("Skill") })
    );
    const [learner] = (await getProjectLearners("en")) ?? [];
    expect(learner.currentCluster).toBeNull();
  });

  it("starts on none when a created course's languages name different skill areas", async () => {
    membershipFindMany.mockImplementationOnce(async () =>
      onCreatedCourse("teamwork", { en: copy("Leadership"), de: copy("Teamwork") })
    );
    const [learner] = (await getProjectLearners("en")) ?? [];
    expect(learner.currentCluster).toBeNull();
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
    // An ADMIN's roster: the whole project, by D53's rule alone.
    await learnersFor(PROJECT_SCOPE, "en");
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
  course: { slug: "saying-no", cluster: "resilience" },
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
    expect(learner.currentStageLabelLang).toBeUndefined();
  });

  it("says the language of that step name when it isn't the page's (WCAG 3.1.2)", async () => {
    // Named only in English, on a German page.
    const dePlan: LessonPlan = {
      ...sayingNoPlan,
      lessons: sayingNoPlan.lessons.map((l) => (l.id === OWN2 ? { ...l, lang: "en" as const } : l)),
    };
    lessonPlans.mockImplementation(async () => new Map([["saying-no", dePlan]]));
    learnerEnrolments.mockImplementation(() => [flexible(["CONTEXT", "CONCEPT"], [OWN])]);
    const [learner] = (await getProjectLearners("de")) ?? [];
    expect(learner.currentStageLabel).toBe("Try it");
    expect(learner.currentStageLabelLang).toBe("en");
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

  it("never says a learner completed a course that only has no lessons left (finding 5)", async () => {
    // Every lesson emptied or hidden after the learner finished one: the
    // plan has none, the one they finished still counts (unseen ∩ done),
    // and they never completed the course.
    lessonPlans.mockImplementation(async () => new Map([["saying-no", { lessons: [], unseen: [OWN] }]]));
    learnerEnrolments.mockImplementation(() => [flexible([], [OWN])]);
    const [learner] = (await getProjectLearners("en")) ?? [];
    expect(learner.currentStage).not.toBe("complete");
    expect(learner.currentStage).toBeNull();
    expect(learner.currentStageLabel).toBeNull();
    expect(learner.completed).toBe(false);
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

/*
 * FD-U9 (D74, D80, spec 3.2, 4.4, 7.4): the roster is read for the viewer's
 * scope, and a Comp Card's text reaches the page only when it was shared
 * with the viewer's organisation. Two independent filters: the query asks
 * the database only for cards shared with that organisation (and for no
 * card at all when the viewer has none), and compCardForViewer checks each
 * card again against the learner's current organisation.
 */

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

const sharedAt = new Date("2026-11-21T10:00:00Z");
const card = (over: Record<string, unknown> = {}) => ({
  wentWell: "MARKER-WENT-WELL",
  difficult: "MARKER-DIFFICULT",
  improve: "MARKER-IMPROVE",
  behaviour: "MARKER-BEHAVIOUR",
  confidence: 4,
  privacy: "FACILITATOR",
  sharedAt,
  sharedWithOrganisationId: "org-a",
  ...over,
});
/** One learner of organisation `org` whose card the database answers as `cards`. */
const learnerWith = (org: string | null, cards: unknown[], user: Record<string, unknown> = {}) => [
  {
    user: {
      id: "u1",
      name: "Ana",
      email: "ana@example.test",
      enrollments: enrollments,
      compCards: cards,
      profiles: [{ organisationId: org, testAccountAt: null }],
      staffHistory: [],
      ...user,
    },
  },
];
const lastQuery = () =>
  (membershipFindMany.mock.calls.at(-1) as unknown[] | undefined)?.[0] as Record<string, unknown>;

describe("getProjectLearners, for the viewer's scope (FD-U9)", () => {
  afterEach(() => {
    membershipFindMany.mockReset();
    membershipFindMany.mockImplementation(async () => learnerOn(learnerEnrolments()));
  });

  it("answers null for no scope, without asking the database", async () => {
    membershipFindMany.mockClear();
    auditFindMany.mockClear();
    expect(await learnersFor(NONE, "en")).toBeNull();
    expect(membershipFindMany).not.toHaveBeenCalled();
    expect(auditFindMany).not.toHaveBeenCalled();
  });

  it("answers null for someone who doesn't support learners, whatever scope is passed", async () => {
    viewerRoles.mockImplementation(async () => [{ role: "CONTENT_EDITOR" }]);
    membershipFindMany.mockClear();
    expect(await learnersFor(ORG_A, "en")).toBeNull();
    expect(membershipFindMany).not.toHaveBeenCalled();
  });

  it("reads only the learners of the viewer's organisation", async () => {
    await learnersFor(ORG_A, "en");
    expect(lastQuery().where).toEqual(learnerMembershipsInScope(ORG_A));
  });

  it("reads whole-project learners for an ADMIN", async () => {
    viewerRoles.mockImplementation(async () => [{ role: "ADMIN" }]);
    await learnersFor(PROJECT_SCOPE, "en");
    expect(lastQuery().where).toEqual(learnerMembershipsInScope(PROJECT_SCOPE));
  });

  it("selects the fields it needs and never a reflection or the other answers", async () => {
    await learnersFor(ORG_A, "en");
    const query = lastQuery();
    expect(query.include).toBeUndefined();
    const keys = keysOf(query.select);
    expect(keys.has("reflection")).toBe(false);
    expect(keys.has("responses")).toBe(false);
    expect(keys.has("simulationChoice")).toBe(false);
  });

  it("asks only for cards shared with the viewer's organisation", async () => {
    await learnersFor(ORG_A, "en");
    const user = (lastQuery().select as { user: { select: Record<string, unknown> } }).user.select;
    expect(user.compCards).toMatchObject({
      where: {
        projectId: "seq-elevate",
        privacy: "FACILITATOR",
        sharedAt: { not: null },
        sharedWithOrganisationId: "org-a",
      },
    });
  });

  it("asks for no card at all when the viewer has no organisation", async () => {
    viewerRoles.mockImplementation(async () => [{ role: "ADMIN" }]);
    await learnersFor(PROJECT_SCOPE, "en");
    const user = (lastQuery().select as { user: { select: Record<string, unknown> } }).user.select;
    expect(user.compCards ?? false).toBe(false);
  });

  it("gives the text of a card shared with the viewer's organisation", async () => {
    membershipFindMany.mockImplementation(async () => learnerWith("org-a", [card()]));
    const [learner] = (await learnersFor(ORG_A, "en")) ?? [];
    expect(learner.compCard).toEqual({
      fields: {
        wentWell: "MARKER-WENT-WELL",
        difficult: "MARKER-DIFFICULT",
        improve: "MARKER-IMPROVE",
        behaviour: "MARKER-BEHAVIOUR",
      },
      confidence: 4,
      sharedAt: sharedAt.toISOString(),
    });
  });

  // The database filter is the first check; these rows reach the code only
  // if it failed, and the second check still keeps their text out.
  it.each([
    ["an unshared card", card({ privacy: "SELF", sharedAt: null, sharedWithOrganisationId: null }), "org-a"],
    ["a card a Release 2 page marked shared", card({ sharedAt: null, sharedWithOrganisationId: null }), "org-a"],
    ["the mentor option", card({ privacy: "FACILITATOR_AND_MENTOR" }), "org-a"],
    ["a card shared with another organisation", card({ sharedWithOrganisationId: "org-b" }), "org-a"],
    ["a card shared before the learner moved", card(), "org-b"],
    ["a card of a learner with no organisation", card(), null],
  ])("gives nothing of %s", async (_name, row, learnerOrg) => {
    membershipFindMany.mockImplementation(async () => learnerWith(learnerOrg, [row]));
    const [learner] = (await learnersFor(ORG_A, "en")) ?? [];
    expect(learner.compCard).toBeNull();
    expect(JSON.stringify(learner)).not.toContain("MARKER");
  });

  it("gives a SENIC admin (no organisation) no card text, even if a row reaches it", async () => {
    viewerRoles.mockImplementation(async () => [{ role: "ADMIN" }]);
    membershipFindMany.mockImplementation(async () => learnerWith("org-a", [card()]));
    const [learner] = (await learnersFor(PROJECT_SCOPE, "en")) ?? [];
    expect(learner.compCard).toBeNull();
    expect(JSON.stringify(learner)).not.toContain("MARKER");
  });

  it("gives an admin of the organisation the cards shared with it", async () => {
    viewerRoles.mockImplementation(async () => [{ role: "ADMIN" }]);
    membershipFindMany.mockImplementation(async () => learnerWith("org-a", [card()]));
    const diesisAdmin: Scope = { kind: "project", viewerId: "ad", viewerOrganisationId: "org-a" };
    const [learner] = (await learnersFor(diesisAdmin, "en")) ?? [];
    expect(learner.compCard?.fields.wentWell).toBe("MARKER-WENT-WELL");
  });

  it("leaves out a field the Comp Card template hides in any language, and a hidden confidence", async () => {
    projectFindUnique.mockImplementation(async () => ({
      compCardTemplate: { de: { hidden: ["difficult"] }, el: { hidden: ["confidence"] } },
    }));
    membershipFindMany.mockImplementation(async () => learnerWith("org-a", [card()]));
    const [learner] = (await learnersFor(ORG_A, "en")) ?? [];
    expect(learner.compCard?.fields).toEqual({
      wentWell: "MARKER-WENT-WELL",
      improve: "MARKER-IMPROVE",
      behaviour: "MARKER-BEHAVIOUR",
    });
    expect(learner.compCard?.confidence).toBeNull();
  });

  it("lists nobody when the Comp Card template can't be read (fails closed)", async () => {
    projectFindUnique.mockImplementation(async () => {
      throw new Error("database down");
    });
    membershipFindMany.mockImplementation(async () => learnerWith("org-a", [card()]));
    expect(await learnersFor(ORG_A, "en")).toEqual([]);
  });

  it("says whether the learner is a marked test account or former staff (spec 7.4)", async () => {
    membershipFindMany.mockImplementation(async () =>
      learnerWith("org-a", [], {
        profiles: [{ organisationId: "org-a", testAccountAt: new Date() }],
        staffHistory: [{ firstAt: new Date() }],
      })
    );
    const [learner] = (await learnersFor(ORG_A, "en")) ?? [];
    expect(learner).toMatchObject({ testAccount: true, formerStaff: true });
    membershipFindMany.mockImplementation(async () => learnerWith("org-a", []));
    const [other] = (await learnersFor(ORG_A, "en")) ?? [];
    expect(other).toMatchObject({ testAccount: false, formerStaff: false });
  });

  it("asks for the test mark and staff history of this project only", async () => {
    await learnersFor(ORG_A, "en");
    const user = (lastQuery().select as { user: { select: Record<string, unknown> } }).user.select;
    expect(user.profiles).toMatchObject({ where: { projectId: "seq-elevate" } });
    expect(user.staffHistory).toMatchObject({ where: { projectId: "seq-elevate" } });
  });
});

describe("getAdminCounts (FD-U9, spec 7.4)", () => {
  afterEach(() => {
    membershipCount.mockClear();
    cohortCount.mockClear();
    organisationCount.mockClear();
    courseCount.mockClear();
  });

  it("answers zeros for no scope, without asking the database", async () => {
    await expect(getAdminCounts(NONE)).resolves.toEqual({ users: 0, cohorts: 0, organisations: 0, courses: 0 });
    expect(membershipCount).not.toHaveBeenCalled();
    expect(cohortCount).not.toHaveBeenCalled();
    expect(organisationCount).not.toHaveBeenCalled();
    expect(courseCount).not.toHaveBeenCalled();
  });

  it("counts learners by the statistics filter without a date: no staff, former staff or test accounts", async () => {
    await expect(getAdminCounts(PROJECT_SCOPE)).resolves.toMatchObject({ users: 1 });
    expect(membershipCount.mock.calls).toEqual([[{ where: statisticsMembershipsInScope(PROJECT_SCOPE, null) }]]);
    // Still D53's rule first: no one holding a staff role now.
    const where = statisticsMembershipsInScope(PROJECT_SCOPE, null) as { AND: unknown[] };
    expect(where.AND[0]).toEqual(LEARNERS_ONLY);
  });

  it("counts a partner admin's own organisation and its cohorts only", async () => {
    await getAdminCounts(ORG_A);
    expect(membershipCount.mock.calls).toEqual([[{ where: statisticsMembershipsInScope(ORG_A, null) }]]);
    expect(cohortCount.mock.calls).toEqual([[{ where: cohortsInScope(ORG_A) }]]);
    expect(organisationCount.mock.calls).toEqual([[{ where: organisationsInScope(ORG_A) }]]);
  });

  it("never passes undefined as a filter", async () => {
    await getAdminCounts(ORG_A);
    expect(JSON.stringify(membershipCount.mock.calls)).not.toContain("undefined");
    expect(MATCH_NOTHING).toEqual({ id: { in: [] } });
  });
});

describe("scopeOrganisationName (SP1: the facilitator page's empty organisation)", () => {
  afterEach(() => {
    organisationFindFirst.mockClear();
    organisationFindFirst.mockImplementation(async () => ({ name: "Pro Arbeit" }));
  });

  it("answers null for no scope and for the whole project, without asking the database", async () => {
    await expect(scopeOrganisationName(NONE)).resolves.toBeNull();
    await expect(scopeOrganisationName(PROJECT_SCOPE)).resolves.toBeNull();
    await expect(
      scopeOrganisationName({ kind: "project", viewerId: "admin", viewerOrganisationId: "org-a" })
    ).resolves.toBeNull();
    expect(organisationFindFirst).not.toHaveBeenCalled();
  });

  it("names the viewer's own organisation, read by its id within the scope", async () => {
    await expect(scopeOrganisationName(ORG_A)).resolves.toBe("Pro Arbeit");
    expect(organisationFindFirst.mock.calls).toEqual([
      [{ where: { AND: [{ id: "org-a" }, organisationsInScope(ORG_A)] }, select: { name: true } }],
    ]);
  });

  it("answers null when it can't be read", async () => {
    organisationFindFirst.mockImplementation(async () => {
      throw new Error("down");
    });
    await expect(scopeOrganisationName(ORG_A)).resolves.toBeNull();
    organisationFindFirst.mockImplementation(async () => null);
    await expect(scopeOrganisationName(ORG_A)).resolves.toBeNull();
  });
});

describe("getProjectLearners: the scenario choice, in the language it is written in (WCAG 3.1.2)", () => {
  // Review R3: a created course's choices fall back field by field to
  // English (or the first language written), so on a German page a choice
  // not translated yet is English, and its element says so. A bundled
  // course's choices are in every language.
  const chose = (slug: string) =>
    ({
      ...flexible(["CONTEXT"], null),
      course: { slug, cluster: "resilience" },
      scenarioRoot: "private",
      scenarioFollowup: "boundary",
    }) as unknown as Enrolment;
  /** The course as getCourse resolves it in German: the follow-up has no German, so it reads in English. */
  const resolved = async (_project: string, slug: string) =>
    ({
      slug,
      title: slug,
      stages: [
        ...NARRATIVE.map((key) => ({ key, title: key })),
        {
          key: "scenario",
          title: "Anwendung",
          scenario: {
            choices: [
              {
                id: "private",
                text: "Unter vier Augen",
                followups: [{ id: "boundary", text: "Set a boundary" }],
              },
            ],
          },
        },
      ],
    }) as unknown as CourseContent;
  /** The exercise as stored: the follow-up written in English only (its German typed, then cleared). */
  const stored = {
    courseSlug: "saying-no",
    structure: {
      kind: "scenario",
      choices: [
        {
          id: "private",
          text: { en: "In private", de: "Unter vier Augen" },
          followups: [{ id: "boundary", text: { en: "Set a boundary", de: "  " } }],
        },
      ],
    },
  };

  it("marks a part of the choice that isn't in the page's language", async () => {
    getCourse.mockImplementation(resolved);
    lessonFindMany.mockImplementation(async () => [stored]);
    learnerEnrolments.mockImplementation(() => [chose("saying-no")]);
    const [learner] = (await getProjectLearners("de")) ?? [];
    expect(learner.scenario).toEqual([{ text: "Unter vier Augen" }, { text: "Set a boundary", lang: "en" }]);
    expect(lessonFindMany).toHaveBeenCalledWith({
      where: { projectId: "seq-elevate", courseSlug: { in: ["saying-no"] }, stageKey: "scenario" },
      select: { courseSlug: true, structure: true },
    });
  });

  it("marks nothing when every part is in the page's language", async () => {
    getCourse.mockImplementation(resolved);
    lessonFindMany.mockImplementation(async () => [stored]);
    learnerEnrolments.mockImplementation(() => [chose("saying-no")]);
    const [learner] = (await getProjectLearners("en")) ?? [];
    expect(learner.scenario).toEqual([{ text: "Unter vier Augen" }, { text: "Set a boundary" }]);
  });

  it("names the first language written when there is no English either", async () => {
    getCourse.mockImplementation(resolved);
    lessonFindMany.mockImplementation(async () => [
      {
        ...stored,
        structure: {
          kind: "scenario",
          choices: [{ id: "private", text: { el: "Ιδιαιτέρως", de: "Unter vier Augen" } }],
        },
      },
    ]);
    learnerEnrolments.mockImplementation(() => [{ ...chose("saying-no"), scenarioFollowup: null }]);
    const [learner] = (await getProjectLearners("en")) ?? [];
    expect(learner.scenario).toEqual([{ text: "Unter vier Augen", lang: "el" }]);
  });

  it("asks nothing for a bundled course, whose text is in every language", async () => {
    getCourse.mockImplementation(resolved);
    learnerEnrolments.mockImplementation(() => [chose("workplace-conflict")]);
    const [learner] = (await getProjectLearners("de")) ?? [];
    expect(learner.scenario).toEqual([{ text: "Unter vier Augen" }, { text: "Set a boundary" }]);
    expect(lessonFindMany).not.toHaveBeenCalled();
  });

  it("still lists the learner, unmarked, when the stored texts can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getCourse.mockImplementation(resolved);
    lessonFindMany.mockImplementation(async () => {
      throw new TypeError("down");
    });
    learnerEnrolments.mockImplementation(() => [chose("saying-no")]);
    const [learner] = (await getProjectLearners("de")) ?? [];
    expect(learner.scenario).toEqual([{ text: "Unter vier Augen" }, { text: "Set a boundary" }]);
    expect(console.error).toHaveBeenCalledWith("[facilitator] couldn't read the scenario texts' languages: TypeError");
  });

  it("has no choice before the learner made one", async () => {
    const [learner] = (await getProjectLearners("de")) ?? [];
    expect(learner.scenario).toBeNull();
    expect(lessonFindMany).not.toHaveBeenCalled();
  });
});

describe("getProjectLearners: the current course's title, in the language it is written in (WCAG 3.1.2)", () => {
  // A created course's title falls back to English (or the first language
  // written) when the page's language has none, so "In: {course}" on a
  // German or Greek page names it in English, and its element says so. A
  // bundled course's title is in every language.
  const on = (slug: string, meta?: unknown) =>
    ({ ...flexible(["CONTEXT"], null), course: { slug, cluster: "resilience", meta } }) as unknown as Enrolment;

  it("names English when the course has no title in the page's language", async () => {
    learnerEnrolments.mockImplementation(() => [on("saying-no", { en: { title: "Saying no" }, de: { title: "  " } })]);
    const [learner] = (await getProjectLearners("de")) ?? [];
    expect(learner.currentCourse).toBe("saying-no");
    expect(learner.currentCourseLang).toBe("en");
  });

  it("names the first language written when there is no English either", async () => {
    learnerEnrolments.mockImplementation(() => [on("saying-no", { el: { title: "Λέγοντας όχι" } })]);
    const [learner] = (await getProjectLearners("en")) ?? [];
    expect(learner.currentCourseLang).toBe("el");
  });

  it("names nothing when the title is in the page's language", async () => {
    learnerEnrolments.mockImplementation(() => [on("saying-no", { en: { title: "Saying no" }, el: { title: "Λέγοντας όχι" } })]);
    const [learner] = (await getProjectLearners("el")) ?? [];
    expect(learner).not.toHaveProperty("currentCourseLang");
  });

  it("names nothing for a bundled course, whose title is in every language", async () => {
    learnerEnrolments.mockImplementation(() => [on("workplace-conflict", null)]);
    const [learner] = (await getProjectLearners("de")) ?? [];
    expect(learner).not.toHaveProperty("currentCourseLang");
  });
});
