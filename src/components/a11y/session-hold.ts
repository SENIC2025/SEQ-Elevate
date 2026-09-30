/**
 * Whose reading-help settings the provider holds, and when it lets go.
 *
 * A signed-in user's settings are saved on their account. The session can
 * change under the page without a page load: they sign out in another tab
 * (next-auth tells every tab), another account signs in there, or the
 * session can't be read for a moment. Those last two look the same:
 * Auth.js answers "no session" when its database lookup fails (a cold
 * start, a dropped connection), next-auth does on a network error, and
 * every tab reads its session again whenever another tab opens. Letting go
 * of the account's settings on the first "no session" dropped the change
 * still waiting to be saved, and once the account was found again its
 * saved settings loaded back over the change. So the provider holds on to
 * them and reads the session again: it lets go once that still finds no
 * one, or as soon as another account signs in — as the learner store does
 * with a learner's progress.
 *
 * No React: AccessibilityProvider applies it.
 */

/**
 * What the provider does when the session's owner (see sessionOwner in
 * src/store/session-owner.ts: an account, null for a guest, undefined
 * while the session loads) goes from `held`, whose settings it holds, to
 * `now`:
 *
 * - "keep": there's nothing to let go of — the same owner, the session
 *   still loading, or the first owner it finds;
 * - "hold": an account's session finds no one now — signed out, or a
 *   lookup that failed for a moment. Its settings are held while the
 *   session is read again (SESSION_RECHECK_MS);
 * - "change": another owner — someone signed in, or another account in
 *   place of this one. The provider starts over for them.
 */
export function ownerChange(
  held: string | null | undefined,
  now: string | null | undefined
): "keep" | "hold" | "change" {
  if (now === undefined || held === undefined || now === held) return "keep";
  return typeof held === "string" && now === null ? "hold" : "change";
}

/**
 * The waits, in ms, before each new read of a session that couldn't be
 * read ("hold"): the account's settings are let go of once none of them
 * finds anyone signed in, about 3 s after it was lost.
 */
export const SESSION_RECHECK_MS: readonly number[] = [1000, 2000];

/**
 * Whether `read` finds someone signed in on one of its tries, one made
 * after each wait in `delays`: false once none has. A try that fails finds
 * no one. Rejects as soon as `signal` aborts (the session changed
 * meanwhile): no try starts after that, and what one finds is dropped.
 */
export async function signedInAgain(
  read: () => Promise<boolean>,
  {
    signal,
    delays = SESSION_RECHECK_MS,
  }: { signal?: AbortSignal; delays?: readonly number[] } = {}
): Promise<boolean> {
  for (const ms of delays) {
    await wait(ms, signal);
    let found = false;
    try {
      found = await read();
    } catch {
      /* no one found, this time */
    }
    if (signal?.aborted) throw signal.reason;
    if (found) return true;
  }
  return false;
}

/** Resolves after `ms`, or rejects as soon as `signal` aborts. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
