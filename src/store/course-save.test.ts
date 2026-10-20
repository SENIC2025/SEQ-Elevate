import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import {
  RESPONSE_LIMITS,
  type ProgressPatch,
  type ProgressState,
  type SaveProgressResult,
} from "@/lib/learner-progress/contract";
import { EMPTY_PROGRESS, applyPatch } from "@/lib/learner-progress/patch";
import {
  courseChanged,
  courseSaveRefs,
  outstandingPatch,
  saveCourse,
  type CourseSaveDeps,
} from "./course-save";
import { putInOutbox, readOutbox, restoreOutbox, type OutboxStorage } from "./outbox";

/*
 * One save of a course's progress as the learner store sends it (spec 5.4,
 * D62.b, D68): worked out when it is sent, against what the server has
 * confirmed; refusals told to the learner and not sent again unchanged;
 * another save when something is still left; a page from an older build
 * puts what isn't confirmed in the tab's outbox instead of trying again,
 * and the outbox is cleared as soon as nothing this page holds is left to
 * send — so it is never applied again over newer progress.
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
const practice = (optionId: string): ProgressState["simulation"] => ({ choice: optionId, correct: optionId === "b" });
const unknownAction = () => new UnrecognizedActionError('Server Action "x" was not found on the server.');

/** sessionStorage, in memory. */
function storage(): OutboxStorage {
  const items = new Map<string, string>();
  return {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, String(v)),
    removeItem: (k) => void items.delete(k),
  };
}

/** What an earlier save that found a newer build left in the tab's outbox. */
const KEPT: ProgressPatch = {
  v: 2,
  answers: { [`${OWN}/main`]: { type: "practice", optionId: "kept", correct: false } },
};

/**
 * A store's refs with `acked` loaded and `latest` as the learner has it
 * now, and a tab whose outbox holds KEPT for the learner and course.
 */
function setup(acked: ProgressState, latest: ProgressState) {
  const refs = courseSaveRefs();
  refs.acked.set(SLUG, acked);
  refs.latest.set(SLUG, latest);
  const tab = storage();
  putInOutbox(tab, ANA, SLUG, KEPT);
  const sent: ProgressPatch[] = [];
  let answer: (patch: ProgressPatch) => Promise<SaveProgressResult> = async () => ({ ok: true, refused: [] });
  const calls = { refused: [] as unknown[], stale: 0, again: 0 };
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
    staleBuild: (slug) => {
      expect(slug).toBe(SLUG);
      calls.stale++;
    },
    outbox: tab,
    again: () => void calls.again++,
    current: () => current,
  };
  return {
    refs,
    sent,
    calls,
    deps,
    save: () => saveCourse(SLUG, ANA, refs, deps),
    /** What the tab's outbox holds for the learner and course now. */
    outbox: () => readOutbox(tab, ANA, SLUG),
    answerWith: (fn: typeof answer) => (answer = fn),
    letGo: () => (current = false),
  };
}

describe("saveCourse", () => {
  it("sends nothing when the server has it all, or the course hasn't loaded", async () => {
    const s = state({ stagesCompleted: ["context"] });
    const t = setup(s, structuredClone(s));
    t.refs.acked.delete(SLUG);
    t.refs.latest.set(SLUG, state({ stagesCompleted: ["context", "concept"] }));
    await t.save();
    // Not loaded: what the server has isn't known, so the outbox stays.
    expect(t.outbox()).toEqual(KEPT);
    t.refs.acked.set(SLUG, s);
    t.refs.latest.set(SLUG, structuredClone(s));
    await t.save();
    expect(t.sent).toEqual([]);
    expect(t.calls.again).toBe(0);
    // The server has all this page holds: nothing kept is needed any more.
    expect(t.outbox()).toBeNull();
  });

  it("works the patch out when it is sent, from the learner's latest progress", async () => {
    const t = setup(EMPTY_PROGRESS, state({ stagesCompleted: ["context"] }));
    // Changed again after the save was scheduled, before it went.
    t.refs.latest.set(SLUG, state({ stagesCompleted: ["context", "concept"] }));
    await t.save();
    expect(t.sent).toEqual([{ v: 2, completed: ["context", "concept"] }]);
    expect(t.refs.acked.get(SLUG)?.stagesCompleted).toEqual(["context", "concept"]);
    expect(t.calls).toMatchObject({ again: 0, refused: [] });
    expect(t.outbox()).toBeNull();
  });

  it("saves again when a value changed back while the save was on its way", async () => {
    const t = setup(EMPTY_PROGRESS, state({ simulation: { choice: "a", correct: false } }));
    t.answerWith(async () => {
      // The learner picks another answer, then the first one's save lands.
      t.refs.latest.set(SLUG, state({ simulation: { choice: "b", correct: true } }));
      return { ok: true, refused: [] };
    });
    await t.save();
    expect(t.calls).toMatchObject({ again: 1 });
    expect(t.outbox()).toEqual(KEPT);
    t.answerWith(async () => ({ ok: true, refused: [] }));
    await t.save();
    expect(t.sent[1]).toEqual({
      v: 2,
      answers: { "simulation/main": { type: "practice", optionId: "b", correct: true } },
    });
    expect(t.calls).toMatchObject({ again: 1 });
    expect(t.outbox()).toBeNull();
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
    expect(t.calls).toMatchObject({ again: 0 });
    expect(t.outbox()).toBeNull();
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
    expect(t.calls).toMatchObject({ again: 0 });
    expect(t.outbox()).toBeNull();
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
    expect(t.calls).toMatchObject({ again: 1 });
    expect(t.outbox()).toEqual(KEPT);
    await t.save();
    expect(Object.keys(t.sent[1].answers ?? {})).toHaveLength(5);
    expect(t.calls).toMatchObject({ again: 1 });
    expect(t.outbox()).toBeNull();
  });

  it("puts what the server hasn't confirmed in the outbox when this page's build is gone, and doesn't try again", async () => {
    const latest = state({
      stagesCompleted: ["context"],
      reflection: { p1: "Mine", p2: "", p3: "" },
    });
    const t = setup(EMPTY_PROGRESS, latest);
    t.answerWith(async () => {
      throw unknownAction();
    });
    await expect(t.save()).resolves.toBeUndefined();
    // In place of what it held: this page took that in when the course
    // loaded, and holds what the learner did since.
    expect(t.outbox()).toEqual({
      v: 2,
      completed: ["context"],
      answers: { "reflection/main": { type: "reflection", text: { p1: "Mine" } } },
    });
    expect(t.refs.acked.get(SLUG)).toBe(EMPTY_PROGRESS);
    expect(t.calls).toMatchObject({ again: 0, stale: 1 });
  });

  it("keeps in the outbox what isn't confirmed when the save fails, not when it was sent", async () => {
    // The learner went back to the answer the server has while the save
    // was on its way: kept, it would come back over it after the reload.
    const t = setup(state({ simulation: practice("a") }), state({ simulation: practice("b") }));
    t.answerWith(async () => {
      t.refs.latest.set(SLUG, state({ simulation: practice("a"), stagesCompleted: ["context"] }));
      throw unknownAction();
    });
    await t.save();
    expect(t.sent[0].answers).toEqual({ "simulation/main": { type: "practice", optionId: "b", correct: true } });
    expect(t.outbox()).toEqual({ v: 2, completed: ["context"] });

    // Nothing left unconfirmed: nothing kept.
    t.answerWith(async () => {
      t.refs.latest.set(SLUG, state({ simulation: practice("a") }));
      throw unknownAction();
    });
    t.refs.latest.set(SLUG, state({ simulation: practice("b") }));
    await t.save();
    expect(t.outbox()).toBeNull();
    expect(t.calls.stale).toBe(2);
  });

  it("an answer kept while the server held Y0 never comes back over the Y saved elsewhere since (finding 4)", async () => {
    // A stale tab answers X (the server held Y0) and its save finds a newer
    // build: X goes to the outbox. The learner's phone saves Y. The tab
    // reloads: what loads is Y, and X must not be sent over it.
    const t = setup(state({ simulation: practice("y0") }), state({ simulation: practice("x") }));
    t.answerWith(async () => {
      throw unknownAction();
    });
    await t.save();
    expect(t.outbox()?.answers).toEqual({ "simulation/main": { type: "practice", optionId: "x", correct: false } });

    const loaded = state({ simulation: practice("y") });
    const reloaded = courseSaveRefs();
    reloaded.acked.set(SLUG, loaded);
    const kept = restoreOutbox(t.deps.outbox, ANA, SLUG, loaded);
    const restored = kept ? applyPatch(loaded, kept) : loaded;
    reloaded.latest.set(SLUG, restored);
    expect(outstandingPatch(reloaded, SLUG)?.answers?.["simulation/main"]).toBeUndefined();
    expect(restored.simulation).toEqual(practice("y"));
  });

  it("a confirmed save with nothing left clears the outbox, though nothing was restored from it on this page", async () => {
    // Deploy skew: a save of practice "a" found a newer build and went to
    // the outbox (the setup's KEPT); the build came back, and the learner
    // picks "b" without reloading. Kept, "a" would come back over "b" on
    // the next load of the course in this tab.
    const t = setup(EMPTY_PROGRESS, state({ responses: { [`${OWN}/main`]: { type: "practice", optionId: "b", correct: true } } }));
    await t.save();
    expect(t.sent).toEqual([{ v: 2, answers: { [`${OWN}/main`]: { type: "practice", optionId: "b", correct: true } } }]);
    expect(t.outbox()).toBeNull();
  });

  it("fails a save that didn't get through, so it's tried again", async () => {
    const t = setup(EMPTY_PROGRESS, state({ stagesCompleted: ["context"] }));
    t.answerWith(async () => {
      throw new Error("No signed-in learner, or the session lookup failed");
    });
    await expect(t.save()).rejects.toThrow(/session lookup failed/);
    expect(t.refs.acked.get(SLUG)).toBe(EMPTY_PROGRESS);
    expect(t.calls.stale).toBe(0);
    expect(t.outbox()).toEqual(KEPT);
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
    expect(t.calls).toMatchObject({ again: 0 });
    expect(t.outbox()).toEqual(KEPT);
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
    expect(t.calls).toMatchObject({ again: 0 });
    expect(t.outbox()).toEqual(KEPT);
  });
});

describe("courseChanged", () => {
  it("a restore that adds nothing new clears the outbox: it is never applied again over newer progress", () => {
    // A save of the practice got through but its answer was lost to the
    // deploy, and the retry found the newer build: the outbox (KEPT) holds
    // what the server already has. Restored, it changes nothing — and no
    // save follows to clear it.
    const server = state({ responses: { [`${OWN}/main`]: { type: "practice", optionId: "kept", correct: false } } });
    const t = setup(server, server);
    const restored = applyPatch(server, t.outbox()!);
    expect(courseChanged(t.refs, SLUG, ANA, restored, t.deps.outbox)).toBe(false);
    expect(t.refs.latest.get(SLUG)).toBe(restored);
    expect(t.outbox()).toBeNull();
  });

  it("says when there is something to save, keeping the outbox until a save of it is confirmed", () => {
    const t = setup(EMPTY_PROGRESS, EMPTY_PROGRESS);
    const restored = applyPatch(EMPTY_PROGRESS, t.outbox()!);
    expect(courseChanged(t.refs, SLUG, ANA, restored, t.deps.outbox)).toBe(true);
    expect(t.outbox()).toEqual(KEPT);
  });

  it("clears the outbox when the learner goes back to what the server has", () => {
    // The page that kept "kept" (KEPT) still holds it, unconfirmed; the
    // learner picks the server's answer again: nothing to send, and the
    // outbox mustn't bring "kept" back after a reload.
    const server = state({ responses: { [`${OWN}/main`]: { type: "practice", optionId: "acct", correct: true } } });
    const t = setup(server, applyPatch(server, KEPT));
    expect(courseChanged(t.refs, SLUG, ANA, structuredClone(server), t.deps.outbox)).toBe(false);
    expect(t.outbox()).toBeNull();
  });

  it("changes nothing for a course that hasn't loaded", () => {
    const t = setup(EMPTY_PROGRESS, EMPTY_PROGRESS);
    t.refs.acked.delete(SLUG);
    expect(courseChanged(t.refs, SLUG, ANA, EMPTY_PROGRESS, t.deps.outbox)).toBe(false);
    expect(t.outbox()).toEqual(KEPT);
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
