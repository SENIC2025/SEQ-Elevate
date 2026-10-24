import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import {
  RESPONSE_LIMITS,
  type ProgressPatch,
  type ProgressState,
  type RefusedKey,
  type SaveProgressResult,
} from "@/lib/learner-progress/contract";
import { EMPTY_PROGRESS, applyPatch, withoutRefused } from "@/lib/learner-progress/patch";
import {
  courseChanged,
  courseLoaded,
  courseSaveRefs,
  outstandingPatch,
  pageHidden,
  progressBeacons,
  saveCourse,
  type CourseSaveDeps,
} from "./course-save";
import { clearEveryOutbox, outboxKey, putInOutbox, readOutbox, restoreOutbox, type OutboxStorage } from "./outbox";
import { pendingSave } from "./pending-save";
import { signOutAfterSaves } from "./sign-out";

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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const SLUG = "workplace-conflict";
const ANA = "user-ana";
const OWN = "s-abcdefgh";
const PART = "p-12345678";
const state = (p: Partial<ProgressState> = {}): ProgressState => ({ ...EMPTY_PROGRESS, ...p });
const practice = (optionId: string): ProgressState["simulation"] => ({ choice: optionId, correct: optionId === "b" });
const unknownAction = () => new UnrecognizedActionError('Server Action "x" was not found on the server.');
const reflection = (p1: string, p2 = "") => ({ p1, p2, p3: "" });
/** A dropped connection: the save may have been written. */
const lostAnswer = () => new TypeError("Failed to fetch");

/** sessionStorage, in memory. */
function storage(): OutboxStorage & Pick<Storage, "length" | "key"> {
  const items = new Map<string, string>();
  return {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, String(v)),
    removeItem: (k) => void items.delete(k),
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
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
    // What the outbox keeps follows what is confirmed: what the page has that isn't.
    expect(t.outbox()).toEqual({ v: 2, answers: { "simulation/main": { type: "practice", optionId: "b", correct: true } } });
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
    // What the outbox keeps follows what is confirmed.
    expect(Object.keys(t.outbox()?.answers ?? {})).toHaveLength(5);
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

  it("refused before the profile step is done (D79): the page says so, logs nothing, and tries nothing again", async () => {
    const t = setup(EMPTY_PROGRESS, state({ stagesCompleted: ["context"] }));
    const profileIncomplete = vi.fn();
    t.deps.profileIncomplete = profileIncomplete;
    t.answerWith(async () => ({ ok: false, error: "profile-incomplete" }));
    await t.save();
    expect(profileIncomplete).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
    expect(t.refs.acked.get(SLUG)).toBe(EMPTY_PROGRESS);
    expect(t.calls).toMatchObject({ again: 0 });
    // Not once the store has let go of the learner's data.
    t.letGo();
    await t.save();
    expect(profileIncomplete).toHaveBeenCalledTimes(1);
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

describe("pageHidden: the page hidden, or left", () => {
  it("keeps, for a course with saves on their way, what the page has that isn't confirmed — every answer they carry included — beside what the server holds if they are written in turn", async () => {
    const t = setup(state({ reflection: reflection("X") }), state({ reflection: reflection("Y") }));
    const held: (() => void)[] = [];
    t.answerWith(() => new Promise((resolve) => held.push(() => resolve({ ok: true, refused: [] }))));
    const first = t.save();
    expect(courseChanged(t.refs, SLUG, ANA, state({ reflection: reflection("X") }), t.deps.outbox)).toBe(true);
    const second = t.save();
    pageHidden(t.refs, ANA, t.deps.outbox);
    const kept = { v: 2, answers: { "reflection/main": { type: "reflection", text: { p1: "X" } } } };
    expect(t.outbox()).toEqual(kept);
    const raw = JSON.parse((t.deps.outbox as OutboxStorage).getItem(outboxKey(ANA, SLUG))!);
    expect(raw.base).toEqual({ "reflection/main": { type: "reflection", text: reflection("X") } });
    expect(raw.alt).toEqual({ "reflection/main": [{ type: "reflection", text: reflection("Y") }] });
    // The saves go through: kept while one is on its way, cleared once nothing is left.
    held[0]();
    await first;
    expect(t.outbox()).toEqual(kept);
    held[1]();
    await second;
    expect(t.outbox()).toBeNull();
  });

  it("keeps an answer whose save failed (it may have been written), brought back over either value", async () => {
    const t = setup(state({ reflection: reflection("X") }), state({ reflection: reflection("Y") }));
    t.answerWith(async () => {
      throw lostAnswer();
    });
    await expect(t.save()).rejects.toThrow();
    pageHidden(t.refs, ANA, t.deps.outbox);
    const kept = { v: 2, answers: { "reflection/main": { type: "reflection", text: { p1: "Y" } } } };
    expect(t.outbox()).toEqual(kept);
    const tab = t.deps.outbox as OutboxStorage;
    const entry = tab.getItem(outboxKey(ANA, SLUG))!;
    for (const p1 of ["X", "Y"]) {
      tab.setItem(outboxKey(ANA, SLUG), entry);
      expect(restoreOutbox(tab, ANA, SLUG, state({ reflection: reflection(p1) }))).toEqual(kept);
    }
  });

  it("keeps nothing for a course with no save on its way and none failed, and leaves what the outbox holds for it", () => {
    const t = setup(state({ reflection: reflection("X") }), state({ reflection: reflection("Y") }));
    pageHidden(t.refs, ANA, t.deps.outbox);
    expect(t.outbox()).toEqual(KEPT);
  });
});

describe("progressBeacons: what the page sends as it goes, outside Next's queue (D37)", () => {
  /** The bodies, read back. */
  const read = (bodies: string[]) => bodies.map((b) => JSON.parse(b) as { v: number; slug: string; forUser: string; patch: ProgressPatch });

  it("for a course with saves on their way: what the page has that isn't confirmed, every answer they carry at the page's value", async () => {
    const t = setup(state({ reflection: reflection("X") }), state({ reflection: reflection("Y") }));
    const held: (() => void)[] = [];
    t.answerWith(() => new Promise((resolve) => held.push(() => resolve({ ok: true, refused: [] }))));
    const first = t.save();
    expect(courseChanged(t.refs, SLUG, ANA, state({ reflection: reflection("X", "W") }), t.deps.outbox)).toBe(true);
    const second = t.save();
    expect(read(progressBeacons(t.refs, ANA))).toEqual([
      {
        v: 1,
        slug: SLUG,
        forUser: ANA,
        patch: { v: 2, answers: { "reflection/main": { type: "reflection", text: { p1: "X", p2: "W" } } } },
      },
    ]);
    held[0]();
    held[1]();
    await Promise.all([first, second]);
    expect(progressBeacons(t.refs, ANA), "all confirmed: nothing").toEqual([]);
  });

  it("for a course whose save failed: the answer it carried, as the page has it", async () => {
    const t = setup(state({ reflection: reflection("X") }), state({ reflection: reflection("Y") }));
    t.answerWith(async () => {
      throw lostAnswer();
    });
    await expect(t.save()).rejects.toThrow();
    expect(read(progressBeacons(t.refs, ANA)).map((b) => b.patch)).toEqual([
      { v: 2, answers: { "reflection/main": { type: "reflection", text: { p1: "Y" } } } },
    ]);
  });

  it("nothing for a course with no save on its way and none failed, or one that hasn't loaded", async () => {
    const t = setup(state({ reflection: reflection("X") }), state({ reflection: reflection("Y") }));
    expect(progressBeacons(t.refs, ANA)).toEqual([]);
    t.answerWith(() => new Promise(() => undefined));
    void t.save();
    t.refs.latest.delete(SLUG);
    expect(progressBeacons(t.refs, ANA)).toEqual([]);
  });

  it("leaves out what the server refused, unchanged, and what it would refuse", async () => {
    const long = "x".repeat(RESPONSE_LIMITS.reflectionChars + 1);
    const t = setup(
      state({ reflection: reflection("X") }),
      state({ reflection: reflection("X"), simulation: practice("a"), stagesCompleted: ["context"] })
    );
    t.answerWith(async () => ({ ok: true, refused: [{ key: "simulation/main", reason: "invalid" }] }));
    await t.save();
    expect(courseChanged(t.refs, SLUG, ANA, state({ reflection: reflection(long), simulation: practice("a"), stagesCompleted: ["context", "concept"] }), t.deps.outbox)).toBe(true);
    t.answerWith(() => new Promise(() => undefined));
    void t.save();
    expect(read(progressBeacons(t.refs, ANA)).map((b) => b.patch)).toEqual([{ v: 2, completed: ["concept"] }]);
  });

  it("every course together within the budget, in bytes: what doesn't fit is left out", async () => {
    const greek = (n: number) => "λ".repeat(n);
    const refs = courseSaveRefs();
    for (const slug of ["course-a", "course-b"]) {
      courseLoaded(refs, slug, state());
      refs.latest.set(slug, state({ reflection: reflection(greek(3000)) }));
      refs.sending.set(slug, [{ v: 2, answers: { "reflection/main": { type: "reflection", text: { p1: "y" } } } }]);
    }
    const bodies = progressBeacons(refs, ANA, 8_000);
    expect(read(bodies).map((b) => b.slug), "one course's answer (6 KB) fits; both don't").toEqual(["course-a"]);
    expect(new TextEncoder().encode(bodies.join("")).length).toBeLessThanOrEqual(8_000);
    expect(read(progressBeacons(refs, ANA, 20_000)).map((b) => b.slug)).toEqual(["course-a", "course-b"]);
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

describe("a save whose answer is lost: what it sent isn't known on the server until a save of it is confirmed", () => {
  it("an answer on its way isn't known yet: changed back meanwhile, it is a change, and a save sends what the page shows", async () => {
    const t = setup(state({ reflection: reflection("X") }), state({ reflection: reflection("Y") }));
    let during: boolean | null = null;
    t.answerWith(async () => {
      // The learner goes back to X while Y is on its way.
      during = courseChanged(t.refs, SLUG, ANA, state({ reflection: reflection("X") }), t.deps.outbox);
      expect(outstandingPatch(t.refs, SLUG)).toEqual({
        v: 2,
        answers: { "reflection/main": { type: "reflection", text: { p1: "X" } } },
      });
      return { ok: true, refused: [] };
    });
    await t.save();
    expect(during).toBe(true);
    // Y is confirmed, and the page shows X: another save.
    expect(t.calls.again).toBe(1);
    t.answerWith(async () => ({ ok: true, refused: [] }));
    await t.save();
    expect(t.sent[1]).toEqual({ v: 2, answers: { "reflection/main": { type: "reflection", text: { p1: "X" } } } });
    expect(courseChanged(t.refs, SLUG, ANA, state({ reflection: reflection("X") }), t.deps.outbox)).toBe(false);
  });

  it("a save that fails leaves what it sent not known (it may have been written) until a save of it is confirmed", async () => {
    const t = setup(state({ reflection: reflection("X") }), state({ reflection: reflection("Y") }));
    t.answerWith(async () => {
      throw lostAnswer();
    });
    await expect(t.save()).rejects.toThrow("Failed to fetch");
    // Unchanged since it was sent: tried again by pending-save.ts, nothing else.
    expect(t.calls.again).toBe(0);
    // Changed back to what the server was known to hold: still a change.
    expect(courseChanged(t.refs, SLUG, ANA, state({ reflection: reflection("X") }), t.deps.outbox)).toBe(true);
    expect(outstandingPatch(t.refs, SLUG)?.answers).toEqual({
      "reflection/main": { type: "reflection", text: { p1: "X" } },
    });
    // Only the question it sent: the others are known.
    t.answerWith(async () => ({ ok: true, refused: [] }));
    await t.save();
    expect(t.refs.acked.get(SLUG)?.reflection).toEqual(reflection("X"));
    expect(courseChanged(t.refs, SLUG, ANA, state({ reflection: reflection("X") }), t.deps.outbox)).toBe(false);
  });

  it("a whole answer (practice) and a self-assessment statement: the same", async () => {
    const key = `${OWN}/${PART}`;
    const before = state({
      simulation: practice("b"),
      responses: { [key]: { type: "rating", values: { s1: 3, s2: 4 } } },
    });
    const t = setup(
      before,
      state({ simulation: practice("a"), responses: { [key]: { type: "rating", values: { s1: 5, s2: 4 } } } })
    );
    t.answerWith(async () => {
      throw lostAnswer();
    });
    await expect(t.save()).rejects.toThrow();
    expect(courseChanged(t.refs, SLUG, ANA, structuredClone(before), t.deps.outbox)).toBe(true);
    expect(outstandingPatch(t.refs, SLUG)?.answers).toEqual({
      "simulation/main": { type: "practice", optionId: "b", correct: true },
      [key]: { type: "rating", values: { s1: 3 } },
    });
  });

  it("a save that fails once the page has changed since it was worked out is followed by another, if something is left", async () => {
    const t = setup(state({ reflection: reflection("X") }), state({ reflection: reflection("Y") }));
    t.answerWith(async () => {
      t.refs.latest.set(SLUG, state({ reflection: reflection("X") }));
      throw lostAnswer();
    });
    await expect(t.save()).rejects.toThrow();
    expect(t.calls.again).toBe(1);
    t.answerWith(async () => ({ ok: true, refused: [] }));
    await t.save();
    expect(t.sent[1]).toEqual({ v: 2, answers: { "reflection/main": { type: "reflection", text: { p1: "X" } } } });
  });

  it("none once the learner's data was let go of", async () => {
    const t = setup(state({ reflection: reflection("X") }), state({ reflection: reflection("Y") }));
    t.answerWith(async () => {
      t.letGo();
      t.refs.latest.set(SLUG, state({ reflection: reflection("X") }));
      throw lostAnswer();
    });
    await expect(t.save()).rejects.toThrow();
    expect(t.calls.again).toBe(0);
  });

  it("a newer build's answer once the learner's data was let go of (signed out, another account): nothing of theirs is kept in the tab", async () => {
    const t = setup(state({ reflection: reflection("X") }), state({ reflection: reflection("Y") }));
    t.deps.outbox?.removeItem(outboxKey(ANA, SLUG));
    t.answerWith(async () => {
      t.letGo();
      throw unknownAction();
    });
    await t.save();
    expect(t.outbox()).toBeNull();
    expect(t.calls.stale, "the page that has let go isn't asked to reload for them").toBe(0);
  });

  it("a newer build wrote nothing: what was sent is as known as before, and the outbox holds what the page shows", async () => {
    const t = setup(state({ reflection: reflection("X") }), state({ reflection: reflection("Y") }));
    t.answerWith(async () => {
      throw unknownAction();
    });
    await t.save();
    expect(t.outbox()?.answers).toEqual({ "reflection/main": { type: "reflection", text: { p1: "Y" } } });
    expect(courseChanged(t.refs, SLUG, ANA, state({ reflection: reflection("X") }), t.deps.outbox)).toBe(false);
    expect(t.outbox()).toBeNull();
  });

  it("a save that finds a newer build keeps, beside the page's answer, what the server holds if a lost save was written: the answer comes back over either", async () => {
    const t = setup(state({ reflection: reflection("X") }), state({ reflection: reflection("Y") }));
    t.answerWith(async () => {
      throw lostAnswer();
    });
    await expect(t.save()).rejects.toThrow();
    // Changed back; its save finds a newer build.
    t.refs.latest.set(SLUG, state({ reflection: reflection("X", "W") }));
    t.answerWith(async () => {
      throw unknownAction();
    });
    await t.save();
    const kept = { v: 2, answers: { "reflection/main": { type: "reflection", text: { p1: "X", p2: "W" } } } };
    expect(t.outbox()).toEqual(kept);
    const tab = t.deps.outbox as OutboxStorage;
    const entry = tab.getItem(outboxKey(ANA, SLUG))!;
    const reloaded = (server: ProgressState) => {
      tab.setItem(outboxKey(ANA, SLUG), entry);
      return restoreOutbox(tab, ANA, SLUG, server);
    };
    // After the reload the server holds Y (the lost save written) or X (not): the page's answers come back.
    expect(reloaded(state({ reflection: reflection("Y") }))).toEqual(kept);
    expect(reloaded(state({ reflection: reflection("X") }))).toEqual(kept);
    // Z, saved elsewhere since: never over it.
    expect(reloaded(state({ reflection: reflection("Z") }))).toEqual({
      v: 2,
      answers: { "reflection/main": { type: "reflection", text: { p2: "W" } } },
    });
  });

  it("after two lost saves of one answer (the first written, the second not) and a newer build, the outbox brings the learner's answer back over the value either may have left", async () => {
    const t = setup(state({ reflection: reflection("X") }), state({ reflection: reflection("Y") }));
    let server = state({ reflection: reflection("X") });
    t.answerWith(async (patch) => {
      server = applyPatch(server, patch);
      throw lostAnswer();
    });
    await expect(t.save()).rejects.toThrow();
    courseChanged(t.refs, SLUG, ANA, state({ reflection: reflection("Z") }), t.deps.outbox);
    t.answerWith(async () => {
      throw lostAnswer();
    });
    await expect(t.save()).rejects.toThrow();
    courseChanged(t.refs, SLUG, ANA, state({ reflection: reflection("W") }), t.deps.outbox);
    t.answerWith(async () => {
      throw unknownAction();
    });
    await t.save();
    expect(server.reflection.p1, "the server holds Y").toBe("Y");
    const kept = { v: 2, answers: { "reflection/main": { type: "reflection", text: { p1: "W" } } } };
    const tab = t.deps.outbox as OutboxStorage;
    const entry = tab.getItem(outboxKey(ANA, SLUG))!;
    for (const p1 of ["X", "Y", "Z"]) {
      tab.setItem(outboxKey(ANA, SLUG), entry);
      expect(restoreOutbox(tab, ANA, SLUG, state({ reflection: reflection(p1) })), `over ${p1}`).toEqual(kept);
    }
    tab.setItem(outboxKey(ANA, SLUG), entry);
    expect(restoreOutbox(tab, ANA, SLUG, state({ reflection: reflection("V") })), "never over an answer saved elsewhere").toBeNull();
  });

  it("keeps a bounded set of what lost saves of an answer may have left: the first ones lost, and the newest", async () => {
    const t = setup(state({ reflection: reflection("X") }), state({ reflection: reflection("v1") }));
    t.answerWith(async () => {
      throw lostAnswer();
    });
    for (let n = 1; n <= 20; n++) {
      courseChanged(t.refs, SLUG, ANA, state({ reflection: reflection(`v${n}`) }), t.deps.outbox);
      await expect(t.save()).rejects.toThrow();
    }
    courseChanged(t.refs, SLUG, ANA, state({ reflection: reflection("W") }), t.deps.outbox);
    t.answerWith(async () => {
      throw unknownAction();
    });
    await t.save();
    const tab = t.deps.outbox as OutboxStorage;
    const entry = tab.getItem(outboxKey(ANA, SLUG))!;
    const alt = (JSON.parse(entry) as { alt: Record<string, { text: { p1: string } }[]> }).alt["reflection/main"];
    expect(alt.map((a) => a.text.p1)).toEqual(["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v20"]);
    const back = (p1: string) => {
      tab.setItem(outboxKey(ANA, SLUG), entry);
      return restoreOutbox(tab, ANA, SLUG, state({ reflection: reflection(p1) }))?.answers?.["reflection/main"] ?? null;
    };
    expect(back("v1")).toEqual({ type: "reflection", text: { p1: "W" } });
    expect(back("v20")).toEqual({ type: "reflection", text: { p1: "W" } });
    expect(back("v10")).toBeNull();
  });

  it("the course loaded again says what the server holds: nothing is left unsure", async () => {
    const t = setup(state({ reflection: reflection("X") }), state({ reflection: reflection("Y") }));
    t.answerWith(async () => {
      throw lostAnswer();
    });
    await expect(t.save()).rejects.toThrow();
    courseLoaded(t.refs, SLUG, state({ reflection: reflection("X") }));
    expect(t.refs.latest.has(SLUG)).toBe(false);
    expect(courseChanged(t.refs, SLUG, ANA, state({ reflection: reflection("X") }), t.deps.outbox)).toBe(false);
  });

  it("tells the learner again about an answer the server refused when it comes back unchanged", async () => {
    const t = setup(state({ reflection: reflection("X") }), state({ reflection: reflection("R") }));
    t.answerWith(async () => ({ ok: true, refused: [{ key: "reflection/main", reason: "row-full" }] }));
    await t.save();
    expect(t.calls.refused).toEqual([[{ key: "reflection/main", reason: "row-full" }]]);
    t.refs.latest.set(SLUG, state({ reflection: reflection("S") }));
    t.answerWith(async () => ({ ok: true, refused: [] }));
    await t.save();
    // Back to R, which the page's notice went with (answerChanged): not sent again, and told again.
    t.refs.latest.set(SLUG, state({ reflection: reflection("R") }));
    await t.save();
    expect(t.sent).toHaveLength(2);
    expect(t.calls.refused).toEqual([
      [{ key: "reflection/main", reason: "row-full" }],
      [{ key: "reflection/main", reason: "row-full" }],
    ]);
  });
});

describe("a course's saves with the page's pending saves (pending-save.ts), as DemoStateProvider wires them: the account ends with what the page shows", () => {
  /** What the facilitator and the next visit read: the answers, as a save would send them. */
  const answersOf = (p: ProgressState) => ({
    stages: [...p.stagesCompleted].sort(),
    simulation: p.simulation?.choice ?? null,
    reflection: p.reflection,
    assessment: { answers: p.assessment.answers, checked: p.assessment.checked },
    responses: Object.fromEntries(
      Object.entries(p.responses).map(([k, v]) => [k, { ...(v as object), at: undefined, retaken: undefined }])
    ),
    completedAt: p.completedAt,
  });
  const RATING = `${OWN}/${PART}`;
  const rating = (s1: 1 | 2 | 3 | 4 | 5) => ({ [RATING]: { type: "rating" as const, values: { s1 } } });

  /** The answer the test gives a save that left the page. */
  interface Answer {
    ok(): void;
    /** The server writes it, and the page gets a dropped connection. */
    lost(): void;
    refuse(keys: RefusedKey[]): void;
    /** A newer build's server: it doesn't know the page's action, and writes nothing. */
    stale(): void;
  }

  /**
   * A page signed in as Ana whose course loaded as `loaded`, and the server
   * holding it. Saves leave the page one at a time, as Next sends server
   * actions: a save handed over while another is on its way waits behind it
   * (`handed`: every save handed over; `sent`: those that left the page).
   * Each save's answer is held until the test gives it (`answers`, one per
   * save sent): `ok`, `lost` or `refuse` (the server refuses some keys).
   * Offline, a save fails as it leaves and nothing is written; `stale`, it
   * finds a newer build. `change` is the course write-through effect, `hide`
   * what the page does when it is hidden or left (demo-state.tsx: pagehide
   * and visibilitychange). `reload` is a pagehide, the page gone and a new
   * one loading the course; `discarded` the page gone with no event, after
   * it was hidden (a phone discarding a tab), and loaded again. A page gone
   * runs nothing more: the save on its way is written (unless
   * `{ written: false }`) and its answer reaches no page; those waiting
   * behind it never leave. `navigateAwayAndBack` is what the store does
   * then (flush() and settle(), then the course's load with the outbox
   * restored).
   */
  function wired(loaded: ProgressState) {
    vi.useFakeTimers();
    let refs = courseSaveRefs();
    courseLoaded(refs, SLUG, loaded);
    let page = loaded;
    const srv = { now: loaded };
    const handed: ProgressPatch[] = [];
    const sent: ProgressPatch[] = [];
    const answers: Answer[] = [];
    const net = { offline: false, stale: false };
    const told: RefusedKey[][] = [];
    let tab = storage();
    let courseSave = pendingSave(700);
    // The learner's session: once it has ended, a save that reaches the
    // server is refused (thrown: "No signed-in learner") and writes nothing.
    const session = { ended: false, endedAfter: [] as ProgressPatch[] };
    // demo-state.tsx: signing out (sign-out.ts) from now on.
    let signingOut = false;
    // Next's queue of server actions: the one on its way, and those waiting behind it.
    let onItsWay: { patch: ProgressPatch; gone: (written: boolean) => void } | null = null;
    let waiting: (() => void)[] = [];
    const next = () => {
      if (!onItsWay) waiting.shift()?.();
    };

    const send = (_slug: string, patch: ProgressPatch): Promise<SaveProgressResult> =>
      new Promise((resolve, reject) => {
        handed.push(patch);
        waiting.push(() => {
          sent.push(patch);
          if (net.offline || net.stale) {
            reject(net.offline ? lostAnswer() : unknownAction());
            return next();
          }
          const signedIn = () => !session.ended;
          let given = false;
          const once = (fn: () => void) => () => {
            if (given) return;
            given = true;
            onItsWay = null;
            fn();
            next();
          };
          onItsWay = {
            patch,
            gone: (written) => {
              given = true;
              if (written && signedIn()) srv.now = applyPatch(srv.now, patch);
            },
          };
          const refusedSignedOut = () => {
            session.endedAfter.push(patch);
            reject(new Error("No signed-in learner, or the session lookup failed"));
          };
          answers.push({
            ok: once(() => {
              if (!signedIn()) return refusedSignedOut();
              srv.now = applyPatch(srv.now, patch);
              resolve({ ok: true, refused: [] });
            }),
            lost: once(() => {
              if (!signedIn()) return refusedSignedOut();
              srv.now = applyPatch(srv.now, patch);
              reject(lostAnswer());
            }),
            refuse: (keys) =>
              once(() => {
                if (!signedIn()) return refusedSignedOut();
                srv.now = applyPatch(srv.now, withoutRefused(patch, keys));
                resolve({ ok: true, refused: keys });
              })(),
            stale: once(() => reject(unknownAction())),
          });
        });
        next();
      });
    // demo-state.tsx: saveFor.
    const saveFor = () => {
      const r = refs;
      const save = (): Promise<void> =>
        saveCourse(SLUG, ANA, r, {
          send,
          refusedKeys: (_s, keys) => void told.push(keys),
          staleBuild: () => undefined,
          outbox: tab,
          again: () => courseSave.schedule(save, SLUG),
          current: () => r === refs,
        });
      return save;
    };
    // demo-state.tsx: the course write-through effect.
    const change = (next: ProgressState) => {
      page = next;
      if (!courseChanged(refs, SLUG, ANA, next, tab)) return;
      courseSave.schedule(saveFor(), SLUG);
    };
    // demo-state.tsx: the course's load, then the outbox restored in the same render.
    const loadAgain = () => {
      courseLoaded(refs, SLUG, srv.now);
      const kept = restoreOutbox(tab, ANA, SLUG, srv.now);
      change(kept ? applyPatch(srv.now, kept) : srv.now);
    };
    // What the page sends with fetch(keepalive) as it goes (D37): the
    // browser finishes it after the page has gone (`inFlight`, until then).
    const beacons: string[] = [];
    let inFlight: string[] = [];
    // demo-state.tsx: pagehide, and visibilitychange to hidden; only a
    // pagehide sends what isn't confirmed outside Next's queue.
    const hide = ({ pagehide = false } = {}) => {
      if (signingOut) return clearEveryOutbox(tab);
      courseSave.flush();
      pageHidden(refs, ANA, tab);
      if (pagehide) {
        const bodies = progressBeacons(refs, ANA);
        beacons.push(...bodies);
        inFlight.push(...bodies);
      }
    };
    // The keepalive requests reach the server (POST /api/progress/beacon,
    // the save action's own code), after the save on the wire, which left
    // the page before them.
    const beaconsArrive = (arrive = true) => {
      for (const body of arrive ? inFlight : []) {
        const { forUser, patch } = JSON.parse(body) as { forUser: string; patch: ProgressPatch };
        if (!session.ended && forUser === ANA) srv.now = applyPatch(srv.now, patch);
      }
      inFlight = [];
    };
    // The page is gone: none of its timers or retries runs again.
    const gone = (written: boolean, beaconsReach = true) => {
      courseSave.drop();
      onItsWay?.gone(written);
      onItsWay = null;
      waiting = [];
      beaconsArrive(beaconsReach);
    };
    // A new page in the same tab loads the course.
    const newPage = () => {
      courseSave = pendingSave(700);
      refs = courseSaveRefs();
      loadAgain();
    };
    return {
      srv,
      handed,
      sent,
      answers,
      net,
      told,
      get tab() {
        return tab;
      },
      change,
      hide: () => hide(),
      beacons,
      shown: () => page,
      /**
       * The page reloaded: its pagehide, then it is gone and a new one
       * loads the course. `beacons: false`: what it sent as it went never
       * reaches the server (lost, or more than a page may send that way).
       */
      reload: async ({ written = true, beacons = true } = {}) => {
        hide({ pagehide: true });
        await vi.advanceTimersByTimeAsync(0);
        gone(written, beacons);
        newPage();
      },
      /**
       * The tab closed: its pagehide, then it is gone; the course opened
       * again in a new tab, with its own sessionStorage.
       */
      closedThenNewTab: async ({ written = true } = {}) => {
        hide({ pagehide: true });
        await vi.advanceTimersByTimeAsync(0);
        gone(written);
        tab = storage();
        newPage();
      },
      /** Hidden before, the page is gone with no event, and the tab loaded again. */
      discarded: async ({ written = true } = {}) => {
        gone(written);
        newPage();
      },
      session,
      /**
       * The header's Sign out (demo-state.tsx, sign-out.ts): the saves
       * first, then the session ends and the page goes (its pagehide,
       * then gone). Resolves with what signOutAfterSaves answers.
       */
      signOut: () =>
        signOutAfterSaves({
          saves: [courseSave],
          signingOut: (on) => void (signingOut = on),
          outbox: tab,
          signOut: async () => {
            session.ended = true;
            hide({ pagehide: true });
            gone(true);
          },
        }),
      /** Another tab signed out, and this one lets go of the learner (demo-state.tsx letGo). */
      letGo: () => {
        courseSave.drop();
        clearEveryOutbox(tab);
        refs = courseSaveRefs();
      },
      outboxKeys: () => Array.from({ length: tab.length }, (_, i) => tab.key(i)).filter((k) => k?.startsWith("seq-elevate-outbox-v1:")),
      /** Another course opened and this one opened again: flush, then settle before the load. */
      navigateAwayAndBack: async () => {
        courseSave.flush();
        let settled = false;
        void courseSave.settle(SLUG).then(() => (settled = true));
        for (let i = 0; i < 100 && !settled; i++) {
          for (const a of answers) a.ok();
          await vi.advanceTimersByTimeAsync(100);
        }
        expect(settled, "the course's saves settled").toBe(true);
        loadAgain();
      },
    };
  }

  /** Every save still waiting for its answer is answered `ok` (and each sent meanwhile), twice over a minute. */
  async function allConfirmed(p: ReturnType<typeof wired>, from = 0) {
    for (let i = 0; i < 2; i++) {
      for (let n = from; n < p.answers.length; n++) p.answers[n].ok();
      await vi.advanceTimersByTimeAsync(60_000);
    }
  }

  it("reflection: changed, then changed back while the change's save is on its way; the server writes the change and its answer is lost", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    expect(p.sent).toHaveLength(1);
    p.change(state({ reflection: reflection("X") }));
    await vi.advanceTimersByTimeAsync(700);
    p.answers[0].lost();
    await vi.advanceTimersByTimeAsync(60_000);
    await allConfirmed(p, 1);
    expect(p.shown().reflection.p1).toBe("X");
    expect(p.srv.now.reflection.p1, "the account holds what the page shows").toBe("X");
  });

  it("guard, a slow answer (longer than the save pause): the same with the change's answer confirmed", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ reflection: reflection("X") }));
    await vi.advanceTimersByTimeAsync(2_000);
    p.answers[0].ok();
    await vi.advanceTimersByTimeAsync(800);
    await allConfirmed(p, 1);
    expect(p.srv.now.reflection.p1).toBe("X");
  });

  it("guard, a slow answer with another question answered meanwhile", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ reflection: reflection("X", "W") }));
    await vi.advanceTimersByTimeAsync(700);
    p.answers[0].ok();
    await vi.advanceTimersByTimeAsync(800);
    await allConfirmed(p, 1);
    expect(p.srv.now.reflection).toEqual(reflection("X", "W"));
  });

  it("reflection, lost: another question answered after the change back, so the change's own save isn't tried again", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("X", "W") }));
    await vi.advanceTimersByTimeAsync(700);
    expect(p.handed).toHaveLength(2);
    expect(p.sent, "the second waits behind the first").toHaveLength(1);
    p.answers[0].lost();
    await vi.advanceTimersByTimeAsync(10);
    p.answers[1].ok();
    await vi.advanceTimersByTimeAsync(60_000);
    await allConfirmed(p, 2);
    expect(p.shown().reflection).toEqual(reflection("X", "W"));
    expect(p.srv.now.reflection, "the account holds what the page shows").toEqual(reflection("X", "W"));
  });

  it("reflection, lost, and the connection gone for every try after (15 s); the change back made once it is back", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    p.net.offline = true;
    p.answers[0].lost();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(p.sent, "tried 1 s, 2 s, 4 s and 8 s after, then left").toHaveLength(5);
    p.net.offline = false;
    p.change(state({ reflection: reflection("X") }));
    await vi.advanceTimersByTimeAsync(60_000);
    await allConfirmed(p, 1);
    expect(p.shown().reflection.p1).toBe("X");
    expect(p.srv.now.reflection.p1, "the account holds what the page shows").toBe("X");
  });

  it("practice: another option chosen ('Try another'), then the first again, and Continue; lost", async () => {
    const best = { choice: "iStatement", correct: true };
    const p = wired(state({ simulation: best }));
    p.change(state({ simulation: { choice: "shrink", correct: false } }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ simulation: best }));
    p.change(state({ simulation: best, stagesCompleted: ["simulation"] }));
    await vi.advanceTimersByTimeAsync(700);
    p.answers[0].lost();
    await vi.advanceTimersByTimeAsync(10);
    p.answers[1].ok();
    await vi.advanceTimersByTimeAsync(60_000);
    await allConfirmed(p, 2);
    expect(p.shown().simulation?.choice).toBe("iStatement");
    expect(p.srv.now.simulation?.choice, "the account holds what the page shows").toBe("iStatement");
    expect(p.srv.now.stagesCompleted).toEqual(["simulation"]);
  });

  it("self-assessment: a statement changed and changed back; lost", async () => {
    const p = wired(state({ responses: rating(3) as ProgressState["responses"] }));
    p.change(state({ responses: rating(4) as ProgressState["responses"] }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ responses: rating(3) as ProgressState["responses"] }));
    await vi.advanceTimersByTimeAsync(700);
    p.answers[0].lost();
    await vi.advanceTimersByTimeAsync(60_000);
    await allConfirmed(p, 1);
    expect(answersOf(p.srv.now).responses, "the account holds what the page shows").toEqual(answersOf(p.shown()).responses);
  });

  it("quick check: 'Try again', then the same answer checked while the retake's save is on its way; lost", async () => {
    const checked = { answers: { q1: "a" }, checked: true };
    const p = wired(state({ assessment: checked }));
    p.change(state({ assessment: { answers: {}, checked: false, retaken: true } as ProgressState["assessment"] }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ assessment: { answers: { q1: "a" }, checked: false, retaken: true } as ProgressState["assessment"] }));
    p.change(state({ assessment: { answers: { q1: "a" }, checked: true, retaken: true } as ProgressState["assessment"] }));
    await vi.advanceTimersByTimeAsync(700);
    p.answers[0].lost();
    await vi.advanceTimersByTimeAsync(60_000);
    await allConfirmed(p, 1);
    expect(answersOf(p.srv.now).assessment, "the account holds what the page shows").toEqual(checked);
  });

  it("guard, a lesson finished whose save's answer is lost: sent again, and the account holds it", async () => {
    const p = wired(state({ stagesCompleted: ["context"] }));
    p.change(state({ stagesCompleted: ["context", "concept"] }));
    await vi.advanceTimersByTimeAsync(700);
    p.answers[0].lost();
    await vi.advanceTimersByTimeAsync(1_000);
    await allConfirmed(p, 1);
    expect(p.srv.now.stagesCompleted).toEqual(["context", "concept"]);
  });

  it("reload in between: lost, changed back, reloaded; the page shows what the learner left, and the account holds it", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ reflection: reflection("X") }));
    p.answers[0].lost();
    await vi.advanceTimersByTimeAsync(300); // before the retry 1 s after: the pagehide sends the change back
    await p.reload();
    await vi.advanceTimersByTimeAsync(60_000);
    await allConfirmed(p, 1);
    expect(p.shown().reflection.p1, "the page after the reload shows what the learner left").toBe("X");
    expect(p.srv.now.reflection.p1).toBe("X");
  });

  it("reload while the change's save is on its way (written by the server, its answer reaching no page), changed back just before: the change back's save, sent by the pagehide, waits behind it and never leaves", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ reflection: reflection("X") }));
    await vi.advanceTimersByTimeAsync(300);
    await p.reload();
    expect(p.handed.map((patch) => patch.answers?.["reflection/main"]), "the pagehide handed the change back over").toEqual([
      { type: "reflection", text: { p1: "Y" } },
      { type: "reflection", text: { p1: "X" } },
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    await allConfirmed(p);
    expect(p.shown().reflection.p1, "the page after the reload shows what the learner left").toBe("X");
    expect(p.srv.now.reflection.p1).toBe("X");
  });

  it("reload while the change's save is on its way (written by the server, its answer reaching no page) and the change back's save waits behind it; what the page sends as it goes lost", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    expect(p.sent).toHaveLength(1);
    p.change(state({ reflection: reflection("X") }));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(p.handed, "the change back's save is handed over").toHaveLength(2);
    expect(p.sent, "and waits behind the change's: Next sends server actions one at a time").toHaveLength(1);
    // What the page sends as it goes (D37) never reaches the server here: the outbox brings it back.
    await p.reload({ beacons: false });
    expect(p.srv.now.reflection.p1, "the server wrote the change").toBe("Y");
    await vi.advanceTimersByTimeAsync(60_000);
    await allConfirmed(p);
    expect(p.shown().reflection.p1, "the page after the reload shows what the learner left").toBe("X");
    expect(p.srv.now.reflection.p1, "the account holds it").toBe("X");
  });

  it("the same, what the page sends as it goes reaching the server after the change's save (D37): the account holds what the learner left at once", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ reflection: reflection("X") }));
    await vi.advanceTimersByTimeAsync(2_000);
    await p.reload();
    expect(p.beacons, "one course's save sent as the page went").toHaveLength(1);
    expect(p.srv.now.reflection.p1, "the account holds what the learner left").toBe("X");
    await vi.advanceTimersByTimeAsync(60_000);
    await allConfirmed(p);
    expect(p.shown().reflection.p1).toBe("X");
    expect(p.srv.now.reflection.p1).toBe("X");
    expect(p.outboxKeys(), "nothing left kept").toEqual([]);
  });

  it("the same with the change's save not written (the connection dropped before the server got it)", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ reflection: reflection("X") }));
    await vi.advanceTimersByTimeAsync(2_000);
    await p.reload({ written: false });
    await vi.advanceTimersByTimeAsync(60_000);
    await allConfirmed(p);
    expect(p.shown().reflection.p1).toBe("X");
    expect(p.srv.now.reflection.p1).toBe("X");
    expect(readOutbox(p.tab, ANA, SLUG), "nothing left kept").toBeNull();
  });

  it("guard: the change's save answered (lost) before the reload: the change back is saved, and the reloaded page shows it", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ reflection: reflection("X") }));
    await vi.advanceTimersByTimeAsync(2_000);
    p.answers[0].lost();
    await allConfirmed(p, 1);
    expect(p.srv.now.reflection.p1).toBe("X");
    await p.reload();
    await allConfirmed(p);
    expect(p.shown().reflection.p1).toBe("X");
    expect(p.srv.now.reflection.p1).toBe("X");
  });

  it("a phone: the tab hidden while the change's save is on its way and the change back's waits behind it, then discarded by the system and loaded again", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ reflection: reflection("X") }));
    await vi.advanceTimersByTimeAsync(2_000);
    p.hide();
    await vi.advanceTimersByTimeAsync(5_000);
    await p.discarded();
    expect(p.srv.now.reflection.p1, "the server wrote the change").toBe("Y");
    await allConfirmed(p);
    expect(p.shown().reflection.p1, "the page loaded again shows what the learner left").toBe("X");
    expect(p.srv.now.reflection.p1, "the account holds it").toBe("X");
  });

  it("a phone: hidden the same way; while hidden the change's save is confirmed and the change back's goes; discarded with it on its way, written or not", async () => {
    for (const written of [true, false]) {
      const p = wired(state({ reflection: reflection("X") }));
      p.change(state({ reflection: reflection("Y") }));
      await vi.advanceTimersByTimeAsync(700);
      p.change(state({ reflection: reflection("X") }));
      await vi.advanceTimersByTimeAsync(2_000);
      p.hide();
      p.answers[0].ok();
      await vi.advanceTimersByTimeAsync(10);
      expect(p.sent, "the change back's save left").toHaveLength(2);
      await p.discarded({ written });
      await allConfirmed(p);
      expect(p.shown().reflection.p1, `the page loaded again shows what the learner left (${written ? "written" : "not written"})`).toBe("X");
      expect(p.srv.now.reflection.p1).toBe("X");
      vi.useRealTimers();
    }
  });

  it("guard, a phone: hidden the same way, every save confirmed while hidden: nothing is left in the outbox, and the page loaded again shows the answer", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ reflection: reflection("X") }));
    await vi.advanceTimersByTimeAsync(2_000);
    p.hide();
    expect(readOutbox(p.tab, ANA, SLUG), "kept while the saves are on their way").not.toBeNull();
    await allConfirmed(p);
    expect(readOutbox(p.tab, ANA, SLUG), "cleared once nothing is left").toBeNull();
    await p.discarded();
    expect(p.shown().reflection.p1).toBe("X");
    expect(p.srv.now.reflection.p1).toBe("X");
  });

  it("what the outbox keeps follows what is confirmed: an answer given again and confirmed after the page was hidden never comes back from it over the answer before", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ reflection: reflection("X") }));
    await vi.advanceTimersByTimeAsync(2_000);
    p.hide();
    // Shown again: another question answered; both saves confirmed.
    p.change(state({ reflection: reflection("X", "W") }));
    p.answers[0].ok();
    await vi.advanceTimersByTimeAsync(10);
    p.answers[1].ok();
    await vi.advanceTimersByTimeAsync(10);
    // The change's text again, saved; the other question changed while that save is on its way.
    p.change(state({ reflection: reflection("Y", "W") }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ reflection: reflection("Y", "W2") }));
    for (let n = 2; n < p.answers.length; n++) p.answers[n].ok();
    await vi.advanceTimersByTimeAsync(10);
    expect(p.srv.now.reflection).toEqual(reflection("Y", "W"));
    // The connection gone for the next save and every try of it.
    p.net.offline = true;
    await vi.advanceTimersByTimeAsync(60_000);
    p.net.offline = false;
    await p.navigateAwayAndBack();
    await allConfirmed(p);
    expect(p.shown().reflection, "the course opened again shows what the learner left").toEqual(reflection("Y", "W2"));
    expect(p.srv.now.reflection).toEqual(reflection("Y", "W2"));
  });

  it("guard: a page hidden with no save on its way keeps nothing in the outbox", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    await allConfirmed(p);
    p.hide();
    expect(readOutbox(p.tab, ANA, SLUG)).toBeNull();
  });

  it("another course opened and this one again in between (settle sends the failed save at once): lost, changed back", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ reflection: reflection("X") }));
    p.answers[0].lost();
    await vi.advanceTimersByTimeAsync(300);
    await p.navigateAwayAndBack();
    await vi.advanceTimersByTimeAsync(60_000);
    await allConfirmed(p, 1);
    expect(p.shown().reflection.p1, "the course opened again shows what the learner left").toBe("X");
    expect(p.srv.now.reflection.p1).toBe("X");
  });

  it("outbox (D68): lost, changed back, then a newer build; after the reload the page shows what the learner left", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ reflection: reflection("X") }));
    p.net.stale = true;
    p.answers[0].lost();
    await vi.advanceTimersByTimeAsync(5_000);
    p.change(state({ reflection: reflection("X", "W") }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(p.sent, "the change back's save and the next found the newer build").toHaveLength(3);
    p.net.stale = false;
    await p.reload();
    await vi.advanceTimersByTimeAsync(60_000);
    await allConfirmed(p, 1);
    expect(p.shown().reflection, "the page after the reload shows what the learner left").toEqual(reflection("X", "W"));
    expect(p.srv.now.reflection).toEqual(reflection("X", "W"));
  });

  it("outbox (D68): lost, the connection gone for every try, changed back, then a newer build; the reloaded page finds the change written and brings the learner's answer back", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    p.net.offline = true;
    p.answers[0].lost();
    await vi.advanceTimersByTimeAsync(60_000);
    p.net.offline = false;
    p.net.stale = true;
    p.change(state({ reflection: reflection("X") }));
    await vi.advanceTimersByTimeAsync(5_000);
    p.net.stale = false;
    await p.reload();
    await vi.advanceTimersByTimeAsync(60_000);
    await allConfirmed(p);
    expect(p.shown().reflection.p1, "the page after the reload shows what the learner left").toBe("X");
    expect(p.srv.now.reflection.p1).toBe("X");
  });

  it("refusal: an answer refused, another saved, then the refused one again: the learner is told again", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("R") }));
    await vi.advanceTimersByTimeAsync(700);
    p.answers[0].refuse([{ key: "reflection/main", reason: "row-full" }]);
    await vi.advanceTimersByTimeAsync(10);
    expect(p.told).toHaveLength(1);
    p.change(state({ reflection: reflection("S") }));
    await vi.advanceTimersByTimeAsync(700);
    p.answers[1].ok();
    await vi.advanceTimersByTimeAsync(10);
    p.change(state({ reflection: reflection("R") })); // the page's notice went with the change to S (answerChanged)
    await vi.advanceTimersByTimeAsync(60_000);
    expect(p.sent).toHaveLength(2);
    expect(p.told).toEqual([
      [{ key: "reflection/main", reason: "row-full" }],
      [{ key: "reflection/main", reason: "row-full" }],
    ]);
  });

  it("guard: offline once the change's answer is lost, a bounded number of tries, never every 700 ms; the next change carries the answer", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    p.change(state({ reflection: reflection("Y") }));
    await vi.advanceTimersByTimeAsync(700);
    p.change(state({ reflection: reflection("X") }));
    p.net.offline = true;
    p.answers[0].lost();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(p.sent.length).toBeLessThanOrEqual(6);
    p.net.offline = false;
    p.change(state({ reflection: reflection("X", "W") }));
    await vi.advanceTimersByTimeAsync(700);
    await allConfirmed(p);
    expect(p.srv.now.reflection, "the next change carries the answer").toEqual(reflection("X", "W"));
  });

  it("guard: saves slower than the pause, answered one at a time while the next is on its way, come to an end", async () => {
    const p = wired(state({ reflection: reflection("X") }));
    for (const text of ["a", "ab", "abc", "abcd"]) {
      p.change(state({ reflection: reflection(text) }));
      await vi.advanceTimersByTimeAsync(1_000);
    }
    // Next sends server actions one at a time: each answered 1.5 s after the one before.
    let answered = 0;
    for (let i = 0; i < 30 && answered < p.answers.length; i++) {
      p.answers[answered++].ok();
      await vi.advanceTimersByTimeAsync(1_500);
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(answered, "every save answered, and none left on its way").toBe(p.answers.length);
    expect(p.sent.length).toBeLessThanOrEqual(8);
    expect(p.srv.now.reflection.p1).toBe("abcd");
  });

  describe("signing out from the header (D68): the saves first, then the session ends", () => {
    it("signed out within the save pause after a change: the save is sent at once and confirmed before the session ends", async () => {
      const p = wired(state({ reflection: reflection("X") }));
      p.change(state({ reflection: reflection("Y") }));
      await vi.advanceTimersByTimeAsync(150);
      let done: boolean | undefined;
      void p.signOut().then((v) => (done = v));
      await vi.advanceTimersByTimeAsync(0);
      expect(p.sent, "sent now, not after the pause").toHaveLength(1);
      expect(p.session.ended, "the session ends only once the save is answered").toBe(false);
      p.answers[0].ok();
      await vi.advanceTimersByTimeAsync(0);
      expect(done, "nothing was left").toBe(true);
      expect(p.session.ended).toBe(true);
      expect(p.srv.now.reflection.p1, "the account holds the change").toBe("Y");
      expect(p.session.endedAfter, "no save reached the server after the session ended").toEqual([]);
      expect(p.outboxKeys(), "nothing of the learner stays in the tab").toEqual([]);
    });

    it("the change's save on its way and the change back's waiting behind it: both are answered before the session ends, and the account holds the change back", async () => {
      const p = wired(state({ reflection: reflection("X") }));
      p.change(state({ reflection: reflection("Y") }));
      await vi.advanceTimersByTimeAsync(700);
      p.change(state({ reflection: reflection("X") }));
      await vi.advanceTimersByTimeAsync(150);
      let done: boolean | undefined;
      void p.signOut().then((v) => (done = v));
      await vi.advanceTimersByTimeAsync(0);
      expect(p.handed, "the change back's save handed over now").toHaveLength(2);
      p.answers[0].lost();
      await vi.advanceTimersByTimeAsync(10);
      expect(p.session.ended).toBe(false);
      p.answers[1].ok();
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
      expect(p.session.ended).toBe(true);
      expect(p.srv.now.reflection.p1, "the account holds what the learner left").toBe("X");
      expect(p.session.endedAfter).toEqual([]);
    });

    it("a save on its way that isn't answered within 3 s: the sign-out goes ahead, answers that something was left, and keeps nothing of the learner in the tab", async () => {
      const p = wired(state({ reflection: reflection("X") }));
      p.change(state({ reflection: reflection("Y") }));
      await vi.advanceTimersByTimeAsync(700);
      p.change(state({ reflection: reflection("Z") }));
      let done: boolean | undefined;
      void p.signOut().then((v) => (done = v));
      await vi.advanceTimersByTimeAsync(2_999);
      expect(p.session.ended, "it waits for the save on its way").toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done, "something was left").toBe(false);
      expect(p.session.ended).toBe(true);
      expect(p.outboxKeys(), "the page's pagehide keeps nothing of the learner in the tab").toEqual([]);
    });

    it("guard: nothing waiting or on its way: the sign-out goes ahead at once", async () => {
      const p = wired(state({ reflection: reflection("X") }));
      let done: boolean | undefined;
      void p.signOut().then((v) => (done = v));
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
      expect(p.session.ended).toBe(true);
      expect(p.sent).toEqual([]);
    });

    it("another tab signs out while this one, hidden with a save on its way, kept an entry: the entry goes when this tab lets go, and a newer build's answer after keeps nothing", async () => {
      const p = wired(state({ reflection: reflection("X") }));
      p.change(state({ reflection: reflection("Y") }));
      await vi.advanceTimersByTimeAsync(700);
      p.hide();
      expect(p.outboxKeys(), "hidden with a save on its way: kept").toHaveLength(1);
      p.session.ended = true;
      p.letGo();
      expect(p.outboxKeys(), "let go of: cleared").toEqual([]);
      p.answers[0].stale();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(p.outboxKeys(), "the late answer keeps nothing of the learner").toEqual([]);
    });
  });

  describe("the tab closed (D37): what isn't confirmed leaves outside Next's queue as the page goes", () => {
    it("C1 closed with the change's save on the wire and the change back's waiting behind it (the one on the wire written); the course opened again in a new tab: the account and the new tab hold what the learner left", async () => {
      const p = wired(state({ reflection: reflection("X") }));
      p.change(state({ reflection: reflection("Y") }));
      await vi.advanceTimersByTimeAsync(700);
      p.change(state({ reflection: reflection("X") }));
      await vi.advanceTimersByTimeAsync(700);
      expect(p.sent, "the change back's save waits behind the change's").toHaveLength(1);
      await p.closedThenNewTab({ written: true });
      expect(p.srv.now.reflection.p1, "the account holds what the learner left").toBe("X");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(p.shown().reflection.p1, "the new tab shows it").toBe("X");
    });

    it("C1b closed with one question's save on the wire and another question answered after it left: the account holds both", async () => {
      const p = wired(state({ reflection: reflection("X") }));
      p.change(state({ reflection: reflection("Y") }));
      await vi.advanceTimersByTimeAsync(700);
      p.change(state({ reflection: reflection("Y", "W") }));
      await vi.advanceTimersByTimeAsync(700);
      await p.closedThenNewTab({ written: true });
      expect(p.srv.now.reflection).toEqual(reflection("Y", "W"));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(p.shown().reflection).toEqual(reflection("Y", "W"));
    });

    it("C2 closed within the save pause after the change, the save it sends never leaving the closing page: the account holds the change", async () => {
      const p = wired(state({ reflection: reflection("X") }));
      p.change(state({ reflection: reflection("Y") }));
      await vi.advanceTimersByTimeAsync(150);
      await p.closedThenNewTab({ written: false });
      expect(p.srv.now.reflection.p1).toBe("Y");
    });

    it("closed while a failed save waits to be tried again: the account holds the answer", async () => {
      const p = wired(state({ reflection: reflection("X") }));
      p.net.offline = true;
      p.change(state({ reflection: reflection("Y") }));
      await vi.advanceTimersByTimeAsync(700); // failed: tried again in 1 s
      p.net.offline = false;
      await p.closedThenNewTab();
      expect(p.srv.now.reflection.p1).toBe("Y");
    });

    it("a lesson finished and the course completed, then closed with the save on the wire written: the completion once, as the save wrote it", async () => {
      const p = wired(state({ stagesCompleted: ["context"] }));
      p.change(state({ stagesCompleted: ["context", "concept"], completedAt: "2026-11-10T09:00:00.000Z" }));
      await vi.advanceTimersByTimeAsync(700);
      await p.closedThenNewTab({ written: true });
      expect(p.srv.now.stagesCompleted).toEqual(["context", "concept"]);
      expect(p.srv.now.completedAt).toBe("2026-11-10T09:00:00.000Z");
    });

    it("guard: closed with every save confirmed: nothing is sent that way", async () => {
      const p = wired(state({ reflection: reflection("X") }));
      p.change(state({ reflection: reflection("Y") }));
      await vi.advanceTimersByTimeAsync(700);
      p.answers[0].ok();
      await vi.advanceTimersByTimeAsync(0);
      await p.closedThenNewTab();
      expect(p.beacons).toEqual([]);
      expect(p.srv.now.reflection.p1).toBe("Y");
    });

    it("guard: hidden (a phone), not left: nothing is sent that way; the outbox keeps it", async () => {
      const p = wired(state({ reflection: reflection("X") }));
      p.change(state({ reflection: reflection("Y") }));
      await vi.advanceTimersByTimeAsync(700);
      p.hide();
      expect(p.beacons).toEqual([]);
      expect(p.outboxKeys()).toHaveLength(1);
    });

    it("guard: signed out from the page: nothing is sent that way", async () => {
      const p = wired(state({ reflection: reflection("X") }));
      p.change(state({ reflection: reflection("Y") }));
      await vi.advanceTimersByTimeAsync(700);
      void p.signOut();
      await vi.advanceTimersByTimeAsync(3_000);
      expect(p.session.ended).toBe(true);
      expect(p.beacons).toEqual([]);
    });
  });
});
