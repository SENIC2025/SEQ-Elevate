import { describe, it, expect } from "vitest";
import {
  presentStageKeys,
  structureHasLocale,
  lessonCoveredIn,
  languageCoverage,
  lastEdited,
  publishReadiness,
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
    byLang[l] = { stage: null, narrative: n };
  }
  return {
    key,
    present: true,
    addable: false,
    body: key === "reflection" ? "reflection" : "narrative",
    editable: { body: true, media: true },
    byLang,
    structure: null,
    draft: null,
    video: null,
    builtInVideo: false,
    documents: [],
    updatedAt: null,
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
