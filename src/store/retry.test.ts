import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { RETRY_DELAYS_MS, withRetry } from "./retry";

/** A load that fails `failures` times, then resolves to "loaded". */
function flaky(failures: number) {
  let calls = 0;
  const load = vi.fn(async () => {
    calls++;
    if (calls <= failures) throw new Error(`failure ${calls}`);
    return "loaded";
  });
  return load;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RETRY_DELAYS_MS", () => {
  it("is 1 s, 2 s, 4 s and 8 s: four more tries over about 15 s", () => {
    expect(RETRY_DELAYS_MS).toEqual([1000, 2000, 4000, 8000]);
  });
});

describe("withRetry", () => {
  it("resolves at once when the first try succeeds", async () => {
    const load = flaky(0);
    await expect(withRetry(load)).resolves.toBe("loaded");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("tries again after each wait until a try succeeds", async () => {
    const load = flaky(2);
    const result = withRetry(load);

    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(3);

    await expect(result).resolves.toBe("loaded");
  });

  it("gives up with the last failure once the waits are used up", async () => {
    const load = flaky(Infinity);
    const result = withRetry(load);
    const outcome = expect(result).rejects.toThrow("failure 5");

    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000 + 8000);
    await outcome;
    expect(load).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(5);
  });

  it("takes its waits from `delays`", async () => {
    const load = flaky(Infinity);
    const outcome = expect(withRetry(load, { delays: [10] })).rejects.toThrow(
      "failure 2"
    );
    await vi.advanceTimersByTimeAsync(10);
    await outcome;
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("stops as soon as it's aborted while waiting: no further try", async () => {
    const load = flaky(Infinity);
    const abort = new AbortController();
    const outcome = expect(
      withRetry(load, { signal: abort.signal })
    ).rejects.toBeDefined();

    await vi.advanceTimersByTimeAsync(500);
    abort.abort();
    await outcome;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("doesn't start when already aborted", async () => {
    const load = flaky(0);
    const abort = new AbortController();
    abort.abort();
    await expect(withRetry(load, { signal: abort.signal })).rejects.toBeDefined();
    expect(load).not.toHaveBeenCalled();
  });
});
