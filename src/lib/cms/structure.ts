/**
 * Interactive-stage structure for CMS-created courses — the DB equivalent of
 * what src/data/course.ts hardcodes for bundled courses.
 *
 * Pure and unit-tested: no DB, no server-only boundary. The DB read lives in
 * db-course.ts, which calls the resolvers here.
 *
 * DESIGN — why the shape looks like this:
 * The structural facts (which option is correct, a branch's quality) are
 * language-NEUTRAL and stored once. Only the human text is per-locale. That is
 * deliberate: if `isBest` or `correctOptionId` could differ between languages,
 * a translation slip would mis-grade a whole cohort. So each option carries one
 * `isBest`/`quality`/`correctOptionId` and a `{ en, de, el }` text map with
 * fallback. This mirrors the bundled model (structure in code, text in
 * messages) rather than the narrative overlay (independent per-locale copies),
 * because correctness must not drift.
 */

import type {
  Locale,
  OutcomeQuality,
  CourseStage,
  ScenarioChoice,
} from "./types";
import { fallbackOrder, firstText } from "./text-fallback";

export type LocalizedText = Partial<Record<Locale, string>>;

export interface StoredSimOption {
  id: string;
  isBest: boolean;
  text: LocalizedText;
  feedback: LocalizedText;
}
export interface StoredSimulation {
  kind: "simulation";
  /** Stage heading shown above the exercise. */
  title?: LocalizedText;
  prompt: LocalizedText;
  instruction: LocalizedText;
  options: StoredSimOption[];
}

export interface StoredScenarioChoice {
  id: string;
  quality: OutcomeQuality;
  text: LocalizedText;
  outcome: LocalizedText;
  followups?: StoredScenarioChoice[];
}
export interface StoredScenario {
  kind: "scenario";
  /** Stage heading shown above the exercise. */
  title?: LocalizedText;
  setup: LocalizedText;
  question: LocalizedText;
  followupQuestion: LocalizedText;
  choices: StoredScenarioChoice[];
}

export interface StoredAssessmentOption {
  id: string;
  text: LocalizedText;
}
export interface StoredAssessmentQuestion {
  id: string;
  correctOptionId: string;
  question: LocalizedText;
  options: StoredAssessmentOption[];
}
export interface StoredAssessment {
  kind: "assessment";
  /** Stage heading shown above the exercise. */
  title?: LocalizedText;
  intro: LocalizedText;
  questions: StoredAssessmentQuestion[];
}

export type StoredStructure =
  | StoredSimulation
  | StoredScenario
  | StoredAssessment;

/** The three stage keys that carry interactive structure. */
export const STRUCTURE_STAGE_KEYS = [
  "simulation",
  "scenario",
  "assessment",
] as const;
export type StructureStageKey = (typeof STRUCTURE_STAGE_KEYS)[number];

/**
 * Best text for a locale: requested → English → first authored → "". A
 * blank value counts as not written: the editor stores a field typed in and
 * cleared again as "", and learners should get the English, not a blank.
 */
export function pickText(t: LocalizedText | undefined, locale: Locale): string {
  if (!t) return "";
  return (
    firstText(...fallbackOrder(t, locale).map((k) => t[k as Locale])) ?? ""
  );
}

/* --------------------------------- resolve -------------------------------- */

export function resolveSimulation(
  s: StoredSimulation,
  locale: Locale
): NonNullable<CourseStage["simulation"]> {
  return {
    prompt: pickText(s.prompt, locale),
    instruction: pickText(s.instruction, locale),
    options: s.options.map((o) => ({
      id: o.id,
      text: pickText(o.text, locale),
      isBest: o.isBest,
      feedback: pickText(o.feedback, locale),
    })),
  };
}

export function resolveScenario(
  s: StoredScenario,
  locale: Locale
): NonNullable<CourseStage["scenario"]> {
  const toChoice = (c: StoredScenarioChoice): ScenarioChoice => ({
    id: c.id,
    text: pickText(c.text, locale),
    outcome: pickText(c.outcome, locale),
    quality: c.quality,
    followups: c.followups?.map(toChoice),
  });
  return {
    setup: pickText(s.setup, locale),
    question: pickText(s.question, locale),
    followupQuestion: pickText(s.followupQuestion, locale),
    choices: s.choices.map(toChoice),
  };
}

export function resolveAssessment(
  s: StoredAssessment,
  locale: Locale
): NonNullable<CourseStage["assessment"]> {
  return {
    intro: pickText(s.intro, locale),
    questions: s.questions.map((q) => ({
      id: q.id,
      question: pickText(q.question, locale),
      options: q.options.map((o) => ({ id: o.id, text: pickText(o.text, locale) })),
      correctOptionId: q.correctOptionId,
    })),
  };
}

/**
 * Resolve a stored structure into the matching slice of a CourseStage. Returns
 * an empty object for a structure whose kind doesn't match its stage, so a
 * mismatch degrades to "no interactive stage" rather than a crash.
 */
export function resolveStructure(
  structure: StoredStructure,
  locale: Locale
): Pick<CourseStage, "simulation" | "scenario" | "assessment"> {
  switch (structure.kind) {
    case "simulation":
      return { simulation: resolveSimulation(structure, locale) };
    case "scenario":
      return { scenario: resolveScenario(structure, locale) };
    case "assessment":
      return { assessment: resolveAssessment(structure, locale) };
    default:
      return {};
  }
}

/* -------------------------------- validate -------------------------------- */

/**
 * Why a stage isn't ready for learners, as a code plus the numbers that name
 * the exact place (1-based, as the editor numbers them). The editor turns
 * each into a sentence in the author's menu language
 * (messages: exerciseEditor.issues.<code>), so the server never sends
 * English prose a German or Greek editor would have to decode.
 */
export type StructureIssueCode =
  | "simOptionsTooFew"
  | "simBestCount"
  | "simPrompt"
  | "simOptionText"
  | "scenarioChoicesTooFew"
  | "scenarioSetup"
  | "scenarioQuestion"
  | "scenarioChoiceText"
  | "scenarioChoiceOutcome"
  | "scenarioFollowupQuestion"
  | "scenarioFollowupText"
  | "scenarioFollowupOutcome"
  | "assessmentNoQuestions"
  | "assessmentQuestionText"
  | "assessmentAnswersTooFew"
  | "assessmentAnswerText"
  | "assessmentCorrect";

export interface StructureIssue {
  code: StructureIssueCode;
  /** Which option / choice / follow-up / question / answer, counted from 1. */
  params?: Partial<
    Record<"option" | "choice" | "followup" | "question" | "answer", number>
  >;
}

/** The reasons that are about one text box (not about the whole exercise). */
const FIELD_ISSUES: ReadonlySet<StructureIssueCode> = new Set<StructureIssueCode>([
  "simPrompt",
  "simOptionText",
  "scenarioSetup",
  "scenarioQuestion",
  "scenarioFollowupQuestion",
  "scenarioChoiceText",
  "scenarioChoiceOutcome",
  "scenarioFollowupText",
  "scenarioFollowupOutcome",
  "assessmentQuestionText",
  "assessmentAnswerText",
]);

const PLACES = ["option", "choice", "followup", "question", "answer"] as const;

/**
 * Every text box in the editor, by the code that names it: the reasons'
 * codes for the boxes a reason can be about, plus the boxes that may stay
 * blank — which no reason names, but a size limit can (sanitizeStructure).
 */
export type StructureFieldCode =
  | StructureIssueCode
  | "stageTitle"
  | "simInstruction"
  | "simOptionFeedback"
  | "assessmentIntro";

/**
 * A key for one text box in the editor: the reason's code plus where it is.
 * The editor gives each box the key of the reason that would name it, so a
 * refused save can mark exactly those boxes as invalid and each reason can
 * take the author to its box. Letters, digits and "-" only, so it can be
 * part of an element id.
 */
export function fieldKey(
  code: StructureFieldCode,
  params: StructureIssue["params"] = {}
): string {
  return [code, ...PLACES.flatMap((p) => (params[p] ? [`${p}${params[p]}`] : []))].join(
    "-"
  );
}

/** The text box a reason is about, or null when it is about no single box. */
export function issueField(issue: StructureIssue): string | null {
  return FIELD_ISSUES.has(issue.code) ? fieldKey(issue.code, issue.params) : null;
}

/**
 * Has this text been written in at least one language? A box that once held
 * text and was emptied is stored as "" (or spaces), which must count as
 * blank — and must not hide the text another language has.
 */
export function hasText(t: LocalizedText | undefined): boolean {
  return Boolean(
    t &&
      Object.values(t).some((v) => typeof v === "string" && v.trim() !== "")
  );
}

/**
 * Publish-time sanity checks. These guard the learner experience: a simulation
 * with no correct answer, or an assessment question whose "correct" id isn't
 * one of its options, would grade nonsensically; a scenario follow-up with no
 * question or blank buttons leaves the learner stuck mid-branch. Returns []
 * when sound.
 *
 * Text must be present in at least ONE language per field — the resolver falls
 * back across locales, so a single authored language renders; a field blank in
 * every language would show nothing.
 */
export function validateStructure(s: StoredStructure): StructureIssue[] {
  const issues: StructureIssue[] = [];
  const need = (
    t: LocalizedText | undefined,
    code: StructureIssueCode,
    params?: StructureIssue["params"]
  ) => {
    if (!hasText(t)) issues.push(params ? { code, params } : { code });
  };

  if (s.kind === "simulation") {
    if (s.options.length < 2) issues.push({ code: "simOptionsTooFew" });
    if (s.options.filter((o) => o.isBest).length !== 1) {
      issues.push({ code: "simBestCount" });
    }
    need(s.prompt, "simPrompt");
    s.options.forEach((o, i) =>
      need(o.text, "simOptionText", { option: i + 1 })
    );
  }

  if (s.kind === "scenario") {
    if (s.choices.length < 2) issues.push({ code: "scenarioChoicesTooFew" });
    need(s.setup, "scenarioSetup");
    need(s.question, "scenarioQuestion");
    // Learners see the follow-up question only after a choice that has
    // follow-ups (ScenarioStage), so it is needed only then.
    if (s.choices.some((c) => (c.followups ?? []).length > 0)) {
      need(s.followupQuestion, "scenarioFollowupQuestion");
    }
    s.choices.forEach((c, i) => {
      const choice = i + 1;
      need(c.text, "scenarioChoiceText", { choice });
      need(c.outcome, "scenarioChoiceOutcome", { choice });
      (c.followups ?? []).forEach((f, j) => {
        const at = { choice, followup: j + 1 };
        need(f.text, "scenarioFollowupText", at);
        need(f.outcome, "scenarioFollowupOutcome", at);
      });
    });
  }

  if (s.kind === "assessment") {
    if (s.questions.length < 1) issues.push({ code: "assessmentNoQuestions" });
    s.questions.forEach((q, i) => {
      const question = i + 1;
      need(q.question, "assessmentQuestionText", { question });
      if (q.options.length < 2) {
        issues.push({ code: "assessmentAnswersTooFew", params: { question } });
      }
      q.options.forEach((o, j) =>
        need(o.text, "assessmentAnswerText", { question, answer: j + 1 })
      );
      if (!q.options.some((o) => o.id === q.correctOptionId)) {
        issues.push({ code: "assessmentCorrect", params: { question } });
      }
    });
  }

  return issues;
}
