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
// The viewer's roles, for whether they may switch a language on (D90).
const viewerRoles = vi.hoisted(() => ({ roles: ["CONTENT_EDITOR"] as string[] }));
vi.mock("@/lib/server-queries", () => ({ getViewerRoles: async () => viewerRoles.roles }));

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
  updatedAt?: Date;
  documents?: Record<string, unknown>[];
  /** Release 4 (D107): LessonLink rows, drafts included. */
  links?: Record<string, unknown>[];
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
          courseSlug: "asking-for-help",
          video: null,
          documents: [],
          links: [],
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
    // Greek is written, so no warning for it; only (Release 3, D90) that
    // its learners get English until it is switched on.
    expect(
      outline?.readiness.filter((r) => "locale" in r && r.locale === "el")
    ).toEqual([{ level: "info", code: "language-not-live", locale: "el" }]);
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
      // Learners get a lesson of the course's own with something in it (D64).
      [OWN, true, false, true],
      // Hidden: learners don't get it.
      ["context", true, false, false],
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
    // Release 2 (D66): none of it stops publishing, and names are no news.
    expect(o?.readiness.filter((r) => r.level === "blocker")).toEqual([]);
    expect(o?.readiness.map((r) => r.code)).not.toContain("labels-later");
    // Nobody is taking it: nothing to count, the cut-off not reached.
    expect(o?.sections).toMatchObject({ learners: 0, finished: 0, restructureClosed: false });
    expect(o?.sections?.closedFrom).toBe("2026-11-30T23:00:00.000Z");
    expect(o?.lessons.some((l) => "learnersWithData" in l)).toBe(false);
  });

  it("numbers only the lessons learners get, leaving out a lesson of its own with nothing in it", async () => {
    lessons.push({ stageKey: "s-empty000" });
    outline = {
      v: 1,
      sections: [
        { id: "context", template: "context" },
        { id: "s-empty000", template: "quiz" },
        { id: "concept", template: "concept" },
        { id: "behaviour", template: "behaviour" },
        { id: "reflection", template: "reflection" },
      ],
    };
    const o = await getCourseOutline("asking-for-help");
    expect(o?.lessons.filter((l) => l.section).map((l) => [l.key, l.live, l.section?.number])).toEqual([
      ["context", true, 1],
      ["s-empty000", false, null],
      ["concept", true, 2],
      ["behaviour", true, 3],
      ["reflection", true, 4],
    ]);
  });

  it("says why learners don't get a lesson: nothing in it yet, or the Release 2 player switched off (spec 3.4)", async () => {
    lessons.push({ stageKey: OWN, narrative: { en: written("Warm-up text", "Before we start") } }, { stageKey: "s-empty000" });
    outline = {
      v: 1,
      sections: [
        { id: OWN, template: "text", label: { en: "Warm-up" } },
        { id: "s-empty000", template: "quiz" },
        { id: "context", template: "context", hidden: true },
        { id: "concept", template: "concept" },
        { id: "behaviour", template: "behaviour" },
        { id: "reflection", template: "reflection" },
      ],
    };
    const why = (o: Awaited<ReturnType<typeof getCourseOutline>>) =>
      o?.lessons.filter((l) => l.section).map((l) => [l.key, l.live, l.notLive ?? null]);

    expect(why(await getCourseOutline("asking-for-help"))).toEqual([
      [OWN, true, null],
      // Its first content makes it appear.
      ["s-empty000", false, "empty"],
      // Hidden says it already.
      ["context", false, null],
      ["concept", true, null],
      ["behaviour", true, null],
      ["reflection", true, null],
    ]);

    vi.stubEnv("R2_LEARNER_PLAYER", "off");
    try {
      // Learners get Release 1's lessons only: no lesson of the course's
      // own, with content or without, and not because it is empty.
      expect(why(await getCourseOutline("asking-for-help"))).toEqual([
        [OWN, false, "switched-off"],
        ["s-empty000", false, "switched-off"],
        // Release 1 never hid a lesson: presentStageKeys.
        ["context", true, null],
        ["concept", true, null],
        ["behaviour", true, null],
        ["reflection", true, null],
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("names the one piece of content a lesson learners get has for them, for the removal's confirmation (finding 6)", async () => {
    const MAIN = { id: "main", type: "main" };
    const text = (id: string) => ({ id, type: "text", blocks: { en: [para("Only this")] } });
    lessons.push(
      { stageKey: OWN, parts: { v: 1, items: [MAIN, text("p-00000001")] } },
      { stageKey: "s-two00000", parts: { v: 1, items: [MAIN, text("p-00000002"), text("p-00000003")] } }
    );
    outline = {
      v: 1,
      sections: [
        { id: OWN, template: "text" },
        { id: "s-two00000", template: "text" },
        { id: "context", template: "context" },
        { id: "concept", template: "concept" },
        { id: "behaviour", template: "behaviour" },
        { id: "reflection", template: "reflection" },
      ],
    };
    const o = await getCourseOutline("asking-for-help");
    expect(o?.lessons.filter((l) => l.section).map((l) => [l.key, l.soleContent ?? null])).toEqual([
      [OWN, "p-00000001"],
      ["s-two00000", null],
      ["context", null],
      ["concept", null],
      ["behaviour", null],
      ["reflection", null],
    ]);
  });

  it("refuses to publish a course with no lesson learners would see", async () => {
    outline = {
      v: 1,
      sections: ["context", "concept", "behaviour", "reflection"].map((id) => ({ id, template: id, hidden: true })),
    };
    const o = await getCourseOutline("asking-for-help");
    expect(o?.readiness[0]).toEqual({ level: "blocker", code: "cannot-publish", blocker: { code: "no-lessons" } });
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
    expect(o?.readiness[0]).toEqual({ level: "blocker", code: "cannot-publish", blocker: { code: "unreadable" } });
  });

  it("puts Release 1's reasons back as blockers under a kill switch (spec 3.4)", async () => {
    vi.stubEnv("R2_PUBLISH_GUARD", "on");
    try {
      outline = {
        v: 1,
        sections: ["concept", "context", "behaviour", "reflection"].map((id) => ({ id, template: id })),
      };
      const o = await getCourseOutline("asking-for-help");
      expect(o?.readiness[0]).toEqual({ level: "blocker", code: "needs-release-2", reason: { code: "reordered" } });
    } finally {
      vi.unstubAllEnvs();
    }
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

  it("names the lessons learners get of a stored list in the grid's language", async () => {
    lessons.push(
      { stageKey: OWN, narrative: { en: written("Check-in text", "Hello") } },
      // A lesson of its own with nothing in it yet: learners don't get it (D64).
      { stageKey: "s-empty000" }
    );
    outline = {
      v: 1,
      sections: [
        { id: "context", template: "context", hidden: true },
        { id: OWN, template: "text", label: { en: "Check-in" } },
        { id: "s-empty000", template: "quiz" },
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
    expect(card.lessonKeys).toEqual([OWN, "concept", "behaviour", "reflection"]);
  });

  it("leaves the names to the card while nothing is stored", async () => {
    gridCourse();
    const [card] = await getCourseGrid("en");
    expect(card.sections).toBeUndefined();
    expect(card.lessonKeys).toEqual(["context", "concept", "behaviour", "reflection"]);
  });
});

/*
 * Release 3 (D90, spec 9.4): the course page and grid say which languages
 * learners get the course in, and whether the viewer may switch one.
 */
describe("which languages are live for learners", () => {
  it("reads a created course's signed-off languages, and the viewer's right to switch them", async () => {
    viewerRoles.roles = ["PARTNER_ADMIN"];
    const outline = await getCourseOutline("asking-for-help");
    expect(outline?.ready).toEqual({ en: true, de: false, el: false });
    expect(outline?.canSignOffLanguage).toBe(true);
    viewerRoles.roles = ["CONTENT_EDITOR"];
    expect((await getCourseOutline("asking-for-help"))?.canSignOffLanguage).toBe(false);
    const original = courseFindFirst.getMockImplementation()!;
    const row = await original();
    courseFindFirst.mockImplementation(async () => ({ ...row, readyLocales: ["de", "el"] }));
    const live = await getCourseOutline("asking-for-help");
    courseFindFirst.mockImplementation(original);
    expect(live?.ready).toEqual({ en: true, de: true, el: true });
    // German is live but its text was cleared: said, never switched off.
    // Greek is live and complete: nothing to say.
    expect(live?.readiness).toContainEqual({ level: "warning", code: "language-live-incomplete", locale: "de" });
    expect(live?.readiness.filter((r) => r.locale === "el")).toEqual([]);
  });
});

/*
 * Release 4, R2 (spec 4.6, 4.7, D107, D108): the course page's data holds
 * each lesson's further-reading links, drafts included, each stored
 * address checked again as it is read (one the check refuses is marked
 * unusable, to be shown as text); the documents' languages; links in what
 * Delete would remove and in the content base deleteSection checks; a key
 * with links isn't free for "Add lesson"; the lesson's preview in each
 * language shows the published links for that language; and "last edited"
 * takes a link's last change.
 */
describe("further reading and languages on the course page (Release 4)", () => {
  const link = (id: string, fields: Record<string, unknown> = {}) => ({
    id,
    title: `Reading ${id}`,
    url: `https://example.org/${id}`,
    description: "",
    languages: [],
    order: 0,
    published: true,
    createdAt: at,
    updatedAt: at,
    ...fields,
  });
  const doc = (id: string, languages: string[]) => ({
    id,
    name: `${id}.pdf`,
    url: `https://store.public.blob.vercel-storage.com/${id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 10,
    order: 0,
    published: true,
    createdAt: at,
    languages,
  });
  const ownCourse = () => {
    outline = {
      v: 1,
      sections: [
        { id: OWN, template: "text", label: { en: "Warm-up" } },
        { id: "context", template: "context" },
        { id: "concept", template: "concept" },
        { id: "behaviour", template: "behaviour" },
        { id: "reflection", template: "reflection" },
      ],
    };
  };

  it("gives each lesson its links, drafts included, an address the check refuses marked unusable", async () => {
    ownCourse();
    lessons.push({
      stageKey: OWN,
      narrative: { en: written("Warm-up text", "Before we start") },
      links: [
        link("k1", { languages: ["de"] }),
        link("k2", { published: false, url: "mailto:help@example.org" }),
        link("k3", { url: "javascript:alert(1)" }),
      ],
    });
    const o = await getCourseOutline("asking-for-help");
    const own = o?.lessons.find((l) => l.key === OWN);
    expect(own?.links).toEqual([
      { id: "k1", title: "Reading k1", url: "https://example.org/k1", kind: "web", description: "", languages: ["de"], published: true },
      { id: "k2", title: "Reading k2", url: "mailto:help@example.org", kind: "email", description: "", languages: [], published: false },
      { id: "k3", title: "Reading k3", url: "javascript:alert(1)", kind: null, unusable: true, description: "", languages: [], published: true },
    ]);
    // Every lesson has its list, empty or not.
    expect(o?.lessons.find((l) => l.key === "context")?.links).toEqual([]);
  });

  it("counts the links in what Delete removes and in the content base, and keeps a key with links from being free", async () => {
    lessons.push(
      { stageKey: "simulation", links: [link("k9")] },
    );
    lessons[1] = { ...lessons[1], links: [link("k1"), link("k2", { published: false })] };
    const o = await getCourseOutline("asking-for-help");
    const concept = o?.lessons.find((l) => l.key === "concept");
    expect(concept?.section?.deleteSummary).toMatchObject({ links: 2 });
    const { sectionContentVersion } = await import("./sections/versions");
    expect(concept?.contentVersion).toBe(
      sectionContentVersion({
        narrative: lessons[1].narrative,
        structure: null,
        structureDraft: null,
        parts: null,
        video: null,
        documentIds: [],
        linkIds: ["k1", "k2"],
      })
    );
    // "Add guided practice" would bring its old links back: it isn't free.
    expect(o?.sections?.freeKeys).toEqual(["scenario", "assessment"]);
    // A lesson without links keeps the summary and base it had.
    expect(o?.lessons.find((l) => l.key === "context")?.section?.deleteSummary).not.toHaveProperty("links");
  });

  it("shows, in the lesson's preview in each language, the published links for that language, and documents with their languages", async () => {
    ownCourse();
    lessons.push({
      stageKey: OWN,
      narrative: { en: written("Warm-up text", "Before we start") },
      documents: [doc("d-de", ["de"]), doc("d-all", [])],
      links: [
        link("all"),
        link("en", { languages: ["en"] }),
        link("de", { languages: ["de"] }),
        link("draft", { published: false }),
        link("bad", { url: "javascript:alert(1)" }),
      ],
    });
    const o = await getCourseOutline("asking-for-help");
    const own = o?.lessons.find((l) => l.key === OWN);
    expect(own?.documents.map((d) => [d.id, d.languages])).toEqual([
      ["d-de", ["de"]],
      ["d-all", []],
    ]);
    expect(own?.byLang.en.sectioned?.links?.map((l) => l.id)).toEqual(["all", "en"]);
    expect(own?.byLang.de.sectioned?.links?.map((l) => l.id)).toEqual(["all", "de"]);
    expect(own?.byLang.el.sectioned?.links?.map((l) => l.id)).toEqual(["all"]);
    // Documents follow the previewed language too.
    expect(own?.byLang.en.sectioned?.documents?.map((d) => d.id)).toEqual(["d-all"]);
    expect(own?.byLang.de.sectioned?.documents?.map((d) => d.id)).toEqual(["d-de", "d-all"]);
  });

  it("takes a link's last change as the course's last edit, on the page and on the grid", async () => {
    const later = new Date("2026-10-20T08:00:00.000Z");
    lessons[0] = { ...lessons[0], links: [link("k1", { updatedAt: later })] };
    expect((await getCourseOutline("asking-for-help"))?.lastEdited).toBe(later.toISOString());
    listCourses.mockResolvedValueOnce([
      { slug: "asking-for-help", title: "Asking for help", tagline: "t", clusterLabel: "c", status: "draft", durationMinutes: 15 },
    ]);
    courseFindMany.mockResolvedValueOnce([{ slug: "asking-for-help", meta, outline, updatedAt: at, _count: { enrollments: 0 } }] as never);
    const [card] = await getCourseGrid("en");
    expect(card.lastEdited).toBe(later.toISOString());
  });

  // Release 4, R2 on r4r (D109, spec 9.3): the references list is a row of
  // its own; its last save is an edit of the course.
  it("takes the references list's last save as the course's last edit, on the page and on the grid", async () => {
    const later = new Date("2026-10-21T08:00:00.000Z");
    const original = courseFindFirst.getMockImplementation()!;
    courseFindFirst.mockImplementation(async (...args: unknown[]) => ({
      ...(await original(...(args as []))),
      bibliography: { updatedAt: later },
    }));
    try {
      expect((await getCourseOutline("asking-for-help"))?.lastEdited).toBe(later.toISOString());
      const asked = (courseFindFirst.mock.calls.at(-1) as unknown as [{ select: Record<string, unknown> }])[0].select;
      expect(asked.bibliography).toEqual({ select: { updatedAt: true } });
    } finally {
      courseFindFirst.mockImplementation(original);
    }
    listCourses.mockResolvedValueOnce([
      { slug: "asking-for-help", title: "Asking for help", tagline: "t", clusterLabel: "c", status: "draft", durationMinutes: 15 },
    ]);
    courseFindMany.mockClear();
    courseFindMany.mockResolvedValueOnce([
      { slug: "asking-for-help", meta, outline, updatedAt: at, bibliography: { updatedAt: later }, _count: { enrollments: 0 } },
    ] as never);
    const [card] = await getCourseGrid("en");
    expect(card.lastEdited).toBe(later.toISOString());
    const grid = (courseFindMany.mock.calls[0] as unknown as [{ select: Record<string, unknown> }])[0].select;
    expect(grid.bibliography).toEqual({ select: { updatedAt: true } });
  });

  it("keeps the course's last edit where it was without a references list", async () => {
    expect((await getCourseOutline("asking-for-help"))?.lastEdited).toBe(at.toISOString());
  });
});
