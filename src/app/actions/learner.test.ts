import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

// The learner store calls ensureLearnerMembership on every signed-in page
// load, staff included. These tests pin down who it may turn into a learner:
// only someone who holds no role in the project at all.
const getCurrentUser = vi.fn();
const getProjectMemberships = vi.fn();
const isBootstrapAdmin = vi.fn();
const membership = {
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  upsert: vi.fn(),
};
vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser, getProjectMemberships }));
vi.mock("@/lib/admin-bootstrap", () => ({ isBootstrapAdmin }));
const badge = { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() };
const userBadge = { upsert: vi.fn(), createMany: vi.fn(), findMany: vi.fn() };
const course = { findUnique: vi.fn(), findMany: vi.fn(async (): Promise<unknown[]> => []), update: vi.fn() };
/** The course's lessons, as loadLessonFacts reads them (the kill switch's completion check). */
let lessons: Record<string, unknown>[] = [];
const lesson = { findMany: vi.fn(async () => lessons) };

/**
 * The enrolment as stored, for the save actions: read, created and updated
 * like the table, so a save's merge can be checked by what it wrote.
 */
let enrolment: Record<string, unknown> | null = null;
const EMPTY_ROW = {
  stagesCompleted: [],
  sectionsCompleted: null,
  simulationChoice: null,
  simulationCorrect: null,
  scenarioRoot: null,
  scenarioFollowup: null,
  reflection: {},
  assessment: {},
  responses: null,
  completedAt: null,
};
const courseEnrollment = {
  upsert: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(async () => (enrolment ? { ...enrolment } : null)),
  createMany: vi.fn(async () => {
    enrolment ??= { ...EMPTY_ROW };
    return { count: 1 };
  }),
  update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    enrolment = { ...enrolment, ...data };
    return enrolment;
  }),
};
/** Every raw query, as its SQL with the values left out: the locks, in order. */
const sql: string[] = [];
const prisma = {
  membership,
  badge,
  userBadge,
  course,
  lesson,
  courseEnrollment,
  $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
    sql.push(strings.join("?").replace(/\s+/g, " ").trim());
    return [];
  }),
  // An interactive transaction runs on the same mocked client; an array
  // one waits for the queries it was given.
  $transaction: vi.fn(async (arg: unknown) =>
    typeof arg === "function" ? arg(prisma) : Promise.all(arg as unknown[])
  ),
};
/** The signed-in person's profile, as ownProfile reads it (complete by default). */
const projectProfile = { findUnique: vi.fn() };
/** The Comp Card, read and written like the table: upserts merge into it. */
let storedCard: Record<string, unknown> | null = null;
const compCard = {
  findUnique: vi.fn(async () => (storedCard ? { ...storedCard } : null)),
  upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
    storedCard = storedCard ? { ...storedCard, ...update } : { id: "card-1", privacy: "SELF", ...create };
    return { ...storedCard };
  }),
};
const auditLog = { create: vi.fn(async () => ({})) };
Object.assign(prisma, { projectProfile, compCard, auditLog });
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma }));
const releaseIfCountryElsewhere = vi.fn(async () => ({ released: false }));
vi.mock("@/lib/person-organisation", () => ({ releaseIfCountryElsewhere }));
vi.mock("@/lib/cms", () => ({ getCourse: vi.fn() }));

const {
  ensureLearnerMembership,
  awardBadgeAction,
  saveCourseProgress,
  saveCourseProgressPatch,
  loadLearnerGlobal,
  loadCourseProgress,
  saveCompCard,
  setCompCardSharing,
} = await import("./learner");
const { getCourse } = await import("@/lib/cms");
const { currentTermsVersion } = await import("@/lib/profile");
const { SHARING_TEXT_VERSION } = await import("@/lib/comp-card-visibility");

const USER = { id: "u1", email: "person@example.org", name: "Ana" };

/** A profile the profile step left complete, in organisation org-a. */
const completeProfile = (over: Record<string, unknown> = {}) => ({
  country: "DE",
  termsVersion: currentTermsVersion(),
  ageConfirmedAt: new Date("2026-11-20T10:00:00Z"),
  consentAt: null,
  organisationId: "org-a",
  ageRule: "SELF_MIN_AGE",
  guardianSharingConsentAt: null,
  organisation: { name: "Org A" },
  ...over,
});
beforeEach(() => {
  projectProfile.findUnique.mockResolvedValue(completeProfile());
});
const roles = (...r: string[]) =>
  r.map((role) => ({ role, projectId: "seq-elevate" }));

/** Did the action add a membership row, by any route? */
const wroteMembership = () =>
  membership.create.mock.calls.length + membership.upsert.mock.calls.length > 0;

describe("ensureLearnerMembership", () => {
  afterEach(() => vi.clearAllMocks());

  it.each([["ADMIN"], ["CONTENT_EDITOR"], ["FACILITATOR"]])(
    "leaves someone who holds %s without a learner role",
    async (role) => {
      getCurrentUser.mockResolvedValue(USER);
      getProjectMemberships.mockResolvedValue(roles(role));
      isBootstrapAdmin.mockReturnValue(false);
      membership.findFirst.mockResolvedValue(null);
      membership.findMany.mockResolvedValue(roles(role));
      await expect(ensureLearnerMembership()).resolves.toBe(true);
      expect(wroteMembership()).toBe(false);
    }
  );

  it("makes someone with no role in the project a learner", async () => {
    getCurrentUser.mockResolvedValue(USER);
    getProjectMemberships.mockResolvedValue([]);
    isBootstrapAdmin.mockReturnValue(false);
    membership.findFirst.mockResolvedValue(null);
    membership.findMany.mockResolvedValue([]);
    membership.upsert.mockResolvedValue({});
    membership.create.mockResolvedValue({});
    await expect(ensureLearnerMembership()).resolves.toBe(true);
    const rows = [
      ...membership.create.mock.calls.map((c) => c[0].data),
      ...membership.upsert.mock.calls.map((c) => c[0].create),
    ];
    expect(rows).toEqual([
      { userId: "u1", projectId: "seq-elevate", role: "LEARNER" },
    ]);
  });

  it("someone given LEARNER back (after Remove) gets the profile step's organisation rule first (spec 5.4 (c))", async () => {
    getCurrentUser.mockResolvedValue(USER);
    getProjectMemberships.mockResolvedValue([]);
    isBootstrapAdmin.mockReturnValue(false);
    membership.findFirst.mockResolvedValue(null);
    membership.findMany.mockResolvedValue([]);
    membership.upsert.mockResolvedValue({});
    membership.create.mockResolvedValue({});
    await expect(ensureLearnerMembership()).resolves.toBe(true);
    expect(releaseIfCountryElsewhere).toHaveBeenCalledWith(prisma, "u1", { actorId: "u1" });
    const released = releaseIfCountryElsewhere.mock.invocationCallOrder[0];
    const granted = [...membership.upsert.mock.invocationCallOrder, ...membership.create.mock.invocationCallOrder][0];
    expect(released).toBeLessThan(granted);
  });

  it("leaves the organisation of someone who holds a role, learners included", async () => {
    for (const held of [["LEARNER"], ["FACILITATOR"]]) {
      vi.clearAllMocks();
      getCurrentUser.mockResolvedValue(USER);
      getProjectMemberships.mockResolvedValue(roles(...held));
      isBootstrapAdmin.mockReturnValue(false);
      membership.findMany.mockResolvedValue(roles(...held));
      await expect(ensureLearnerMembership()).resolves.toBe(true);
      expect(releaseIfCountryElsewhere, held.join()).not.toHaveBeenCalled();
    }
  });

  it("doesn't make an ADMIN_EMAILS address a learner while its roles are still on their way", async () => {
    getCurrentUser.mockResolvedValue({ ...USER, email: "admin@example.org" });
    getProjectMemberships.mockResolvedValue([]);
    isBootstrapAdmin.mockReturnValue(true);
    membership.findFirst.mockResolvedValue(null);
    membership.findMany.mockResolvedValue([]);
    await expect(ensureLearnerMembership()).resolves.toBe(true);
    expect(wroteMembership()).toBe(false);
  });

  it("fails, writing nothing, when the roles can't be read", async () => {
    getCurrentUser.mockResolvedValue(USER);
    getProjectMemberships.mockRejectedValue(new Error("db down"));
    isBootstrapAdmin.mockReturnValue(false);
    membership.findFirst.mockRejectedValue(new Error("db down"));
    membership.findMany.mockRejectedValue(new Error("db down"));
    await expect(ensureLearnerMembership()).rejects.toThrow();
    expect(wroteMembership()).toBe(false);
  });

  it("fails when no one is signed in (or the session lookup failed)", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(ensureLearnerMembership()).rejects.toThrow();
    expect(wroteMembership()).toBe(false);
  });
});

/** What the database answers a second insert of the same UserBadge (userId, badgeId): P2002. */
const UNIQUE_VIOLATION = Object.assign(new Error("Unique constraint failed on the fields: (`userId`,`badgeId`)"), {
  code: "P2002",
});

describe("awardBadgeAction", () => {
  afterEach(() => vi.clearAllMocks());

  // Not thrown: the store and the guest migration try a thrown award again
  // for 15 s, as if the connection had dropped, and this one can't succeed.
  it("answers no-badge, rather than as if saved or with an error worth retrying, when the badge doesn't exist", async () => {
    getCurrentUser.mockResolvedValue(USER);
    badge.findUnique.mockResolvedValue(null);
    await expect(awardBadgeAction("no-such-badge", "u1")).resolves.toEqual({
      ok: false,
      reason: "no-badge",
    });
    expect(userBadge.createMany).not.toHaveBeenCalled();
  });

  it("saves the badge for the learner", async () => {
    getCurrentUser.mockResolvedValue(USER);
    badge.findUnique.mockResolvedValue({ id: "b1", slug: "x-complete" });
    userBadge.createMany.mockResolvedValue({ count: 1 });
    await expect(awardBadgeAction("x-complete", "u1")).resolves.toEqual({ ok: true });
    expect(userBadge.createMany).toHaveBeenCalledWith({
      data: [{ userId: "u1", badgeId: "b1" }],
      skipDuplicates: true,
    });
  });

  it("awards a badge the completing save wrote at the same moment, without an error (the row there is kept)", async () => {
    // Found at integration (the full e2e suite's server log): the save that
    // completes a course and this action write the same UserBadge row at
    // once. An upsert reads, finds nothing, inserts, and the other's row
    // fails it on the unique key (P2002): the page then tries again an
    // award that had happened. The database is told to leave a row there.
    getCurrentUser.mockResolvedValue(USER);
    badge.findUnique.mockResolvedValue({ id: "b1", slug: "x-complete" });
    userBadge.upsert.mockRejectedValue(UNIQUE_VIOLATION);
    userBadge.createMany.mockResolvedValue({ count: 0 });
    await expect(awardBadgeAction("x-complete", "u1")).resolves.toEqual({ ok: true });
  });

  it("refuses an award meant for another account, without throwing", async () => {
    getCurrentUser.mockResolvedValue(USER);
    await expect(awardBadgeAction("x-complete", "someone-else")).resolves.toEqual({
      ok: false,
      reason: "other-account",
    });
    expect(badge.findUnique).not.toHaveBeenCalled();
    expect(userBadge.createMany).not.toHaveBeenCalled();
  });
});

describe("saveCourseProgress on a created course without a badge", () => {
  afterEach(() => {
    vi.clearAllMocks();
    enrolment = null;
    sql.length = 0;
  });

  const ROW = {
    id: "course-1",
    projectId: "seq-elevate",
    slug: "speaking-up",
    meta: { en: { title: "Speaking up", tagline: "Say it", clusterLabel: "Communication" } },
    badgeId: null as string | null,
  };
  const COMPLETED = {
    stagesCompleted: ["context", "concept", "behaviour", "reflection"],
    simulation: null,
    scenario: { root: null, followup: null },
    reflection: { p1: "", p2: "", p3: "" },
    assessment: { answers: {}, checked: false },
    completedAt: "2026-10-13T10:00:00.000Z",
  };

  function badgelessCourse(row = ROW) {
    getCurrentUser.mockResolvedValue(USER);
    course.findUnique.mockResolvedValue(row);
    course.update.mockResolvedValue({});
    badge.findMany.mockResolvedValue([]);
    badge.create.mockImplementation(async ({ data }) => ({ id: "badge-new", ...data }));
    courseEnrollment.findMany.mockResolvedValue([]);
    userBadge.createMany.mockResolvedValue({ count: 1 });
  }

  // A course the old createCourse made while a deploy was building has no
  // badge. Finishing it used to save the course but drop the badge without
  // a word, so the learner lost it on the next reload (C9).
  it("gives the course its badge and saves it for the learner who finished it", async () => {
    badgelessCourse();
    await saveCourseProgress("speaking-up", COMPLETED, "u1");
    expect(badge.create.mock.calls[0][0].data).toEqual({
      projectId: "seq-elevate",
      slug: "speaking-up-complete",
      name: "Speaking up",
      meaning: "Say it",
      iconRef: "award",
    });
    expect(course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { badgeId: "badge-new" },
    });
    expect(courseEnrollment.createMany).toHaveBeenCalledTimes(1);
    expect(enrolment?.completedAt).toEqual(new Date(COMPLETED.completedAt));
    expect(userBadge.createMany).toHaveBeenCalledWith({
      data: [{ userId: "u1", badgeId: "badge-new" }],
      skipDuplicates: true,
    });
  });

  it("makes no badge while the course isn't finished", async () => {
    badgelessCourse();
    await saveCourseProgress("speaking-up", { ...COMPLETED, completedAt: null }, "u1");
    expect(badge.create).not.toHaveBeenCalled();
    expect(userBadge.createMany).not.toHaveBeenCalled();
    expect(enrolment?.stagesCompleted).toEqual(["CONTEXT", "CONCEPT", "BEHAVIOUR", "REFLECTION"]);
  });

  it("makes no badge for a built-in course, whose badge comes from the seed", async () => {
    badgelessCourse({ ...ROW, meta: null } as unknown as typeof ROW);
    await saveCourseProgress("speaking-up", COMPLETED, "u1");
    expect(badge.create).not.toHaveBeenCalled();
    expect(userBadge.createMany).not.toHaveBeenCalled();
    expect(enrolment?.completedAt).toEqual(new Date(COMPLETED.completedAt));
  });

  it("saves the badge a created course already has, without making another", async () => {
    badgelessCourse({ ...ROW, badgeId: "badge-1" });
    await saveCourseProgress("speaking-up", COMPLETED, "u1");
    expect(badge.create).not.toHaveBeenCalled();
    expect(userBadge.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ userId: "u1", badgeId: "badge-1" }] })
    );
  });
});

/*
 * U5 (spec 4.1–4.3): the save actions' transaction. The lock order is
 * fixed — the Course row, then the enrolment, never a Lesson row — so no
 * two saves, nor a save and an editor, can deadlock; an "s-…" id never
 * reaches the StageKey enum; and a page from before the deploy can't clear
 * a completion.
 */
describe("the save actions' transaction", () => {
  const ROW = { id: "course-1", projectId: "seq-elevate", slug: "speaking-up", meta: { en: {} }, badgeId: "badge-1" };
  const OWN = "s-abcdefgh";

  beforeEach(() => {
    getCurrentUser.mockResolvedValue(USER);
    course.findUnique.mockResolvedValue(ROW);
    userBadge.createMany.mockResolvedValue({ count: 1 });
  });
  afterEach(() => {
    vi.clearAllMocks();
    enrolment = null;
    sql.length = 0;
  });

  const OLD_PROGRESS = {
    stagesCompleted: ["context"],
    simulation: null,
    scenario: { root: null, followup: null },
    reflection: { p1: "", p2: "", p3: "" },
    assessment: { answers: {}, checked: false },
    completedAt: null,
  };

  it("finishes the course though the learner's badge was written at the same moment (the award action, another tab)", async () => {
    // The same race as awardBadgeAction's: an upsert here failed the whole
    // save on the unique key, and the page sent it again.
    enrolment = { ...EMPTY_ROW };
    userBadge.upsert.mockRejectedValue(UNIQUE_VIOLATION);
    userBadge.createMany.mockResolvedValue({ count: 0 });
    await expect(
      saveCourseProgressPatch("speaking-up", { v: 2, completedAt: "2026-10-01T00:00:00.000Z" }, "u1")
    ).resolves.toEqual({ ok: true, refused: [] });
    expect(enrolment?.completedAt).toEqual(new Date("2026-10-01T00:00:00.000Z"));
  });

  it("locks the Course row FOR KEY SHARE, then the enrolment FOR UPDATE, and never a Lesson", async () => {
    enrolment = { ...EMPTY_ROW };
    await expect(
      saveCourseProgressPatch("speaking-up", { v: 2, completed: ["context"] }, "u1")
    ).resolves.toEqual({ ok: true, refused: [] });
    expect(sql).toEqual([
      'SELECT id FROM "Course" WHERE "id" = ? FOR KEY SHARE',
      'SELECT id FROM "CourseEnrollment" WHERE "userId" = ? AND "courseId" = ? FOR UPDATE',
    ]);
    expect(sql.join(" ")).not.toMatch(/"Lesson"/);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("takes the Course row FOR UPDATE up front when the save may create the course's badge", async () => {
    course.findUnique.mockResolvedValue({ ...ROW, badgeId: null });
    badge.findMany.mockResolvedValue([]);
    badge.create.mockImplementation(async ({ data }) => ({ id: "badge-new", ...data }));
    courseEnrollment.findMany.mockResolvedValue([]);
    enrolment = { ...EMPTY_ROW };
    await saveCourseProgressPatch("speaking-up", { v: 2, completedAt: "2026-10-01T00:00:00.000Z" }, "u1");
    expect(sql[0]).toBe('SELECT id FROM "Course" WHERE "id" = ? FOR UPDATE');
    expect(sql).not.toContain('SELECT id FROM "Course" WHERE "id" = ? FOR KEY SHARE');
    expect(sql.at(-1)).toMatch(/"CourseEnrollment".*FOR UPDATE$/);
    expect(userBadge.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ userId: "u1", badgeId: "badge-new" }] })
    );
  });

  it("the old action takes the same locks", async () => {
    enrolment = { ...EMPTY_ROW };
    await saveCourseProgress("speaking-up", OLD_PROGRESS, "u1");
    expect(sql).toEqual([
      'SELECT id FROM "Course" WHERE "id" = ? FOR KEY SHARE',
      'SELECT id FROM "CourseEnrollment" WHERE "userId" = ? AND "courseId" = ? FOR UPDATE',
    ]);
  });

  it("never casts an s- id to the enum: the new action keeps it apart", async () => {
    await saveCourseProgressPatch("speaking-up", { v: 2, completed: ["context", OWN] }, "u1");
    expect(enrolment).toMatchObject({ stagesCompleted: ["CONTEXT"], sectionsCompleted: [OWN] });
  });

  it("never casts an s- id to the enum: the old action leaves it out", async () => {
    await saveCourseProgress("speaking-up", { ...OLD_PROGRESS, stagesCompleted: ["context", OWN] }, "u1");
    expect(enrolment?.stagesCompleted).toEqual(["CONTEXT"]);
    expect(enrolment?.sectionsCompleted).toBeNull();
  });

  it("the old action keeps a stored completion and stored lessons a stale page doesn't have", async () => {
    const done = new Date("2026-10-01T00:00:00.000Z");
    enrolment = { ...EMPTY_ROW, stagesCompleted: ["CONTEXT", "CONCEPT"], completedAt: done };
    await saveCourseProgress("speaking-up", { ...OLD_PROGRESS, stagesCompleted: ["behaviour"] }, "u1");
    expect(enrolment).toMatchObject({ completedAt: done, stagesCompleted: ["CONTEXT", "CONCEPT", "BEHAVIOUR"] });
    const data = courseEnrollment.update.mock.calls[0][0].data as Record<string, unknown>;
    expect("completedAt" in data).toBe(false);
    expect("sectionsCompleted" in data || "responses" in data).toBe(false);
  });

  it("the old action writes the four standard answers as it always has", async () => {
    await saveCourseProgress(
      "speaking-up",
      {
        ...OLD_PROGRESS,
        simulation: { choice: "a", correct: true },
        scenario: { root: "c1", followup: "f1" },
        reflection: { p1: "One", p2: "", p3: "" },
        assessment: { answers: { q1: "x" }, checked: true },
      },
      "u1"
    );
    expect(enrolment).toMatchObject({
      simulationChoice: "a",
      simulationCorrect: true,
      scenarioRoot: "c1",
      scenarioFollowup: "f1",
      reflection: { p1: "One", p2: "", p3: "" },
      assessment: { answers: { q1: "x" }, checked: true },
    });
  });

  it("answers a save meant for another account, without touching the database", async () => {
    await expect(
      saveCourseProgressPatch("speaking-up", { v: 2, completed: ["context"] }, "someone-else")
    ).resolves.toEqual({ ok: false, error: "other-account" });
    expect(course.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("fails, to be tried again, when the session can't be read", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(saveCourseProgressPatch("speaking-up", { v: 2 }, "u1")).rejects.toThrow();
  });

  it("creates no enrolment for an empty patch, or one whose keys were all refused", async () => {
    await expect(saveCourseProgressPatch("speaking-up", { v: 2 }, "u1")).resolves.toEqual({ ok: true, refused: [] });
    await expect(
      saveCourseProgressPatch("speaking-up", { v: 2, answers: { "nope/main": { type: "practice" } } }, "u1")
    ).resolves.toEqual({ ok: true, refused: [{ key: "nope/main", reason: "invalid" }] });
    expect(course.findUnique).not.toHaveBeenCalled();
    expect(courseEnrollment.createMany).not.toHaveBeenCalled();
  });

  it("creates no enrolment for a patch that changes nothing", async () => {
    await saveCourseProgressPatch(
      "speaking-up",
      { v: 2, answers: { "reflection/main": { type: "reflection", text: {} } } },
      "u1"
    );
    expect(courseEnrollment.createMany).not.toHaveBeenCalled();
    expect(enrolment).toBeNull();
  });

  it("writes only the columns that changed, and nothing for a patch already saved", async () => {
    enrolment = { ...EMPTY_ROW, stagesCompleted: ["CONTEXT"] };
    await saveCourseProgressPatch(
      "speaking-up",
      { v: 2, answers: { [`${OWN}/main`]: { type: "rating", values: { s: 4 } } } },
      "u1"
    );
    expect(Object.keys(courseEnrollment.update.mock.calls[0][0].data)).toEqual(["responses"]);
    courseEnrollment.update.mockClear();
    await saveCourseProgressPatch("speaking-up", { v: 2, completed: ["context"] }, "u1");
    expect(courseEnrollment.update).not.toHaveBeenCalled();
  });

  it("refuses per key and saves the rest", async () => {
    const r = await saveCourseProgressPatch(
      "speaking-up",
      {
        v: 2,
        answers: {
          "simulation/main": { type: "practice", optionId: "a", correct: true },
          [`${OWN}/main`]: { type: "reflection", text: { a: "x".repeat(5_001) } },
        },
      },
      "u1"
    );
    expect(r).toEqual({ ok: true, refused: [{ key: `${OWN}/main`, reason: "too-long" }] });
    expect(enrolment).toMatchObject({ simulationChoice: "a", responses: null });
  });

  it.each([
    ["a slug that isn't one", "Speaking Up!", { v: 2, completed: ["context"] }, "bad-input"],
    ["Release 1's progress", "speaking-up", { stagesCompleted: ["context"] }, "bad-input"],
    ["a patch too big", "speaking-up", { v: 2, completed: Array(65).fill("context") }, "too-large"],
  ])("answers %s, writing nothing", async (_name, slug, patch, error) => {
    await expect(saveCourseProgressPatch(slug, patch, "u1")).resolves.toEqual({ ok: false, error });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("answers a course that doesn't exist", async () => {
    course.findUnique.mockResolvedValue(null);
    await expect(
      saveCourseProgressPatch("speaking-up", { v: 2, completed: ["context"] }, "u1")
    ).resolves.toEqual({ ok: false, error: "unknown-course" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("saves the badge once, when the course is finished by this save", async () => {
    enrolment = { ...EMPTY_ROW };
    await saveCourseProgressPatch("speaking-up", { v: 2, completedAt: "2026-10-01T00:00:00.000Z" }, "u1");
    await saveCourseProgressPatch("speaking-up", { v: 2, completedAt: "2026-10-02T00:00:00.000Z" }, "u1");
    expect(userBadge.createMany).toHaveBeenCalledTimes(1);
    expect(enrolment?.completedAt).toEqual(new Date("2026-10-01T00:00:00.000Z"));
  });

  // Found at integration review (finding 3): neither action looked at the
  // course's status, so a hand-made call enrolled a learner in a course
  // nobody had ever published — and from the cut-off, a course with a
  // learner can't be restructured (live-rules.ts), so the draft froze.
  describe("a course nobody has published", () => {
    const DRAFT = { ...ROW, status: "draft", publishedAt: null };

    it("the new action enrols no one in it, and says it doesn't know the course", async () => {
      course.findUnique.mockResolvedValue(DRAFT);
      await expect(
        saveCourseProgressPatch("speaking-up", { v: 2, completed: ["context"] }, "u1")
      ).resolves.toEqual({ ok: false, error: "unknown-course" });
      expect(courseEnrollment.createMany).not.toHaveBeenCalled();
      expect(courseEnrollment.update).not.toHaveBeenCalled();
      expect(enrolment).toBeNull();
    });

    it("the old action enrols no one in it either", async () => {
      course.findUnique.mockResolvedValue({ ...DRAFT, status: "archived" });
      await saveCourseProgress("speaking-up", OLD_PROGRESS, "u1");
      expect(courseEnrollment.createMany).not.toHaveBeenCalled();
      expect(courseEnrollment.update).not.toHaveBeenCalled();
      expect(enrolment).toBeNull();
    });

    it("guard: a built-in course's row (published, never stamped with a date) still enrols", async () => {
      course.findUnique.mockResolvedValue({ ...ROW, meta: null, status: "published", publishedAt: null });
      await expect(
        saveCourseProgressPatch("speaking-up", { v: 2, completed: ["context"] }, "u1")
      ).resolves.toEqual({ ok: true, refused: [] });
      expect(enrolment).toMatchObject({ stagesCompleted: ["CONTEXT"] });
    });

    it("guard (D62.f): a course unpublished after it was published still takes a new learner's answers and an enrolled learner's", async () => {
      const unpublished = { ...ROW, status: "draft", publishedAt: new Date("2026-10-01T00:00:00.000Z") };
      course.findUnique.mockResolvedValue(unpublished);
      await expect(
        saveCourseProgressPatch("speaking-up", { v: 2, completed: ["context"] }, "u1")
      ).resolves.toEqual({ ok: true, refused: [] });
      await saveCourseProgress("speaking-up", { ...OLD_PROGRESS, stagesCompleted: ["concept"] }, "u1");
      expect(enrolment).toMatchObject({ stagesCompleted: ["CONTEXT", "CONCEPT"] });
    });

    it("guard (D62.f): a learner already enrolled keeps saving, whatever the course's status", async () => {
      course.findUnique.mockResolvedValue(DRAFT);
      enrolment = { ...EMPTY_ROW, stagesCompleted: ["CONTEXT"] };
      await expect(
        saveCourseProgressPatch("speaking-up", { v: 2, completed: ["concept"] }, "u1")
      ).resolves.toEqual({ ok: true, refused: [] });
      await saveCourseProgress("speaking-up", { ...OLD_PROGRESS, stagesCompleted: ["behaviour"] }, "u1");
      expect(enrolment).toMatchObject({ stagesCompleted: ["CONTEXT", "CONCEPT", "BEHAVIOUR"] });
      expect(courseEnrollment.createMany).not.toHaveBeenCalled();
    });
  });

  it("reads again after creating the enrolment, in case another tab made it meanwhile", async () => {
    courseEnrollment.createMany.mockImplementationOnce(async () => {
      // The other tab's row, already holding a lesson.
      enrolment = { ...EMPTY_ROW, stagesCompleted: ["CONCEPT"] };
      return { count: 0 };
    });
    await saveCourseProgressPatch("speaking-up", { v: 2, completed: ["context"] }, "u1");
    expect(courseEnrollment.createMany).toHaveBeenCalledWith({
      data: [{ userId: "u1", courseId: "course-1" }],
      skipDuplicates: true,
    });
    expect(enrolment?.stagesCompleted).toEqual(["CONCEPT", "CONTEXT"]);
  });
});

/*
 * Found at integration review (finding 2, Major; an owner decision, taken
 * here by default as the spec's own option: under the switch, a completion
 * of such a course doesn't stand). Under R2_LEARNER_PLAYER=off learners
 * play a created course as Release 1 did (spec 3.4): its standard lessons.
 * A published course made only of lessons of its own was then finished
 * with four presses of Continue through the four standard lessons it
 * doesn't have, badge and all — and the trigger keeps a completion for
 * good, so switching back (or rolling forward) couldn't take it back.
 */
describe("under R2_LEARNER_PLAYER=off, a course the Release 1 view doesn't hold", () => {
  const OWN = "s-abcdefgh";
  const NARRATIVE = ["context", "concept", "behaviour", "reflection"];
  const OWN_ONLY = {
    id: "course-1",
    projectId: "seq-elevate",
    slug: "speaking-up",
    meta: { en: {} },
    badgeId: "badge-1",
    status: "published",
    publishedAt: new Date("2026-11-10T00:00:00.000Z"),
    outline: { v: 1, sections: [{ id: OWN, template: "text" }], removed: NARRATIVE },
  };
  const OWN_LESSON = {
    stageKey: OWN,
    narrative: { en: { title: "Own", blocks: [{ kind: "paragraph", text: "Mine" }] } },
    structure: null,
    structureDraft: null,
    parts: null,
    video: null,
    documents: [],
  };
  const done = "2026-10-01T09:00:00.000Z";
  const OLD = {
    stagesCompleted: NARRATIVE,
    simulation: null,
    scenario: { root: null, followup: null },
    reflection: { p1: "", p2: "", p3: "" },
    assessment: { answers: {}, checked: false },
    completedAt: done,
  };

  beforeEach(() => {
    vi.stubEnv("R2_LEARNER_PLAYER", "off");
    getCurrentUser.mockResolvedValue(USER);
    course.findUnique.mockResolvedValue(OWN_ONLY);
    course.findMany.mockResolvedValue([OWN_ONLY]);
    badge.findUnique.mockResolvedValue({ id: "badge-1", slug: "speaking-up" });
    userBadge.createMany.mockResolvedValue({ count: 1 });
    lessons = [OWN_LESSON];
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    enrolment = null;
    lessons = [];
    sql.length = 0;
  });

  it("four standard lessons don't finish it: no completion, no badge (the new action)", async () => {
    await expect(
      saveCourseProgressPatch("speaking-up", { v: 2, completed: NARRATIVE, completedAt: done }, "u1")
    ).resolves.toEqual({ ok: true, refused: [] });
    expect(enrolment?.completedAt).toBeNull();
    expect(enrolment?.stagesCompleted).toEqual(["CONTEXT", "CONCEPT", "BEHAVIOUR", "REFLECTION"]);
    expect(userBadge.createMany).not.toHaveBeenCalled();
  });

  it("nor through the old action", async () => {
    await saveCourseProgress("speaking-up", OLD, "u1");
    expect(enrolment?.completedAt).toBeNull();
    expect(userBadge.createMany).not.toHaveBeenCalled();
  });

  it("nor through the badge award, while the course isn't finished", async () => {
    await expect(awardBadgeAction("speaking-up", "u1")).resolves.toEqual({ ok: false, reason: "not-finished" });
    expect(userBadge.createMany).not.toHaveBeenCalled();
    // Finished for real (the server holds the completion): the badge stands.
    enrolment = { ...EMPTY_ROW, sectionsCompleted: [OWN], completedAt: new Date(done) };
    await expect(awardBadgeAction("speaking-up", "u1")).resolves.toEqual({ ok: true });
  });

  it("guard: finishing the course's own lessons finishes it, badge and all", async () => {
    await saveCourseProgressPatch("speaking-up", { v: 2, completed: [...NARRATIVE, OWN], completedAt: done }, "u1");
    expect(enrolment?.completedAt).toEqual(new Date(done));
    expect(userBadge.createMany).toHaveBeenCalledTimes(1);
  });

  it("guard: a course the Release 1 view holds (its standard lessons) finishes as before", async () => {
    course.findUnique.mockResolvedValue({ ...OWN_ONLY, outline: null });
    course.findMany.mockResolvedValue([{ ...OWN_ONLY, outline: null }]);
    lessons = [];
    await saveCourseProgress("speaking-up", OLD, "u1");
    expect(enrolment?.completedAt).toEqual(new Date(done));
    await expect(awardBadgeAction("speaking-up", "u1")).resolves.toEqual({ ok: true });
  });

  it("guard: with the switch unset, a completion is trusted as before", async () => {
    vi.unstubAllEnvs();
    await saveCourseProgressPatch("speaking-up", { v: 2, completed: NARRATIVE, completedAt: done }, "u1");
    expect(enrolment?.completedAt).toEqual(new Date(done));
    expect(lesson.findMany).not.toHaveBeenCalled();
  });
});

describe("loadLearnerGlobal", () => {
  afterEach(() => vi.clearAllMocks());

  it("counts the course's own lessons and says whether anything was saved", async () => {
    getCurrentUser.mockResolvedValue(USER);
    const findUnique = vi.fn().mockResolvedValue(null);
    Object.assign(prisma, { compCard: { findUnique } });
    userBadge.findMany.mockResolvedValue([]);
    courseEnrollment.findMany.mockResolvedValue([
      {
        ...EMPTY_ROW,
        course: { slug: "own" },
        stagesCompleted: ["CONTEXT"],
        sectionsCompleted: ["s-abcdefgh"],
      },
      {
        ...EMPTY_ROW,
        course: { slug: "rating-only" },
        responses: { v: 1, items: { "s-abcdefgh/main": { type: "rating", values: { s: 2 }, at: "x" } } },
      },
      { ...EMPTY_ROW, course: { slug: "nothing" } },
    ]);
    const global = await loadLearnerGlobal();
    expect(global.enrollments).toEqual([
      { slug: "own", stagesCompleted: 2, completed: false, hasProgress: true },
      { slug: "rating-only", stagesCompleted: 0, completed: false, hasProgress: true },
      { slug: "nothing", stagesCompleted: 0, completed: false, hasProgress: false },
    ]);
  });
});

/* ------------------------------------------------- Release 3 (D79, D80) --- */

describe("the learner's place waits for the profile step (D79)", () => {
  beforeEach(() => {
    getCurrentUser.mockResolvedValue(USER);
    getProjectMemberships.mockResolvedValue([]);
    isBootstrapAdmin.mockReturnValue(false);
    membership.upsert.mockResolvedValue({});
  });
  afterEach(() => vi.clearAllMocks());

  it.each([
    ["no profile at all", null, USER],
    ["no country", completeProfile({ country: null }), USER],
    ["Terms of an older version", completeProfile({ termsVersion: "1999-01-01" }), USER],
    ["no age rule confirmed", completeProfile({ ageConfirmedAt: null }), USER],
    ["a blank name", completeProfile(), { ...USER, name: "  " }],
  ])("ensureLearnerMembership grants nothing and answers profile-incomplete, without throwing, for %s", async (_, profile, user) => {
    getCurrentUser.mockResolvedValue(user);
    projectProfile.findUnique.mockResolvedValue(profile);
    await expect(ensureLearnerMembership()).resolves.toBe("profile-incomplete");
    expect(wroteMembership()).toBe(false);
  });

  it("ensureLearnerMembership grants LEARNER once the profile is complete", async () => {
    await expect(ensureLearnerMembership()).resolves.toBe(true);
    expect(membership.upsert.mock.calls.map((c) => c[0].create)).toEqual([
      { userId: "u1", projectId: "seq-elevate", role: "LEARNER" },
    ]);
  });

  it("reads the signed-in person's own profile, nobody else's", async () => {
    await ensureLearnerMembership();
    expect(projectProfile.findUnique.mock.calls[0][0].where).toEqual({
      userId_projectId: { userId: "u1", projectId: "seq-elevate" },
    });
  });

  it("loadLearnerGlobal refuses (throws) an incomplete profile, before reading anything of the learner's", async () => {
    projectProfile.findUnique.mockResolvedValue(completeProfile({ termsVersion: null }));
    Object.assign(prisma, { compCard });
    await expect(loadLearnerGlobal()).rejects.toThrow();
    expect(compCard.findUnique).not.toHaveBeenCalled();
    expect(courseEnrollment.findMany).not.toHaveBeenCalled();
  });
});

describe("loadLearnerGlobal's Comp Card says whether it is shared (D80)", () => {
  beforeEach(() => {
    getCurrentUser.mockResolvedValue(USER);
    Object.assign(prisma, { compCard });
    userBadge.findMany.mockResolvedValue([]);
    courseEnrollment.findMany.mockResolvedValue([]);
  });
  afterEach(() => {
    storedCard = null;
    vi.clearAllMocks();
  });

  const card = (over: Record<string, unknown>) => ({
    id: "card-1",
    wentWell: "Went well",
    difficult: "",
    improve: "",
    behaviour: "",
    confidence: 4,
    privacy: "SELF",
    sharedAt: null,
    sharedWithOrganisationId: null,
    updatedAt: new Date("2026-11-21T09:00:00Z"),
    ...over,
  });

  it("shared with the learner's organisation: facilitators, since when and with whom, and 'facilitator' for older pages", async () => {
    storedCard = card({ privacy: "FACILITATOR", sharedAt: new Date("2026-11-21T08:00:00Z"), sharedWithOrganisationId: "org-a" });
    const { compCard: loaded } = await loadLearnerGlobal();
    expect(loaded).toMatchObject({
      sharing: "facilitators",
      sharedAt: "2026-11-21T08:00:00.000Z",
      organisationName: "Org A",
      privacy: "facilitator",
    });
  });

  it.each([
    ["privacy written by an older page, never shared", { privacy: "FACILITATOR" }],
    ["the mentor value", { privacy: "FACILITATOR_AND_MENTOR" }],
    ["shared with an organisation the learner has left", { privacy: "FACILITATOR", sharedAt: new Date(), sharedWithOrganisationId: "org-b" }],
  ])("%s reads as Only me", async (_, over) => {
    storedCard = card(over);
    const { compCard: loaded } = await loadLearnerGlobal();
    expect(loaded).toMatchObject({ sharing: "onlyMe", sharedAt: null, organisationName: null, privacy: "self" });
  });
});

describe("saveCompCard (D80, spec 4.3)", () => {
  beforeEach(() => {
    getCurrentUser.mockResolvedValue(USER);
    Object.assign(prisma, { compCard });
  });
  afterEach(() => {
    storedCard = null;
    vi.clearAllMocks();
  });

  const written = () => compCard.upsert.mock.calls.map((c) => ({ create: c[0].create, update: c[0].update }));

  it("ignores privacy: a page from before Release 3 sends 'facilitator', and nothing about sharing is written", async () => {
    storedCard = { id: "card-1", wentWell: "", difficult: "", improve: "", behaviour: "", privacy: "SELF" };
    const answer = await saveCompCard(
      { wentWell: "a", difficult: "b", improve: "c", behaviour: "d", confidence: 4, privacy: "facilitator" },
      "u1"
    );
    expect(answer).toEqual({ ok: true });
    const [{ create, update }] = written();
    for (const data of [create, update]) {
      expect(Object.keys(data)).not.toEqual(expect.arrayContaining(["privacy"]));
      expect(data).not.toHaveProperty("privacy");
      expect(data).not.toHaveProperty("sharedAt");
      expect(data).not.toHaveProperty("sharedWithOrganisationId");
    }
    expect(storedCard?.privacy).toBe("SELF");
  });

  it("writes only the fields sent: one left out keeps its stored text", async () => {
    storedCard = { id: "card-1", wentWell: "kept", difficult: "kept too", improve: "", behaviour: "", privacy: "SELF" };
    await saveCompCard({ improve: "new", confidence: 2 }, "u1");
    expect(written()[0].update).toEqual({ improve: "new", confidence: 2 });
    expect(storedCard).toMatchObject({ wentWell: "kept", difficult: "kept too", improve: "new", confidence: 2 });
  });

  it("refuses a text over 2,000 characters as an answer, naming the field, and writes nothing", async () => {
    const answer = await saveCompCard({ wentWell: "ok", difficult: "x".repeat(2001) }, "u1");
    expect(answer).toEqual({ ok: false, error: "too-long", field: "difficult" });
    expect(compCard.upsert).not.toHaveBeenCalled();
  });

  it("saves an older text already longer than 2,000 characters unchanged (growth only)", async () => {
    const long = "y".repeat(2400);
    storedCard = { id: "card-1", wentWell: long, difficult: "", improve: "", behaviour: "", privacy: "SELF" };
    await expect(saveCompCard({ wentWell: long, improve: "z" }, "u1")).resolves.toEqual({ ok: true });
    await expect(saveCompCard({ wentWell: `${long}!` }, "u1")).resolves.toEqual({
      ok: false,
      error: "too-long",
      field: "wentWell",
    });
  });

  it.each([[0], [6], [2.5], ["4"]])("refuses the confidence %j as an answer", async (confidence) => {
    await expect(saveCompCard({ wentWell: "a", confidence: confidence as number }, "u1")).resolves.toEqual({
      ok: false,
      error: "bad-input",
    });
    expect(compCard.upsert).not.toHaveBeenCalled();
  });

  it("answers a save meant for another account, without touching the card", async () => {
    await expect(saveCompCard({ wentWell: "a" }, "someone-else")).resolves.toEqual({ ok: false, error: "other-account" });
    expect(compCard.findUnique).not.toHaveBeenCalled();
    expect(compCard.upsert).not.toHaveBeenCalled();
  });

  it("a new card starts as the schema makes it: Only me", async () => {
    await saveCompCard({ wentWell: "first" }, "u1");
    expect(written()[0].create).toEqual({ userId: "u1", projectId: "seq-elevate", wentWell: "first" });
  });
});

describe("setCompCardSharing (D80, spec 4.3)", () => {
  beforeEach(() => {
    getCurrentUser.mockResolvedValue(USER);
    Object.assign(prisma, { compCard });
  });
  afterEach(() => {
    storedCard = null;
    vi.clearAllMocks();
  });

  it("shares with the learner's own organisation, recording when and under which wording, and logs it by the card's id", async () => {
    const answer = await setCompCardSharing("facilitators", "u1");
    expect(answer).toMatchObject({ ok: true, sharing: "facilitators", organisationName: "Org A" });
    expect(storedCard).toMatchObject({
      privacy: "FACILITATOR",
      sharedWithOrganisationId: "org-a",
      sharingVersion: SHARING_TEXT_VERSION,
    });
    expect(storedCard?.sharedAt).toBeInstanceOf(Date);
    expect(auditLog.create).toHaveBeenCalledTimes(1);
    const { data } = (auditLog.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0];
    expect(data).toEqual({
      projectId: "seq-elevate",
      action: "compcard.sharing_changed",
      entity: "CompCard",
      entityId: "card-1",
      metadata: { to: "facilitators", version: SHARING_TEXT_VERSION },
    });
    expect(data).not.toHaveProperty("actorId");
  });

  it("Only me takes it back at once, whatever the profile says", async () => {
    storedCard = { id: "card-1", privacy: "FACILITATOR", sharedAt: new Date(), sharedWithOrganisationId: "org-a" };
    projectProfile.findUnique.mockResolvedValue(completeProfile({ organisationId: null, termsVersion: null }));
    await expect(setCompCardSharing("onlyMe", "u1")).resolves.toEqual({
      ok: true,
      sharing: "onlyMe",
      sharedAt: null,
      organisationName: null,
    });
    expect(storedCard).toMatchObject({ privacy: "SELF", sharedAt: null, sharedWithOrganisationId: null });
  });

  it.each([
    ["profile-incomplete", completeProfile({ termsVersion: "1999-01-01" })],
    ["profile-incomplete", null],
    ["no-organisation", completeProfile({ organisationId: null, organisation: null })],
    ["guardian-consent-needed", completeProfile({ ageRule: "INVITED_WITH_GUARDIAN_CONSENT", guardianSharingConsentAt: null })],
  ])("refuses to share with %s, writing nothing", async (error, profile) => {
    projectProfile.findUnique.mockResolvedValue(profile);
    await expect(setCompCardSharing("facilitators", "u1")).resolves.toEqual({ ok: false, error });
    expect(compCard.upsert).not.toHaveBeenCalled();
    expect(auditLog.create).not.toHaveBeenCalled();
  });

  it("an invited learner shares once the guardian's permission covers it", async () => {
    projectProfile.findUnique.mockResolvedValue(
      completeProfile({ ageRule: "INVITED_WITH_GUARDIAN_CONSENT", guardianSharingConsentAt: new Date() })
    );
    await expect(setCompCardSharing("facilitators", "u1")).resolves.toMatchObject({ ok: true, sharing: "facilitators" });
  });

  it.each([["everyone"], [""], [null]])("refuses the choice %j", async (choice) => {
    await expect(setCompCardSharing(choice as never, "u1")).resolves.toEqual({ ok: false, error: "bad-input" });
    expect(compCard.upsert).not.toHaveBeenCalled();
  });

  it("refuses a change meant for another account", async () => {
    await expect(setCompCardSharing("facilitators", "someone-else")).resolves.toEqual({ ok: false, error: "other-account" });
    expect(compCard.upsert).not.toHaveBeenCalled();
  });

  it("fails when no one is signed in", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(setCompCardSharing("onlyMe", "u1")).rejects.toThrow();
  });
});

/* ---------------------------------------------- Release 3 (D90, spec 9.3) --- */

describe("loadCourseProgress reads the course in the language the learner gets it in (D90, spec 9.3)", () => {
  /** The created course, with its scenario's choices in the language asked for. */
  const content = (locale: string) => ({
    title: locale === "de" ? "Nein sagen" : "Saying no",
    stages: [
      {
        key: "scenario",
        scenario: {
          choices: [
            {
              id: "c1",
              text: locale === "de" ? "Bitte ausreden lassen" : "Ask to finish",
              followups: [{ id: "f1", text: locale === "de" ? "Dich bedanken" : "Thank them" }],
            },
          ],
        },
      },
    ],
  });

  beforeEach(() => {
    getCurrentUser.mockResolvedValue(USER);
    enrolment = { ...EMPTY_ROW, scenarioRoot: "c1", scenarioFollowup: "f1" };
    vi.mocked(getCourse).mockImplementation((async (_p: string, _s: string, locale: string) => content(locale)) as never);
  });
  afterEach(() => {
    enrolment = null;
    vi.clearAllMocks();
  });

  /** The course row as both reads take it: its id, and which languages are switched on. */
  const created = (readyLocales: string[]) =>
    course.findUnique.mockResolvedValue({ id: "c-1", slug: "saying-no", readyLocales, meta: { kind: "created" } });

  it("a German learner of a course whose German isn't switched on gets its title and choices in English, and is told so", async () => {
    created([]);
    const progress = await loadCourseProgress("saying-no", "de");
    expect(vi.mocked(getCourse)).toHaveBeenCalledWith("seq-elevate", "saying-no", "en");
    expect(progress).toMatchObject({
      courseTitle: "Saying no",
      courseLocale: "en",
      scenario: { root: "c1", followup: "f1", rootLabel: "Ask to finish", followupLabel: "Thank them" },
    });
  });

  it("once German is switched on, in German", async () => {
    created(["de"]);
    const progress = await loadCourseProgress("saying-no", "de");
    expect(vi.mocked(getCourse)).toHaveBeenCalledWith("seq-elevate", "saying-no", "de");
    expect(progress).toMatchObject({
      courseTitle: "Nein sagen",
      courseLocale: "de",
      scenario: { rootLabel: "Bitte ausreden lassen", followupLabel: "Dich bedanken" },
    });
  });

  it("in English, English", async () => {
    created([]);
    await expect(loadCourseProgress("saying-no", "en")).resolves.toMatchObject({ courseLocale: "en", courseTitle: "Saying no" });
  });
});
