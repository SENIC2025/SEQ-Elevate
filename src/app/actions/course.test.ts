import { describe, it, expect, afterEach, vi } from "vitest";

// A course created in the CMS must get a Badge row, linked through
// Course.badgeId, or the badge a learner earns on it is never saved (C9).
const getCurrentUser = vi.fn();
const getProjectMemberships = vi.fn();
const listCourses = vi.fn();
const getBaseCourseCopy = vi.fn();
const prisma = {
  course: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  badge: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
};
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser, getProjectMemberships }));
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/cms", () => ({ listCourses, getBaseCourseCopy }));

const { createCourse, updateCourseMeta } = await import("./course");

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
});
