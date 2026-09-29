/**
 * Whose data the learner store holds, and when it has to let go of it.
 *
 * A signed-in learner's store holds their progress, Comp Card and badges.
 * The session can change under it without a page load: they sign out in
 * another tab (next-auth tells every tab), another account signs in there,
 * or the session can't be read for a moment. What's in memory then belongs
 * to no one here. Kept, it would be written to this browser's guest store
 * and from there moved into the next account that signs in, or saved
 * straight into that account.
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
 * Must the store drop what it holds? Only when it holds a signed-in
 * learner's data (`held`, their owner) and the session now belongs to
 * someone else, or to no one. A guest signing in keeps their progress (it
 * moves to the account), and nothing changes while the session loads.
 */
export function mustForget(
  held: string | null | undefined,
  now: string | null | undefined
): boolean {
  return typeof held === "string" && now !== undefined && now !== held;
}

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
