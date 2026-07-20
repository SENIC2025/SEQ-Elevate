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

/** Best text for a locale: requested → English → first authored → "". */
export function pickText(t: LocalizedText | undefined, locale: Locale): string {
  if (!t) return "";
  return t[locale] ?? t.en ?? Object.values(t).find(Boolean) ?? "";
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

export interface StructureIssue {
  message: string;
}

/**
 * Publish-time sanity checks. These guard the learner experience: a simulation
 * with no correct answer, or an assessment question whose "correct" id isn't
 * one of its options, would grade nonsensically. Returns [] when sound.
 *
 * Text must be present in at least ONE language per field — the resolver falls
 * back across locales, so a single authored language renders; a field blank in
 * every language would show nothing.
 */
export function validateStructure(
  s: StoredStructure,
  defaultLocale: Locale = "en"
): StructureIssue[] {
  const issues: StructureIssue[] = [];
  const need = (t: LocalizedText | undefined, what: string) => {
    if (!pickText(t, defaultLocale).trim()) {
      issues.push({ message: `${what} needs text in at least one language.` });
    }
  };

  if (s.kind === "simulation") {
    if (s.options.length < 2) {
      issues.push({ message: "A simulation needs at least two options." });
    }
    if (s.options.filter((o) => o.isBest).length !== 1) {
      issues.push({ message: "Mark exactly one option as the best response." });
    }
    need(s.prompt, "The simulation prompt");
    s.options.forEach((o, i) => need(o.text, `Option ${i + 1}`));
  }

  if (s.kind === "scenario") {
    if (s.choices.length < 2) {
      issues.push({ message: "A scenario needs at least two first choices." });
    }
    need(s.setup, "The scenario setup");
    need(s.question, "The scenario question");
    s.choices.forEach((c, i) => {
      need(c.text, `Choice ${i + 1}`);
      need(c.outcome, `Choice ${i + 1}'s outcome`);
    });
  }

  if (s.kind === "assessment") {
    if (s.questions.length < 1) {
      issues.push({ message: "An assessment needs at least one question." });
    }
    s.questions.forEach((q, i) => {
      need(q.question, `Question ${i + 1}`);
      if (q.options.length < 2) {
        issues.push({ message: `Question ${i + 1} needs at least two answers.` });
      }
      if (!q.options.some((o) => o.id === q.correctOptionId)) {
        issues.push({
          message: `Question ${i + 1}: mark which answer is correct.`,
        });
      }
    });
  }

  return issues;
}
