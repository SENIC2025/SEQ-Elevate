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
const course = { findUnique: vi.fn(), update: vi.fn() };

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
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/cms", () => ({ getCourse: vi.fn() }));

const { ensureLearnerMembership, awardBadgeAction, saveCourseProgress, saveCourseProgressPatch, loadLearnerGlobal } =
  await import("./learner");

const USER = { id: "u1", email: "person@example.org" };
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
