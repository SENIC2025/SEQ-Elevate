/**
 * What awarding a badge answers (awardBadgeAction).
 *
 * Two kinds of failure need telling apart. A thrown error (a dropped
 * connection, a session lookup that failed) may go away, so the learner
 * store and the guest migration try the award again (retry.ts). A refusal
 * can't: the project has no Badge row for the slug, or the award was meant
 * for another account than the one signed in. Trying that again only
 * holds up the learner's data for about 15 s, so it's answered, not thrown,
 * and the callers log it once and leave the badge unsaved.
 *
 * Pure, so the callers' handling can be tested without a server.
 */

export type BadgeAwardResult =
  | { ok: true }
  | { ok: false; reason: "no-badge" | "other-account" };

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
