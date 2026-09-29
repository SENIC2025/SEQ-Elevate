import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { pendingSave } from "./pending-save";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pendingSave", () => {
  it("sends a save once the delay has passed, not before", () => {
    const saves = pendingSave(700);
    const save = vi.fn();
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
    const older = vi.fn();
    const newer = vi.fn();
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
    const save = vi.fn();
    saves.schedule(save);

    saves.flush();
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    saves.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps one course's last change when the next course's first save follows the flush", () => {
    const saves = pendingSave(700);
    const sent: string[] = [];
    saves.schedule(() => sent.push("course A, last change"));
    // The learner opens course B before the delay is up.
    saves.flush();
    saves.schedule(() => sent.push("course B, merged on load"));
    vi.advanceTimersByTime(700);

    expect(sent).toEqual(["course A, last change", "course B, merged on load"]);
  });

  it("flush does nothing when nothing is waiting", () => {
    const saves = pendingSave(700);
    expect(() => saves.flush()).not.toThrow();
  });

  it("drop forgets the waiting save: it's never sent", () => {
    const saves = pendingSave(700);
    const save = vi.fn();
    saves.schedule(save);

    saves.drop();
    vi.advanceTimersByTime(10_000);
    saves.flush();
    expect(save).not.toHaveBeenCalled();
  });
});
