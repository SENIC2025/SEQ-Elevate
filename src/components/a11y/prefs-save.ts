/**
 * The reading-help settings' save to the account.
 *
 * Sent once the user pauses, not on every click: a newer save replaces the
 * one still waiting. A save that fails (a dropped connection, a session
 * lookup that failed for a moment) is tried again, like the loads (see
 * src/store/retry.ts) — until a newer save is sent, which replaces it, or
 * it's dropped. drop() is for a save that may no longer be sent at all: the
 * session changed hands, and the cookie may already be someone else's.
 *
 * No React: AccessibilityProvider applies it.
 */

import { RETRY_DELAYS_MS, withRetry } from "@/store/retry";

/** A save: `send` makes one try; `onGiveUp` hears that every try failed. */
export interface Save {
  send: () => Promise<unknown>;
  onGiveUp?: (err: unknown) => void;
}

export interface PrefsSave {
  /**
   * Sends `save` once `delayMs` pass without another schedule(); until
   * then it replaces the save waiting, if there is one. `onGiveUp` isn't
   * called for a save replaced or dropped.
   */
  schedule(save: Save): void;
  /**
   * Sends the waiting save now, if there is one: it replaces the save
   * still being tried, which isn't tried again.
   */
  flush(): void;
  /** Forgets the waiting save; a save already sent is still tried. */
  cancel(): void;
  /** Forgets the waiting save, and no try of a sent one starts after this. */
  drop(): void;
}

export function prefsSave(
  delayMs: number,
  { delays = RETRY_DELAYS_MS }: { delays?: readonly number[] } = {}
): PrefsSave {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting: Save | null = null;
  // The save sent last, while it's still being tried.
  let sending: AbortController | null = null;

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    waiting = null;
  };
  const stopSending = () => {
    sending?.abort();
    sending = null;
  };
  const flush = () => {
    const save = waiting;
    cancel();
    if (!save) return;
    stopSending();
    const abort = new AbortController();
    sending = abort;
    // withRetry makes the first try at once, before this returns.
    withRetry(save.send, { signal: abort.signal, delays }).then(
      () => {
        if (sending === abort) sending = null;
      },
      (err) => {
        if (sending === abort) sending = null;
        if (!abort.signal.aborted) save.onGiveUp?.(err);
      }
    );
  };

  return {
    schedule(save) {
      cancel();
      waiting = save;
      timer = setTimeout(flush, delayMs);
    },
    flush,
    cancel,
    drop() {
      cancel();
      stopSending();
    },
  };
}
