import { describe, it, expect } from "vitest";
import {
  presentStageKeys,
  structureHasLocale,
  lessonCoveredIn,
  languageCoverage,
  lastEdited,
  publishBlockerIssues,
  publishReadiness,
  englishGaps,
  release1BlockerIssues,
  offersAdd,
  type LessonFacts,
} from "./course-derive";
import type { StoredStructure } from "./structure";
import type {
  CourseCopyState,
  CourseOutline,
  LessonOutline,
  NarrativeInitial,
} from "./course-admin-types";
import type { Locale, StageKey } from "./types";
import {
  mainKindOf,
  type NewOnlyReason,
  type PartView,
  type SectionsMeta,
} from "./sections/contract";
import { resolveOutline } from "./sections/outline";

const sim = (text: Partial<Record<Locale, string>>): StoredStructure => ({
  kind: "simulation",
  prompt: text,
  instruction: {},
  options: [
    { id: "a", isBest: true, text, feedback: {} },
    { id: "b", isBest: false, text, feedback: {} },
  ],
});

const narrative = (...locales: Locale[]) =>
  Object.fromEntries(
    locales.map((l) => [l, { title: `T-${l}`, blocks: [{ kind: "paragraph", text: l }] }])
  );

describe("presentStageKeys", () => {
  it("gives a built-in course all seven lessons", () => {
    expect(presentStageKeys("bundled", [])).toEqual([
      "context",
      "concept",
      "behaviour",
      "simulation",
      "scenario",
      "reflection",
      "assessment",
    ]);
  });

  it("gives a CMS course its four narrative lessons plus written interactive ones", () => {
    expect(presentStageKeys("cms", [])).toEqual([
      "context",
      "concept",
      "behaviour",
      "reflection",
    ]);
    expect(
      presentStageKeys("cms", [
        { stageKey: "assessment", structure: { kind: "assessment" } },
        { stageKey: "simulation", structure: null },
      ])
    ).toEqual(["context", "concept", "behaviour", "reflection", "assessment"]);
  });
});

describe("structureHasLocale", () => {
  it("is true when every written text also exists in the language", () => {
    expect(structureHasLocale(sim({ en: "Hi", de: "Hallo" }), "de")).toBe(true);
  });

  it("is false when a written text is missing in the language", () => {
    expect(structureHasLocale(sim({ en: "Hi" }), "de")).toBe(false);
    expect(structureHasLocale(sim({ en: "Hi", de: "  " }), "de")).toBe(false);
  });

  it("ignores texts that are blank in every language", () => {
    // `instruction` and the feedback are {} above — not a translation gap.
    expect(structureHasLocale(sim({ en: "Hi", el: "Γεια" }), "el")).toBe(true);
  });

  it("walks scenario follow-ups", () => {
    const s: StoredStructure = {
      kind: "scenario",
      setup: { en: "S", de: "S" },
      question: { en: "Q", de: "Q" },
      followupQuestion: {},
      choices: [
        {
          id: "a",
          quality: "best",
          text: { en: "A", de: "A" },
          outcome: { en: "O", de: "O" },
          followups: [
            { id: "a1", quality: "okay", text: { en: "F" }, outcome: {} },
          ],
        },
      ],
    };
    expect(structureHasLocale(s, "de")).toBe(false);
    expect(structureHasLocale(s, "en")).toBe(true);
  });

  it("walks assessment questions and options", () => {
    const s: StoredStructure = {
      kind: "assessment",
      intro: {},
      questions: [
        {
          id: "q",
          correctOptionId: "x",
          question: { en: "Q", el: "Ε" },
          options: [{ id: "x", text: { en: "X" } }],
        },
      ],
    };
    expect(structureHasLocale(s, "el")).toBe(false);
  });
});

describe("lessonCoveredIn", () => {
  it("counts every lesson of a built-in course as covered", () => {
    expect(lessonCoveredIn("bundled", "concept", undefined, "el")).toBe(true);
  });

  it("covers a CMS narrative lesson only in the languages written", () => {
    const lesson = { stageKey: "context", narrative: narrative("en") };
    expect(lessonCoveredIn("cms", "context", lesson, "en")).toBe(true);
    expect(lessonCoveredIn("cms", "context", lesson, "de")).toBe(false);
    expect(lessonCoveredIn("cms", "context", undefined, "en")).toBe(false);
  });

  it("covers an unwritten CMS reflection everywhere (localised defaults)", () => {
    expect(lessonCoveredIn("cms", "reflection", undefined, "de")).toBe(true);
    const written = { stageKey: "reflection", narrative: narrative("en") };
    expect(lessonCoveredIn("cms", "reflection", written, "en")).toBe(true);
    expect(lessonCoveredIn("cms", "reflection", written, "de")).toBe(false);
  });

  it("doesn't cover a language whose text was cleared down to blanks", () => {
    const lesson = {
      stageKey: "context",
      narrative: {
        ...narrative("en"),
        de: { title: " ", blocks: [{ kind: "paragraph", text: "" }] },
      },
    };
    expect(lessonCoveredIn("cms", "context", lesson, "de")).toBe(false);
    // A reflection cleared everywhere is back on the localised defaults.
    const cleared = { stageKey: "reflection", narrative: { en: { title: "" } } };
    expect(lessonCoveredIn("cms", "reflection", cleared, "de")).toBe(true);
  });

  it("covers a CMS interactive lesson via its structure", () => {
    const lesson = { stageKey: "simulation", structure: sim({ en: "Hi" }) };
    expect(lessonCoveredIn("cms", "simulation", lesson, "en")).toBe(true);
    expect(lessonCoveredIn("cms", "simulation", lesson, "de")).toBe(false);
  });
});

describe("languageCoverage", () => {
  const keys: StageKey[] = ["context", "concept", "behaviour", "reflection"];

  it("is complete in every language for a built-in course", () => {
    const c = languageCoverage("bundled", null, [], presentStageKeys("bundled", []));
    for (const l of ["en", "de", "el"] as const) {
      expect(c[l]).toEqual({ state: "complete", covered: 7, total: 7 });
    }
  });

  it("marks a brand-new CMS course partial in its language, missing in the others", () => {
    const c = languageCoverage("cms", { en: { title: "X" } }, [], keys);
    // Only the reflection (platform defaults) is covered anywhere yet.
    expect(c.en).toEqual({ state: "partial", covered: 1, total: 4 });
    expect(c.de).toEqual({ state: "missing", covered: 1, total: 4 });
  });

  it("is complete once the copy and every lesson exist in the language", () => {
    const lessons: LessonFacts[] = [
      { stageKey: "context", narrative: narrative("en", "de") },
      { stageKey: "concept", narrative: narrative("en", "de") },
      { stageKey: "behaviour", narrative: narrative("en") },
    ];
    const meta = { en: { title: "X" }, de: { title: "Y" } };
    const c = languageCoverage("cms", meta, lessons, keys);
    expect(c.en.state).toBe("complete");
    expect(c.de).toEqual({ state: "partial", covered: 3, total: 4 });
    // Lessons written in Greek without Greek copy still count as started.
    const c2 = languageCoverage(
      "cms",
      { en: { title: "X" } },
      [{ stageKey: "context", narrative: narrative("el") }],
      keys
    );
    expect(c2.el.state).toBe("partial");
  });

  it("doesn't count a title and subtitle cleared down to blanks as copy", () => {
    const meta = { en: { title: "X" }, de: { title: "", tagline: "  " } };
    const c = languageCoverage("cms", meta, [], keys);
    expect(c.de.state).toBe("missing");
  });
});

describe("lastEdited", () => {
  it("is null with no course row and no lessons", () => {
    expect(lastEdited(null, [])).toBeNull();
  });

  it("uses documents when that is all there is", () => {
    expect(
      lastEdited(null, [
        {
          stageKey: "context",
          documents: [{ createdAt: "2026-09-01T10:00:00.000Z" }],
        },
      ])
    ).toBe("2026-09-01T10:00:00.000Z");
  });

  it("takes the latest of course, lessons and documents", () => {
    expect(
      lastEdited(new Date("2026-09-01T00:00:00Z"), [
        { stageKey: "context", updatedAt: new Date("2026-09-03T00:00:00Z") },
        {
          stageKey: "concept",
          updatedAt: "2026-09-02T00:00:00Z",
          documents: [{ createdAt: "2026-09-05T00:00:00Z" }],
        },
      ])
    ).toBe("2026-09-05T00:00:00.000Z");
  });

  // Release 4, R2 (spec 4.7): a further-reading link added, changed,
  // shown or hidden is an edit of the course (links have an updatedAt).
  it("takes a further-reading link's last change too", () => {
    expect(
      lastEdited(new Date("2026-09-01T00:00:00Z"), [
        {
          stageKey: "context",
          updatedAt: new Date("2026-09-03T00:00:00Z"),
          documents: [{ createdAt: "2026-09-04T00:00:00Z" }],
          links: [{ updatedAt: "2026-09-02T00:00:00Z" }, { updatedAt: new Date("2026-09-06T00:00:00Z") }],
        },
      ])
    ).toBe("2026-09-06T00:00:00.000Z");
  });

  // Release 4, R2 on r4r (D109, spec 9.3): a save of the course's references
  // list is an edit of the course (the list is a row of its own, with an
  // updatedAt, so the Course row's doesn't move).
  it("takes the references list's last save too, when it is the latest", () => {
    const lessons = [{ stageKey: "context", updatedAt: new Date("2026-09-03T00:00:00Z") }];
    expect(lastEdited(new Date("2026-09-01T00:00:00Z"), lessons, { updatedAt: "2026-09-07T00:00:00Z" })).toBe(
      "2026-09-07T00:00:00.000Z"
    );
    expect(lastEdited(null, [], { updatedAt: new Date("2026-09-08T00:00:00Z") })).toBe("2026-09-08T00:00:00.000Z");
    // An older save, no list, or a course without its row change nothing.
    expect(lastEdited(new Date("2026-09-01T00:00:00Z"), lessons, { updatedAt: "2026-08-01T00:00:00Z" })).toBe(
      "2026-09-03T00:00:00.000Z"
    );
    expect(lastEdited(new Date("2026-09-01T00:00:00Z"), lessons, null)).toBe("2026-09-03T00:00:00.000Z");
    expect(lastEdited(null, [], undefined)).toBeNull();
  });
});

/* ------------------------------ publishReadiness ------------------------------ */

const copyState = (source: CourseCopyState["source"]): CourseCopyState => ({
  title: "T",
  tagline: "",
  clusterLabel: "Skill",
  source,
});

function lesson(
  key: StageKey,
  written: Partial<Record<Locale, number>>,
  over: Partial<LessonOutline> = {}
): LessonOutline {
  const byLang = {} as LessonOutline["byLang"];
  for (const l of ["en", "de", "el"] as const) {
    const n: NarrativeInitial = {
      title: key,
      subtitle: "",
      blocks: Array.from({ length: written[l] ?? written.en ?? 0 }, () => ({
        kind: "paragraph" as const,
        text: "x",
      })),
      hasOverride: written[l] !== undefined,
      version: written[l] !== undefined ? `v-${l}` : null,
    };
    byLang[l] = { stage: null, narrative: n, sectioned: null };
  }
  return {
    key,
    present: true,
    addable: false,
    body: key === "reflection" ? "reflection" : "narrative",
    mainKind: mainKindOf({ id: key, template: key }),
    editable: { body: true, media: true },
    byLang,
    structure: null,
    draft: null,
    video: null,
    builtInVideo: false,
    documents: [],
    updatedAt: null,
    section: null,
    parts: null,
    contentVersion: null,
    live: true,
    ...over,
  };
}

function outline(
  lessons: LessonOutline[],
  copy: Partial<Record<Locale, CourseCopyState["source"]>> = {}
): Pick<CourseOutline, "kind" | "copy" | "lessons"> {
  return {
    kind: "cms",
    copy: {
      en: copyState(copy.en ?? "authored"),
      de: copyState(copy.de ?? "authored"),
      el: copyState(copy.el ?? "authored"),
    },
    lessons,
  };
}

describe("publishReadiness", () => {
  it("has nothing to say about a built-in course", () => {
    expect(publishReadiness({ ...outline([]), kind: "bundled" })).toEqual([]);
  });

  it("reports missing copy per language", () => {
    const issues = publishReadiness(
      outline([lesson("assessment", {}, { body: "interactive", structure: sim({ en: "a", de: "a", el: "a" }) })], {
        de: "fallback",
      })
    );
    expect(issues).toEqual([
      { level: "warning", code: "copy-missing", locale: "de" },
    ]);
  });

  it("reports empty lessons once, not again as untranslated", () => {
    const issues = publishReadiness(
      outline([lesson("context", {}), lesson("concept", { en: 2 })])
    );
    expect(issues).toContainEqual({
      level: "warning",
      code: "lesson-empty",
      stage: "context",
    });
    expect(issues).toContainEqual({
      level: "warning",
      code: "lesson-untranslated",
      locale: "de",
      count: 1,
    });
    expect(
      issues.filter((i) => i.code === "lesson-untranslated" && i.locale === "en")
    ).toEqual([]);
  });

  it("does not call an unwritten reflection untranslated", () => {
    const issues = publishReadiness(outline([lesson("reflection", {})]));
    expect(issues.some((i) => i.code === "lesson-untranslated")).toBe(false);
    expect(issues.some((i) => i.code === "lesson-empty")).toBe(false);
  });

  it("names each lesson with a draft learners don't see yet", () => {
    const all = sim({ en: "a", de: "a", el: "a" });
    const issues = publishReadiness(
      outline([
        // Saved for learners, with a newer draft beside it…
        lesson("simulation", {}, { body: "interactive", structure: all, draft: sim({ en: "b" }) }),
        // …and one that so far exists only as a draft.
        lesson("assessment", {}, {
          body: "interactive",
          present: false,
          addable: true,
          draft: sim({ en: "c" }),
        }),
      ])
    );
    expect(issues).toEqual([
      { level: "warning", code: "lesson-draft", stage: "simulation" },
      { level: "warning", code: "lesson-draft", stage: "assessment" },
    ]);
  });

  it("counts interactive lessons missing a language", () => {
    const issues = publishReadiness(
      outline([
        lesson("simulation", {}, { body: "interactive", structure: sim({ en: "Hi" }) }),
      ])
    );
    expect(issues).toContainEqual({
      level: "warning",
      code: "lesson-untranslated",
      locale: "el",
      count: 1,
    });
    expect(issues.some((i) => i.code === "no-interactive")).toBe(false);
  });

  it("notes (as info) a course with no practice activity", () => {
    const issues = publishReadiness(outline([lesson("concept", { en: 1, de: 1, el: 1 })]));
    expect(issues).toEqual([{ level: "info", code: "no-interactive" }]);
  });

  it("ignores 'Add …' slots that learners don't see", () => {
    const issues = publishReadiness(
      outline([
        lesson("concept", { en: 1, de: 1, el: 1 }),
        lesson("scenario", {}, { present: false, addable: true, body: "interactive" }),
      ])
    );
    expect(issues).toEqual([{ level: "info", code: "no-interactive" }]);
  });

  it("doesn't count a listed practice lesson with no exercise saved for learners", () => {
    // A stored lesson list can hold the practice lesson before anything is
    // saved in it (the full template, or "Add lesson" reusing the key).
    const issues = publishReadiness(
      outline([
        lesson("concept", { en: 1, de: 1, el: 1 }),
        lesson("simulation", {}, { body: "interactive", live: false }),
      ])
    );
    expect(issues).toEqual([{ level: "info", code: "no-interactive" }]);
  });
});

describe("offersAdd", () => {
  const scenario = sim({ en: "a" });

  it("offers to add a practice lesson that isn't written yet", () => {
    expect(offersAdd(lesson("scenario", {}, { present: false, addable: true }))).toBe(true);
  });

  it("offers to edit, not add, a lesson that so far exists only as a draft", () => {
    expect(
      offersAdd(lesson("scenario", {}, { present: false, addable: true, draft: scenario }))
    ).toBe(false);
  });

  it("never offers to add a lesson learners already have", () => {
    expect(offersAdd(lesson("scenario", {}, { structure: scenario }))).toBe(false);
  });
});

/* ---------------------- Release 1: lesson list and content ---------------------- */

const meta = (over: Partial<SectionsMeta> = {}): SectionsMeta => {
  const resolved = resolveOutline("cms", null, []);
  return {
    version: "v",
    resolved,
    reasons: [],
    freeKeys: ["simulation", "scenario", "assessment"],
    hasLabels: false,
    max: 15,
    warnAbove: 12,
    ...over,
  };
};

const question = (id: `p-${string}`, draft: boolean): PartView => ({
  id,
  type: "quiz",
  data: null,
  draft: draft ? { kind: "assessment", intro: {}, questions: [] } : null,
  versions: { data: null, draft: draft ? "d" : null },
  itemVersion: "i",
  issues: [],
});

describe("publishReadiness with the lesson list", () => {
  const base = () => outline([lesson("concept", { en: 1, de: 1, el: 1 })]);

  it("says nothing new about a standard course", () => {
    expect(publishReadiness({ ...base(), sections: meta() })).toEqual(publishReadiness(base()));
    expect(publishReadiness({ ...base(), sections: null })).toEqual(publishReadiness(base()));
  });

  it("no longer blocks a course whose list differs from the standard one (D66)", () => {
    const reasons: NewOnlyReason[] = [
      { code: "custom-section", sectionId: "s-abcdefgh" },
      { code: "reordered" },
    ];
    const issues = publishReadiness({ ...base(), sections: meta({ reasons }) });
    expect(issues.filter((i) => i.level === "blocker")).toEqual([]);
    expect(issues).toEqual(publishReadiness(base()));
  });

  it("puts the blockers it is given first, naming the lesson", () => {
    const blockers = publishBlockerIssues([{ code: "unreadable", sectionId: "concept" }, { code: "no-lessons" }]);
    expect(blockers).toEqual([
      { level: "blocker", code: "cannot-publish", blocker: { code: "unreadable", sectionId: "concept" }, stage: "concept" },
      { level: "blocker", code: "cannot-publish", blocker: { code: "no-lessons" } },
    ]);
    const issues = publishReadiness({ ...base(), sections: meta() }, blockers);
    expect(issues.slice(0, 2)).toEqual(blockers);
    expect(issues.slice(2)).toEqual(publishReadiness(base()));
  });

  it("under a kill switch, says Release 1's reasons as blockers (spec 3.4)", () => {
    const reasons: NewOnlyReason[] = [{ code: "custom-section", sectionId: "s-abcdefgh" }, { code: "reordered" }];
    expect(release1BlockerIssues(reasons)).toEqual([
      { level: "blocker", code: "needs-release-2", reason: reasons[0], stage: "s-abcdefgh" },
      { level: "blocker", code: "needs-release-2", reason: reasons[1] },
    ]);
  });

  it("names each piece of extra content with a draft learners don't see", () => {
    const issues = publishReadiness({
      ...outline([
        lesson("concept", { en: 1, de: 1, el: 1 }, {
          parts: {
            order: "o",
            items: [{ id: "main", type: "main" }, question("p-aaaaaaaa", true), question("p-bbbbbbbb", false)],
          },
        }),
      ]),
      sections: meta(),
    });
    expect(issues).toContainEqual({ level: "warning", code: "part-draft", stage: "concept", part: "p-aaaaaaaa" });
    expect(issues.filter((i) => i.code === "part-draft")).toHaveLength(1);
  });

  it("says nothing about step names: learners get them (D58)", () => {
    expect(publishReadiness({ ...base(), sections: meta({ hasLabels: true }) })).toEqual(publishReadiness(base()));
  });

  it("warns above 12 visible lessons", () => {
    const sections = (n: number, hidden = 0) =>
      Array.from({ length: n }, (_, i) => ({
        id: `s-${String(i).padStart(8, "0")}` as const,
        template: "text" as const,
        custom: true,
        ...(i < hidden ? { hidden: true as const } : {}),
      }));
    const many = (n: number, hidden = 0) =>
      publishReadiness({
        ...base(),
        sections: meta({ resolved: { sections: sections(n, hidden), removed: [], materialised: true } }),
      }).filter((i) => i.code === "sections-many");
    expect(many(12)).toEqual([]);
    expect(many(13)).toEqual([{ level: "warning", code: "sections-many", count: 13 }]);
    expect(many(14, 2)).toEqual([]);
  });
});

describe("coverage of a lesson of the course's own", () => {
  it("reads its main content by its kind", () => {
    const quiz = { stageKey: "s-abcdefgh", mainKind: "assessment" as const, structure: sim({ en: "Hi" }) };
    expect(lessonCoveredIn("cms", "s-abcdefgh", quiz, "en")).toBe(true);
    expect(lessonCoveredIn("cms", "s-abcdefgh", quiz, "de")).toBe(false);
    const text = { stageKey: "s-abcdefgh", mainKind: "narrative" as const, narrative: narrative("de") };
    expect(lessonCoveredIn("cms", "s-abcdefgh", text, "de")).toBe(true);
    expect(lessonCoveredIn("cms", "s-abcdefgh", text, "en")).toBe(false);
    // Unwritten text is missing, not the reflection's localised defaults.
    expect(lessonCoveredIn("cms", "s-abcdefgh", { stageKey: "s-abcdefgh", mainKind: "narrative" }, "en")).toBe(false);
  });

  it("counts it with the standard lessons", () => {
    const lessons: LessonFacts[] = [
      { stageKey: "context", narrative: narrative("en") },
      { stageKey: "s-abcdefgh", mainKind: "simulation", structure: sim({ en: "a", de: "b" }) },
    ];
    expect(languageCoverage("cms", { en: { title: "X" } }, lessons, ["context", "s-abcdefgh"]).de).toEqual({
      state: "partial",
      covered: 1,
      total: 2,
    });
  });

  it("keeps today's rule for a standard lesson, whatever kind it is given", () => {
    for (const key of ["context", "reflection", "scenario"] as const) {
      for (const locale of ["en", "de"] as const) {
        const row = { stageKey: key, narrative: narrative("en"), structure: sim({ en: "a" }) };
        expect(lessonCoveredIn("cms", key, { ...row, mainKind: mainKindOf({ id: key, template: key }) }, locale)).toBe(
          lessonCoveredIn("cms", key, row, locale)
        );
      }
    }
  });
});

/*
 * Release 3 (D90, spec 9.4): English is a created course's source
 * language. A course whose English is incomplete is not published the
 * first time (a blocker; guardPublish refuses it too); once published, the
 * same gap is a warning and nothing is unpublished. A language that is
 * live for learners but no longer complete is a warning; one that is
 * written in part but not switched on is info. Release 2 only warned.
 */
describe("publishReadiness: English first, and which languages are live", () => {
  const sim3 = sim({ en: "a", de: "a", el: "a" });
  const ready = (de: boolean, el: boolean) => ({ en: true, de, el });
  const cov = (state: "complete" | "partial" | "missing") => ({ state, covered: 1, total: 1 });
  const languages = { en: cov("complete"), de: cov("complete"), el: cov("complete") };

  it("blocks a course never published while its English title or a lesson's English is missing", () => {
    const noCopy = publishReadiness({ ...outline([lesson("concept", { en: 1, de: 1, el: 1 })], { en: "fallback" }), publishedAt: null });
    expect(noCopy[0]).toEqual({ level: "blocker", code: "english-incomplete" });
    expect(noCopy).toContainEqual({ level: "warning", code: "copy-missing", locale: "en" });

    // A lesson written first in German, never in English.
    const germanFirst = publishReadiness({ ...outline([lesson("concept", { de: 1 })]), publishedAt: null });
    expect(germanFirst[0]).toEqual({ level: "blocker", code: "english-incomplete" });
    // So is an exercise missing its English.
    const exercise = publishReadiness({
      ...outline([lesson("simulation", {}, { body: "interactive", structure: sim({ de: "a" }) })]),
      publishedAt: null,
    });
    expect(exercise[0]).toEqual({ level: "blocker", code: "english-incomplete" });
  });

  it("keeps blockers first: the server's own come before it", () => {
    const blockers = [{ level: "blocker" as const, code: "cannot-publish" as const, blocker: { code: "no-lessons" as const } }];
    const issues = publishReadiness({ ...outline([lesson("concept", { de: 1 })]), publishedAt: null }, blockers);
    expect(issues.slice(0, 2)).toEqual([...blockers, { level: "blocker", code: "english-incomplete" }]);
  });

  it("warns, never blocks, once the course was published", () => {
    const issues = publishReadiness({
      ...outline([lesson("concept", { de: 1 })]),
      publishedAt: "2026-11-01T09:00:00.000Z",
    });
    expect(issues).toContainEqual({ level: "warning", code: "english-incomplete" });
    expect(issues.some((i) => i.level === "blocker")).toBe(false);
  });

  it("says nothing when English is complete, other languages' gaps aside", () => {
    const issues = publishReadiness({ ...outline([lesson("concept", { en: 1 })], { de: "fallback" }), publishedAt: null });
    expect(issues.some((i) => i.code === "english-incomplete")).toBe(false);
    // An empty lesson is lesson-empty, not English missing.
    const empty = publishReadiness({ ...outline([lesson("context", {}), lesson("concept", { en: 1 })]), publishedAt: null });
    expect(empty.some((i) => i.code === "english-incomplete")).toBe(false);
  });

  it("warns about a live language that isn't complete any more, and notes a written one not yet live", () => {
    const issues = publishReadiness({
      ...outline([lesson("assessment", {}, { body: "interactive", structure: sim3 })]),
      publishedAt: null,
      ready: ready(true, false),
      languages: { ...languages, de: cov("partial"), el: cov("partial") },
    });
    expect(issues).toContainEqual({ level: "warning", code: "language-live-incomplete", locale: "de" });
    expect(issues).toContainEqual({ level: "info", code: "language-not-live", locale: "el" });
    // Complete and live, or not written at all: nothing to say.
    const quiet = publishReadiness({
      ...outline([lesson("assessment", {}, { body: "interactive", structure: sim3 })]),
      ready: ready(true, false),
      languages: { ...languages, el: cov("missing") },
    });
    expect(quiet.filter((i) => i.code.startsWith("language-"))).toEqual([]);
  });
});

describe("englishGaps: the same rule, from the stored rows (guardPublish)", () => {
  const META = { en: { title: "T", tagline: "t" } };
  const text = (blocks: number) => ({ title: "T", blocks: Array.from({ length: blocks }, () => ({ kind: "paragraph", text: "x" })) });

  it("finds the English title and every listed lesson written in another language only", () => {
    expect(englishGaps(META, [])).toEqual({ copy: false, lessons: 0 });
    expect(englishGaps({ de: { title: "T" } }, [])).toEqual({ copy: true, lessons: 0 });
    expect(englishGaps({ en: { title: " ", tagline: "" } }, [])).toEqual({ copy: true, lessons: 0 });
    expect(
      englishGaps(META, [
        { mainKind: "narrative", narrative: { de: text(1) } },
        { mainKind: "reflection", narrative: { el: text(0) } },
        { mainKind: "simulation", structure: sim({ de: "a" }) },
        { mainKind: "narrative", narrative: { en: text(1), de: text(1) } },
        { mainKind: "scenario", structure: null },
      ])
    ).toEqual({ copy: false, lessons: 3 });
  });

  it("leaves out a text lesson nobody wrote blocks for, as lesson-empty does", () => {
    expect(englishGaps(META, [{ mainKind: "narrative", narrative: { de: { title: "Nur ein Titel" } } }])).toEqual({
      copy: false,
      lessons: 0,
    });
  });
});
