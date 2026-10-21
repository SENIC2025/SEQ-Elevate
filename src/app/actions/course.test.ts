import { describe, it, expect, afterEach, vi } from "vitest";

// A course created in the CMS must get a Badge row, linked through
// Course.badgeId, or the badge a learner earns on it is never saved (C9).
const getCurrentUser = vi.fn();
const getProjectMemberships = vi.fn();
const listCourses = vi.fn();
const getBaseCourseCopy = vi.fn();
const prisma = {
  course: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  badge: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  courseEnrollment: { findMany: vi.fn() },
  lesson: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
  userBadge: { createMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
};
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser, getProjectMemberships }));
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/cms", () => ({ listCourses, getBaseCourseCopy }));

const { createCourse, setCourseStatus, updateCourseMeta, setCourseLanguageReady } = await import("./course");

const EDITOR = { id: "editor-1", email: "ed@example.org" };

function signedInEditor() {
  getCurrentUser.mockResolvedValue(EDITOR);
  getProjectMemberships.mockResolvedValue([
    { role: "CONTENT_EDITOR", projectId: "seq-elevate" },
  ]);
  // An interactive transaction runs on the same mocked client.
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? arg(prisma) : Promise.all(arg as unknown[])
  );
  prisma.auditLog.create.mockResolvedValue({});
}

const NEW_COURSE = {
  title: "Speaking up",
  tagline: "Say what you need, kindly",
  cluster: "communicationEi",
  clusterLabel: "Communication",
  durationMinutes: 15,
  locale: "en" as const,
};

describe("createCourse", () => {
  afterEach(() => vi.clearAllMocks());

  it("creates the course's badge and links the course to it", async () => {
    signedInEditor();
    listCourses.mockResolvedValue([]);
    prisma.badge.findMany.mockResolvedValue([]);
    prisma.badge.create.mockImplementation(async ({ data }) => ({
      id: "badge-1",
      ...data,
    }));
    prisma.course.create.mockImplementation(async ({ data }) => ({
      id: "course-1",
      ...data,
    }));

    await expect(createCourse(NEW_COURSE)).resolves.toEqual({
      ok: true,
      slug: "speaking-up",
    });

    expect(prisma.badge.create).toHaveBeenCalledTimes(1);
    expect(prisma.badge.create.mock.calls[0][0].data).toEqual({
      projectId: "seq-elevate",
      slug: "speaking-up-complete",
      name: "Speaking up",
      meaning: "Say what you need, kindly",
      iconRef: "award",
    });
    expect(prisma.course.create.mock.calls[0][0].data).toMatchObject({
      slug: "speaking-up",
      badgeId: "badge-1",
    });
  });

  it("gives the badge a slug of its own when another badge has the usual one", async () => {
    signedInEditor();
    listCourses.mockResolvedValue([]);
    prisma.badge.findMany.mockResolvedValue([{ slug: "speaking-up-complete" }]);
    prisma.badge.create.mockImplementation(async ({ data }) => ({
      id: "badge-2",
      ...data,
    }));
    prisma.course.create.mockResolvedValue({ id: "course-2" });

    await createCourse(NEW_COURSE);
    expect(prisma.badge.create.mock.calls[0][0].data.slug).toBe(
      "speaking-up-complete-2"
    );
    expect(prisma.course.create.mock.calls[0][0].data.badgeId).toBe("badge-2");
  });

  it("creates nothing for someone who can't edit content", async () => {
    getCurrentUser.mockResolvedValue(EDITOR);
    getProjectMemberships.mockResolvedValue([
      { role: "FACILITATOR", projectId: "seq-elevate" },
    ]);
    await expect(createCourse(NEW_COURSE)).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(prisma.badge.create).not.toHaveBeenCalled();
    expect(prisma.course.create).not.toHaveBeenCalled();
  });
});

describe("updateCourseMeta on a created course", () => {
  afterEach(() => vi.clearAllMocks());

  function createdCourse(meta: object, badgeId: string | null = "badge-1") {
    signedInEditor();
    listCourses.mockResolvedValue([
      { slug: "speaking-up", cluster: "communicationEi", durationMinutes: 15, status: "draft" },
    ]);
    getBaseCourseCopy.mockResolvedValue(null);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.course.findFirst.mockResolvedValue({
      id: "course-1",
      meta,
      copyOverride: null,
      badgeId,
    });
    prisma.course.update.mockResolvedValue({});
    prisma.badge.update.mockResolvedValue({});
    // The row as the transaction reads it back: with the copy just saved.
    prisma.course.findUnique.mockImplementation(async () => ({
      id: "course-1",
      projectId: "seq-elevate",
      slug: "speaking-up",
      meta: prisma.course.update.mock.calls.at(-1)?.[0].data.meta ?? meta,
      badgeId,
    }));
    prisma.badge.findMany.mockResolvedValue([]);
    prisma.badge.create.mockImplementation(async ({ data }) => ({
      id: "badge-new",
      ...data,
    }));
    prisma.courseEnrollment.findMany.mockResolvedValue([]);
  }

  it("renames the badge with the course's English title", async () => {
    createdCourse({
      en: { title: "Speaking up", tagline: "Old", clusterLabel: "Communication" },
    });
    const res = await updateCourseMeta("speaking-up", "en", {
      title: "Speaking up at work",
      tagline: "Ask for what you need",
    });
    expect(res.ok).toBe(true);
    expect(prisma.badge.update).toHaveBeenCalledWith({
      where: { id: "badge-1" },
      data: { name: "Speaking up at work", meaning: "Ask for what you need" },
    });
  });

  it("keeps the badge's English name when another language is reworded", async () => {
    createdCourse({
      en: { title: "Speaking up", tagline: "Say it", clusterLabel: "Communication" },
    });
    await updateCourseMeta("speaking-up", "de", {
      title: "Sich äußern",
      tagline: "Sag es",
    });
    for (const [arg] of prisma.badge.update.mock.calls) {
      expect(arg.data.name).toBe("Speaking up");
    }
  });

  // A course the old createCourse made while a deploy was building has no
  // badge; saving its copy gives it one rather than leaving it without.
  it("gives a created course that has no badge one, named after its English copy", async () => {
    createdCourse(
      { de: { title: "Sich äußern", tagline: "Sag es", clusterLabel: "Kommunikation" } },
      null
    );
    const res = await updateCourseMeta("speaking-up", "en", {
      title: "Speaking up at work",
      tagline: "Ask for what you need",
    });
    expect(res.ok).toBe(true);
    expect(prisma.badge.update).not.toHaveBeenCalled();
    expect(prisma.badge.create).toHaveBeenCalledTimes(1);
    expect(prisma.badge.create.mock.calls[0][0].data).toEqual({
      projectId: "seq-elevate",
      slug: "speaking-up-complete",
      name: "Speaking up at work",
      meaning: "Ask for what you need",
      iconRef: "award",
    });
    expect(prisma.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { badgeId: "badge-new" },
    });
  });
});

describe("setCourseStatus on a created course without a badge", () => {
  afterEach(() => vi.clearAllMocks());

  const COMPLETED_AT = new Date("2026-10-12T09:00:00Z");

  function badgelessCourse(badgeId: string | null = null) {
    signedInEditor();
    listCourses.mockResolvedValue([
      { slug: "speaking-up", cluster: "communicationEi", durationMinutes: 15, status: "draft" },
    ]);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.course.findFirst.mockResolvedValue({ id: "course-1", publishedAt: null });
    prisma.course.findUnique.mockResolvedValue({
      id: "course-1",
      projectId: "seq-elevate",
      slug: "speaking-up",
      meta: { en: { title: "Speaking up", tagline: "Say it", clusterLabel: "Communication" } },
      badgeId,
    });
    prisma.course.update.mockResolvedValue({});
    // Another course's badge already has the usual slug.
    prisma.badge.findMany.mockResolvedValue([{ slug: "speaking-up-complete" }]);
    prisma.badge.create.mockImplementation(async ({ data }) => ({
      id: "badge-new",
      ...data,
    }));
    // A learner finished it before it had a badge.
    prisma.courseEnrollment.findMany.mockResolvedValue([
      { userId: "learner-1", completedAt: COMPLETED_AT },
    ]);
    prisma.userBadge.createMany.mockResolvedValue({ count: 1 });
  }

  it("gives it its badge when it is published, and to those who already finished it", async () => {
    badgelessCourse();
    await expect(setCourseStatus("speaking-up", "published")).resolves.toEqual({
      ok: true,
      status: "published",
    });
    expect(prisma.badge.create.mock.calls[0][0].data).toEqual({
      projectId: "seq-elevate",
      slug: "speaking-up-complete-2",
      name: "Speaking up",
      meaning: "Say it",
      iconRef: "award",
    });
    expect(prisma.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: { badgeId: "badge-new" },
    });
    expect(prisma.courseEnrollment.findMany.mock.calls[0][0].where).toEqual({
      courseId: "course-1",
      completedAt: { not: null },
    });
    expect(prisma.userBadge.createMany).toHaveBeenCalledWith({
      data: [{ userId: "learner-1", badgeId: "badge-new", awardedAt: COMPLETED_AT }],
      skipDuplicates: true,
    });
    // One transaction, holding the course's row, so two editors publishing
    // at once can't each make it a badge.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.course.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "course-1" },
        data: expect.objectContaining({ status: "published" }),
      })
    );
  });

  it("leaves a course that has its badge as it is", async () => {
    badgelessCourse("badge-1");
    await setCourseStatus("speaking-up", "published");
    expect(prisma.badge.create).not.toHaveBeenCalled();
    expect(prisma.userBadge.createMany).not.toHaveBeenCalled();
  });

  it("makes no badge when the course only moves to draft or archive", async () => {
    badgelessCourse();
    await setCourseStatus("speaking-up", "draft");
    await setCourseStatus("speaking-up", "archived");
    expect(prisma.badge.create).not.toHaveBeenCalled();
  });

  it("makes no badge for a built-in course, whose badge comes from the seed", async () => {
    badgelessCourse();
    prisma.course.findUnique.mockResolvedValue({
      id: "course-1",
      projectId: "seq-elevate",
      slug: "speaking-up",
      meta: null,
      badgeId: null,
    });
    await setCourseStatus("speaking-up", "published");
    expect(prisma.badge.create).not.toHaveBeenCalled();
  });
});

/*
 * Publishing a created course (Release 2, D66, spec 4.8): Release 1's guard
 * (G1, D57) is lifted, so a course with lessons of its own, hidden or
 * deleted standard lessons, a new order or extra content publishes. Only a
 * lesson list (or a listed lesson's content) that can't be read, or a
 * course with no lesson learners would see, is refused — checked under the
 * Course row lock before anything is written, with the reasons, and
 * audited. The kill switches put Release 1's guard back (spec 3.4).
 */
describe("setCourseStatus: the publish guard", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  const META = { en: { title: "Speaking up", tagline: "Say it", clusterLabel: "Communication" } };
  const TEXT = { en: { title: "T", blocks: [{ kind: "paragraph", text: "x" }] } };
  const OWN = { id: "s-abcdefgh", template: "text" };
  const NARRATIVE = ["context", "concept", "behaviour", "reflection"];

  function createdCourse(outline: unknown, lessons: unknown[] = [], meta: unknown = META, badgeId: string | null = "badge-1") {
    signedInEditor();
    listCourses.mockResolvedValue([
      { slug: "speaking-up", cluster: "communicationEi", durationMinutes: 15, status: "draft" },
    ]);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.course.findFirst.mockResolvedValue({ id: "course-1", publishedAt: null });
    prisma.course.findUnique.mockResolvedValue({
      id: "course-1",
      projectId: "seq-elevate",
      slug: "speaking-up",
      meta,
      outline,
      badgeId,
    });
    prisma.course.update.mockResolvedValue({});
    prisma.lesson.findMany.mockResolvedValue(lessons);
  }

  const lockSql = () =>
    prisma.$queryRaw.mock.calls.map((c) => (c[0] as TemplateStringsArray).join("?"));

  it("publishes a course with a lesson of its own, a hidden one, a new order and extra content (D66)", async () => {
    createdCourse(
      {
        v: 1,
        sections: [
          { id: "context", template: "context", hidden: true },
          { id: "concept", template: "concept" },
          { id: "reflection", template: "reflection" },
          { id: "behaviour", template: "behaviour" },
          { ...OWN, label: { en: "Wrap-up" } },
        ],
      },
      [
        { stageKey: "s-abcdefgh", narrative: TEXT, documents: [] },
        {
          stageKey: "concept",
          narrative: TEXT,
          parts: { v: 1, items: [{ id: "main", type: "main" }, { id: "p-12345678", type: "text", blocks: { en: [] } }] },
          documents: [],
        },
      ]
    );
    expect(await setCourseStatus("speaking-up", "published")).toEqual({ ok: true, status: "published" });
    expect(prisma.course.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "published" }) })
    );
    expect(prisma.auditLog.create.mock.calls.map((c) => c[0].data.action)).toEqual(["course.published"]);
  });

  it("refuses a list that can't be read: nothing written, no badge, audited", async () => {
    createdCourse("not a list", [], META, null);
    const res = await setCourseStatus("speaking-up", "published");
    expect(res).toEqual({ ok: false, error: "cannot-publish", reasons: [{ code: "unreadable" }] });
    // The lock comes first, then the read of the list and the lessons.
    expect(lockSql()[0]).toBe('SELECT id FROM "Course" WHERE "id" = ? FOR UPDATE');
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.lesson.findMany.mock.invocationCallOrder[0]
    );
    expect(prisma.course.update).not.toHaveBeenCalled();
    expect(prisma.badge.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: "course.publish_refused",
      entity: "Course",
      entityId: "speaking-up",
      metadata: { error: "cannot-publish", reasons: [{ code: "unreadable" }] },
    });
  });

  it("refuses a listed lesson whose content can't be read, naming it", async () => {
    createdCourse(null, [{ stageKey: "concept", narrative: TEXT, parts: "garbage", documents: [] }]);
    expect(await setCourseStatus("speaking-up", "published")).toEqual({
      ok: false,
      error: "cannot-publish",
      reasons: [{ code: "unreadable", sectionId: "concept" }],
    });
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it("refuses a course with no lesson learners would see, which would hand out its badge for nothing", async () => {
    // Every standard text lesson deleted, and a lesson of its own with nothing in it.
    createdCourse({ v: 1, sections: [OWN], removed: NARRATIVE });
    expect(await setCourseStatus("speaking-up", "published")).toEqual({
      ok: false,
      error: "cannot-publish",
      reasons: [{ code: "no-lessons" }],
    });
    // Hidden lessons don't count either.
    createdCourse({ v: 1, sections: NARRATIVE.map((id) => ({ id, template: id, hidden: true })) });
    expect(await setCourseStatus("speaking-up", "published")).toMatchObject({ reasons: [{ code: "no-lessons" }] });
    // A video alone is something to see.
    createdCourse({ v: 1, sections: [OWN], removed: NARRATIVE }, [
      { stageKey: "s-abcdefgh", video: { provider: "file", src: "https://blob.example/v.mp4" }, documents: [] },
    ]);
    expect(await setCourseStatus("speaking-up", "published")).toEqual({ ok: true, status: "published" });
    expect((prisma.lesson.findMany.mock.calls as unknown[][])[0][0]).toMatchObject({
      where: { projectId: "seq-elevate", courseSlug: "speaking-up" },
      select: { stageKey: true, parts: true, video: true, documents: { where: { published: true } } },
    });
  });

  it("publishes a standard course, and a standard course with step names", async () => {
    createdCourse(null);
    expect(await setCourseStatus("speaking-up", "published")).toEqual({ ok: true, status: "published" });
    createdCourse({
      v: 1,
      sections: NARRATIVE.map((id) => ({ id, template: id, label: { en: `My ${id}`, de: `Mein ${id}` } })),
    });
    expect(await setCourseStatus("speaking-up", "published")).toEqual({ ok: true, status: "published" });
  });

  it.each([
    ["R2_PUBLISH_GUARD", "on"],
    ["R2_LEARNER_PLAYER", "off"],
  ])("with %s=%s, refuses what Release 1 refused, audited as then", async (name, value) => {
    vi.stubEnv(name, value);
    createdCourse({ v: 1, sections: [...NARRATIVE.map((id) => ({ id, template: id })), OWN] }, [
      { stageKey: "s-abcdefgh", narrative: TEXT, documents: [] },
    ]);
    expect(await setCourseStatus("speaking-up", "published")).toEqual({
      ok: false,
      error: "needs-release-2",
      reasons: [{ code: "custom-section", sectionId: "s-abcdefgh" }],
    });
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: "course.publish_refused",
      metadata: { reasons: [{ code: "custom-section", sectionId: "s-abcdefgh" }] },
    });
    // A standard course still publishes.
    createdCourse(null);
    expect(await setCourseStatus("speaking-up", "published")).toEqual({ ok: true, status: "published" });
  });

  it("never checks a move to draft or archive, or a built-in course", async () => {
    createdCourse({ v: 1, sections: [OWN], removed: NARRATIVE });
    expect(await setCourseStatus("speaking-up", "draft")).toEqual({ ok: true, status: "draft" });
    expect(await setCourseStatus("speaking-up", "archived")).toEqual({ ok: true, status: "archived" });
    expect(prisma.lesson.findMany).not.toHaveBeenCalled();
    createdCourse({ v: 1, sections: [OWN], removed: NARRATIVE }, [], null);
    expect(await setCourseStatus("speaking-up", "published")).toEqual({ ok: true, status: "published" });
    expect(prisma.lesson.findMany).not.toHaveBeenCalled();
  });
});

describe("createCourse: arguments and layout", () => {
  afterEach(() => vi.clearAllMocks());

  function fresh() {
    signedInEditor();
    listCourses.mockResolvedValue([]);
    prisma.badge.findMany.mockResolvedValue([]);
    prisma.badge.create.mockResolvedValue({ id: "badge-1" });
    prisma.course.create.mockResolvedValue({ id: "course-1" });
  }

  it("refuses a language the platform doesn't have, and arguments no form sends", async () => {
    fresh();
    expect(await createCourse({ ...NEW_COURSE, locale: "fr" as never })).toEqual({
      ok: false,
      error: "bad-locale",
    });
    expect(await createCourse({ ...NEW_COURSE, title: 5 as never })).toEqual({
      ok: false,
      error: "bad-input",
    });
    expect(await createCourse({ ...NEW_COURSE, layout: "everything" as never })).toEqual({
      ok: false,
      error: "bad-input",
    });
    expect(prisma.course.create).not.toHaveBeenCalled();
  });

  it("starts from today's layout, with no stored list", async () => {
    fresh();
    await createCourse(NEW_COURSE);
    expect(prisma.course.create.mock.calls[0][0].data.outline).toBeUndefined();
  });

  it("starts from the full template: all seven standard lessons, still standard", async () => {
    fresh();
    await expect(createCourse({ ...NEW_COURSE, layout: "full" })).resolves.toEqual({
      ok: true,
      slug: "speaking-up",
    });
    expect(prisma.course.create.mock.calls[0][0].data.outline).toEqual({
      v: 1,
      sections: ["context", "concept", "behaviour", "simulation", "scenario", "reflection", "assessment"].map(
        (id) => ({ id, template: id })
      ),
    });
  });
});

/*
 * Release 3 (D90, spec 9.4): a created course's German or Greek is
 * switched on for learners by a partner admin or an ADMIN, atomically and
 * audited. Release 2 had no such switch: every language a course had any
 * text in went to learners, half-translated or not.
 */
describe("setCourseLanguageReady", () => {
  afterEach(() => vi.clearAllMocks());

  /** The course row as it is locked, and the arrays the UPDATE leaves. */
  function course(row: { id: string; builtin: boolean } | null, before: string[] = [], after: string[] = before) {
    getCurrentUser.mockResolvedValue(EDITOR);
    prisma.$transaction.mockImplementation(async (arg: unknown) =>
      typeof arg === "function" ? arg(prisma) : Promise.all(arg as unknown[])
    );
    prisma.auditLog.create.mockResolvedValue({});
    prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("FOR UPDATE")) return row ? [{ ...row, readyLocales: before }] : [];
      if (sql.startsWith("UPDATE")) return [{ readyLocales: after }];
      return [];
    });
  }
  const as = (...roles: string[]) =>
    getProjectMemberships.mockResolvedValue(roles.map((role) => ({ role, projectId: "seq-elevate" })));
  const sqlOf = () => prisma.$queryRaw.mock.calls.map((c) => (c[0] as TemplateStringsArray).join("?"));

  it.each([["CONTENT_EDITOR"], ["FACILITATOR"], ["LEARNER"]])("refuses a %s: nothing is read or written", async (role) => {
    course({ id: "course-1", builtin: false });
    as(role);
    expect(await setCourseLanguageReady("speaking-up", "de", true)).toEqual({ ok: false, error: "forbidden" });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("refuses someone signed out", async () => {
    course({ id: "course-1", builtin: false });
    getCurrentUser.mockResolvedValue(null);
    expect(await setCourseLanguageReady("speaking-up", "de", true)).toEqual({ ok: false, error: "forbidden" });
  });

  it.each([["PARTNER_ADMIN"], ["ADMIN"]])("lets a %s switch German on, in one statement under the course's lock, audited", async (role) => {
    course({ id: "course-1", builtin: false }, ["el"], ["el", "de"]);
    as(role);
    expect(await setCourseLanguageReady("speaking-up", "de", true)).toEqual({ ok: true, readyLocales: ["el", "de"] });
    const [lock, update] = sqlOf();
    expect(lock).toContain('FROM "Course"');
    expect(lock).toContain("FOR UPDATE");
    // The array changes in the database, so two languages switched at once
    // never drop each other.
    expect(update).toMatch(/^UPDATE "Course" SET "readyLocales" = array_append\(array_remove\(/);
    expect(prisma.$queryRaw.mock.calls[1].slice(1)).toEqual(["de", "de", "course-1"]);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: "course.language_ready",
      entity: "Course",
      entityId: "speaking-up",
      metadata: { locale: "de" },
      actorId: "editor-1",
    });
  });

  it("switches Greek off with array_remove alone, audited as such", async () => {
    course({ id: "course-1", builtin: false }, ["de", "el"], ["de"]);
    as("ADMIN");
    expect(await setCourseLanguageReady("speaking-up", "el", false)).toEqual({ ok: true, readyLocales: ["de"] });
    expect(sqlOf()[1]).toMatch(/^UPDATE "Course" SET "readyLocales" = array_remove\(/);
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: "course.language_unready",
      metadata: { locale: "el" },
    });
  });

  it("writes no audit row when nothing changed", async () => {
    course({ id: "course-1", builtin: false }, ["de"], ["de"]);
    as("ADMIN");
    expect(await setCourseLanguageReady("speaking-up", "de", true)).toEqual({ ok: true, readyLocales: ["de"] });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("refuses a built-in course, an unknown one, English and arguments no form sends", async () => {
    as("ADMIN");
    course({ id: "course-1", builtin: true });
    expect(await setCourseLanguageReady("speaking-up", "de", true)).toEqual({ ok: false, error: "built-in" });
    // A course the platform ships is never even looked up.
    course({ id: "course-1", builtin: false });
    prisma.$queryRaw.mockClear();
    expect(await setCourseLanguageReady("receiving-feedback", "de", true)).toEqual({ ok: false, error: "built-in" });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    course(null);
    expect(await setCourseLanguageReady("no-such-course", "de", true)).toEqual({ ok: false, error: "unknown-course" });
    for (const args of [
      ["speaking-up", "en", true],
      ["speaking-up", "fr", true],
      ["speaking-up", "de", "yes"],
      [42, "de", true],
      ["../x", "de", true],
    ]) {
      expect(await (setCourseLanguageReady as (...a: unknown[]) => Promise<unknown>)(...args)).toEqual({
        ok: false,
        error: "bad-input",
      });
    }
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
