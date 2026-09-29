/**
 * The learner store's debounced saves.
 *
 * A save is sent once the learner pauses, not on every keystroke, and a
 * newer save replaces the one still waiting. What's waiting must not be
 * lost when the learner moves on, though: flush() sends it at once (another
 * course opened, whose first save would replace it; the session can't be
 * read for a moment), and only drop() forgets it — for a save that may no
 * longer be sent, the learner's data having been let go of.
 *
 * A save that fails — a dropped connection, or a session lookup that
 * failed (the save actions fail rather than answer "saved": see
 * requireLearner in src/app/actions/learner.ts) — is tried again after
 * 1 s, 2 s, 4 s and 8 s (retry.ts), unless a newer save of the same thing
 * (`key`: the course) has been scheduled since: that one holds everything
 * the failed one did, so an older save is never sent after it. drop()
 * stops every retry, and close() — the store going away — sends what's
 * waiting and every retry at once, and tries nothing again after.
 *
 * No React: DemoStateProvider in demo-state.tsx applies it.
 */

import { RETRY_DELAYS_MS } from "./retry";

export interface PendingSave {
  /**
   * Sends `save` once `delayMs` pass without another schedule(). `key`
   * names what it saves (a course's slug): a newer save of the same key
   * replaces a failed one waiting to be tried again.
   */
  schedule(save: () => Promise<unknown>, key?: string): void;
  /** Sends the waiting save now, if there is one. */
  flush(): void;
  /** Forgets the waiting save and stops every retry: none is ever sent. */
  drop(): void;
  /**
   * The store is going away: the waiting save and every retry are sent now
   * — before a store mounted next loads them back — and none of them is
   * tried again after.
   */
  close(): void;
}

export function pendingSave(
  delayMs: number,
  retryDelays: readonly number[] = RETRY_DELAYS_MS
): PendingSave {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting: (() => void) | null = null;
  // Every save gets a number, and each key remembers its newest one's: a
  // failed save is tried again only while it's still its key's newest.
  // drop() forgets them all, so nothing sent before is tried again.
  let count = 0;
  const newest = new Map<string, number>();
  // Failed saves waiting out their delay, by their timer.
  const retries = new Map<ReturnType<typeof setTimeout>, () => void>();

  const isNewest = (key: string, n: number) => newest.get(key) === n;

  const send = (
    save: () => Promise<unknown>,
    key: string,
    n: number,
    attempt: number
  ) => {
    let sent: Promise<unknown>;
    try {
      sent = Promise.resolve(save());
    } catch (err) {
      sent = Promise.reject(err);
    }
    sent.catch((err: unknown) => {
      if (!isNewest(key, n)) return;
      if (attempt >= retryDelays.length) {
        console.error("A save kept failing; it isn't tried again.", err);
        return;
      }
      const retry = () => {
        clearTimeout(retryTimer);
        retries.delete(retryTimer);
        if (isNewest(key, n)) send(save, key, n, attempt + 1);
      };
      const retryTimer = setTimeout(retry, retryDelays[attempt]);
      retries.set(retryTimer, retry);
    });
  };

  const clearWaiting = () => {
    clearTimeout(timer);
    timer = undefined;
    waiting = null;
  };
  const flush = () => {
    const sendNow = waiting;
    clearWaiting();
    sendNow?.();
  };

  return {
    schedule(save, key = "") {
      clearWaiting();
      const n = ++count;
      newest.set(key, n);
      waiting = () => send(save, key, n, 0);
      timer = setTimeout(flush, delayMs);
    },
    flush,
    drop() {
      clearWaiting();
      newest.clear();
      for (const retryTimer of retries.keys()) clearTimeout(retryTimer);
      retries.clear();
    },
    close() {
      flush();
      for (const retry of [...retries.values()]) retry();
      // Sent: none of them is tried again. A save scheduled after this is
      // handled as usual (React may mount the store again).
      newest.clear();
    },
  };
}
