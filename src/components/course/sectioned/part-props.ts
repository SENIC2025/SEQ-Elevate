/**
 * What every content component of the sectioned view takes. The answer
 * lives in the learner store (keyed by partKey; SectionView reads and
 * writes it), never in the component: it survives the lesson's remount,
 * Back and a reload.
 */
import type { PartAnswer, ResolvedPart } from "@/lib/cms/sections/contract";

/**
 * Where Continue pressed early may take focus inside a part (useContinue),
 * and the note that then describes the place.
 */
export interface PartTargets {
  /** A scenario's follow-up question. */
  followup?: string;
  /** A quick check's question, by its id. */
  question?: (questionId: string) => string;
  /** A quick check's "Check answers". */
  check?: string;
  /**
   * The id of the lesson's hint above Continue, while there is one: what
   * "Check answers" is described by (the hint is said once, there).
   */
  hint?: string;
  /** The note's id for the place with `id`, when Continue marked it. */
  describedBy?: (id: string) => string | undefined;
}

export interface PartProps<T extends ResolvedPart["type"]> {
  part: Extract<ResolvedPart, { type: T }>;
  /** This part's answer so far, if any. */
  answer: PartAnswer | undefined;
  /** Replace this part's answer; undefined: "Try another" — on screen only. */
  onAnswer: (answer: PartAnswer | undefined) => void;
  /** The id of the part's heading (SectionView renders it), for focus. */
  headingId: string;
  targets?: PartTargets;
}
