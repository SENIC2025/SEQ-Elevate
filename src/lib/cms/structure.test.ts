import { describe, it, expect } from "vitest";
import {
  pickText,
  resolveSimulation,
  resolveScenario,
  resolveAssessment,
  resolveStructure,
  validateStructure,
  issueField,
  fieldKey,
  type StoredSimulation,
  type StoredScenario,
  type StoredAssessment,
} from "./structure";

const sim: StoredSimulation = {
  kind: "simulation",
  prompt: { en: "What do you say?", de: "Was sagst du?" },
  instruction: { en: "Pick one." },
  options: [
    { id: "a", isBest: false, text: { en: "Blame them" }, feedback: { en: "Escalates." } },
    { id: "b", isBest: true, text: { en: "Use an I-statement", de: "Ich-Botschaft" }, feedback: { en: "Owns it." } },
  ],
};

describe("pickText", () => {
  it("prefers the requested locale, then en, then any, then empty", () => {
    expect(pickText({ en: "E", de: "D" }, "de")).toBe("D");
    expect(pickText({ en: "E" }, "de")).toBe("E");
    expect(pickText({ el: "G" }, "de")).toBe("G");
    expect(pickText({}, "en")).toBe("");
    expect(pickText(undefined, "en")).toBe("");
  });
});

describe("resolveSimulation", () => {
  it("resolves text for the locale and carries isBest unchanged", () => {
    const out = resolveSimulation(sim, "de");
    expect(out.prompt).toBe("Was sagst du?");
    expect(out.options[1].text).toBe("Ich-Botschaft");
    expect(out.options[1].isBest).toBe(true);
    // Falls back to en where de is missing.
    expect(out.options[0].text).toBe("Blame them");
  });

  it("keeps the SAME correct option across locales (no drift)", () => {
    const en = resolveSimulation(sim, "en");
    const de = resolveSimulation(sim, "de");
    const el = resolveSimulation(sim, "el");
    for (const r of [en, de, el]) {
      expect(r.options.find((o) => o.isBest)?.id).toBe("b");
    }
  });
});

const scenario: StoredScenario = {
  kind: "scenario",
  setup: { en: "A teammate snaps at you." },
  question: { en: "What do you do?" },
  followupQuestion: { en: "And then?" },
  choices: [
    {
      id: "private",
      quality: "best",
      text: { en: "Talk privately" },
      outcome: { en: "It lands well." },
      followups: [
        { id: "listen", quality: "best", text: { en: "Listen" }, outcome: { en: "Good." } },
      ],
    },
    {
      id: "confront",
      quality: "poor",
      text: { en: "Call them out" },
      outcome: { en: "It escalates." },
    },
  ],
};

describe("resolveScenario", () => {
  it("resolves the tree and preserves quality tags at both levels", () => {
    const out = resolveScenario(scenario, "en");
    expect(out.choices).toHaveLength(2);
    expect(out.choices[0].quality).toBe("best");
    expect(out.choices[0].followups?.[0].quality).toBe("best");
    expect(out.choices[1].followups).toBeUndefined();
  });
});

const assessment: StoredAssessment = {
  kind: "assessment",
  intro: { en: "Three quick questions." },
  questions: [
    {
      id: "q1",
      correctOptionId: "b",
      question: { en: "Which is an I-statement?" },
      options: [
        { id: "a", text: { en: "You always…" } },
        { id: "b", text: { en: "I feel…" } },
      ],
    },
  ],
};

describe("resolveAssessment", () => {
  it("resolves questions and keeps the correct id", () => {
    const out = resolveAssessment(assessment, "en");
    expect(out.questions[0].correctOptionId).toBe("b");
    expect(out.questions[0].options).toHaveLength(2);
  });
});

describe("resolveStructure", () => {
  it("routes by kind into the right stage slice", () => {
    expect(resolveStructure(sim, "en").simulation).toBeDefined();
    expect(resolveStructure(scenario, "en").scenario).toBeDefined();
    expect(resolveStructure(assessment, "en").assessment).toBeDefined();
  });
});

describe("validateStructure", () => {
  const codes = (s: Parameters<typeof validateStructure>[0]) =>
    validateStructure(s).map((i) => i.code);

  it("passes a sound simulation, scenario and assessment", () => {
    expect(validateStructure(sim)).toEqual([]);
    expect(validateStructure(scenario)).toEqual([]);
    expect(validateStructure(assessment)).toEqual([]);
  });

  it("flags a simulation with no single best option", () => {
    const two = {
      ...sim,
      options: sim.options.map((o) => ({ ...o, isBest: true })),
    };
    expect(codes(two)).toContain("simBestCount");
  });

  it("flags an assessment whose correct id is not an option", () => {
    const bad: StoredAssessment = {
      ...assessment,
      questions: [{ ...assessment.questions[0], correctOptionId: "zzz" }],
    };
    expect(validateStructure(bad)).toContainEqual({
      code: "assessmentCorrect",
      params: { question: 1 },
    });
  });

  it("accepts a field authored in only one (non-default) language", () => {
    // The resolver falls back across locales, so German-only text still
    // renders — validation must not reject it.
    const deOnly: StoredSimulation = { ...sim, prompt: { de: "nur Deutsch" } };
    expect(validateStructure(deOnly)).toEqual([]);
  });

  it("accepts a field whose English was typed and then cleared, when German has text", () => {
    // The quirk partners hit: an emptied English box ("") used to hide the
    // German text from the check, so the save failed although it had text.
    const cleared: StoredScenario = {
      ...scenario,
      setup: { en: "", de: "Eine Kollegin fährt dich an." },
      choices: scenario.choices.map((c, i) =>
        i === 1 ? { ...c, outcome: { en: "   ", el: "Κλιμακώνεται." } } : c
      ),
    };
    expect(validateStructure(cleared)).toEqual([]);
  });

  it("flags a field blank in every language", () => {
    const blank: StoredSimulation = { ...sim, prompt: { en: " ", de: "" } };
    expect(codes(blank)).toEqual(["simPrompt"]);
  });

  it("flags a scenario with fewer than two choices", () => {
    const one: StoredScenario = { ...scenario, choices: [scenario.choices[0]] };
    expect(codes(one)).toContain("scenarioChoicesTooFew");
  });

  it("names the exact choice and field that is missing", () => {
    const gaps: StoredScenario = {
      ...scenario,
      choices: [
        scenario.choices[0],
        { ...scenario.choices[1], text: {}, outcome: {} },
      ],
    };
    expect(validateStructure(gaps)).toEqual([
      { code: "scenarioChoiceText", params: { choice: 2 } },
      { code: "scenarioChoiceOutcome", params: { choice: 2 } },
    ]);
  });

  it("asks for the follow-up question once a choice has follow-ups", () => {
    // Without it learners meet follow-up buttons under an empty question.
    const noQuestion: StoredScenario = { ...scenario, followupQuestion: {} };
    expect(validateStructure(noQuestion)).toEqual([
      { code: "scenarioFollowupQuestion" },
    ]);
    // No follow-ups anywhere: the question is never shown, so not needed.
    const noFollowups: StoredScenario = {
      ...noQuestion,
      choices: noQuestion.choices.map((c) => ({ ...c, followups: [] })),
    };
    expect(validateStructure(noFollowups)).toEqual([]);
  });

  it("asks for each follow-up's text and outcome, naming it", () => {
    const blankFollowup: StoredScenario = {
      ...scenario,
      choices: [
        {
          ...scenario.choices[0],
          followups: [
            scenario.choices[0].followups![0],
            { id: "f2", quality: "okay", text: {}, outcome: { en: "" } },
          ],
        },
        scenario.choices[1],
      ],
    };
    expect(validateStructure(blankFollowup)).toEqual([
      { code: "scenarioFollowupText", params: { choice: 1, followup: 2 } },
      { code: "scenarioFollowupOutcome", params: { choice: 1, followup: 2 } },
    ]);
  });

  it("names a quick-check answer with no text", () => {
    const blankAnswer: StoredAssessment = {
      ...assessment,
      questions: [
        {
          ...assessment.questions[0],
          options: [
            assessment.questions[0].options[0],
            { id: "b", text: { de: "" } },
          ],
        },
      ],
    };
    expect(validateStructure(blankAnswer)).toEqual([
      { code: "assessmentAnswerText", params: { question: 1, answer: 2 } },
    ]);
  });
});

describe("issueField", () => {
  // Everything blank: a reason for every field, plus "too few" / "which is
  // correct" reasons that are about no single box.
  const blank: StoredScenario = {
    kind: "scenario",
    setup: {},
    question: {},
    followupQuestion: {},
    choices: [
      {
        id: "c1",
        quality: "best",
        text: {},
        outcome: {},
        followups: [
          { id: "f1", quality: "okay", text: {}, outcome: {} },
          { id: "f2", quality: "poor", text: {}, outcome: {} },
        ],
      },
      { id: "c2", quality: "poor", text: {}, outcome: {}, followups: [] },
    ],
  };

  it("names a different box for every reason about one box", () => {
    const fields = validateStructure(blank).map(issueField);
    expect(fields.every((f) => f !== null)).toBe(true);
    expect(new Set(fields).size).toBe(fields.length);
    // Safe inside an element id, so the editor can mark and focus the box.
    for (const f of fields) expect(f).toMatch(/^[A-Za-z0-9-]+$/);
  });

  it("matches the key the editor gives that box", () => {
    const issues = validateStructure(blank);
    expect(issues.map(issueField)).toContain(
      fieldKey("scenarioFollowupOutcome", { choice: 1, followup: 2 })
    );
    expect(issues.map(issueField)).toContain(fieldKey("scenarioChoiceText", { choice: 2 }));
    expect(fieldKey("scenarioFollowupText", { followup: 1, choice: 2 })).toBe(
      fieldKey("scenarioFollowupText", { choice: 2, followup: 1 })
    );
  });

  it("names no box for reasons about the whole exercise", () => {
    expect(issueField({ code: "scenarioChoicesTooFew" })).toBeNull();
    expect(issueField({ code: "simBestCount" })).toBeNull();
    expect(issueField({ code: "assessmentCorrect", params: { question: 1 } })).toBeNull();
    expect(issueField({ code: "assessmentAnswersTooFew", params: { question: 1 } })).toBeNull();
  });
});
