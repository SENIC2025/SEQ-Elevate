import { describe, it, expect, vi, afterEach } from "vitest";
import { ownerChange, SESSION_RECHECK_MS, signedInAgain } from "./session-hold";

describe("ownerChange", () => {
  it("holds an account's settings when its session finds no one: signed out, or a lookup that failed", () => {
    expect(ownerChange("user-a", null)).toBe("hold");
  });

  it("starts over when someone signs in, or another account does", () => {
    expect(ownerChange(null, "user-a")).toBe("change");
    expect(ownerChange("user-a", "user-b")).toBe("change");
  });

  it("keeps them for the same owner, while the session loads, and for the first owner found", () => {
    expect(ownerChange("user-a", "user-a")).toBe("keep");
    expect(ownerChange(null, null)).toBe("keep");
    expect(ownerChange("user-a", undefined)).toBe("keep");
    expect(ownerChange(null, undefined)).toBe("keep");
    expect(ownerChange(undefined, "user-a")).toBe("keep");
    expect(ownerChange(undefined, null)).toBe("keep");
  });
});

describe("signedInAgain", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the session after each wait, and stops at the first that finds someone", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const found = signedInAgain(read, { delays: [1000, 2000] });

    await vi.advanceTimersByTimeAsync(999);
    expect(read).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(found).resolves.toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("is false once no read finds anyone; a read that fails finds no one", async () => {
    vi.useFakeTimers();
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(false);
    const found = signedInAgain(read, { delays: [1000, 2000] });

    await vi.advanceTimersByTimeAsync(3000);
    await expect(found).resolves.toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("stops once aborted: no read after that, and what one finds is dropped", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValue(false);
    const abort = new AbortController();
    const found = signedInAgain(read, { delays: [1000, 2000], signal: abort.signal });
    const settled = found.catch((err: unknown) => err);

    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(1);
    abort.abort(new Error("owner changed"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(await settled).toEqual(new Error("owner changed"));

    // Aborted while a read is on its way: its answer is dropped.
    let answer!: (v: boolean) => void;
    const slow = vi.fn(() => new Promise<boolean>((r) => (answer = r)));
    const second = new AbortController();
    const dropped = signedInAgain(slow, { delays: [1000], signal: second.signal }).catch(
      (err: unknown) => err
    );
    await vi.advanceTimersByTimeAsync(1000);
    second.abort(new Error("owner changed"));
    answer(true);
    expect(await dropped).toEqual(new Error("owner changed"));
  });

  it("lets go about 3 s after the session was lost", () => {
    expect(SESSION_RECHECK_MS.reduce((a, b) => a + b, 0)).toBe(3000);
  });
});
