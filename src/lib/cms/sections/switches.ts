/**
 * Release 2's kill switches (spec 3.4): server environment variables,
 * unset by default, for a bad day after the deploy — before, or instead
 * of, rolling back.
 *
 *   R2_LEARNER_PLAYER=off  every lesson plan is built as Release 1 built
 *                          it (lessonPlanOf's legacyOnly): learners and
 *                          preview get exactly the Release 1 learner view,
 *                          and counting follows, being done by the same
 *                          plans. Saves go on; own-lesson answers stay
 *                          where they are. Also turns the publish guard on.
 *   R2_PUBLISH_GUARD=on    publishing re-applies Release 1's newOnlyReasons
 *                          (D57), audited as before, without touching the
 *                          player.
 *
 * Read on every call, so a changed variable takes effect on the next
 * request of a redeploy. Server-side only: the browser has no such
 * variables.
 */

type Env = Record<string, string | undefined>;

const is = (value: string | undefined, expected: string) => value?.trim().toLowerCase() === expected;

/** R2_LEARNER_PLAYER=off: learners get the Release 1 view of every course. */
export function learnerPlayerOff(env: Env = process.env): boolean {
  return is(env.R2_LEARNER_PLAYER, "off");
}

/** Publishing refuses what Release 1 refused: R2_PUBLISH_GUARD=on, or the player switched off. */
export function publishGuardOn(env: Env = process.env): boolean {
  return is(env.R2_PUBLISH_GUARD, "on") || learnerPlayerOff(env);
}
