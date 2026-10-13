/**
 * What every content component of the sectioned preview takes. The answer
 * lives in the player (keyed by partKey), never in the component or a
 * store: it survives the lesson's remount and Back, and nothing is saved.
 */
import type { PartAnswer, ResolvedPart } from "@/lib/cms/sections/contract";

export interface PartProps<T extends ResolvedPart["type"]> {
  part: Extract<ResolvedPart, { type: T }>;
  /** This part's answer so far, if any. */
  answer: PartAnswer | undefined;
  /** Replace this part's answer; undefined clears it ("Try again"). */
  onAnswer: (answer: PartAnswer | undefined) => void;
  /** The id of the part's heading (SectionView renders it), for focus. */
  headingId: string;
}
