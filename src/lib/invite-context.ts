/**
 * The "an admin is inviting this address right now" signal (D27).
 *
 * Auth.js exposes every configured provider at /api/auth/signin/<id>, so the
 * invitation provider is reachable from the internet. It must only ever send
 * a link when an ADMIN-gated server action is inviting exactly that address.
 * That action runs signIn() inside withInviteIntent(); Auth.js's callbacks run
 * in the same async context, so auth.ts can check currentInviteIntent() before
 * any token is created or email sent. A public request carries no intent and
 * is refused. No database state, nothing to forge.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { InviteCopy } from "./invite-email";

/** Auth.js provider id for invitation emails. */
export const INVITE_PROVIDER = "invite";

/**
 * How long an invitation link works. People open invitations days later, so
 * this is longer than a normal sign-in link (which keeps Auth.js's 24 hours).
 */
export const INVITE_VALID_DAYS = 7;

export interface InviteIntent {
  /** Lower-cased address being invited. */
  email: string;
  /** Localised email copy, rendered once Auth.js has built the link. */
  copy: InviteCopy;
}

const intents = new AsyncLocalStorage<InviteIntent>();

/** Run `fn` with an admin-initiated invitation in scope. */
export function withInviteIntent<T>(
  intent: InviteIntent,
  fn: () => Promise<T>
): Promise<T> {
  return intents.run(intent, fn);
}

/** The invitation being sent in the current async context, if any. */
export function currentInviteIntent(): InviteIntent | undefined {
  return intents.getStore();
}
