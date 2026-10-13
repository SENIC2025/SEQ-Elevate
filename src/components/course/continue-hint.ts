/**
 * The hint the practice steps show where Continue will appear, while it's
 * hidden: Continue only shows once the learner has answered, and without a
 * word about it a learner who scrolls down finds no way forward. The keys
 * name messages in the "continueHint" namespace.
 *
 * No React: the stages render the message.
 */

export type ContinueHint =
  | "simulation"
  | "scenario"
  | "scenarioFollowup"
  | "assessment";

/**
 * The applied scenario's hint: choose what you would do; then, when that
 * choice has a follow-up question, answer it; null once Continue shows.
 */
export function scenarioContinueHint({
  rootChosen,
  followups,
  followupChosen,
}: {
  rootChosen: boolean;
  /** How many follow-up choices the chosen first choice has. */
  followups: number;
  followupChosen: boolean;
}): "scenario" | "scenarioFollowup" | null {
  if (!rootChosen) return "scenario";
  if (followups > 0 && !followupChosen) return "scenarioFollowup";
  return null;
}
