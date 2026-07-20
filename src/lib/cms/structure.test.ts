import { describe, it, expect } from "vitest";
import {
  pickText,
  resolveSimulation,
  resolveScenario,
  resolveAssessment,
  resolveStructure,
  validateStructure,
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
  it("passes a sound simulation", () => {
    expect(validateStructure(sim)).toEqual([]);
  });

  it("flags a simulation with no single best option", () => {
    const two = {
      ...sim,
      options: sim.options.map((o) => ({ ...o, isBest: true })),
    };
    expect(validateStructure(two).some((i) => /exactly one/.test(i.message))).toBe(
      true
    );
  });

  it("flags an assessment whose correct id is not an option", () => {
    const bad: StoredAssessment = {
      ...assessment,
      questions: [{ ...assessment.questions[0], correctOptionId: "zzz" }],
    };
    expect(
      validateStructure(bad).some((i) => /which answer is correct/.test(i.message))
    ).toBe(true);
  });

  it("accepts a field authored in only one (non-default) language", () => {
    // The resolver falls back across locales, so German-only text still
    // renders — validation must not reject it.
    const deOnly: StoredSimulation = { ...sim, prompt: { de: "nur Deutsch" } };
    expect(
      validateStructure(deOnly, "en").some((i) => /at least one language/.test(i.message))
    ).toBe(false);
  });

  it("flags a field blank in every language", () => {
    const blank: StoredSimulation = { ...sim, prompt: {} };
    expect(
      validateStructure(blank, "en").some((i) =>
        /at least one language/.test(i.message)
      )
    ).toBe(true);
  });

  it("flags a scenario with fewer than two choices", () => {
    const one: StoredScenario = { ...scenario, choices: [scenario.choices[0]] };
    expect(
      validateStructure(one).some((i) => /at least two first choices/.test(i.message))
    ).toBe(true);
  });
});
