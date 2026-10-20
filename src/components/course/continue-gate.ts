/**
 * When a lesson's Continue lets the learner through (requirement 4, spec
 * 5.7), and if not, what is missing — for every lesson of the player, both
 * kinds: a lesson drawn by SectionView asks about its pieces of content, a
 * standard lesson drawn by its stage screen about its main content
 * (mainPartOf), under the same rule.
 *
 * Continue is always there and enabled. Pressing it asks this function:
 * ready, or the items still missing in page order, each with what it needs
 * — a practice question an answer, a branching scenario its first choice
 * and then its follow-up, a quick check its unanswered questions and then
 * "Check answers" — so the player can name the item and the need, and take
 * the learner to the exact place.
 *
 * Text, reflection questions and self-assessments never hold a learner up,
 * nor does a question with nothing to answer (no options, no questions):
 * nobody could get past it (the Release 1 preview's rule, which this
 * replaces). A practice question or scenario the learner chose to try
 * again ("Try another", `retrying`) counts as unanswered on this visit —
 * its saved answer stays (D65, owner default 8) — as Release 0's "Try
 * another" did.
 *
 * Pure, no React.
 */

import { checkedQuiz } from "@/lib/assessment-progress";
import {
  MAIN_PART_ID,
  partKey,
  type PartAnswer,
  type PartId,
  type PartKey,
  type ResolvedPart,
  type SectionId,
} from "@/lib/cms/sections/contract";
import type { CourseStage } from "@/lib/cms/types";
import type { StoredAnswer } from "@/lib/learner-progress/contract";

/** What one missing item needs before the lesson can go on. */
export type Need =
  | { kind: "choose" }
  | { kind: "scenarioRoot" }
  | { kind: "scenarioFollowup" }
  /** `first`: the id of the first question still without an answer. */
  | { kind: "quizLeft"; left: number; first: string }
  | { kind: "quizCheck" };

/** One item Continue waits for: which, what it needs, and its name (title, else its kind). */
export interface Missing {
  partId: PartId;
  need: Need;
  item: string;
}

export type ContinueGate = { ready: true } | { ready: false; missing: Missing[] };

/** A lesson's answers by part key: the store's (with `correct`) or the plain kind. */
export type LessonAnswers = Readonly<Partial<Record<PartKey, PartAnswer | StoredAnswer>>>;

/** A part's name as Continue says it: its own title, else its kind (the caller translates kinds). */
export type ItemName = (part: ResolvedPart) => string;
const defaultItem: ItemName = (part) => ("title" in part && part.title) || part.type;

/** What `part` still needs, given its answer; null when nothing (or when it never needs anything). */
export function needOf(
  part: ResolvedPart,
  answer: PartAnswer | StoredAnswer | undefined,
  retrying = false
): Need | null {
  switch (part.type) {
    case "practice": {
      if (part.simulation.options.length === 0) return null;
      const chosen =
        !retrying && answer?.type === "practice" && part.simulation.options.some((o) => o.id === answer.optionId);
      return chosen ? null : { kind: "choose" };
    }
    case "scenario": {
      if (part.scenario.choices.length === 0) return null;
      const picked = !retrying && answer?.type === "scenario" ? answer : undefined;
      const root = part.scenario.choices.find((c) => c.id === picked?.rootId);
      if (!root) return { kind: "scenarioRoot" };
      const followups = root.followups ?? [];
      if (followups.length === 0 || followups.some((c) => c.id === picked?.followupId)) return null;
      return { kind: "scenarioFollowup" };
    }
    case "quiz": {
      const questions = part.assessment.questions;
      if (questions.length === 0) return null;
      const progress =
        answer?.type === "quiz"
          ? { answers: answer.answers, checked: answer.checked }
          : { answers: {} as Record<string, string>, checked: false };
      const open = questions.filter((q) => !q.options.some((o) => o.id === progress.answers[q.id]));
      if (open.length > 0) return { kind: "quizLeft", left: open.length, first: open[0].id };
      return checkedQuiz(questions, progress).checked ? null : { kind: "quizCheck" };
    }
    default:
      return null;
  }
}

/**
 * Ready, or every item of lesson `lessonId` still missing, in page order.
 * `retrying` holds the part keys tried again on this visit.
 */
export function lessonContinue(
  lessonId: SectionId,
  parts: readonly ResolvedPart[],
  answers: LessonAnswers,
  retrying: ReadonlySet<PartKey> = new Set(),
  itemOf: ItemName = defaultItem
): ContinueGate {
  const missing: Missing[] = [];
  for (const part of parts) {
    const key = partKey(lessonId, part.id);
    const need = needOf(part, answers[key], retrying.has(key));
    if (need) missing.push({ partId: part.id, need, item: itemOf(part) });
  }
  return missing.length ? { ready: false, missing } : { ready: true };
}

/**
 * A standard lesson's main content as a piece of content, so its stage
 * screen goes through the same rule: guided practice as a practice
 * question, the applied scenario as a scenario, the quick check as a quick
 * check, the reflection's three questions (p1–p3) as reflection questions,
 * and any other lesson as text. Named by the lesson's title.
 */
export function mainPartOf(stage: CourseStage): ResolvedPart {
  const base = { id: MAIN_PART_ID, title: stage.title } as const;
  if (stage.key === "simulation" && stage.simulation) {
    return {
      ...base,
      type: "practice",
      simulation: {
        prompt: stage.simulation.prompt,
        instruction: stage.simulation.instruction,
        options: stage.simulation.options,
      },
    };
  }
  if (stage.key === "scenario" && stage.scenario) return { ...base, type: "scenario", scenario: stage.scenario };
  if (stage.key === "assessment" && stage.assessment) return { ...base, type: "quiz", assessment: stage.assessment };
  if (stage.key === "reflection" && stage.reflection) {
    return {
      ...base,
      type: "reflection",
      intro: stage.reflection.intro,
      prompts: stage.reflection.prompts.slice(0, 3).map((p, i) => ({
        id: `p${i + 1}`,
        label: p.label,
        placeholder: p.placeholder,
      })),
    };
  }
  return { id: MAIN_PART_ID, type: "text", blocks: stage.blocks ?? [] };
}
