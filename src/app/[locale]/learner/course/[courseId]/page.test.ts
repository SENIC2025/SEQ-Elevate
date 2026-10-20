import { describe, it, expect, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import type { CourseContent } from "@/lib/cms/types";
import type { LearnerCourse } from "@/lib/cms/learner-course";

/**
 * The course route (Release 2, D63, spec 5.1): every viewer of every course
 * gets the one player, with the lessons learners get (getLearnerCourse) —
 * an editor's preview the very same, plus the editors' note. Only preview
 * honours ?lesson=, for any lesson learners get; a signed-in learner opens
 * where the server worked out they left off. Release 1 gave learners the
 * standard lessons only and played an editor's draft in a separate
 * sectioned preview player, with a banner.
 */

const getCourse = vi.fn();
const getCourseStatus = vi.fn();
const getViewerRoles = vi.fn();
const getLearnerCourse = vi.fn();
const getCurrentUser = vi.fn();
const findFirst = vi.fn();
vi.mock("@/lib/cms", () => ({ getCourse }));
vi.mock("@/lib/cms/course-overlay", () => ({ getCourseStatus }));
vi.mock("@/lib/server-queries", () => ({ getViewerRoles }));
vi.mock("@/lib/cms/learner-course", () => ({ getLearnerCourse }));
vi.mock("@/lib/auth-helpers", () => ({ getCurrentUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { courseEnrollment: { findFirst } } }));
vi.mock("next-intl/server", () => ({ setRequestLocale: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/course/CoursePlayer", () => ({ CoursePlayer: () => null }));
vi.mock("@/store/demo-state", () => ({
  PreviewStateProvider: ({ children }: { children: unknown }) => children,
}));

const { default: Page } = await import("./page");
const { CoursePlayer } = await import("@/components/course/CoursePlayer");
const { PreviewStateProvider } = await import("@/store/demo-state");

const base = { slug: "speak-up", title: "Speak up", stages: [] } as unknown as CourseContent;
/** A published flexible course: a lesson of its own, a standard one with extra content, one by its stage screen. */
const flexible = {
  slug: "speak-up",
  title: "Speak up",
  lessons: [
    { kind: "section", id: "s-abcd1234", label: "Warm-up", section: { key: "s-abcd1234", parts: [] } },
    { kind: "section", id: "concept", label: "The idea", section: { key: "concept", parts: [] } },
    { kind: "stage", id: "assessment", label: "Quick check", stage: { key: "assessment" } },
  ],
  unseen: ["context"],
} as unknown as LearnerCourse;

type El = ReactElement<Record<string, unknown>>;

async function visit(
  { locale = "en", ...sp }: { locale?: string; lesson?: string; preview?: string; ui?: string } = {}
) {
  return (await Page({
    params: Promise.resolve({ locale, courseId: "speak-up" }),
    searchParams: Promise.resolve(sp),
  })) as El;
}

function setup(o: {
  status: "draft" | "published";
  editor: boolean;
  user?: { id: string } | null;
  enrolment?: { stagesCompleted: string[]; sectionsCompleted: unknown; completedAt: Date | null } | null;
}) {
  getCourse.mockResolvedValue(base);
  getCourseStatus.mockResolvedValue(o.status);
  getViewerRoles.mockResolvedValue(o.editor ? ["CONTENT_EDITOR"] : ["LEARNER"]);
  getLearnerCourse.mockResolvedValue(flexible);
  getCurrentUser.mockResolvedValue(o.user ?? null);
  findFirst.mockResolvedValue(o.enrolment ?? null);
}

/** The player inside the preview's in-memory store, or the bare player. */
function player(el: El): El {
  if (el.type === PreviewStateProvider) return el.props.children as El;
  return el;
}

describe("course route", () => {
  afterEach(() => vi.clearAllMocks());

  it("gives a learner on a published flexible course the lessons learners get, sections and all", async () => {
    setup({ status: "published", editor: false });
    const el = await visit({ locale: "de" });
    expect(el.type).toBe(CoursePlayer);
    expect(getLearnerCourse).toHaveBeenCalledWith("seq-elevate", "speak-up", "de", base, { editor: false });
    expect(el.props).toEqual({
      course: flexible,
      draftPreview: false,
      preview: false,
      canEdit: false,
      initialLesson: undefined,
      editLocale: undefined,
      serverResume: null,
    });
  });

  it("never lets a learner skip ahead with ?lesson= (Q4), even with ?preview=1", async () => {
    setup({ status: "published", editor: false });
    const el = await visit({ preview: "1", lesson: "assessment" });
    expect(el.type).toBe(CoursePlayer);
    expect(el.props.preview).toBe(false);
    expect(el.props.initialLesson).toBeUndefined();
  });

  it("opens a signed-in learner at the first lesson of the plan they haven't done", async () => {
    setup({
      status: "published",
      editor: false,
      user: { id: "u1" },
      enrolment: { stagesCompleted: ["CONCEPT"], sectionsCompleted: ["s-abcd1234"], completedAt: null },
    });
    const el = await visit();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1", course: { projectId: "seq-elevate", slug: "speak-up" } } })
    );
    expect(el.props.serverResume).toBe("assessment");
  });

  it("opens a completed course on its completion screen, and one with every lesson done on its last", async () => {
    setup({
      status: "published",
      editor: false,
      user: { id: "u1" },
      enrolment: { stagesCompleted: [], sectionsCompleted: null, completedAt: new Date("2026-11-10T09:00:00Z") },
    });
    expect((await visit()).props.serverResume).toBe("complete");
    setup({
      status: "published",
      editor: false,
      user: { id: "u1" },
      enrolment: { stagesCompleted: ["CONCEPT", "ASSESSMENT"], sectionsCompleted: ["s-abcd1234"], completedAt: null },
    });
    expect((await visit()).props.serverResume).toBe("assessment");
  });

  it("has no position for a guest, a learner not enrolled, or when the enrolment can't be read", async () => {
    setup({ status: "published", editor: false });
    expect((await visit()).props.serverResume).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
    setup({ status: "published", editor: false, user: { id: "u1" } });
    expect((await visit()).props.serverResume).toBeNull();
    setup({ status: "published", editor: false, user: { id: "u1" } });
    findFirst.mockRejectedValueOnce(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await visit()).props.serverResume).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("previews a draft as learners get it, in the same player, from any lesson learners get", async () => {
    setup({ status: "draft", editor: true, user: { id: "editor" } });
    for (const lesson of ["s-abcd1234", "concept", "assessment"]) {
      const el = await visit({ locale: "de", lesson, ui: "en" });
      expect(getLearnerCourse).toHaveBeenLastCalledWith("seq-elevate", "speak-up", "de", base, { editor: true });
      expect(el.type).toBe(PreviewStateProvider);
      const p = player(el);
      expect(p.type).toBe(CoursePlayer);
      expect(p.props).toEqual({
        course: flexible,
        draftPreview: true,
        preview: true,
        canEdit: true,
        initialLesson: lesson,
        editLocale: "en",
        serverResume: null,
      });
    }
    // A preview never reads the editor's own progress.
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("starts a preview at the first lesson for one learners don't get (hidden, unknown or not an id)", async () => {
    setup({ status: "draft", editor: true });
    for (const lesson of ["context", "s-zzzz9999", "../x"]) {
      expect(player(await visit({ lesson })).props.initialLesson).toBeUndefined();
    }
  });

  it("previews a published course with ?preview=1, and plays it for an editor without", async () => {
    setup({ status: "published", editor: true, user: { id: "editor" } });
    const previewing = player(await visit({ preview: "1", lesson: "concept" }));
    expect(previewing.props).toMatchObject({ preview: true, draftPreview: false, initialLesson: "concept" });
    const playing = await visit({ lesson: "concept" });
    expect(playing.type).toBe(CoursePlayer);
    expect(playing.props).toMatchObject({ preview: false, canEdit: true, initialLesson: undefined });
    expect(getLearnerCourse).toHaveBeenLastCalledWith("seq-elevate", "speak-up", "en", base, { editor: false });
  });

  it("is a 404 for a learner on a draft, as before", async () => {
    setup({ status: "draft", editor: false });
    await expect(visit()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getLearnerCourse).not.toHaveBeenCalled();
  });
});
