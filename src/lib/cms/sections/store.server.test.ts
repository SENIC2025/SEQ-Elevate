import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * The flexible editor's database helpers: the two lock strengths as literal
 * queries (a tagged template can't parameterise the keyword), the refusals
 * every action starts with, ids that never adopt a row, and the learner
 * count the page shows (D53).
 */

vi.mock("server-only", () => ({}));
const auditCreate = vi.fn(async () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { auditLog: { create: auditCreate } } }));

const store = await import("./store.server");

const queries: string[] = [];
let course: Record<string, unknown> | null;
let lessons: Record<string, unknown>[];
const tx = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
    queries.push(strings.join("?"));
    return [];
  }),
  course: { findFirst: vi.fn(async () => course) },
  lesson: {
    findMany: vi.fn(async () => lessons),
    upsert: vi.fn(async () => ({})),
  },
  courseEnrollment: { count: vi.fn(async () => 3) },
};
const asTx = tx as never;

beforeEach(() => {
  queries.length = 0;
  course = { id: "course-1", meta: { en: { title: "T" } }, outline: null, status: "published" };
  lessons = [];
  vi.clearAllMocks();
});

describe("lockCourse", () => {
  it("locks the course row FOR UPDATE or FOR SHARE, then reads it", async () => {
    await expect(store.lockCourse(asTx, "my-course", "update")).resolves.toEqual({
      id: "course-1",
      meta: { en: { title: "T" } },
      outline: null,
      status: "published",
    });
    await store.lockCourse(asTx, "my-course", "share");
    expect(queries).toEqual([
      'SELECT id FROM "Course" WHERE "projectId" = ? AND "slug" = ? FOR UPDATE',
      'SELECT id FROM "Course" WHERE "projectId" = ? AND "slug" = ? FOR SHARE',
    ]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.course.findFirst.mock.invocationCallOrder[0]
    );
  });

  it("is null for a course that doesn't exist", async () => {
    course = null;
    await expect(store.lockCourse(asTx, "nope", "share")).resolves.toBeNull();
  });
});

describe("lockLessonRow", () => {
  it("makes sure the row exists, then locks it", async () => {
    await store.lockLessonRow(asTx, "my-course", "s-abcdefgh");
    expect(tx.lesson.upsert).toHaveBeenCalledWith({
      where: {
        projectId_courseSlug_stageKey: {
          projectId: "seq-elevate",
          courseSlug: "my-course",
          stageKey: "s-abcdefgh",
        },
      },
      create: { projectId: "seq-elevate", courseSlug: "my-course", stageKey: "s-abcdefgh" },
      update: {},
    });
    expect(queries).toEqual([
      'SELECT id FROM "Lesson" WHERE "projectId" = ? AND "courseSlug" = ? AND "stageKey" = ? FOR UPDATE',
    ]);
  });
});

describe("openCourse", () => {
  it("refuses a built-in course and a course that doesn't exist", async () => {
    course = { id: "c", meta: null, outline: null, status: "published" };
    await expect(store.openCourse(asTx, "x", "update")).rejects.toMatchObject({
      result: { ok: false, error: "not-cms-course" },
    });
    course = null;
    await expect(store.openCourse(asTx, "x", "update")).rejects.toMatchObject({
      result: { ok: false, error: "not-cms-course" },
    });
  });

  it("refuses while the lesson list or a listed lesson's content can't be read (G8)", async () => {
    course = { ...course, outline: { v: 9 } };
    await expect(store.openCourse(asTx, "x", "share")).rejects.toMatchObject({
      result: { ok: false, error: "outline-unreadable" },
    });
    course = { ...course, outline: null };
    lessons = [{ stageKey: "concept", parts: { v: 1, items: [] }, documents: [] }];
    await expect(store.openCourse(asTx, "x", "share")).rejects.toMatchObject({
      result: { ok: false, error: "outline-unreadable" },
    });
  });

  it("gives the resolved list, its reasons and the rows", async () => {
    lessons = [
      {
        stageKey: "scenario",
        structure: { kind: "scenario" },
        video: { provider: "youtube", src: "x" },
        documents: [{ id: "d2", url: "u2" }, { id: "d1", url: "u1" }],
      },
    ];
    const state = await store.openCourse(asTx, "x", "update");
    expect(state.outline.sections.map((s) => s.id)).toEqual([
      "context",
      "concept",
      "behaviour",
      "scenario",
      "reflection",
    ]);
    expect(state.reasons).toEqual([]);
    expect(state.lessons[0]).toMatchObject({
      stageKey: "scenario",
      narrative: null,
      parts: null,
      documentCount: 2,
      documentIds: ["d2", "d1"],
      documentUrls: ["u2", "u1"],
    });
  });
});

describe("new ids", () => {
  it("makes lesson ids of the custom form, never one already taken", () => {
    const taken = new Set<string>();
    const isTaken = vi.fn((id: string) => {
      // The first two tries clash with a stray row and an outline entry.
      if (isTaken.mock.calls.length <= 2) {
        taken.add(id);
        return true;
      }
      return taken.has(id);
    });
    const id = store.newSectionId(isTaken);
    expect(id).toMatch(/^s-[a-z0-9]{8}$/);
    expect(taken.has(id)).toBe(false);
    expect(isTaken).toHaveBeenCalledTimes(3);
  });

  it("gives up after five tries, leaving the refusal to the rules", () => {
    const isTaken = vi.fn(() => true);
    expect(store.newPartId(isTaken)).toMatch(/^p-[a-z0-9]{8}$/);
    expect(isTaken).toHaveBeenCalledTimes(4);
  });
});

describe("learnerCount", () => {
  it("counts the course's learners only (D53)", async () => {
    await expect(store.learnerCount(asTx, "course-1")).resolves.toBe(3);
    expect(tx.courseEnrollment.count).toHaveBeenCalledWith({
      where: {
        courseId: "course-1",
        user: {
          memberships: {
            some: { projectId: "seq-elevate", role: "LEARNER" },
            none: { projectId: "seq-elevate", role: { in: expect.any(Array) } },
          },
        },
      },
    });
  });
});

describe("audit rows", () => {
  it("names the course, or the lesson as course:lesson", async () => {
    await store.auditCourse("u1", "section.moved", "my-course", { sectionId: "concept" });
    await store.auditLesson("u1", "part.added", "my-course", "concept", { partId: "p-1" });
    expect(auditCreate.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      {
        data: {
          projectId: "seq-elevate",
          actorId: "u1",
          action: "section.moved",
          entity: "Course",
          entityId: "my-course",
          metadata: { sectionId: "concept" },
        },
      },
      {
        data: {
          projectId: "seq-elevate",
          actorId: "u1",
          action: "part.added",
          entity: "Lesson",
          entityId: "my-course:concept",
          metadata: { partId: "p-1" },
        },
      },
    ]);
  });
});
