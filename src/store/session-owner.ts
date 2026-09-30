/**
 * Whose data the learner store holds, and when it has to let go of it.
 *
 * A signed-in learner's store holds their progress, Comp Card and badges.
 * The session can change under it without a page load: they sign out in
 * another tab (next-auth tells every tab), another account signs in there,
 * or the session can't be read for a moment. What's in memory then may
 * belong to no one here. Kept, it would be written to this browser's guest
 * store and from there moved into the next account that signs in, or saved
 * straight into that account.
 *
 * But a session that can't be read looks just like a sign-out: Auth.js
 * answers "no session" when its database lookup fails (a cold start, a
 * dropped connection) and next-auth does on a network error, and every
 * tab reads its session again whenever another one opens. Letting go of
 * the learner's data then would lose what they did that isn't saved yet —
 * everything, while their data is still loading. So the store only holds
 * on to it (nothing saved, nothing written to the guest store) and reads
 * the session again; it lets go once the learner is still signed out, or
 * as soon as another account signs in.
 *
 * No React: DemoStateProvider in demo-state.tsx applies it.
 */

import type { DemoState } from "./demo-state";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

/**
 * The owner of the data the session gives the store: the signed-in
 * learner's id (their email if a session had no id), null for a guest,
 * undefined while the session loads — not known yet.
 */
export function sessionOwner(
  status: SessionStatus,
  user: { id?: string | null; email?: string | null } | null | undefined
): string | null | undefined {
  if (status === "loading") return undefined;
  if (status === "unauthenticated") return null;
  return user?.id ?? user?.email ?? "";
}

/**
 * What the store does with what it holds (`held`, its owner) when the
 * session's owner is `now`:
 *
 * - "keep": nothing changes — the same learner, a guest signing in (their
 *   progress moves to the account), or the session still loading;
 * - "hold": a signed-in learner's session can't be read now — signed out,
 *   or the lookup failed for a moment. Their data is held (nothing saved
 *   meanwhile, nothing written to the guest store) while the session is
 *   read again (SESSION_RECHECK_MS), and let go of if it still finds no
 *   one;
 * - "forget": another account has signed in: let go of it now.
 */
export function sessionChange(
  held: string | null | undefined,
  now: string | null | undefined
): "keep" | "hold" | "forget" {
  if (typeof held !== "string" || now === undefined || now === held) {
    return "keep";
  }
  return now === null ? "hold" : "forget";
}

/**
 * The waits, in ms, before each new read of a session that couldn't be
 * read ("hold"): the learner's data is let go of once none of them finds
 * anyone signed in, about 3 s after it was lost.
 */
export const SESSION_RECHECK_MS: readonly number[] = [1000, 2000];

/**
 * The store once it has let go of a learner's data (`blank` is the empty
 * store): none of their progress, answers, badges or Comp Card is left. The
 * course being played stays open — its slug and title, so what's done next
 * is recorded against it — and so do the project and the demo role, which
 * aren't the learner's.
 */
export function forgetLearner(state: DemoState, blank: DemoState): DemoState {
  return {
    ...blank,
    projectId: state.projectId,
    role: state.role,
    course: {
      ...blank.course,
      courseSlug: state.course.courseSlug,
      courseTitle: state.course.courseTitle,
    },
  };
}
