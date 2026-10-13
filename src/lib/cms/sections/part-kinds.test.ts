import { describe, it, expect } from "vitest";
import {
  emptyExercise,
  partFieldKey,
  partIssueField,
  sanitizeExercise,
  validateExercise,
} from "./part-kinds";
import {
  fieldKey,
  issueField,
  STRUCTURE_FIELD_CODES,
  validateStructure,
  type StoredStructure,
  type StructureIssueCode,
} from "../structure";
import { sanitizeStructure } from "../structure-sanitize";
import { PART_LIMITS, type StoredRating, type StoredReflection } from "./contract";

/*
 * The question kinds of the flexible editor (D56). The three Release 0 kinds
 * go through Release 0's own rules unchanged — the same sanitizer, the same
 * "Save stage" checks — and the two new ones (reflection questions, a 1–5
 * self-assessment) follow the same rules: rebuilt from a whitelist, limits
 * refused rather than cut, and what is stored already may stay (D52).
 */

const scenario: StoredStructure = {
  kind: "scenario",
  title: { en: "Speak up" },
  setup: { en: "A meeting", de: "Ein Treffen" },
  question: { en: "What now?" },
  followupQuestion: { en: "And then?" },
  choices: [
    {
      id: "c1",
      quality: "best",
      text: { en: "Ask" },
      outcome: { en: "Good" },
      followups: [{ id: "f1", quality: "okay", text: { en: "Wait" }, outcome: {} }],
    },
    { id: "c2", quality: "poor", text: { en: "" }, outcome: { en: "Bad" } },
  ],
};

const reflection: StoredReflection = {
  kind: "reflection",
  title: { en: "Look back" },
  intro: { en: "Think about it.\nTake your time." },
  prompts: [
    { id: "p1", label: { en: "What went well?", de: "Was lief gut?" } },
    { id: "p2", label: { en: "What next?" }, placeholder: { en: "e.g. ask earlier" } },
  ],
};

const rating: StoredRating = {
  kind: "rating",
  title: { en: "Where do you stand?" },
  minLabel: { en: "Not at all" },
  maxLabel: { en: "Very much" },
  statements: [
    { id: "s1", text: { en: "I ask early." } },
    { id: "s2", text: { en: "I say no.", el: "Λέω όχι." } },
  ],
};

describe("the Release 0 kinds", () => {
  it("are sanitized exactly as Release 0 sanitizes them", () => {
    const inputs: [unknown, StoredStructure["kind"], unknown[]][] = [
      [scenario, "scenario", []],
      [{ ...scenario, setup: { en: "x".repeat(2_001) } }, "scenario", []],
      [{ ...scenario, setup: { en: "x".repeat(2_001) } }, "scenario", [{ ...scenario, setup: { en: "y".repeat(2_500) } }]],
      [{ ...scenario, choices: "no" }, "scenario", []],
      [scenario, "assessment", []],
      [emptyExercise("simulation"), "simulation", []],
      [emptyExercise("assessment"), "assessment", []],
    ];
    for (const [input, kind, stored] of inputs) {
      const legacy = sanitizeStructure(input, kind, stored);
      const now = sanitizeExercise(input, kind, stored);
      expect(now).toEqual(
        legacy.ok ? { ok: true, value: legacy.structure } : legacy
      );
    }
  });

  it("are checked for learners exactly as Release 0 checks them", () => {
    for (const s of [scenario, emptyExercise("simulation"), emptyExercise("scenario"), emptyExercise("assessment")]) {
      expect(validateExercise(s)).toEqual(validateStructure(s as StoredStructure));
    }
  });

  it("start empty in the shape the editor starts them", () => {
    for (const kind of ["simulation", "scenario", "assessment"] as const) {
      const empty = emptyExercise(kind);
      expect(empty.kind).toBe(kind);
      // A stored draft must survive the server's own check.
      expect(sanitizeExercise(empty, kind)).toEqual({ ok: true, value: empty });
    }
    expect(emptyExercise("simulation")).toMatchObject({ options: [{ isBest: true }, { isBest: false }] });
    expect(emptyExercise("assessment")).toMatchObject({ questions: [{ correctOptionId: "" }] });
    expect(emptyExercise("scenario")).toEqual(emptyExercise("scenario"));
  });
});

describe("reflection questions", () => {
  it("keep what the editor can write, and nothing else", () => {
    const res = sanitizeExercise(
      {
        ...reflection,
        extra: "dropped",
        prompts: [
          { id: "p1", label: { en: " What went well? ", fr: "x", de: "  " }, script: "<b>" },
          { id: "p2", label: { en: "Next?\u202E" }, placeholder: { en: "e.g.\nsoon" } },
        ],
      },
      "reflection"
    );
    expect(res).toEqual({
      ok: true,
      value: {
        kind: "reflection",
        title: { en: "Look back" },
        intro: { en: "Think about it.\nTake your time." },
        prompts: [
          { id: "p1", label: { en: " What went well? " } },
          { id: "p2", label: { en: "Next?" }, placeholder: { en: "e.g. soon" } },
        ],
      },
    });
  });

  it("refuse what the editor can't produce", () => {
    for (const bad of [
      null,
      "x",
      { ...reflection, kind: "rating" },
      { ...reflection, prompts: "x" },
      { ...reflection, prompts: [{ id: "p 1", label: {} }] },
      { ...reflection, prompts: [{ id: "p1", label: {} }, { id: "p1", label: {} }] },
      { ...reflection, prompts: [{ id: "p1", label: { en: 3 } }] },
      { ...reflection, prompts: [null] },
    ]) {
      expect(sanitizeExercise(bad, "reflection"), JSON.stringify(bad)).toEqual({ ok: false, error: "bad-input" });
    }
  });

  it("refuse a question over the limit, naming its box and language", () => {
    const long = { ...reflection, prompts: [reflection.prompts[0], { id: "p2", label: { de: "x".repeat(PART_LIMITS.promptChars + 1) } }] };
    expect(sanitizeExercise(long, "reflection")).toEqual({
      ok: false,
      error: "too-large",
      at: {
        limit: "text",
        field: "reflectionPromptLabel",
        params: { prompt: 2 },
        locale: "de",
        max: PART_LIMITS.promptChars,
      },
    });
    const title = { ...reflection, title: { el: "x".repeat(PART_LIMITS.titleChars + 1) } };
    expect(sanitizeExercise(title, "reflection")).toMatchObject({
      at: { limit: "text", field: "partTitle", locale: "el", max: PART_LIMITS.titleChars },
    });
    const intro = { ...reflection, intro: { en: "x".repeat(PART_LIMITS.introChars + 1) } };
    expect(sanitizeExercise(intro, "reflection")).toMatchObject({ at: { field: "partIntro" } });
    const hint = { ...reflection, prompts: [{ id: "p1", label: {}, placeholder: { en: "x".repeat(PART_LIMITS.placeholderChars + 1) } }] };
    expect(sanitizeExercise(hint, "reflection")).toMatchObject({
      at: { field: "reflectionPromptPlaceholder", params: { prompt: 1 } },
    });
  });

  it("refuse more questions than the limit", () => {
    const prompts = Array.from({ length: PART_LIMITS.reflectionPrompts + 1 }, (_, i) => ({ id: `p${i}`, label: {} }));
    expect(sanitizeExercise({ ...reflection, prompts }, "reflection")).toEqual({
      ok: false,
      error: "too-large",
      at: { limit: "list", list: "reflectionPrompts", max: PART_LIMITS.reflectionPrompts, count: prompts.length },
    });
  });

  it("let what is stored already stay, refusing only growth", () => {
    const long = "x".repeat(PART_LIMITS.promptChars + 10);
    const stored = { ...reflection, prompts: [{ id: "p1", label: { en: long } }] };
    expect(sanitizeExercise(stored, "reflection", [stored]).ok).toBe(true);
    const grown = { ...reflection, prompts: [{ id: "p1", label: { en: `${long}y` } }] };
    expect(sanitizeExercise(grown, "reflection", [stored])).toMatchObject({ error: "too-large" });
    // Another question doesn't inherit p1's allowance.
    const other = { ...reflection, prompts: [{ id: "p2", label: { en: long } }] };
    expect(sanitizeExercise(other, "reflection", [stored])).toMatchObject({ error: "too-large" });
    const many = Array.from({ length: PART_LIMITS.reflectionPrompts + 2 }, (_, i) => ({ id: `p${i}`, label: {} }));
    expect(sanitizeExercise({ ...reflection, prompts: many }, "reflection", [{ ...reflection, prompts: many }]).ok).toBe(true);
  });

  it("must have at least one question, each written in some language", () => {
    expect(validateExercise(reflection)).toEqual([]);
    expect(validateExercise({ ...reflection, prompts: [] })).toEqual([{ code: "reflectionNoPrompts" }]);
    expect(
      validateExercise({ ...reflection, prompts: [reflection.prompts[0], { id: "p2", label: { en: " ", de: "" } }] })
    ).toEqual([{ code: "reflectionPromptText", params: { prompt: 2 } }]);
  });

  it("start empty with one question to write", () => {
    const empty = emptyExercise("reflection");
    expect(empty).toEqual({ kind: "reflection", title: {}, intro: {}, prompts: [{ id: "p1", label: {} }] });
    expect(sanitizeExercise(empty, "reflection")).toEqual({ ok: true, value: empty });
    expect(validateExercise(empty)).toEqual([{ code: "reflectionPromptText", params: { prompt: 1 } }]);
  });
});

describe("the 1–5 self-assessment", () => {
  it("keeps what the editor can write, and nothing else", () => {
    const res = sanitizeExercise(
      { ...rating, scale: 7, statements: [{ id: "s1", text: { en: "I ask early." }, weight: 2 }] },
      "rating"
    );
    expect(res).toEqual({
      ok: true,
      value: {
        kind: "rating",
        title: { en: "Where do you stand?" },
        minLabel: { en: "Not at all" },
        maxLabel: { en: "Very much" },
        statements: [{ id: "s1", text: { en: "I ask early." } }],
      },
    });
  });

  it("refuses statements and end labels over the limits", () => {
    const statement = { ...rating, statements: [{ id: "s1", text: { en: "x".repeat(PART_LIMITS.statementChars + 1) } }] };
    expect(sanitizeExercise(statement, "rating")).toMatchObject({
      at: { field: "ratingStatementText", params: { statement: 1 }, locale: "en", max: PART_LIMITS.statementChars },
    });
    const max = { ...rating, maxLabel: { de: "x".repeat(PART_LIMITS.endLabelChars + 1) } };
    expect(sanitizeExercise(max, "rating")).toMatchObject({
      at: { field: "ratingMaxLabel", locale: "de", max: PART_LIMITS.endLabelChars },
    });
    const min = { ...rating, minLabel: { de: "x".repeat(PART_LIMITS.endLabelChars + 1) } };
    expect(sanitizeExercise(min, "rating")).toMatchObject({ at: { field: "ratingMinLabel" } });
    const statements = Array.from({ length: PART_LIMITS.ratingStatements + 1 }, (_, i) => ({ id: `s${i}`, text: {} }));
    expect(sanitizeExercise({ ...rating, statements }, "rating")).toMatchObject({
      at: { limit: "list", list: "ratingStatements", count: statements.length, max: PART_LIMITS.ratingStatements },
    });
  });

  it("refuses what the editor can't produce", () => {
    for (const bad of [
      { ...rating, statements: [{ id: "", text: {} }] },
      { ...rating, minLabel: "Not at all" },
      { ...rating, statements: undefined },
      { ...rating, kind: "reflection" },
    ]) {
      expect(sanitizeExercise(bad, "rating"), JSON.stringify(bad)).toEqual({ ok: false, error: "bad-input" });
    }
  });

  it("needs statements and both end labels written", () => {
    expect(validateExercise(rating)).toEqual([]);
    expect(validateExercise({ ...rating, statements: [] })).toEqual([{ code: "ratingNoStatements" }]);
    expect(
      validateExercise({ ...rating, minLabel: {}, statements: [rating.statements[0], { id: "s2", text: {} }] })
    ).toEqual([{ code: "ratingStatementText", params: { statement: 2 } }, { code: "ratingEndLabels" }]);
    expect(validateExercise({ ...rating, maxLabel: { en: "  " } })).toEqual([{ code: "ratingEndLabels" }]);
  });

  it("starts empty with one statement to write", () => {
    const empty = emptyExercise("rating");
    expect(empty).toEqual({
      kind: "rating",
      title: {},
      intro: {},
      minLabel: {},
      maxLabel: {},
      statements: [{ id: "s1", text: {} }],
    });
    expect(sanitizeExercise(empty, "rating")).toEqual({ ok: true, value: empty });
  });
});

describe("the whole question", () => {
  it("stays within the size of a whole stage when every box is full", () => {
    const prompts = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      label: { en: "x".repeat(300), de: "x".repeat(300), el: "x".repeat(300) },
      placeholder: { en: "x".repeat(200), de: "x".repeat(200), el: "x".repeat(200) },
    }));
    // Far below the total: the limits per box keep a question small.
    expect(sanitizeExercise({ kind: "reflection", prompts }, "reflection").ok).toBe(true);
  });
});

describe("partFieldKey and partIssueField", () => {
  it("name a Release 0 box exactly as fieldKey does", () => {
    const places = { option: 2, choice: 3, followup: 1, question: 4, answer: 5 };
    for (const code of STRUCTURE_FIELD_CODES) {
      expect(partFieldKey(code, places)).toBe(fieldKey(code, places));
      expect(partFieldKey(code)).toBe(fieldKey(code));
    }
  });

  it("name the new boxes with their question or statement", () => {
    expect(partFieldKey("reflectionPromptLabel", { prompt: 2 })).toBe("reflectionPromptLabel-prompt2");
    expect(partFieldKey("ratingStatementText", { statement: 11 })).toBe("ratingStatementText-statement11");
    expect(partFieldKey("ratingMinLabel")).toBe("ratingMinLabel");
    // Letters, digits and "-" only, so it can be part of an element id.
    expect(partFieldKey("reflectionPromptPlaceholder", { prompt: 1 })).toMatch(/^[A-Za-z0-9-]+$/);
  });

  it("take a reason to the box it is about", () => {
    const legacy: StructureIssueCode[] = ["simPrompt", "scenarioFollowupText", "assessmentCorrect", "simBestCount"];
    for (const code of legacy) {
      const issue = { code, params: { choice: 1, followup: 2, question: 3 } };
      expect(partIssueField(issue)).toBe(issueField(issue));
    }
    expect(partIssueField({ code: "reflectionPromptText", params: { prompt: 3 } })).toBe(
      partFieldKey("reflectionPromptLabel", { prompt: 3 })
    );
    expect(partIssueField({ code: "ratingStatementText", params: { statement: 2 } })).toBe(
      partFieldKey("ratingStatementText", { statement: 2 })
    );
    // About the whole question, or about two boxes at once.
    expect(partIssueField({ code: "reflectionNoPrompts" })).toBeNull();
    expect(partIssueField({ code: "ratingNoStatements" })).toBeNull();
    expect(partIssueField({ code: "ratingEndLabels" })).toBeNull();
  });
});
