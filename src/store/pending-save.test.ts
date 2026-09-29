import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { pendingSave } from "./pending-save";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A save that succeeds. */
const ok = () => vi.fn(async () => undefined);

/** A save that fails its first `times` tries, then succeeds. */
const failing = (times: number) => {
  let tries = 0;
  return vi.fn(async () => {
    if (++tries <= times) throw new Error("no session");
  });
};

describe("pendingSave", () => {
  it("sends a save once the delay has passed, not before", () => {
    const saves = pendingSave(700);
    const save = ok();
    saves.schedule(save);

    vi.advanceTimersByTime(699);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("replaces a waiting save with a newer one, and waits again", () => {
    const saves = pendingSave(700);
    const older = ok();
    const newer = ok();
    saves.schedule(older);
    vi.advanceTimersByTime(500);
    saves.schedule(newer);

    vi.advanceTimersByTime(699);
    expect(newer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(older).not.toHaveBeenCalled();
    expect(newer).toHaveBeenCalledTimes(1);
  });

  it("flush sends the waiting save at once, and only once", () => {
    const saves = pendingSave(700);
    const save = ok();
    saves.schedule(save);

    saves.flush();
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    saves.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps one course's last change when the next course's first save follows the flush", async () => {
    const saves = pendingSave(700);
    const sent: string[] = [];
    saves.schedule(async () => void sent.push("course A, last change"), "a");
    // The learner opens course B before the delay is up.
    saves.flush();
    saves.schedule(async () => void sent.push("course B, merged on load"), "b");
    await vi.advanceTimersByTimeAsync(700);

    expect(sent).toEqual(["course A, last change", "course B, merged on load"]);
  });

  it("flush does nothing when nothing is waiting", () => {
    const saves = pendingSave(700);
    expect(() => saves.flush()).not.toThrow();
  });

  it("drop forgets the waiting save: it's never sent", () => {
    const saves = pendingSave(700);
    const save = ok();
    saves.schedule(save);

    saves.drop();
    vi.advanceTimersByTime(10_000);
    saves.flush();
    expect(save).not.toHaveBeenCalled();
  });

  describe("a save that fails", () => {
    beforeEach(() => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    it("is tried again after 1 s, 2 s, 4 s and 8 s, until it gets through", async () => {
      const saves = pendingSave(700);
      const save = failing(3);
      saves.schedule(save);

      await vi.advanceTimersByTimeAsync(700);
      expect(save).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(999);
      expect(save).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(save).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2000);
      expect(save).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(4000);
      expect(save).toHaveBeenCalledTimes(4); // got through
      await vi.advanceTimersByTimeAsync(60_000);
      expect(save).toHaveBeenCalledTimes(4);
      expect(console.error).not.toHaveBeenCalled();
    });

    it("gives up once the delays are used up, and says so", async () => {
      const saves = pendingSave(700);
      const save = failing(100);
      saves.schedule(save);

      await vi.advanceTimersByTimeAsync(700 + 1000 + 2000 + 4000 + 8000);
      expect(save).toHaveBeenCalledTimes(5);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(save).toHaveBeenCalledTimes(5);
      expect(console.error).toHaveBeenCalledTimes(1);
    });

    it("is tried again when it throws at once, too", async () => {
      const saves = pendingSave(700);
      let tries = 0;
      const save = vi.fn(() => {
        if (++tries === 1) throw new Error("thrown");
        return Promise.resolve();
      });
      saves.schedule(save);

      await vi.advanceTimersByTimeAsync(700 + 1000);
      expect(save).toHaveBeenCalledTimes(2);
    });

    it("isn't sent again once a newer save of the same thing is scheduled: that one holds all of it", async () => {
      const saves = pendingSave(700);
      const older = failing(100);
      const newer = ok();
      saves.schedule(older, "course-a");
      await vi.advanceTimersByTimeAsync(700); // sent, failed: retry in 1 s
      saves.schedule(newer, "course-a");

      await vi.advanceTimersByTimeAsync(30_000);
      expect(older).toHaveBeenCalledTimes(1);
      expect(newer).toHaveBeenCalledTimes(1);
    });

    it("is still tried again when another course's save follows it", async () => {
      const saves = pendingSave(700);
      const courseA = failing(1);
      const courseB = ok();
      saves.schedule(courseA, "course-a");
      saves.flush(); // the learner opened course B
      await vi.advanceTimersByTimeAsync(0); // A failed: retry in 1 s
      saves.schedule(courseB, "course-b");

      await vi.advanceTimersByTimeAsync(1000);
      expect(courseA).toHaveBeenCalledTimes(2);
      expect(courseB).toHaveBeenCalledTimes(1);
    });

    it("isn't tried again once dropped, even if it fails after the drop", async () => {
      const saves = pendingSave(700);
      let reject!: (err: Error) => void;
      const inFlight = vi.fn(
        () => new Promise<void>((_, r) => (reject = r))
      );
      const retried = failing(100);
      saves.schedule(retried, "a");
      await vi.advanceTimersByTimeAsync(700); // failed: retry in 1 s
      saves.schedule(inFlight, "b");
      saves.flush(); // sent, still in flight

      saves.drop();
      reject(new Error("no session"));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(retried).toHaveBeenCalledTimes(1);
      expect(inFlight).toHaveBeenCalledTimes(1);
    });

    it("close sends the waiting save and every retry at once, and tries nothing again after", async () => {
      const saves = pendingSave(700);
      const retried = failing(100);
      const waiting = failing(100);
      saves.schedule(retried, "a");
      await vi.advanceTimersByTimeAsync(700); // failed: retry in 1 s
      saves.schedule(waiting, "b");

      saves.close();
      expect(retried).toHaveBeenCalledTimes(2);
      expect(waiting).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(retried).toHaveBeenCalledTimes(2);
      expect(waiting).toHaveBeenCalledTimes(1);
    });

    it("is still tried again when scheduled after a close (React may mount the store again)", async () => {
      const saves = pendingSave(700);
      saves.close();
      const save = failing(1);
      saves.schedule(save);

      await vi.advanceTimersByTimeAsync(700 + 1000);
      expect(save).toHaveBeenCalledTimes(2);
    });
  });

  describe("settle", () => {
    beforeEach(() => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    /** Has `promise` resolved yet? */
    const watch = (promise: Promise<void>) => {
      const seen = { settled: false };
      void promise.then(() => (seen.settled = true));
      return seen;
    };

    it("resolves at once when no save of that course is on its way", async () => {
      const saves = pendingSave(700);
      const settle = watch(saves.settle("course-a"));
      await vi.advanceTimersByTimeAsync(0);
      expect(settle.settled).toBe(true);
    });

    it("keeps a failed save of a course the learner left and comes back to: it's sent before the course loads again", async () => {
      // The learner finishes a lesson of course A and its save fails. They
      // open course B and come back to A, which starts over empty and loads
      // A's saved progress again — without that lesson, still waiting to
      // be tried again. The save of the merge would take the failed one's
      // place for good. So A loads again only once the failed save is in:
      // it's sent now, and the load reads it back.
      const saves = pendingSave(700);
      const server: string[] = [];
      let tries = 0;
      saves.schedule(async () => {
        if (++tries === 1) throw new Error("no session");
        server.push("A: the lesson finished");
      }, "course-a");
      saves.flush(); // the learner opened course B
      await vi.advanceTimersByTimeAsync(0); // failed: retry in 1 s

      // Back in A: before it loads.
      const settle = watch(saves.settle("course-a"));
      await vi.advanceTimersByTimeAsync(0);
      expect(server).toEqual(["A: the lesson finished"]); // now, not in 1 s
      expect(settle.settled).toBe(true);

      // Loaded (with the lesson), merged, saved.
      saves.schedule(async () => void server.push("A: loaded again"), "course-a");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(server).toEqual(["A: the lesson finished", "A: loaded again"]);
    });

    it("waits for a save still on its way", async () => {
      const saves = pendingSave(700);
      let answer!: () => void;
      saves.schedule(
        () => new Promise<void>((resolve) => (answer = resolve)),
        "course-a"
      );
      saves.flush();

      const settle = watch(saves.settle("course-a"));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(settle.settled).toBe(false);
      answer();
      await vi.advanceTimersByTimeAsync(0);
      expect(settle.settled).toBe(true);
    });

    it("sends that course's save still waiting out the debounce", async () => {
      const saves = pendingSave(700);
      const save = ok();
      saves.schedule(save, "course-a");

      const settle = watch(saves.settle("course-a"));
      await vi.advanceTimersByTimeAsync(0);
      expect(save).toHaveBeenCalledTimes(1);
      expect(settle.settled).toBe(true);
    });

    it("keeps waiting while the save sent now fails again, until a retry gets through", async () => {
      const saves = pendingSave(700);
      const save = failing(2);
      saves.schedule(save, "course-a");
      saves.flush();
      await vi.advanceTimersByTimeAsync(0); // failed: retry in 1 s

      const settle = watch(saves.settle("course-a"));
      await vi.advanceTimersByTimeAsync(0);
      expect(save).toHaveBeenCalledTimes(2); // sent now, failed again
      expect(settle.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2000); // the next retry, as usual
      expect(save).toHaveBeenCalledTimes(3);
      expect(settle.settled).toBe(true);
    });

    it("resolves once the save gives up", async () => {
      const saves = pendingSave(700);
      const save = failing(100);
      saves.schedule(save, "course-a");
      saves.flush();
      await vi.advanceTimersByTimeAsync(0);

      const settle = watch(saves.settle("course-a"));
      await vi.advanceTimersByTimeAsync(2000 + 4000 + 8000);
      expect(save).toHaveBeenCalledTimes(5);
      expect(settle.settled).toBe(true);
    });

    it("resolves once the saves are dropped", async () => {
      const saves = pendingSave(700);
      const save = failing(100);
      saves.schedule(save, "course-a");
      saves.flush();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000); // the retry failed again
      const settle = watch(saves.settle("course-a"));
      await vi.advanceTimersByTimeAsync(0);
      expect(settle.settled).toBe(false);

      saves.drop();
      await vi.advanceTimersByTimeAsync(0);
      expect(settle.settled).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(save).toHaveBeenCalledTimes(3);
    });

    it("doesn't wait for, or send, another course's save", async () => {
      const saves = pendingSave(700);
      const courseB = failing(100);
      saves.schedule(courseB, "course-b");
      saves.flush();
      await vi.advanceTimersByTimeAsync(0); // failed: retry in 1 s

      const settle = watch(saves.settle("course-a"));
      await vi.advanceTimersByTimeAsync(0);
      expect(settle.settled).toBe(true);
      expect(courseB).toHaveBeenCalledTimes(1);
    });
  });
});
