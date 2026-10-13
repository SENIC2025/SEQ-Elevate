import { describe, it, expect } from "vitest";
import {
  partKey,
  type PartAnswer,
  type PartId,
  type PartKey,
  type SectionId,
} from "@/lib/cms/sections/contract";
import { partIsRequired, sectionContinueState } from "./section-continue";
import {
  emptyQuizPart,
  practicePart,
  quizPart,
  quizPart2,
  ratingPart,
  reflectionPart,
  scenarioPart,
  textPart,
} from "./test-fixtures";

const S = "s-abcd1234" as const;
type Answers = Partial<Record<PartKey, PartAnswer>>;

/** The player's answers: lesson `S` unless another is named. */
function given(...pairs: [PartId, PartAnswer, SectionId?][]): Answers {
  const out: Answers = {};
  for (const [id, answer, section] of pairs)
    out[partKey(section ?? S, id)] = answer;
  return out;
}

describe("sectionContinueState", () => {
  it("is ready at once when nothing in the lesson needs an answer", () => {
    expect(
      sectionContinueState(S, [textPart, reflectionPart, ratingPart], {}),
    ).toEqual({
      ready: true,
    });
    expect(sectionContinueState(S, [], {})).toEqual({ ready: true });
  });

  it("names the first part still waiting for an answer, in lesson order", () => {
    const parts = [textPart, reflectionPart, practicePart, quizPart];
    expect(sectionContinueState(S, parts, {})).toEqual({
      ready: false,
      firstMissing: "p-practc01",
    });
    const answered: Answers = given([
      "p-practc01",
      { type: "practice", optionId: "o2" },
    ]);
    expect(sectionContinueState(S, parts, answered)).toEqual({
      ready: false,
      firstMissing: "p-quizaaaa",
    });
  });

  it("takes any practice answer, right or wrong, but only one of its own options", () => {
    const wrong: Answers = given([
      "p-practc01",
      { type: "practice", optionId: "o2" },
    ]);
    expect(sectionContinueState(S, [practicePart], wrong).ready).toBe(true);
    const stale: Answers = given([
      "p-practc01",
      { type: "practice", optionId: "gone" },
    ]);
    expect(sectionContinueState(S, [practicePart], stale).ready).toBe(false);
  });

  it("needs the scenario's follow-up when the first choice has one", () => {
    const ID = "p-scenar01";
    expect(
      sectionContinueState(
        S,
        [scenarioPart],
        given([ID, { type: "scenario", rootId: "private" }]),
      ),
    ).toEqual({ ready: false, firstMissing: "p-scenar01" });
    expect(
      sectionContinueState(
        S,
        [scenarioPart],
        given([
          ID,
          { type: "scenario", rootId: "private", followupId: "boundary" },
        ]),
      ).ready,
    ).toBe(true);
    // A first choice without follow-ups is enough on its own.
    expect(
      sectionContinueState(
        S,
        [scenarioPart],
        given([ID, { type: "scenario", rootId: "public" }]),
      ).ready,
    ).toBe(true);
  });

  it("needs a quick check's answers checked, not just chosen", () => {
    const ID = "p-quizaaaa";
    const chosen = { q1: "b", q2: "a" };
    expect(
      sectionContinueState(
        S,
        [quizPart],
        given([ID, { type: "quiz", answers: chosen, checked: false }]),
      ).ready,
    ).toBe(false);
    expect(
      sectionContinueState(
        S,
        [quizPart],
        given([ID, { type: "quiz", answers: chosen, checked: true }]),
      ).ready,
    ).toBe(true);
    // Checked, but a question is open (the quiz changed): not done.
    expect(
      sectionContinueState(
        S,
        [quizPart],
        given([ID, { type: "quiz", answers: { q1: "b" }, checked: true }]),
      ).ready,
    ).toBe(false);
  });

  it("keeps two quick checks in one lesson apart, though their questions share ids", () => {
    const parts = [quizPart, quizPart2];
    const first: Answers = given([
      "p-quizaaaa",
      { type: "quiz", answers: { q1: "b", q2: "a" }, checked: true },
    ]);
    expect(sectionContinueState(S, parts, first)).toEqual({
      ready: false,
      firstMissing: "p-quizbbbb",
    });
  });

  it("reads only this lesson's answers", () => {
    const elsewhere: Answers = given([
      "p-practc01",
      { type: "practice", optionId: "o1" },
      "concept",
    ]);
    expect(sectionContinueState(S, [practicePart], elsewhere).ready).toBe(
      false,
    );
  });

  it("an answer of another kind doesn't count", () => {
    const odd: Answers = given([
      "p-practc01",
      { type: "reflection", text: {} },
    ]);
    expect(sectionContinueState(S, [practicePart], odd).ready).toBe(false);
  });

  it("never holds the lesson up on a question with nothing to answer", () => {
    expect(partIsRequired(emptyQuizPart)).toBe(false);
    expect(
      partIsRequired({
        ...practicePart,
        simulation: { ...practicePart.simulation, options: [] },
      }),
    ).toBe(false);
    expect(sectionContinueState(S, [emptyQuizPart], {})).toEqual({
      ready: true,
    });
  });
});
