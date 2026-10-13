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

  it("puts one blocker per reason first, naming the lesson", () => {
    const reasons: NewOnlyReason[] = [
      { code: "custom-section", sectionId: "s-abcdefgh" },
      { code: "reordered" },
    ];
    const issues = publishReadiness({ ...base(), sections: meta({ reasons }) });
    expect(issues.slice(0, 2)).toEqual([
      { level: "blocker", code: "needs-release-2", reason: reasons[0], stage: "s-abcdefgh" },
      { level: "blocker", code: "needs-release-2", reason: reasons[1] },
    ]);
    expect(issues.slice(2)).toEqual(publishReadiness(base()));
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

  it("notes that learners get the step names from Release 2", () => {
    expect(publishReadiness({ ...base(), sections: meta({ hasLabels: true }) })).toContainEqual({
      level: "info",
      code: "labels-later",
    });
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
