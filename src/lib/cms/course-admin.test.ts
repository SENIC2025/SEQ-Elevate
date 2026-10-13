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

const courseFindFirst = vi.fn();
const courseFindMany = vi.fn(async () => []);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    course: {
      findMany: courseFindMany,
      findFirst: courseFindFirst.mockImplementation(async () => ({
        slug: "asking-for-help",
        cluster: "communicationEi",
        durationMinutes: 15,
        meta,
        copyOverride: null,
        status: "draft",
        publishedAt: null,
        updatedAt: at,
        _count: { enrollments: 0 },
      })),
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

const { getCourseGrid, getCourseOutline } = await import("./course-admin");

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

  it("says which language the English editor shows for a lesson written only in German", async () => {
    // Learners reading in English get the German text when English has none
    // (or only blanks), so the English editor opens on it and must say so:
    // otherwise saving a typo fix would quietly store German as English.
    lessons[0].narrative = {
      en: { title: "", blocks: [para(" ")] },
      de: written("Titel", "Text auf Deutsch"),
    };
    const outline = await getCourseOutline("asking-for-help");
    const context = outline?.lessons.find((l) => l.key === "context");
    expect(context?.byLang.en.narrative).toMatchObject({
      hasOverride: false,
      fallbackFrom: "de",
      title: "Titel",
      blocks: [para("Text auf Deutsch")],
    });
    // Greek has no text either: it gets German too, and says so.
    expect(context?.byLang.el.narrative).toMatchObject({
      hasOverride: false,
      fallbackFrom: "de",
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

/*
 * "N learners enrolled" counts learners: people with a LEARNER membership
 * and no staff role in the project. Staff who opened a learner page before
 * Release 0 still hold the LEARNER role it gave everyone, and a course they
 * tried out isn't a learner's enrolment.
 */
const ENROLLED_LEARNERS = {
  _count: {
    select: {
      enrollments: {
        where: {
          user: {
            memberships: {
              some: { projectId: "seq-elevate", role: "LEARNER" },
              none: {
                projectId: "seq-elevate",
                role: {
                  in: expect.arrayContaining(["FACILITATOR", "ADMIN", "CONTENT_EDITOR"]),
                },
              },
            },
          },
        },
      },
    },
  },
};

describe("who a course's enrolment count counts", () => {
  it("counts learners only on the course page", async () => {
    courseFindFirst.mockClear();
    await getCourseOutline("asking-for-help");
    // The course is also read for what learners see; only one read counts.
    const counting = courseFindFirst.mock.calls
      .map(([args]) => args as { select?: { _count?: unknown } })
      .filter((args) => args?.select?._count);
    expect(counting).toHaveLength(1);
    expect(counting[0].select).toMatchObject(ENROLLED_LEARNERS);
  });

  it("counts learners only on the course grid", async () => {
    courseFindMany.mockClear();
    await getCourseGrid("en");
    expect(courseFindMany).toHaveBeenCalledTimes(1);
    expect(
      (courseFindMany.mock.calls[0] as unknown as [{ select: unknown }])[0].select
    ).toMatchObject(ENROLLED_LEARNERS);
  });
});

describe("each lesson's main content and whether learners get it", () => {
  it("names the editor each lesson's main content needs, and marks the lessons learners get", async () => {
    const outline = await getCourseOutline("asking-for-help");
    expect(
      outline?.lessons.map((l) => [l.key, l.mainKind, l.live, l.present])
    ).toEqual([
      ["context", "narrative", true, true],
      ["concept", "narrative", true, true],
      ["behaviour", "narrative", true, true],
      // "Add …" slots: learners don't get them.
      ["simulation", "simulation", false, false],
      ["scenario", "scenario", false, false],
      ["reflection", "reflection", true, true],
      ["assessment", "assessment", false, false],
    ]);
  });
});
