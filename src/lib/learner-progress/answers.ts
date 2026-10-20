/**
 * A learner's answers as the players read and write them (spec 5.4): one
 * map by PartKey, whichever field each answer lives in.
 *
 * The four standard answers keep the store's Release 0 fields (simulation,
 * scenario, reflection p1–p3, assessment), which the stage screens, the
 * Comp Card and Release 1's save action read; everything else is in
 * `responses`. answersOf builds the one map from both, withAnswer puts an
 * answer back where it lives (D56: one home each), and completeLesson keeps
 * the course's own lessons out of stagesCompleted, so Release 1's enum cast
 * never meets one after a rollback.
 *
 * Pure and client-safe; the learner store dispatches through these.
 */

import { assessmentToSave } from "@/lib/assessment-progress";
import {
  isCustomSectionId,
  isLegacySectionId,
  type PartKey,
  type SectionId,
} from "@/lib/cms/sections/contract";
import { LEGACY_PROMPT_IDS, type ProgressState, type StoredAnswer } from "./contract";

type Quiz = Extract<StoredAnswer, { type: "quiz" }> | { answers: Record<string, string>; checked: boolean };

/**
 * A quick check's next value. A checked one going back to nothing is "Try
 * again" (retakeQuiz): marked, so the saved check can't come back over it
 * when saved progress arrives (mergeAssessment); the mark stays while it
 * is answered again.
 */
function quizValue(
  before: (Quiz & { retaken?: true }) | undefined,
  answers: Record<string, string>,
  checked: boolean
) {
  const retaken =
    before?.retaken === true || (before?.checked === true && !checked && Object.keys(answers).length === 0);
  return { answers: { ...answers }, checked, ...(retaken ? { retaken: true as const } : {}) };
}

/** Every answer of the course, by PartKey, for the players. */
export function answersOf(p: ProgressState): Partial<Record<PartKey, StoredAnswer>> {
  const out: Partial<Record<PartKey, StoredAnswer>> = {};
  if (p.simulation) {
    out["simulation/main"] = { type: "practice", optionId: p.simulation.choice, correct: p.simulation.correct };
  }
  if (p.scenario.root) {
    out["scenario/main"] = {
      type: "scenario",
      rootId: p.scenario.root,
      ...(p.scenario.followup ? { followupId: p.scenario.followup } : {}),
    };
  }
  if (LEGACY_PROMPT_IDS.some((id) => p.reflection[id] !== "")) {
    out["reflection/main"] = { type: "reflection", text: { ...p.reflection } };
  }
  if (Object.keys(p.assessment.answers).length > 0 || p.assessment.checked) {
    out["assessment/main"] = { type: "quiz", ...assessmentToSave(p.assessment) };
  }
  for (const [key, answer] of Object.entries(p.responses) as [PartKey, StoredAnswer & { retaken?: true }][]) {
    if (!answer) continue;
    if (answer.type === "quiz") {
      out[key] = { type: "quiz", answers: answer.answers, checked: answer.checked };
    } else {
      out[key] = answer;
    }
  }
  return out;
}

/**
 * `p` with `answer` to `key`, where it lives. A practice, scenario or quick
 * check replaces the one before; a reflection or rating is merged question
 * by question. `labels` are a scenario's choice texts, kept for the Comp
 * Card and the facilitator's evidence. An answer of the wrong type under a
 * standard key changes nothing.
 */
export function withAnswer<T extends ProgressState>(
  p: T,
  key: PartKey,
  answer: StoredAnswer,
  labels?: { root?: string | null; followup?: string | null }
): T {
  switch (key) {
    case "simulation/main":
      if (answer.type !== "practice") return p;
      return { ...p, simulation: { choice: answer.optionId, correct: answer.correct } };
    case "scenario/main": {
      if (answer.type !== "scenario") return p;
      const sameRoot = p.scenario.root === answer.rootId;
      const followup = answer.followupId ?? null;
      const sameFollowup = sameRoot && followup !== null && p.scenario.followup === followup;
      return {
        ...p,
        scenario: {
          root: answer.rootId,
          followup,
          rootLabel: labels?.root ?? (sameRoot ? (p.scenario.rootLabel ?? null) : null),
          followupLabel:
            followup === null ? null : (labels?.followup ?? (sameFollowup ? (p.scenario.followupLabel ?? null) : null)),
        },
      };
    }
    case "reflection/main": {
      if (answer.type !== "reflection") return p;
      const reflection = { ...p.reflection };
      for (const id of LEGACY_PROMPT_IDS) {
        if (typeof answer.text[id] === "string") reflection[id] = answer.text[id];
      }
      return { ...p, reflection };
    }
    case "assessment/main":
      if (answer.type !== "quiz") return p;
      return { ...p, assessment: quizValue(p.assessment, answer.answers, answer.checked) };
  }

  const before = p.responses[key];
  let next: StoredAnswer & { retaken?: true };
  if (answer.type === "quiz") {
    next = { type: "quiz", ...quizValue(before?.type === "quiz" ? before : undefined, answer.answers, answer.checked) };
  } else if (answer.type === "reflection") {
    next = { type: "reflection", text: { ...(before?.type === "reflection" ? before.text : {}), ...answer.text } };
  } else if (answer.type === "rating") {
    next = { type: "rating", values: { ...(before?.type === "rating" ? before.values : {}), ...answer.values } };
  } else {
    next = { ...answer };
  }
  return { ...p, responses: { ...p.responses, [key]: next } };
}

/**
 * `p` with lesson `id` finished: a standard one in stagesCompleted, one of
 * the course's own in sectionsCompleted. The same object when it already
 * was, or `id` is no lesson.
 */
export function completeLesson<T extends ProgressState>(p: T, id: SectionId): T {
  if (isLegacySectionId(id)) {
    return p.stagesCompleted.includes(id) ? p : { ...p, stagesCompleted: [...p.stagesCompleted, id] };
  }
  if (isCustomSectionId(id)) {
    return p.sectionsCompleted.includes(id) ? p : { ...p, sectionsCompleted: [...p.sectionsCompleted, id] };
  }
  return p;
}
