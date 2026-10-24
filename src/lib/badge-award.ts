/**
 * What awarding a badge answers (awardBadgeAction).
 *
 * Two kinds of failure need telling apart. A thrown error (a dropped
 * connection, a session lookup that failed) may go away, so the learner
 * store and the guest migration try the award again (retry.ts). A refusal
 * can't: the project has no Badge row for the slug, the award was meant
 * for another account than the one signed in, or the person's profile step
 * isn't done (D79). Trying that again only holds up the learner's data for
 * about 15 s, so it's answered, not thrown, and the callers leave the badge
 * unsaved: they log it once, or, before the profile step is done, the page
 * says so, as for a refused save.
 *
 * Pure, so the callers' handling can be tested without a server.
 */

export type BadgeAwardResult =
  | { ok: true }
  /**
   * not-finished: under R2_LEARNER_PLAYER=off, the badge of a course whose
   * lessons the Release 1 view doesn't hold, which the learner hasn't
   * finished as the server counts it (learner.ts completionStands).
   * profile-incomplete: the person's profile step isn't done (D79; a page
   * loaded before the Terms changed or before Release 3).
   */
  | { ok: false; reason: "no-badge" | "other-account" | "not-finished" | "profile-incomplete" };

/** Did the server answer the award with a refusal that a retry won't fix? */
export function isRefusedAward(
  result: unknown
): result is Extract<BadgeAwardResult, { ok: false }> {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { ok?: unknown }).ok === false
  );
}
