import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CourseContent } from "./types";
import { isSectionedCourse, type SectionedCourseContent } from "./sections/contract";

/*
 * "Preview as learner" (spec 9.2): the learner view itself for every course
 * learners get as built — bundled, published, or standard — and, for a draft
 * course with lessons or content learners don't get until Release 2, the
 * editor's layout: the list's order, hidden lessons left out, step names,
 * lessons of the course's own, extra content, video and published documents.
 * Any error previews as learners see it.
 */

vi.mock("server-only", () => ({}));

const state: {
  course: { meta: unknown; outline: unknown; status: string } | null;
  lessons: Record<string, unknown>[];
  fail: boolean;
} = { course: null, lessons: [], fail: false };

const lessonFindMany = vi.fn(async () => {
  if (state.fail) throw new Error("db down");
  return state.lessons.map((l) => ({
    narrative: null,
    structure: null,
    structureDraft: null,
    parts: null,
    video: null,
    documents: [],
    ...l,
  }));
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    course: { findFirst: vi.fn(async () => state.course) },
    lesson: { findMany: lessonFindMany },
  },
}));

const { getPreviewCourse } = await import("./preview-course");

const learner: CourseContent = {
  slug: "asking-for-help",
  locale: "en",
  title: "Asking for help",
  tagline: "Short and real",
  cluster: "communicationEi",
  clusterLabel: "Communication",
  durationMinutes: 15,
  badge: { slug: "asking-for-help", name: "Asking for help", meaning: "Short and real" },
  stages: [],
  completion: { title: "Done", body: "Short and real" },
};

const META = { en: { title: "Asking for help", tagline: "t", clusterLabel: "c" } };
const para = (text: string) => ({ kind: "paragraph", text });
const OWN = "s-abcdefgh";
const DOC = { id: "d1", name: "a.pdf", url: "https://x/a.pdf", mimeType: "application/pdf", sizeBytes: 1, published: true };

/** A draft course learners can't get as built yet. */
function flexible() {
  state.course = {
    meta: META,
    status: "draft",
    outline: {
      v: 1,
      sections: [
        { id: "context", template: "context", hidden: true },
        { id: OWN, template: "quiz", label: { de: "Kurzer Check" } },
        { id: "concept", template: "concept", label: { en: "The idea" } },
        { id: "behaviour", template: "behaviour" },
        { id: "reflection", template: "reflection" },
      ],
    },
  };
  state.lessons = [
    {
      stageKey: OWN,
      structure: {
        kind: "assessment",
        questions: [
          {
            id: "q1",
            question: { en: "When do you ask?" },
            correctOptionId: "a",
            options: [
              { id: "a", text: { en: "Early" } },
              { id: "b", text: { en: "Late" } },
            ],
          },
        ],
      },
    },
    { stageKey: "context", narrative: { en: { title: "Hidden", blocks: [para("x")] } } },
    {
      stageKey: "concept",
      narrative: { en: { title: "Concept", blocks: [para("Main text")] } },
      video: { provider: "youtube", src: "https://youtu.be/abc" },
      documents: [DOC],
      parts: {
        v: 1,
        items: [
          { id: "main", type: "main" },
          { id: "p-text0001", type: "text", blocks: { en: [para("More text")] } },
          { id: "p-quiz0001", type: "quiz", data: null, draft: { kind: "assessment", questions: [] } },
        ],
      },
    },
  ];
}

beforeEach(() => {
  state.course = null;
  state.lessons = [];
  state.fail = false;
  lessonFindMany.mockClear();
});

describe("getPreviewCourse", () => {
  it("previews a standard course exactly as learners get it (the same object)", async () => {
    state.course = { meta: META, outline: null, status: "draft" };
    await expect(getPreviewCourse("seq-elevate", "asking-for-help", "en", learner)).resolves.toBe(
      learner
    );
  });

  it("previews built-in and published courses as learners get them, without reading lessons", async () => {
    state.course = { meta: null, outline: null, status: "draft" };
    await expect(getPreviewCourse("seq-elevate", "workplace-conflict", "en", learner)).resolves.toBe(learner);
    flexible();
    state.course!.status = "published";
    await expect(getPreviewCourse("seq-elevate", "asking-for-help", "en", learner)).resolves.toBe(learner);
    expect(lessonFindMany).not.toHaveBeenCalled();
  });

  it("shows a draft course in the editor's layout", async () => {
    flexible();
    const shown = await getPreviewCourse("seq-elevate", "asking-for-help", "en", learner);
    expect(isSectionedCourse(shown)).toBe(true);
    const c = shown as SectionedCourseContent;
    expect(c).toMatchObject({ sectioned: true, title: "Asking for help", badge: learner.badge });
    // The list's order, the hidden lesson left out.
    expect(c.stages.map((s) => s.key)).toEqual([OWN, "concept", "behaviour", "reflection"]);
    // Step names: the lesson's own, else another language's, never "Course — s-…".
    expect(c.stages.map((s) => s.label)).toEqual(["Kurzer Check", "The idea", "Behaviour model", "Reflection"]);
    const concept = c.stages[1];
    expect(concept.parts.map((p) => p.id)).toEqual(["main", "p-text0001"]);
    // The question that is only a draft is left out and counted.
    expect(concept.skipped).toBe(1);
    expect(concept.video).toEqual({ provider: "youtube", src: "https://youtu.be/abc" });
    expect(concept.documents).toEqual([DOC]);
  });

  it("reads published documents only, in the learner's order", async () => {
    flexible();
    await getPreviewCourse("seq-elevate", "asking-for-help", "en", learner);
    const select = (lessonFindMany.mock.calls[0] as unknown as [{ select: { documents: unknown } }])[0]
      .select;
    expect(select.documents).toEqual({
      where: { published: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, url: true, mimeType: true, sizeBytes: true, published: true },
    });
  });

  it("names the lessons in the preview's language", async () => {
    flexible();
    const c = (await getPreviewCourse("seq-elevate", "asking-for-help", "de", learner)) as SectionedCourseContent;
    expect(c.stages.map((s) => s.label)).toEqual([
      "Kurzer Check",
      // A standard lesson without a German name has its standard one, not the English.
      "Skill-Konzept",
      "Verhaltens-Modell",
      "Reflexion",
    ]);
  });

  it("falls back to what learners see on any error, or a list that can't be read", async () => {
    flexible();
    state.fail = true;
    await expect(getPreviewCourse("seq-elevate", "asking-for-help", "en", learner)).resolves.toBe(learner);
    state.fail = false;
    state.course!.outline = { v: 9 };
    await expect(getPreviewCourse("seq-elevate", "asking-for-help", "en", learner)).resolves.toBe(learner);
  });
});
