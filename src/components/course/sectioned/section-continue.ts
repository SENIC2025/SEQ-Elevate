/**
 * When a lesson of the editor's sectioned preview may go on (spec 10).
 *
 * Continue is always there and always enabled — unlike the learner
 * player's practice steps, which only show it once answered. Pressing it
 * asks this function: ready, or which part still needs an answer, so the
 * player can take the editor there and say why. The same rule is what
 * Release 2's learner player will use.
 *
 * Required: a practice question answered (one of its own options chosen);
 * a branching scenario's first choice, plus its follow-up when that choice
 * has follow-ups; a quick check whose answers were checked. Text,
 * reflection questions and self-assessment never hold a learner up. A
 * question with nothing to answer (no options, no questions) doesn't
 * either: nobody could get past it.
 *
 * Answers are keyed by partKey (lesson/part), so two quick checks in one
 * lesson never share theirs. Pure, no React.
 */

import { checkedQuiz } from "@/lib/assessment-progress";
import {
  partKey,
  type PartAnswer,
  type ResolvedPart,
  type SectionContinue,
} from "@/lib/cms/sections/contract";

/** Does this part need an answer before the lesson can go on? */
export function partIsRequired(part: ResolvedPart): boolean {
  switch (part.type) {
    case "practice":
      return part.simulation.options.length > 0;
    case "scenario":
      return part.scenario.choices.length > 0;
    case "quiz":
      return part.assessment.questions.length > 0;
    default:
      return false;
  }
}

/** Has `answer` done what `part` needs? Parts that need nothing are always done. */
export function partIsAnswered(part: ResolvedPart, answer: PartAnswer | undefined): boolean {
  if (!partIsRequired(part)) return true;
  switch (part.type) {
    case "practice":
      return (
        answer?.type === "practice" &&
        part.simulation.options.some((o) => o.id === answer.optionId)
      );
    case "scenario": {
      if (answer?.type !== "scenario") return false;
      const root = part.scenario.choices.find((c) => c.id === answer.rootId);
      if (!root) return false;
      const followups = root.followups ?? [];
      return followups.length === 0 || followups.some((c) => c.id === answer.followupId);
    }
    case "quiz":
      return (
        answer?.type === "quiz" &&
        checkedQuiz(part.assessment.questions, answer).checked
      );
    default:
      return true;
  }
}

export const sectionContinueState: SectionContinue = (sectionId, parts, answers) => {
  for (const part of parts) {
    if (!partIsAnswered(part, answers[partKey(sectionId, part.id)])) {
      return { ready: false, firstMissing: part.id };
    }
  }
  return { ready: true };
};
