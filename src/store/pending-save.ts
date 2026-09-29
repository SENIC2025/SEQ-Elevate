/**
 * The learner store's debounced saves.
 *
 * A save is sent once the learner pauses, not on every keystroke, and a
 * newer save replaces the one still waiting. What's waiting must not be
 * lost when the learner moves on, though: flush() sends it at once (another
 * course opened, whose first save would replace it; the store unmounting),
 * and only drop() forgets it — for a save that may no longer be sent, the
 * session having changed hands.
 *
 * No React: DemoStateProvider in demo-state.tsx applies it.
 */

export interface PendingSave {
  /** Sends `save` once `delayMs` pass without another schedule(). */
  schedule(save: () => void): void;
  /** Sends the waiting save now, if there is one. */
  flush(): void;
  /** Forgets the waiting save: it's never sent. */
  drop(): void;
}

export function pendingSave(delayMs: number): PendingSave {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting: (() => void) | null = null;
  const drop = () => {
    clearTimeout(timer);
    timer = undefined;
    waiting = null;
  };
  const flush = () => {
    const save = waiting;
    drop();
    save?.();
  };
  return {
    schedule(save) {
      drop();
      waiting = save;
      timer = setTimeout(flush, delayMs);
    },
    flush,
    drop,
  };
}
