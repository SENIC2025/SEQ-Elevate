/**
 * Trying a signed-in learner's loads again when they fail.
 *
 * The learner store saves nothing it hasn't loaded first — a save would
 * overwrite what's on the server with what's in memory. So one failed
 * request (a cold start, a dropped connection) must not switch saving off
 * for the rest of the visit: a failed load is tried again after 1 s, 2 s,
 * 4 s and 8 s before the store gives up on it. Meanwhile the learner's
 * progress stays in memory, and it's saved once a try gets through.
 *
 * No React: DemoStateProvider in demo-state.tsx applies it.
 */

/** The wait before each new try, in ms: one more try per entry. */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000];

/**
 * What `load` resolves to, calling it again after each failure, first
 * waiting as long as `delays` says. Rejects with the last failure once the
 * delays are used up, or as soon as `signal` aborts (the component
 * unmounted, the learner opened another course): no try starts after that.
 */
export async function withRetry<T>(
  load: () => Promise<T>,
  {
    signal,
    delays = RETRY_DELAYS_MS,
  }: { signal?: AbortSignal; delays?: readonly number[] } = {}
): Promise<T> {
  for (let retry = 0; ; retry++) {
    if (signal?.aborted) throw signal.reason;
    try {
      return await load();
    } catch (err) {
      if (retry >= delays.length) throw err;
      await wait(delays[retry], signal);
    }
  }
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
