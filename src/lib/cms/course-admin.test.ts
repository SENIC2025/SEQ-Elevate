import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NarrativeBlock } from "./types";

/*
 * The course page's "before you publish" warnings for a course created in
 * the CMS whose German version was typed and then cleared. Learners get the
 * English there, so the page must say German isn't written yet — not count
 * the blank German as a translation.
 *
 * The database and the sign-in are stood in for; what learners see comes
 * from the real getDbCourse, as on the page.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/editor-gate", () => ({ viewerCanEditContent: async () => true }));

const para = (text: string): NarrativeBlock => ({ kind: "paragraph", text });
const at = new Date("2026-10-01T10:00:00.000Z");

let meta: unknown;
let lessons: { stageKey: string; narrative?: unknown; structure?: unknown }[];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    course: {
      findFirst: async () => ({
        slug: "asking-for-help",
        cluster: "communicationEi",
        durationMinutes: 15,
        meta,
        copyOverride: null,
        status: "draft",
        publishedAt: null,
        updatedAt: at,
        _count: { enrollments: 0 },
      }),
    },
    lesson: {
      findMany: async () =>
        lessons.map((l) => ({
          video: null,
          documents: [],
          updatedAt: at,
          structure: null,
          narrative: null,
          ...l,
        })),
    },
  },
}));
vi.mock("@/lib/cms", async () => {
  const { getDbCourse } = await import("./db-course");
  return {
    getCourse: getDbCourse,
    getBaseCourseCopy: async () => null,
    listCourses: async () => [],
  };
});

const { getCourseOutline } = await import("./course-admin");

const EN = { title: "Asking for help", tagline: "Short and real", clusterLabel: "Communication" };
const written = (title: string, text: string) => ({ title, blocks: [para(text)] });

beforeEach(() => {
  // Everything written in English and Greek; German typed, then cleared.
  meta = {
    en: EN,
    el: { title: "Ζητώντας βοήθεια", tagline: "Σύντομο", clusterLabel: "Επικοινωνία" },
    de: { title: "", tagline: " ", clusterLabel: "" },
  };
  lessons = ["context", "concept", "behaviour", "reflection"].map((stageKey) => ({
    stageKey,
    narrative: {
      en: written("Title", "Text"),
      el: written("Τίτλος", "Κείμενο"),
      de: { title: " ", blocks: [para("")] },
    },
  }));
});

describe("getCourseOutline with a cleared translation", () => {
  it("warns that the German title and subtitle are missing", async () => {
    const outline = await getCourseOutline("asking-for-help");
    expect(outline?.copy.de).toMatchObject({
      source: "fallback",
      fallbackFrom: "en",
      title: "Asking for help",
      tagline: "Short and real",
    });
    expect(outline?.readiness).toContainEqual({
      level: "warning",
      code: "copy-missing",
      locale: "de",
    });
  });

  it("counts every blank German lesson as untranslated", async () => {
    const outline = await getCourseOutline("asking-for-help");
    expect(outline?.readiness).toContainEqual({
      level: "warning",
      code: "lesson-untranslated",
      locale: "de",
      count: 4,
    });
    // Greek is written, so no warning for it.
    expect(
      outline?.readiness.filter((r) => "locale" in r && r.locale === "el")
    ).toEqual([]);
    expect(outline?.languages.de).toEqual({ state: "missing", covered: 0, total: 4 });
  });

  it("opens the German editor on the English learners see", async () => {
    const outline = await getCourseOutline("asking-for-help");
    const context = outline?.lessons.find((l) => l.key === "context");
    expect(context?.byLang.de.narrative).toMatchObject({
      hasOverride: false,
      fallbackFrom: "en",
      title: "Title",
      blocks: [para("Text")],
    });
  });

  it("calls a lesson with only blank blocks in every language empty", async () => {
    lessons[1].narrative = { en: { title: "Concept", blocks: [para(" ")] } };
    const outline = await getCourseOutline("asking-for-help");
    expect(outline?.readiness).toContainEqual({
      level: "warning",
      code: "lesson-empty",
      stage: "concept",
    });
  });

  it("keeps a partly written German lesson as the editor stored it", async () => {
    // A German title with the body still to write: learners see the
    // English text under it, but the editor shows what is stored in German,
    // so saving the title doesn't copy the English text into German.
    lessons[0].narrative = {
      en: written("Title", "Text"),
      de: { title: "Titel", blocks: [] },
    };
    const outline = await getCourseOutline("asking-for-help");
    const context = outline?.lessons.find((l) => l.key === "context");
    expect(context?.byLang.de.stage?.blocks).toEqual([para("Text")]);
    expect(context?.byLang.de.narrative).toMatchObject({
      hasOverride: true,
      title: "Titel",
      blocks: [],
    });
  });
});
