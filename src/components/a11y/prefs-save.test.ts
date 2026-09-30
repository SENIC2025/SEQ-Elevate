import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { prefsSave } from "./prefs-save";

/** A save that fails `failures` times, then succeeds. */
function flaky(failures: number) {
  let calls = 0;
  return vi.fn(async () => {
    calls++;
    if (calls <= failures) throw new Error(`failure ${calls}`);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("prefsSave", () => {
  it("sends a save once the delay passes", async () => {
    const slot = prefsSave(600);
    const send = flaky(0);
    slot.schedule({ send });

    await vi.advanceTimersByTimeAsync(599);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends only the newest of the saves scheduled within the delay", async () => {
    const slot = prefsSave(600);
    const older = flaky(0);
    const newer = flaky(0);
    slot.schedule({ send: older });
    await vi.advanceTimersByTimeAsync(400);
    slot.schedule({ send: newer });

    await vi.advanceTimersByTimeAsync(599);
    expect(newer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(older).not.toHaveBeenCalled();
    expect(newer).toHaveBeenCalledTimes(1);
  });

  it("tries a failed save again, and stops once one gets through", async () => {
    const slot = prefsSave(600, { delays: [1000, 2000] });
    const send = flaky(1);
    const onGiveUp = vi.fn();
    slot.schedule({ send, onGiveUp });

    await vi.advanceTimersByTimeAsync(600);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("gives up once every try failed, and says so", async () => {
    const slot = prefsSave(600, { delays: [1000, 2000] });
    const send = flaky(Infinity);
    const onGiveUp = vi.fn();
    slot.schedule({ send, onGiveUp });

    await vi.advanceTimersByTimeAsync(600 + 1000 + 2000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onGiveUp.mock.calls[0][0]).toEqual(new Error("failure 3"));
  });

  it("cancel() forgets the waiting save", async () => {
    const slot = prefsSave(600);
    const send = flaky(0);
    slot.schedule({ send });
    slot.cancel();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).not.toHaveBeenCalled();
  });

  it("cancel() leaves a sent save being tried", async () => {
    const slot = prefsSave(600, { delays: [1000] });
    const sent = flaky(1);
    slot.schedule({ send: sent });
    await vi.advanceTimersByTimeAsync(600);
    expect(sent).toHaveBeenCalledTimes(1);

    // A change undone before its save went out: only that one is forgotten.
    const undone = flaky(0);
    slot.schedule({ send: undone });
    slot.cancel();

    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveBeenCalledTimes(2);
    expect(undone).not.toHaveBeenCalled();
  });

  it("a newer save sent replaces the one still being tried", async () => {
    const slot = prefsSave(600, { delays: [1000, 2000, 4000] });
    const older = flaky(Infinity);
    const olderGaveUp = vi.fn();
    slot.schedule({ send: older, onGiveUp: olderGaveUp });
    await vi.advanceTimersByTimeAsync(600);
    expect(older).toHaveBeenCalledTimes(1);

    // Waiting out its debounce, the newer one doesn't stop the older yet…
    const newer = flaky(0);
    slot.schedule({ send: newer });
    await vi.advanceTimersByTimeAsync(400);
    // …sent, it does: the older isn't tried again, nor reported.
    await vi.advanceTimersByTimeAsync(200);
    expect(newer).toHaveBeenCalledTimes(1);
    const olderTries = older.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(older).toHaveBeenCalledTimes(olderTries);
    expect(olderGaveUp).not.toHaveBeenCalled();
  });

  it("drop() forgets the waiting save and stops the one being tried, without reporting it", async () => {
    const slot = prefsSave(600, { delays: [1000, 2000] });
    const sent = flaky(Infinity);
    const onGiveUp = vi.fn();
    slot.schedule({ send: sent, onGiveUp });
    await vi.advanceTimersByTimeAsync(600);
    const waiting = flaky(0);
    slot.schedule({ send: waiting });

    slot.drop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(waiting).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("flush() sends the waiting save at once, and nothing when none waits", async () => {
    const slot = prefsSave(600);
    slot.flush();
    const send = flaky(0);
    slot.schedule({ send });

    slot.flush();
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
