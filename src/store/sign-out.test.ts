import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { OUTBOX_PREFIX } from "./outbox";
import { pendingSave } from "./pending-save";
import { SIGN_OUT_WAIT_MS, signOutAfterSaves } from "./sign-out";

/*
 * Signing out from the header (D68): the saves waiting are sent and
 * waited for, with those on their way, up to SIGN_OUT_WAIT_MS; then the
 * sign-out goes ahead and nothing of the learner stays in the tab's
 * outbox. course-save.test.ts runs it with the page's course saves.
 */

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** sessionStorage, in memory, with an outbox entry and something else. */
function tab() {
  const items = new Map<string, string>([
    [`${OUTBOX_PREFIX}user-ana:workplace-conflict`, '{"v":2}'],
    ["something-else", "kept"],
  ]);
  return {
    items,
    get length() {
      return items.size;
    },
    key: (i: number) => [...items.keys()][i] ?? null,
    removeItem: (k: string) => void items.delete(k),
  };
}

describe("signOutAfterSaves", () => {
  it("the saves first: the session ends only once the save waiting is answered; then every outbox entry is cleared", async () => {
    const saves = pendingSave(700);
    const order: string[] = [];
    let answer!: () => void;
    saves.schedule(
      () =>
        new Promise<void>((resolve) => {
          order.push("save sent");
          answer = () => {
            order.push("save answered");
            resolve();
          };
        }),
      "workplace-conflict"
    );
    const storage = tab();
    const signingOut: boolean[] = [];
    const done = signOutAfterSaves({
      saves: [saves],
      signingOut: (on) => void signingOut.push(on),
      outbox: storage,
      signOut: async () => {
        order.push("signed out");
        expect([...storage.items.keys()], "cleared before the session ends").toEqual(["something-else"]);
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["save sent"]);
    answer();
    await expect(done).resolves.toBe(true);
    expect(order).toEqual(["save sent", "save answered", "signed out"]);
    expect(signingOut).toEqual([true]);
  });

  it("goes ahead once the wait runs out, answering that a save was left", async () => {
    const saves = pendingSave(700);
    saves.schedule(() => new Promise<void>(() => undefined), "workplace-conflict");
    const signOut = vi.fn(async () => undefined);
    let result: boolean | undefined;
    void signOutAfterSaves({ saves: [saves], signingOut: () => undefined, outbox: tab(), signOut }).then(
      (v) => (result = v)
    );
    await vi.advanceTimersByTimeAsync(SIGN_OUT_WAIT_MS - 1);
    expect(signOut).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it("a sign-out that fails leaves the learner signed in: signing out is off again, and the error is thrown on", async () => {
    const signingOut: boolean[] = [];
    const failed = signOutAfterSaves({
      saves: [pendingSave(700)],
      signingOut: (on) => void signingOut.push(on),
      outbox: null,
      signOut: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(failed).rejects.toThrow("Failed to fetch");
    expect(signingOut).toEqual([true, false]);
  });
});
