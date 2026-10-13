import { describe, it, expect } from "vitest";
import { sanitizeStructure, STRUCTURE_LIMITS } from "./structure-sanitize";
import type {
  StoredAssessment,
  StoredAssessmentQuestion,
  StoredScenario,
  StoredSimulation,
} from "./structure";

const scenario: StoredScenario = {
  kind: "scenario",
  title: { en: "Play it out" },
  setup: { en: "A teammate snaps at you." },
  question: { en: "What do you do?" },
  followupQuestion: { en: "And then?" },
  choices: [
    {
      id: "c1",
      quality: "best",
      text: { en: "Talk privately" },
      outcome: { en: "It lands well." },
      followups: [
        { id: "f1", quality: "okay", text: { en: "Listen" }, outcome: { en: "Good." } },
      ],
    },
    { id: "c2", quality: "poor", text: { en: "Call them out" }, outcome: { en: "It escalates." } },
  ],
};

describe("sanitizeStructure", () => {
  it("keeps a sound structure as it is", () => {
    expect(sanitizeStructure(scenario, "scenario")).toEqual({
      ok: true,
      structure: scenario,
    });
  });

  it("keeps an unfinished exercise: a draft may have blank fields", () => {
    const unfinished: StoredSimulation = {
      kind: "simulation",
      title: {},
      prompt: {},
      instruction: {},
      options: [
        { id: "o1", isBest: true, text: { en: "Say it calmly" }, feedback: {} },
        { id: "o2", isBest: false, text: {}, feedback: {} },
      ],
    };
    expect(sanitizeStructure(unfinished, "simulation")).toEqual({
      ok: true,
      structure: unfinished,
    });
  });

  it("drops emptied languages, so learners fall back to a language with text", () => {
    const out = sanitizeStructure(
      { ...scenario, setup: { en: "", de: "Eine Kollegin fährt dich an.", el: "  " } },
      "scenario"
    );
    expect(out.ok && out.structure.kind === "scenario" && out.structure.setup).toEqual({
      de: "Eine Kollegin fährt dich an.",
    });
  });

  it("rebuilds rather than passes through: unknown keys and languages go", () => {
    const out = sanitizeStructure(
      {
        ...scenario,
        extra: "<script>",
        setup: { en: "Setup", fr: "Mise en place" },
        choices: scenario.choices.map((c) => ({ ...c, onclick: "x" })),
      },
      "scenario"
    );
    expect(out).toEqual({ ok: true, structure: { ...scenario, setup: { en: "Setup" } } });
  });

  it("removes invisible characters Postgres can't store", () => {
    const out = sanitizeStructure(
      { ...scenario, question: { en: "What\u0000 do you﻿ do?\uD800" } },
      "scenario"
    );
    expect(out.ok && out.structure.kind === "scenario" && out.structure.question).toEqual({
      en: "What do you do?",
    });
  });

  it("keeps one level of follow-ups — the editor and the player have no more", () => {
    const deep = {
      ...scenario,
      choices: [
        {
          ...scenario.choices[0],
          followups: [{ ...scenario.choices[0].followups![0], followups: [scenario.choices[1]] }],
        },
        scenario.choices[1],
      ],
    };
    expect(sanitizeStructure(deep, "scenario")).toEqual({ ok: true, structure: scenario });
  });

  it("refuses a structure for another kind of lesson, or a malformed one", () => {
    expect(sanitizeStructure(scenario, "simulation")).toEqual({ ok: false, error: "bad-input" });
    expect(sanitizeStructure(null, "scenario")).toEqual({ ok: false, error: "bad-input" });
    expect(sanitizeStructure({ ...scenario, choices: "x" }, "scenario")).toEqual({
      ok: false,
      error: "bad-input",
    });
    expect(
      sanitizeStructure(
        { ...scenario, choices: [{ ...scenario.choices[0], quality: "great" }, scenario.choices[1]] },
        "scenario"
      )
    ).toEqual({ ok: false, error: "bad-input" });
    expect(
      sanitizeStructure({ ...scenario, setup: { en: 42 } }, "scenario")
    ).toEqual({ ok: false, error: "bad-input" });
  });

  it("refuses ids that aren't short tokens, or that repeat", () => {
    const badId = { ...scenario, choices: [{ ...scenario.choices[0], id: "a b" }, scenario.choices[1]] };
    expect(sanitizeStructure(badId, "scenario")).toEqual({ ok: false, error: "bad-input" });
    const twice = { ...scenario, choices: [scenario.choices[1], scenario.choices[1]] };
    expect(sanitizeStructure(twice, "scenario")).toEqual({ ok: false, error: "bad-input" });
  });

  it("refuses text over the limit instead of cutting it short, saying which box and language", () => {
    const long = "x".repeat(STRUCTURE_LIMITS.maxTextChars + 1);
    expect(sanitizeStructure({ ...scenario, setup: { en: long } }, "scenario")).toEqual({
      ok: false,
      error: "too-large",
      at: { limit: "text", field: "scenarioSetup", locale: "en", max: STRUCTURE_LIMITS.maxTextChars },
    });
    const longTitle = "x".repeat(STRUCTURE_LIMITS.maxTitleChars + 1);
    expect(sanitizeStructure({ ...scenario, title: { de: longTitle } }, "scenario")).toEqual({
      ok: false,
      error: "too-large",
      at: { limit: "text", field: "stageTitle", locale: "de", max: STRUCTURE_LIMITS.maxTitleChars },
    });
    // A box inside a list is named by its place, as the editor numbers it.
    const followup = { ...scenario.choices[0].followups![0], outcome: { el: long } };
    expect(
      sanitizeStructure(
        { ...scenario, choices: [scenario.choices[1], { ...scenario.choices[0], followups: [followup] }] },
        "scenario"
      )
    ).toEqual({
      ok: false,
      error: "too-large",
      at: {
        limit: "text",
        field: "scenarioFollowupOutcome",
        params: { choice: 2, followup: 1 },
        locale: "el",
        max: STRUCTURE_LIMITS.maxTextChars,
      },
    });
  });

  it("refuses more choices than the editor offers, saying which list", () => {
    const many = {
      ...scenario,
      choices: Array.from({ length: STRUCTURE_LIMITS.maxChoices + 1 }, (_, i) => ({
        ...scenario.choices[1],
        id: `c${i}`,
      })),
    };
    expect(sanitizeStructure(many, "scenario")).toEqual({
      ok: false,
      error: "too-large",
      at: {
        limit: "list",
        list: "scenarioChoices",
        max: STRUCTURE_LIMITS.maxChoices,
        count: STRUCTURE_LIMITS.maxChoices + 1,
      },
    });
  });

  it("rebuilds an assessment, keeping an unticked correct answer for a draft", () => {
    const quiz = {
      kind: "assessment",
      intro: { en: "One question." },
      questions: [
        {
          id: "q1",
          correctOptionId: "",
          question: { en: "Which is an I-statement?" },
          options: [
            { id: "a", text: { en: "You always…" } },
            { id: "b", text: {} },
          ],
        },
      ],
    };
    expect(sanitizeStructure(quiz, "assessment")).toEqual({ ok: true, structure: quiz });
  });
});

/*
 * Stages saved before Release 0 had no limits. One already over a limit must
 * stay editable — an editor fixing a typo in it must be able to save — so
 * what the row already holds is allowed; only growth past a limit is not.
 */
describe("sanitizeStructure with what is already stored", () => {
  const TEXT = STRUCTURE_LIMITS.maxTextChars;
  const longDe = "Lang. ".repeat(400).trim(); // 2,399 characters
  const legacy: StoredScenario = {
    ...scenario,
    setup: { en: "A teammate snaps at you.", de: longDe },
    choices: [
      scenario.choices[0],
      { ...scenario.choices[1], outcome: { en: "y".repeat(TEXT + 300) } },
    ],
  };

  it("saves an over-long text that is stored already, when another box is edited", () => {
    const typoFixed = {
      ...legacy,
      choices: [{ ...legacy.choices[0], text: { en: "Talk to them privately" } }, legacy.choices[1]],
    };
    expect(sanitizeStructure(typoFixed, "scenario")).toMatchObject({ ok: false, error: "too-large" });
    expect(sanitizeStructure(typoFixed, "scenario", [legacy, null])).toEqual({
      ok: true,
      structure: typoFixed,
    });
  });

  it("saves it shortened, even while it is still over the limit", () => {
    const shorter = { ...legacy, setup: { ...legacy.setup, de: longDe.slice(0, TEXT + 100) } };
    expect(sanitizeStructure(shorter, "scenario", [legacy])).toMatchObject({ ok: true });
  });

  it("refuses it grown past what is stored, naming the box and language", () => {
    const longer = { ...legacy, setup: { ...legacy.setup, de: `${longDe} Mehr.` } };
    expect(sanitizeStructure(longer, "scenario", [legacy])).toEqual({
      ok: false,
      error: "too-large",
      at: { limit: "text", field: "scenarioSetup", locale: "de", max: TEXT },
    });
  });

  it("allows it per box and language: not in another box or another language", () => {
    // The long German setup doesn't make room for a long English one…
    const english = { ...legacy, setup: { en: longDe, de: longDe } };
    expect(sanitizeStructure(english, "scenario", [legacy])).toMatchObject({
      ok: false,
      at: { field: "scenarioSetup", locale: "en" },
    });
    // …nor for a long text in another box.
    const moved = { ...legacy, question: { de: longDe } };
    expect(sanitizeStructure(moved, "scenario", [legacy])).toMatchObject({
      ok: false,
      at: { field: "scenarioQuestion", locale: "de" },
    });
  });

  it("follows an item by its id, wherever it moved in its list", () => {
    const reordered = { ...legacy, choices: [legacy.choices[1], legacy.choices[0]] };
    expect(sanitizeStructure(reordered, "scenario", [legacy])).toMatchObject({ ok: true });
    // A new choice (a new id) gets no room from the stored one's text.
    const copied = {
      ...legacy,
      choices: [...legacy.choices, { ...legacy.choices[1], id: "c9" }],
    };
    expect(sanitizeStructure(copied, "scenario", [legacy])).toEqual({
      ok: false,
      error: "too-large",
      at: {
        limit: "text",
        field: "scenarioChoiceOutcome",
        params: { choice: 3 },
        locale: "en",
        max: TEXT,
      },
    });
  });

  it("counts the draft as stored too", () => {
    expect(sanitizeStructure(legacy, "scenario", [null, legacy])).toMatchObject({ ok: true });
    expect(sanitizeStructure(legacy, "scenario", [scenario, legacy])).toMatchObject({ ok: true });
  });

  it("ignores stored data of another kind, or none at all", () => {
    const sim: StoredSimulation = {
      kind: "simulation",
      prompt: { de: longDe },
      instruction: {},
      options: [],
    };
    expect(sanitizeStructure(legacy, "scenario", [sim, "x", 42])).toMatchObject({
      ok: false,
      error: "too-large",
    });
  });

  const question = (i: number, answers = 2): StoredAssessmentQuestion => ({
    id: `q${i}`,
    correctOptionId: "a0",
    question: { en: `Question ${i}` },
    options: Array.from({ length: answers }, (_, j) => ({ id: `a${j}`, text: { en: `A${j}` } })),
  });
  const quiz = (questions: StoredAssessmentQuestion[]): StoredAssessment => ({
    kind: "assessment",
    intro: { en: "Intro" },
    questions,
  });

  it("keeps a stored list over its count, and allows it shorter, but not longer", () => {
    const max = STRUCTURE_LIMITS.maxQuestions;
    const stored = quiz(Array.from({ length: max + 2 }, (_, i) => question(i)));
    expect(sanitizeStructure(stored, "assessment")).toEqual({
      ok: false,
      error: "too-large",
      at: { limit: "list", list: "assessmentQuestions", max, count: max + 2 },
    });
    expect(sanitizeStructure(stored, "assessment", [stored])).toMatchObject({ ok: true });
    const fewer = quiz(stored.questions.slice(1));
    expect(sanitizeStructure(fewer, "assessment", [stored])).toMatchObject({ ok: true });
    const more = quiz([...stored.questions, question(99)]);
    expect(sanitizeStructure(more, "assessment", [stored])).toEqual({
      ok: false,
      error: "too-large",
      at: { limit: "list", list: "assessmentQuestions", max, count: max + 3 },
    });
  });

  it("counts a nested list against the same item's stored list", () => {
    const max = STRUCTURE_LIMITS.maxAnswers;
    const stored = quiz([question(1), question(2, max + 1)]);
    expect(sanitizeStructure(stored, "assessment", [stored])).toMatchObject({ ok: true });
    // The long list belongs to question q2; q1 doesn't get its room.
    const grown = quiz([question(1, max + 1), question(2, max + 1)]);
    expect(sanitizeStructure(grown, "assessment", [stored])).toEqual({
      ok: false,
      error: "too-large",
      at: {
        limit: "list",
        list: "assessmentAnswers",
        params: { question: 1 },
        max,
        count: max + 1,
      },
    });
  });

  it("names follow-ups by their choice", () => {
    const max = STRUCTURE_LIMITS.maxFollowups;
    const followups = Array.from({ length: max + 1 }, (_, i) => ({
      ...scenario.choices[0].followups![0],
      id: `f${i}`,
    }));
    const many = { ...scenario, choices: [scenario.choices[1], { ...scenario.choices[0], followups }] };
    expect(sanitizeStructure(many, "scenario")).toEqual({
      ok: false,
      error: "too-large",
      at: {
        limit: "list",
        list: "scenarioFollowups",
        params: { choice: 2 },
        max,
        count: max + 1,
      },
    });
    expect(sanitizeStructure(many, "scenario", [many])).toMatchObject({ ok: true });
  });

  it("measures the whole stage against what is stored, so an unchanged one passes", () => {
    // Thirty questions of long text in three languages: over 200,000
    // characters as JSON, as only a stage from before the limits can be.
    const long = (i: number) => ({
      en: `${i}`.padEnd(3_000, "e"),
      de: `${i}`.padEnd(3_000, "d"),
      el: `${i}`.padEnd(3_000, "l"),
    });
    const big = (n: number) => ({ ...question(n), question: long(n) });
    const stored = quiz(Array.from({ length: 30 }, (_, i) => big(i)));
    expect(JSON.stringify(stored).length).toBeGreaterThan(STRUCTURE_LIMITS.maxJsonChars);
    expect(sanitizeStructure(stored, "assessment", [stored])).toMatchObject({ ok: true });

    // Swapping a question for a new one, every box within its own limit,
    // still makes the whole stage larger than it was.
    const full = (n: number) => ({
      ...question(n, STRUCTURE_LIMITS.maxAnswers),
      question: { en: "q".repeat(TEXT), de: "q".repeat(TEXT), el: "q".repeat(TEXT) },
      options: Array.from({ length: STRUCTURE_LIMITS.maxAnswers }, (_, j) => ({
        id: `a${j}`,
        text: { en: "a".repeat(TEXT), de: "a".repeat(TEXT), el: "a".repeat(TEXT) },
      })),
    });
    const swapped = quiz([...stored.questions.slice(1), full(99)]);
    expect(sanitizeStructure(swapped, "assessment", [stored])).toEqual({
      ok: false,
      error: "too-large",
      at: { limit: "total", max: STRUCTURE_LIMITS.maxJsonChars },
    });
  });
});

