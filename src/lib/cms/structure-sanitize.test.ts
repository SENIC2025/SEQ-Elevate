import { describe, it, expect } from "vitest";
import { sanitizeStructure, STRUCTURE_LIMITS } from "./structure-sanitize";
import type { StoredScenario, StoredSimulation } from "./structure";

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

  it("refuses text over the limit instead of cutting it short", () => {
    const long = "x".repeat(STRUCTURE_LIMITS.maxTextChars + 1);
    expect(sanitizeStructure({ ...scenario, setup: { en: long } }, "scenario")).toEqual({
      ok: false,
      error: "too-large",
    });
    const longTitle = "x".repeat(STRUCTURE_LIMITS.maxTitleChars + 1);
    expect(sanitizeStructure({ ...scenario, title: { de: longTitle } }, "scenario")).toEqual({
      ok: false,
      error: "too-large",
    });
  });

  it("refuses more choices than the editor offers", () => {
    const many = {
      ...scenario,
      choices: Array.from({ length: STRUCTURE_LIMITS.maxChoices + 1 }, (_, i) => ({
        ...scenario.choices[1],
        id: `c${i}`,
      })),
    };
    expect(sanitizeStructure(many, "scenario")).toEqual({ ok: false, error: "too-large" });
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
