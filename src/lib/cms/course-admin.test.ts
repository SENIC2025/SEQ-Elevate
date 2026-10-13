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
let outline: unknown = null;
let lessons: {
  stageKey: string;
  narrative?: unknown;
  structure?: unknown;
  structureDraft?: unknown;
  parts?: unknown;
  video?: unknown;
}[];

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
        outline,
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
          structureDraft: null,
          parts: null,
          narrative: null,
          ...l,
        })),
    },
  },
}));
const listCourses = vi.fn(async (): Promise<unknown[]> => []);
vi.mock("@/lib/cms", async () => {
  const { getDbCourse } = await import("./db-course");
  return {
    getCourse: getDbCourse,
    getBaseCourseCopy: async () => null,
    listCourses,
  };
});

const { getCourseGrid, getCourseOutline } = await import("./course-admin");

const EN = { title: "Asking for help", tagline: "Short and real", clusterLabel: "Communication" };
const written = (title: string, text: string) => ({ title, blocks: [para(text)] });

beforeEach(() => {
  outline = null;
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

/*
 * Release 1 (spec 9.1): a created course's lesson list comes from
 * Course.outline when one is stored — its order, hidden lessons, step names
 * and lessons of its own — with the bases and reasons the page needs to
 * change it. A course nobody has changed the list of shows exactly today's
 * rows.
 */
const SCENARIO = {
  kind: "scenario",
  setup: { en: "A teammate snaps at you." },
  question: { en: "What do you do?" },
  followupQuestion: {},
  choices: [
    { id: "c1", quality: "best", text: { en: "Talk privately" }, outcome: { en: "Good." } },
    { id: "c2", quality: "poor", text: { en: "Call them out" }, outcome: { en: "Bad." } },
  ],
};
const OWN = "s-abcdefgh";

describe("getCourseOutline with a stored lesson list", () => {
  it("shows today's rows, and no reasons, while nothing is stored", async () => {
    const o = await getCourseOutline("asking-for-help");
    expect(o?.sections).toMatchObject({ reasons: [], hasLabels: false, max: 15, warnAbove: 12 });
    expect(o?.sections?.resolved.materialised).toBe(false);
    expect(o?.sections?.freeKeys).toEqual(["simulation", "scenario", "assessment"]);
    expect(o?.lessons.map((l) => [l.key, l.section?.number ?? null])).toEqual([
      ["context", 1],
      ["concept", 2],
      ["behaviour", 3],
      ["simulation", null],
      ["scenario", null],
      ["reflection", 4],
      ["assessment", null],
    ]);
    expect(o?.readiness.some((r) => r.level === "blocker")).toBe(false);
  });

  it("lists the stored order, with a lesson of the course's own and a hidden one", async () => {
    lessons.push(
      { stageKey: OWN, narrative: { en: written("Warm-up text", "Before we start") } },
      { stageKey: "scenario", structure: SCENARIO }
    );
    outline = {
      v: 1,
      sections: [
        { id: OWN, template: "text", label: { en: "Warm-up" } },
        { id: "context", template: "context", hidden: true },
        { id: "concept", template: "concept" },
        { id: "behaviour", template: "behaviour" },
        { id: "scenario", template: "scenario" },
        { id: "reflection", template: "reflection" },
      ],
    };
    const o = await getCourseOutline("asking-for-help");
    expect(o?.lessons.map((l) => [l.key, l.present, l.addable, l.live])).toEqual([
      [OWN, true, false, false],
      ["context", true, false, true],
      ["concept", true, false, true],
      ["behaviour", true, false, true],
      // Not in the list: today's "Add guided practice", in its standard place.
      ["simulation", false, true, false],
      ["scenario", true, false, true],
      ["reflection", true, false, true],
      ["assessment", false, true, false],
    ]);
    const own = o?.lessons[0];
    expect(own?.mainKind).toBe("narrative");
    expect(own?.body).toBe("narrative");
    expect(own?.editable).toEqual({ body: true, media: true });
    expect(own?.section).toMatchObject({
      id: OWN,
      template: "text",
      custom: true,
      hidden: false,
      label: { en: "Warm-up" },
      number: 1,
    });
    expect(own?.section?.name.en).toEqual({ text: "Warm-up", source: "own" });
    // No German name: another language's, never the key.
    expect(own?.section?.name.de).toEqual({ text: "Warm-up", source: "other-language" });
    // Its text is read from the row: there's no learner stage for it.
    expect(own?.byLang.en.stage).toBeNull();
    expect(own?.byLang.en.narrative).toMatchObject({
      title: "Warm-up text",
      blocks: [para("Before we start")],
      hasOverride: true,
    });
    expect(own?.byLang.en.sectioned).toMatchObject({ key: OWN, label: "Warm-up" });
    // The hidden lesson keeps its standard name and gets no number.
    const context = o?.lessons[1];
    expect(context?.section).toMatchObject({ hidden: true, number: null });
    expect(context?.section?.name.de).toEqual({ text: "Kontext", source: "standard" });
    expect(o?.lessons.find((l) => l.key === "concept")?.section?.number).toBe(2);

    expect(o?.sections?.reasons).toEqual([
      { code: "custom-section", sectionId: OWN },
      { code: "hidden-section", sectionId: "context" },
    ]);
    expect(o?.sections?.hasLabels).toBe(true);
    expect(o?.sections?.freeKeys).toEqual(["simulation", "assessment"]);
    expect(o?.readiness.slice(0, 2)).toEqual([
      { level: "blocker", code: "needs-release-2", reason: { code: "custom-section", sectionId: OWN }, stage: OWN },
      { level: "blocker", code: "needs-release-2", reason: { code: "hidden-section", sectionId: "context" }, stage: "context" },
    ]);
    expect(o?.readiness).toContainEqual({ level: "info", code: "labels-later" });
  });

  it("gives every lesson the bases its changes need", async () => {
    lessons.push({
      stageKey: "concept",
      narrative: { en: written("Concept", "Text") },
      parts: {
        v: 1,
        items: [
          { id: "main", type: "main" },
          { id: "p-12345678", type: "text", blocks: { en: [para("More")] } },
        ],
      },
    });
    lessons.splice(1, 1); // the concept row above replaces the default one
    const o = await getCourseOutline("asking-for-help");
    const concept = o?.lessons.find((l) => l.key === "concept");
    expect(concept?.parts?.items.map((p) => [p.id, p.type])).toEqual([
      ["main", "main"],
      ["p-12345678", "text"],
    ]);
    expect(typeof concept?.parts?.order).toBe("string");
    expect(concept?.contentVersion).toEqual(expect.any(String));
    expect(concept?.section?.deleteSummary).toEqual({
      languages: ["en"],
      textBlocks: 2,
      questionBlocks: 0,
      video: false,
      documents: 0,
    });
    // Extra content: a reason, and the preview's view of the lesson.
    expect(o?.sections?.reasons).toEqual([{ code: "extra-parts", sectionId: "concept" }]);
    expect(concept?.byLang.en.sectioned?.parts.map((p) => p.id)).toEqual(["main", "p-12345678"]);
    // A lesson without extra content has no preview view of its own.
    expect(o?.lessons.find((l) => l.key === "context")?.byLang.en.sectioned).toBeNull();
  });

  it("still shows the lessons when the stored list can't be read, and blocks publishing", async () => {
    outline = { v: 7 };
    const o = await getCourseOutline("asking-for-help");
    expect(o?.lessons.filter((l) => l.present).map((l) => l.key)).toEqual([
      "context",
      "concept",
      "behaviour",
      "reflection",
    ]);
    expect(o?.sections?.reasons).toEqual([{ code: "unreadable" }]);
    expect(o?.readiness[0]).toMatchObject({ level: "blocker", code: "needs-release-2" });
  });
});

describe("getCourseGrid with a stored lesson list", () => {
  function gridCourse() {
    listCourses.mockResolvedValueOnce([
      {
        slug: "asking-for-help",
        title: "Asking for help",
        tagline: "Short and real",
        clusterLabel: "Communication",
        status: "draft",
        durationMinutes: 15,
      },
    ]);
    courseFindMany.mockResolvedValueOnce([
      { slug: "asking-for-help", meta, outline, updatedAt: at, _count: { enrollments: 0 } },
    ] as never);
  }

  it("names the lessons of a stored list in the grid's language, hidden ones left out", async () => {
    lessons.push({ stageKey: OWN });
    outline = {
      v: 1,
      sections: [
        { id: "context", template: "context", hidden: true },
        { id: OWN, template: "quiz", label: { en: "Check-in" } },
        { id: "concept", template: "concept", label: { de: "Die Idee" } },
      ],
    };
    gridCourse();
    const [card] = await getCourseGrid("de");
    expect(card.sections).toEqual([
      { id: OWN, name: "Check-in" },
      { id: "concept", name: "Die Idee" },
      { id: "behaviour", name: "Verhaltens-Modell" },
      { id: "reflection", name: "Reflexion" },
    ]);
  });

  it("leaves the names to the card while nothing is stored", async () => {
    gridCourse();
    const [card] = await getCourseGrid("en");
    expect(card.sections).toBeUndefined();
    expect(card.lessonKeys).toEqual(["context", "concept", "behaviour", "reflection"]);
  });
});
