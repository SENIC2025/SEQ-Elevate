/**
 * Signing out from the header (D68).
 *
 * A change waits out a short pause (~0.7 s) before its save is sent, and
 * Next sends a page's server actions one at a time, so a save may wait
 * behind another. Signed out at once, the session would be gone before
 * those saves reach the server, which refuses a save without one. So
 * signing out first sends every course and Comp Card save still waiting
 * and waits for them, and for the save on its way, up to SIGN_OUT_WAIT_MS
 * (settleWithin); then it signs out, whether or not they were all
 * answered. From then on nothing of the learner stays in the tab: every
 * outbox entry is cleared, the page's pagehide keeps nothing more and a
 * late answer keeps nothing (demo-state.tsx).
 *
 * No React: DemoStateProvider in demo-state.tsx applies it.
 */

import { clearEveryOutbox } from "./outbox";
import { settleWithin, type PendingSave } from "./pending-save";

/** How long signing out waits for the saves waiting and those on their way. */
export const SIGN_OUT_WAIT_MS = 3000;

export interface SignOutDeps {
  /** The store's debounced saves: the course's and the Comp Card's. */
  saves: readonly PendingSave[];
  /**
   * The sign-out goes ahead (true): from now on the page keeps nothing of
   * the learner in the tab. False when it failed, and the learner is still
   * signed in.
   */
  signingOut(on: boolean): void;
  /** The tab's sessionStorage, whose outbox entries are all cleared; null where there is none. */
  outbox: Pick<Storage, "length" | "key" | "removeItem"> | null;
  /** next-auth's signOut: the session ends, and the page goes. */
  signOut(): Promise<unknown>;
  waitMs?: number;
}

/**
 * The saves first, then the sign-out. Resolves with true when no save was
 * left when the sign-out went ahead, false when the wait ran out first.
 * Throws what signOut throws (the learner is then still signed in).
 */
export async function signOutAfterSaves(deps: SignOutDeps): Promise<boolean> {
  const nothingLeft = await settleWithin(deps.saves, deps.waitMs ?? SIGN_OUT_WAIT_MS);
  deps.signingOut(true);
  clearEveryOutbox(deps.outbox);
  try {
    await deps.signOut();
  } catch (err) {
    deps.signingOut(false);
    throw err;
  }
  return nothingLeft;
}
