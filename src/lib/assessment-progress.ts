/**
 * A learner's quick-check (assessment) answers, as the learner store keeps
 * them and CourseEnrollment.assessment saves them.
 *
 * Answers are keyed by the question's id. The built-in courses' quizzes
 * use q1 to q3, but a quiz made in the course editor has any number of
 * questions with ids of its own, so no fixed slots. `checked` records that
 * the learner pressed "Check answers": the answers are then locked and the
 * score shown, so a learner who comes back finds them as they left them,
 * and the facilitator and statistics views score only what was checked.
 * "Try again" clears both (retakeQuiz), and that is saved too: the latest
 * check is the one that counts.
 *
 * Before this shape, the store kept three slots ({ q1, q2, q3 }) that were
 * never filled, and that's what every enrollment saved until now holds.
 * Both readers below take it as "nothing answered yet".
 *
 * Pure (no React, no database): shared by the learner store, its server
 * actions (src/app/actions/learner.ts) and the facilitator and statistics
 * queries.
 */

import type { AssessmentQuestion } from "./cms/types";

// A type rather than an interface: Prisma saves it as JSON, which takes an
// object type only when it can be indexed by any key, as an interface can't.
export type AssessmentProgress = {
  /** The option chosen, keyed by the question's id. */
  answers: Record<string, string>;
  /** "Check answers" was pressed: the answers are locked. */
  checked: boolean;
  /**
   * Only in the learner store, never saved (assessmentToSave): the learner
   * chose "Try again" on this page, so these answers replace the saved
   * ones when they arrive (mergeAssessment).
   */
  retaken?: true;
};

/** More answers than any quiz is meant to have; ids are a few characters. */
export const MAX_ASSESSMENT_ANSWERS = 100;
export const MAX_ASSESSMENT_ID_LENGTH = 100;

export function emptyAssessment(): AssessmentProgress {
  return { answers: {}, checked: false };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** An id or an answer: some text, not too long. */
const fits = (s: string) => s.length > 0 && s.length <= MAX_ASSESSMENT_ID_LENGTH;

/**
 * The answers held in `raw`: either the current shape or the three old
 * slots. Anything that isn't an answer (not text, empty, too long) is left
 * out, and so is everything past MAX_ASSESSMENT_ANSWERS. Never fails: for
 * what's been saved already, from the database or this browser's guest
 * store, which the learner can't fix.
 */
export function readAssessment(raw: unknown): AssessmentProgress {
  if (!isRecord(raw)) return emptyAssessment();
  const current = "answers" in raw;
  const source = current ? raw.answers : raw;
  if (!isRecord(source)) return emptyAssessment();
  const answers: Record<string, string> = {};
  let count = 0;
  for (const [id, answer] of Object.entries(source)) {
    if (count >= MAX_ASSESSMENT_ANSWERS) break;
    if (typeof answer !== "string" || !fits(id) || !fits(answer)) continue;
    answers[id] = answer;
    count++;
  }
  return { answers, checked: current && raw.checked === true };
}

/**
 * A save's quick check, checked strictly: it comes from the browser.
 * Throws for anything that isn't one — answers that aren't text or null
 * (a question left open), more than MAX_ASSESSMENT_ANSWERS of them, an id
 * or answer that's empty or longer than MAX_ASSESSMENT_ID_LENGTH, other
 * fields. Null answers are left out.
 *
 * Returns null for the three old slots with nothing in them: that's what a
 * page loaded before answers were kept always sends, and saving it would
 * wipe the answers the learner has saved since, from a newer page. The
 * saved answers are left as they are then.
 */
export function parseAssessmentInput(raw: unknown): AssessmentProgress | null {
  if (!isRecord(raw)) throw new Error("A quick check must be an object");
  const current = "answers" in raw;
  if (current) {
    const extra = Object.keys(raw).filter((k) => k !== "answers" && k !== "checked");
    if (extra.length > 0 || typeof raw.checked !== "boolean") {
      throw new Error("A quick check holds only its answers and whether it was checked");
    }
  }
  const source = current ? raw.answers : raw;
  if (!isRecord(source)) throw new Error("Quick-check answers must be an object");
  const entries = Object.entries(source);
  if (entries.length > MAX_ASSESSMENT_ANSWERS) {
    throw new Error("Too many quick-check answers");
  }
  const answers: Record<string, string> = {};
  for (const [id, answer] of entries) {
    if (!fits(id)) throw new Error("A quick-check question id is empty or too long");
    if (answer === null) continue;
    if (typeof answer !== "string" || !fits(answer)) {
      throw new Error("A quick-check answer must be a short text or null");
    }
    answers[id] = answer;
  }
  if (!current) {
    return Object.keys(answers).length > 0 ? { answers, checked: false } : null;
  }
  return { answers, checked: raw.checked === true };
}

/**
 * `a` once the learner chose `optionId` for `questionId`. A quick check
 * that was checked is open again: the score no longer matches the
 * answers, so they're checked again. (The player locks a checked quiz, so
 * this only happens once its questions have changed: see checkedQuiz.) A
 * quiz tried again stays marked so: these are still the answers since.
 */
export function answerQuestion(
  a: AssessmentProgress,
  questionId: string,
  optionId: string
): AssessmentProgress {
  return {
    ...a,
    answers: { ...a.answers, [questionId]: optionId },
    checked: false,
  };
}

/**
 * A checked quick check once the learner chose "Try again": no answers and
 * no check, so they answer and check it again. Saved like any change, so
 * the old score is gone from the facilitator and statistics views until
 * the new check. Marked `retaken`: if the saved progress hasn't arrived
 * yet, the saved check mustn't come back over it (mergeAssessment).
 */
export function retakeQuiz(): AssessmentProgress {
  return { answers: {}, checked: false, retaken: true };
}

/**
 * What a save sends: the answers and the check. The `retaken` mark only
 * steers merging on this page, and the server refuses a quick check with
 * anything else in it (parseAssessmentInput).
 */
export function assessmentToSave(a: AssessmentProgress): AssessmentProgress {
  return { answers: a.answers, checked: a.checked };
}

/**
 * Where the learner is with this quiz: has every question one of its own
 * options as an answer, and is it checked? It counts as checked only when
 * every question is answered too: an editor may have added a question, or
 * changed an answer's options, since the learner checked theirs; they then
 * answer what's open and check again.
 */
export function checkedQuiz(
  questions: readonly AssessmentQuestion[],
  a: AssessmentProgress
): { allAnswered: boolean; checked: boolean } {
  const allAnswered = questions.every((q) =>
    q.options.some((o) => o.id === a.answers[q.id])
  );
  return { allAnswered, checked: allAnswered && a.checked };
}

/** Has the learner answered anything in this quiz yet? */
export function hasAssessmentProgress(a: AssessmentProgress): boolean {
  return Object.keys(a.answers).length > 0;
}

/**
 * The quick check from both sides, when the saved progress arrives after
 * the learner has started (see progress-merge.ts): each answer chosen
 * locally, else the saved one. While every local answer matches the saved
 * one, the answers are the ones that were checked, so a check from either
 * side holds. A different local answer opens the quiz again, as it does in
 * answerQuestion: the saved check scored other answers, so only a local
 * check counts — otherwise the player would lock answers nobody checked,
 * and the facilitator and statistics views would score them.
 *
 * A quiz the learner tried again on this page (retakeQuiz) is theirs
 * alone: they set the saved answers and check aside, so neither comes
 * back — not even where an answer chosen since matches a saved one, which
 * would otherwise bring the old check back with it.
 */
export function mergeAssessment(
  local: AssessmentProgress,
  saved: AssessmentProgress
): AssessmentProgress {
  if (local.retaken) return { ...local, answers: { ...local.answers } };
  const changedLocally = Object.entries(local.answers).some(
    ([id, answer]) => saved.answers[id] !== answer
  );
  return {
    answers: { ...saved.answers, ...local.answers },
    checked: changedLocally ? local.checked : local.checked || saved.checked,
  };
}

/**
 * The learner's score in `questions`, for the facilitator and statistics
 * views: of the questions they answered, how many were right. Only once
 * they checked their answers — until then they may still change them —
 * and only for questions the quiz still has.
 */
export function scoreAssessment(
  questions: readonly AssessmentQuestion[],
  a: AssessmentProgress
): { correct: number; total: number } {
  let correct = 0;
  let total = 0;
  if (!a.checked) return { correct, total };
  for (const q of questions) {
    const answer = a.answers[q.id];
    if (answer === undefined) continue;
    total += 1;
    if (answer === q.correctOptionId) correct += 1;
  }
  return { correct, total };
}
