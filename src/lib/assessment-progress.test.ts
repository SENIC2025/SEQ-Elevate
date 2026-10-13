import { describe, it, expect } from "vitest";
import {
  MAX_ASSESSMENT_ANSWERS,
  MAX_ASSESSMENT_ID_LENGTH,
  answerQuestion,
  assessmentToSave,
  checkedQuiz,
  emptyAssessment,
  hasAssessmentProgress,
  mergeAssessment,
  parseAssessmentInput,
  readAssessment,
  retakeQuiz,
  scoreAssessment,
} from "./assessment-progress";
import type { AssessmentQuestion } from "./cms/types";

const q = (id: string, correct: string, options = [correct, "x"]) =>
  ({
    id,
    question: id,
    options: options.map((o) => ({ id: o, text: o })),
    correctOptionId: correct,
  }) satisfies AssessmentQuestion;

describe("answerQuestion", () => {
  it("records the option chosen for a question, by the question's id", () => {
    const one = answerQuestion(emptyAssessment(), "qk3f", "a1x");
    expect(one).toEqual({ answers: { qk3f: "a1x" }, checked: false });
    expect(answerQuestion(one, "qk3f", "a2x").answers).toEqual({ qk3f: "a2x" });
  });

  it("opens a checked quick check again: a changed answer has to be checked again", () => {
    const checked = { answers: { q1: "a" }, checked: true };
    expect(answerQuestion(checked, "q2", "b")).toEqual({
      answers: { q1: "a", q2: "b" },
      checked: false,
    });
  });
});

describe("retakeQuiz", () => {
  it("clears the answers and the check, marked as tried again on this page", () => {
    expect(retakeQuiz()).toEqual({ answers: {}, checked: false, retaken: true });
  });

  it("stays marked as tried again while the learner answers and checks again", () => {
    const one = answerQuestion(retakeQuiz(), "qk3f", "a1x");
    expect(one).toEqual({ answers: { qk3f: "a1x" }, checked: false, retaken: true });
  });
});

describe("assessmentToSave", () => {
  it("saves the answers and the check, never the mark of a retake", () => {
    expect(
      assessmentToSave({ answers: { q1: "a" }, checked: true, retaken: true })
    ).toEqual({ answers: { q1: "a" }, checked: true });
    expect(assessmentToSave({ answers: {}, checked: false })).toEqual({
      answers: {},
      checked: false,
    });
  });

  it("sends a quiz just tried again as an empty quick check, which the server takes", () => {
    // Saved over the old check: the facilitator no longer sees its score.
    expect(parseAssessmentInput(assessmentToSave(retakeQuiz()))).toEqual({
      answers: {},
      checked: false,
    });
  });
});

describe("checkedQuiz", () => {
  const questions = [q("q1", "a"), q("q2", "b", ["a", "b"])];

  it("is checked once every question has one of its own options and Check answers was pressed", () => {
    expect(
      checkedQuiz(questions, { answers: { q1: "a", q2: "a" }, checked: true })
    ).toEqual({ allAnswered: true, checked: true });
    expect(
      checkedQuiz(questions, { answers: { q1: "a", q2: "a" }, checked: false })
    ).toEqual({ allAnswered: true, checked: false });
  });

  it("isn't checked while a question is open, or answered with an option it no longer has", () => {
    expect(
      checkedQuiz(questions, { answers: { q1: "a" }, checked: true })
    ).toEqual({ allAnswered: false, checked: false });
    expect(
      checkedQuiz(questions, { answers: { q1: "a", q2: "gone" }, checked: true })
    ).toEqual({ allAnswered: false, checked: false });
  });
});

describe("hasAssessmentProgress", () => {
  it("is true once any question is answered", () => {
    expect(hasAssessmentProgress(emptyAssessment())).toBe(false);
    expect(hasAssessmentProgress({ answers: { qk3f: "a" }, checked: false })).toBe(
      true
    );
  });
});

describe("mergeAssessment", () => {
  it("keeps each answer chosen locally and the saved one otherwise", () => {
    expect(
      mergeAssessment(
        { answers: { b: "local" }, checked: false },
        { answers: { a: "saved", b: "saved" }, checked: false }
      )
    ).toEqual({ answers: { a: "saved", b: "local" }, checked: false });
  });

  it("keeps a check from either side while the local answers match the saved ones", () => {
    expect(
      mergeAssessment(
        { answers: { a: "x" }, checked: false },
        { answers: { a: "x", b: "y" }, checked: true }
      )
    ).toEqual({ answers: { a: "x", b: "y" }, checked: true });
    expect(
      mergeAssessment(
        { answers: { a: "x", b: "y" }, checked: true },
        { answers: { a: "x" }, checked: false }
      )
    ).toEqual({ answers: { a: "x", b: "y" }, checked: true });
    expect(
      mergeAssessment({ answers: {}, checked: false }, { answers: { a: "x" }, checked: true })
    ).toEqual({ answers: { a: "x" }, checked: true });
  });

  it("opens a saved checked quiz again when a different answer was chosen locally", () => {
    expect(
      mergeAssessment(
        { answers: { b: "local" }, checked: false },
        { answers: { a: "saved", b: "saved" }, checked: true }
      )
    ).toEqual({ answers: { a: "saved", b: "local" }, checked: false });
  });
});

describe("mergeAssessment after the learner tried the quiz again", () => {
  const saved = { answers: { a: "x", b: "y" }, checked: true };

  it("doesn't bring the saved check back over a retake made while it loaded", () => {
    expect(mergeAssessment(retakeQuiz(), saved)).toEqual({
      answers: {},
      checked: false,
      retaken: true,
    });
  });

  it("keeps only the answers chosen since, even where they match the saved ones", () => {
    const again = answerQuestion(retakeQuiz(), "a", "x");
    expect(mergeAssessment(again, saved)).toEqual({
      answers: { a: "x" },
      checked: false,
      retaken: true,
    });
  });

  it("keeps the new check", () => {
    const rechecked = {
      ...answerQuestion(answerQuestion(retakeQuiz(), "a", "z"), "b", "y"),
      checked: true,
    };
    expect(mergeAssessment(rechecked, saved)).toEqual(rechecked);
  });
});

describe("readAssessment", () => {
  it("reads what the store saves", () => {
    expect(readAssessment({ answers: { qk3f: "a1x" }, checked: true })).toEqual({
      answers: { qk3f: "a1x" },
      checked: true,
    });
  });

  it("reads the shape saved before answers were kept: three empty slots", () => {
    expect(readAssessment({ q1: null, q2: null, q3: null })).toEqual(
      emptyAssessment()
    );
    expect(readAssessment({ q1: "b", q2: null })).toEqual({
      answers: { q1: "b" },
      checked: false,
    });
  });

  it("drops what isn't an answer, and reads nothing from what isn't a quick check", () => {
    expect(
      readAssessment({ answers: { a: "x", b: 3, c: null, d: "" }, checked: "yes" })
    ).toEqual({ answers: { a: "x" }, checked: false });
    for (const raw of [null, undefined, "x", 3, [], { answers: [] }]) {
      expect(readAssessment(raw)).toEqual(emptyAssessment());
    }
  });
});

describe("parseAssessmentInput", () => {
  it("accepts the store's quick check, dropping questions left open", () => {
    expect(
      parseAssessmentInput({ answers: { qk3f: "a1x", q9zz: null }, checked: true })
    ).toEqual({ answers: { qk3f: "a1x" }, checked: true });
  });

  it("leaves the saved answers alone for a page loaded before they were kept", () => {
    // Such a page always sends three empty slots: nothing to save over them.
    expect(parseAssessmentInput({ q1: null, q2: null, q3: null })).toBeNull();
    expect(parseAssessmentInput({})).toBeNull();
  });

  it("refuses anything but text or nothing as an answer", () => {
    for (const answer of [1, true, {}, ["a"]]) {
      expect(() =>
        parseAssessmentInput({ answers: { q1: answer }, checked: false })
      ).toThrow();
    }
    expect(() => parseAssessmentInput({ q1: 1 })).toThrow();
  });

  it("refuses a quick check that isn't one", () => {
    for (const raw of [
      null,
      "x",
      [],
      { answers: [], checked: false },
      { answers: {}, checked: "yes" },
      { answers: {} },
      { answers: {}, checked: false, extra: 1 },
    ]) {
      expect(() => parseAssessmentInput(raw)).toThrow();
    }
  });

  it("refuses too many answers, or an id or answer that is too long", () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_ASSESSMENT_ANSWERS + 1 }, (_, i) => [`q${i}`, "a"])
    );
    expect(() => parseAssessmentInput({ answers: many, checked: false })).toThrow();
    const long = "x".repeat(MAX_ASSESSMENT_ID_LENGTH + 1);
    expect(() =>
      parseAssessmentInput({ answers: { [long]: "a" }, checked: false })
    ).toThrow();
    expect(() =>
      parseAssessmentInput({ answers: { q1: long }, checked: false })
    ).toThrow();
    expect(() =>
      parseAssessmentInput({ answers: { "": "a" }, checked: false })
    ).toThrow();
    // The most it takes, at the longest.
    const most = Object.fromEntries(
      Array.from({ length: MAX_ASSESSMENT_ANSWERS }, (_, i) => [
        `q${i}`.padEnd(MAX_ASSESSMENT_ID_LENGTH, "x"),
        "a".repeat(MAX_ASSESSMENT_ID_LENGTH),
      ])
    );
    expect(
      Object.keys(parseAssessmentInput({ answers: most, checked: true })!.answers)
    ).toHaveLength(MAX_ASSESSMENT_ANSWERS);
  });
});

describe("scoreAssessment", () => {
  const questions = [q("qk3f", "a1x"), q("q9zz", "a4x", ["a3x", "a4x"])];

  it("scores a checked quick check by question id, whatever the ids", () => {
    expect(
      scoreAssessment(questions, {
        answers: { qk3f: "a1x", q9zz: "a3x" },
        checked: true,
      })
    ).toEqual({ correct: 1, total: 2 });
  });

  it("scores the built-in quizzes, whose ids are q1 to q3", () => {
    const builtIn = [q("q1", "b"), q("q2", "b"), q("q3", "b")];
    expect(
      scoreAssessment(builtIn, {
        answers: { q1: "b", q2: "a", q3: "b" },
        checked: true,
      })
    ).toEqual({ correct: 2, total: 3 });
  });

  it("counts nothing until the learner checked their answers", () => {
    expect(
      scoreAssessment(questions, { answers: { qk3f: "a1x" }, checked: false })
    ).toEqual({ correct: 0, total: 0 });
  });

  it("counts only the questions the quiz still has", () => {
    expect(
      scoreAssessment(questions, {
        answers: { qk3f: "a1x", removed: "a1x" },
        checked: true,
      })
    ).toEqual({ correct: 1, total: 1 });
  });
});
