import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import {
  RESPONSE_LIMITS,
  type ProgressPatch,
  type ProgressState,
  type SaveProgressResult,
} from "@/lib/learner-progress/contract";
import { EMPTY_PROGRESS } from "@/lib/learner-progress/patch";
import { courseSaveRefs, outstandingPatch, saveCourse, type CourseSaveDeps } from "./course-save";

/*
 * One save of a course's progress as the learner store sends it (spec 5.4,
 * D62.b, D68): worked out when it is sent, against what the server has
 * confirmed; refusals told to the learner and not sent again unchanged;
 * another save when something is still left; a page from an older build
 * puts what isn't confirmed in the outbox instead of trying again.
 */

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const SLUG = "workplace-conflict";
const ANA = "user-ana";
const OWN = "s-abcdefgh";
const PART = "p-12345678";
const state = (p: Partial<ProgressState> = {}): ProgressState => ({ ...EMPTY_PROGRESS, ...p });

/** A store's refs with `acked` loaded and `latest` as the learner has it now. */
function setup(acked: ProgressState, latest: ProgressState) {
  const refs = courseSaveRefs();
  refs.acked.set(SLUG, acked);
  refs.latest.set(SLUG, latest);
  const sent: ProgressPatch[] = [];
  let answer: (patch: ProgressPatch) => Promise<SaveProgressResult> = async () => ({ ok: true, refused: [] });
  const calls = { refused: [] as unknown[], stale: [] as ProgressPatch[], settled: 0, again: 0 };
  let current = true;
  const deps: CourseSaveDeps = {
    send: async (slug, patch, forUser) => {
      expect([slug, forUser]).toEqual([SLUG, ANA]);
      sent.push(patch);
      return answer(patch);
    },
    refusedKeys: (slug, keys) => {
      expect(slug).toBe(SLUG);
      calls.refused.push(keys);
    },
    staleBuild: (slug, forUser, patch) => {
      expect([slug, forUser]).toEqual([SLUG, ANA]);
      calls.stale.push(patch);
    },
    settled: () => void calls.settled++,
    again: () => void calls.again++,
    current: () => current,
  };
  return {
    refs,
    sent,
    calls,
    deps,
    save: () => saveCourse(SLUG, ANA, refs, deps),
    answerWith: (fn: typeof answer) => (answer = fn),
    letGo: () => (current = false),
  };
}

describe("saveCourse", () => {
  it("sends nothing when the server has it all, or the course hasn't loaded", async () => {
    const s = state({ stagesCompleted: ["context"] });
    const t = setup(s, structuredClone(s));
    await t.save();
    t.refs.acked.delete(SLUG);
    t.refs.latest.set(SLUG, state({ stagesCompleted: ["context", "concept"] }));
    await t.save();
    expect(t.sent).toEqual([]);
    expect(t.calls.again).toBe(0);
  });

  it("works the patch out when it is sent, from the learner's latest progress", async () => {
    const t = setup(EMPTY_PROGRESS, state({ stagesCompleted: ["context"] }));
    // Changed again after the save was scheduled, before it went.
    t.refs.latest.set(SLUG, state({ stagesCompleted: ["context", "concept"] }));
    await t.save();
    expect(t.sent).toEqual([{ v: 2, completed: ["context", "concept"] }]);
    expect(t.refs.acked.get(SLUG)?.stagesCompleted).toEqual(["context", "concept"]);
    expect(t.calls).toMatchObject({ settled: 1, again: 0, refused: [] });
  });

  it("saves again when a value changed back while the save was on its way", async () => {
    const t = setup(EMPTY_PROGRESS, state({ simulation: { choice: "a", correct: false } }));
    t.answerWith(async () => {
      // The learner picks another answer, then the first one's save lands.
      t.refs.latest.set(SLUG, state({ simulation: { choice: "b", correct: true } }));
      return { ok: true, refused: [] };
    });
    await t.save();
    expect(t.calls).toMatchObject({ again: 1, settled: 0 });
    t.answerWith(async () => ({ ok: true, refused: [] }));
    await t.save();
    expect(t.sent[1]).toEqual({
      v: 2,
      answers: { "simulation/main": { type: "practice", optionId: "b", correct: true } },
    });
    expect(t.calls).toMatchObject({ again: 1, settled: 1 });
  });

  it("tells the learner what the server refused, and doesn't send it again unchanged", async () => {
    const key = `${OWN}/${PART}`;
    const t = setup(
      EMPTY_PROGRESS,
      state({
        stagesCompleted: ["context"],
        responses: { [key]: { type: "rating", values: { s1: 4 } } },
      })
    );
    t.answerWith(async () => ({ ok: true, refused: [{ key, reason: "row-full" }] }));
    await t.save();
    expect(t.calls.refused).toEqual([[{ key, reason: "row-full" }]]);
    // The rest is confirmed; the refused answer isn't.
    expect(t.refs.acked.get(SLUG)).toMatchObject({ stagesCompleted: ["context"], responses: {} });
    // Nothing left that the server would take: no save loops on it.
    expect(t.calls).toMatchObject({ again: 0, settled: 1 });
    await t.save();
    expect(t.sent).toHaveLength(1);

    // Changed: sent again.
    t.refs.latest.set(
      SLUG,
      state({ stagesCompleted: ["context"], responses: { [key]: { type: "rating", values: { s1: 3 } } } })
    );
    t.answerWith(async () => ({ ok: true, refused: [] }));
    await t.save();
    expect(t.sent[1]).toEqual({ v: 2, answers: { [key]: { type: "rating", values: { s1: 3 } } } });
  });

  it("holds back an answer the server would refuse, sends the rest, and doesn't loop on it", async () => {
    const key = `${OWN}/${PART}`;
    const long = "x".repeat(RESPONSE_LIMITS.reflectionChars + 1);
    const t = setup(
      EMPTY_PROGRESS,
      state({
        stagesCompleted: ["context"],
        responses: { [key]: { type: "reflection", text: { q1: long, q2: "Fine" } } },
      })
    );
    await t.save();
    expect(t.sent).toEqual([
      {
        v: 2,
        completed: ["context"],
        answers: { [key]: { type: "reflection", text: { q2: "Fine" } } },
      },
    ]);
    expect(t.calls.refused).toEqual([[{ key, reason: "too-long" }]]);
    expect(t.calls).toMatchObject({ again: 0, settled: 1 });
    await t.save();
    expect(t.sent).toHaveLength(1);
  });

  it("saves again when a patch was too big to send at once", async () => {
    const answers = Object.fromEntries(
      Array.from({ length: RESPONSE_LIMITS.keysPerPatch + 5 }, (_, i) => [
        `${OWN}/p-${String(i).padStart(8, "0")}`,
        { type: "rating" as const, values: { s1: 3 as const } },
      ])
    );
    const t = setup(EMPTY_PROGRESS, state({ responses: answers }));
    await t.save();
    expect(Object.keys(t.sent[0].answers ?? {})).toHaveLength(RESPONSE_LIMITS.keysPerPatch);
    expect(t.calls).toMatchObject({ again: 1, settled: 0 });
    await t.save();
    expect(Object.keys(t.sent[1].answers ?? {})).toHaveLength(5);
    expect(t.calls).toMatchObject({ again: 1, settled: 1 });
  });

  it("puts what the server hasn't confirmed in the outbox when this page's build is gone, and doesn't try again", async () => {
    const latest = state({
      stagesCompleted: ["context"],
      reflection: { p1: "Mine", p2: "", p3: "" },
    });
    const t = setup(EMPTY_PROGRESS, latest);
    t.answerWith(async () => {
      throw new UnrecognizedActionError('Server Action "x" was not found on the server.');
    });
    await expect(t.save()).resolves.toBeUndefined();
    expect(t.calls.stale).toEqual([
      {
        v: 2,
        completed: ["context"],
        answers: { "reflection/main": { type: "reflection", text: { p1: "Mine" } } },
      },
    ]);
    expect(t.refs.acked.get(SLUG)).toBe(EMPTY_PROGRESS);
    expect(t.calls).toMatchObject({ again: 0, settled: 0 });
  });

  it("fails a save that didn't get through, so it's tried again", async () => {
    const t = setup(EMPTY_PROGRESS, state({ stagesCompleted: ["context"] }));
    t.answerWith(async () => {
      throw new Error("No signed-in learner, or the session lookup failed");
    });
    await expect(t.save()).rejects.toThrow(/session lookup failed/);
    expect(t.refs.acked.get(SLUG)).toBe(EMPTY_PROGRESS);
    expect(t.calls.stale).toEqual([]);
  });

  it("drops a save meant for another account, logs one that can never succeed, and tries neither again", async () => {
    const t = setup(EMPTY_PROGRESS, state({ stagesCompleted: ["context"] }));
    t.answerWith(async () => ({ ok: false, error: "other-account" }));
    await t.save();
    expect(console.error).not.toHaveBeenCalled();
    t.answerWith(async () => ({ ok: false, error: "bad-input" }));
    await t.save();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(t.refs.acked.get(SLUG)).toBe(EMPTY_PROGRESS);
    expect(t.calls).toMatchObject({ again: 0, settled: 0 });
  });

  it("forgets the answer to a save once the store has let go of the learner's data", async () => {
    const t = setup(EMPTY_PROGRESS, state({ stagesCompleted: ["context"] }));
    t.answerWith(async () => {
      t.letGo();
      t.refs.latest.set(SLUG, state({ stagesCompleted: ["context", "concept"] }));
      return { ok: true, refused: [] };
    });
    await t.save();
    expect(t.refs.acked.get(SLUG)).toBe(EMPTY_PROGRESS);
    expect(t.calls).toMatchObject({ again: 0, settled: 0 });
  });
});

describe("outstandingPatch", () => {
  it("is what the next save would send: null when nothing", () => {
    const t = setup(EMPTY_PROGRESS, state({ stagesCompleted: ["context"] }));
    expect(outstandingPatch(t.refs, SLUG)).toEqual({ v: 2, completed: ["context"] });
    t.refs.latest.set(SLUG, EMPTY_PROGRESS);
    expect(outstandingPatch(t.refs, SLUG)).toBeNull();
    expect(outstandingPatch(t.refs, "receiving-feedback")).toBeNull();
  });
});
