"use client";

import { useCallback } from "react";
import { useDemoState } from "@/store/demo-state";
import type { PartKey } from "@/lib/cms/sections/contract";
import type { KeyRefusal, StoredAnswer } from "@/lib/learner-progress/contract";
import { answersOf } from "@/lib/learner-progress/answers";
import type { LessonAnswers } from "./continue-gate";

/**
 * A lesson's answers as the sectioned view reads and writes them (spec
 * 5.3–5.4): every answer of the course by part key, whichever field of the
 * learner store it lives in (answersOf: the four standard answers in their
 * Release 0 fields, everything else in `responses`), and an `answer` that
 * puts one back there (answerPart). The store is the learner's — saved to
 * their account, or this browser's for a guest — or, in an editor's
 * preview, the preview's own, which saves nothing.
 *
 * `labels` are a scenario's choice texts, which the Comp Card and the
 * facilitator show as evidence (scenario/main only). `refused` holds the
 * keys the server refused, or the store holds back (progressRefused).
 */
export function useLessonAnswers(): {
  answers: LessonAnswers;
  answer: (key: PartKey, answer: StoredAnswer, labels?: { root?: string | null; followup?: string | null }) => void;
  refused: Partial<Record<string, KeyRefusal>>;
} {
  const { state, dispatch } = useDemoState();
  const answer = useCallback(
    (key: PartKey, a: StoredAnswer, labels?: { root?: string | null; followup?: string | null }) =>
      dispatch({ type: "answerPart", key, answer: a, ...(labels ? { labels } : {}) }),
    [dispatch]
  );
  return { answers: answersOf(state.course), answer, refused: state.refusedKeys ?? {} };
}
