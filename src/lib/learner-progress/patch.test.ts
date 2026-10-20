import { describe, it, expect } from "vitest";
import { RESPONSE_LIMITS, type ProgressPatch, type ProgressState } from "./contract";
import { EMPTY_PROGRESS, applyPatch, fitPatch, patchSince, withoutRefused } from "./patch";
import { parseProgressPatch } from "./parse";

/*
 * U4 (spec 5.4): what the learner store sends. A patch is worked out when
 * it is sent, against what the server has confirmed (`acked`), so a retry
 * or a later save always carries everything not yet confirmed; a value
 * changed back while a save was on its way is sent again; and nothing the
 * server would refuse, or a patch too big for it, leaves the browser.
 */

const OWN = "s-abcdefgh";
const PART = "p-12345678";
const state = (p: Partial<ProgressState> = {}): ProgressState => ({ ...EMPTY_PROGRESS, ...p });

describe("patchSince", () => {
  it("is null when there is nothing new", () => {
    expect(patchSince(EMPTY_PROGRESS, EMPTY_PROGRESS)).toBeNull();
    const s = state({ stagesCompleted: ["context"], simulation: { choice: "a", correct: true } });
    expect(patchSince(s, structuredClone(s))).toBeNull();
  });

  it("holds lessons finished since, answers changed since, and a new completion", () => {
    const acked = state({ stagesCompleted: ["context"] });
    const latest = state({
      stagesCompleted: ["context", "concept"],
      sectionsCompleted: [OWN],
      simulation: { choice: "a", correct: false },
      scenario: { root: "c1", followup: "f1", rootLabel: "A", followupLabel: "B" },
      assessment: { answers: { q1: "x" }, checked: true },
      responses: { [`${OWN}/main`]: { type: "practice", optionId: "o", correct: true } },
      completedAt: "2026-11-10T09:00:00.000Z",
    });
    expect(patchSince(acked, latest)).toEqual({
      v: 2,
      completed: ["concept", OWN],
      answers: {
        "simulation/main": { type: "practice", optionId: "a", correct: false },
        "scenario/main": { type: "scenario", rootId: "c1", followupId: "f1" },
        "assessment/main": { type: "quiz", answers: { q1: "x" }, checked: true },
        [`${OWN}/main`]: { type: "practice", optionId: "o", correct: true },
      },
      completedAt: "2026-11-10T09:00:00.000Z",
    });
  });

  it("sends a reflection and a rating question by question", () => {
    const acked = state({
      reflection: { p1: "A", p2: "B", p3: "" },
      responses: {
        [`${OWN}/${PART}`]: { type: "reflection", text: { a: "x", b: "y" } },
        [`concept/${PART}`]: { type: "rating", values: { s1: 1, s2: 2 } },
      },
    });
    const latest = state({
      reflection: { p1: "A", p2: "B2", p3: "" },
      responses: {
        [`${OWN}/${PART}`]: { type: "reflection", text: { a: "x", b: "y2", c: "new" } },
        [`concept/${PART}`]: { type: "rating", values: { s1: 1, s2: 5 } },
      },
    });
    expect(patchSince(acked, latest)?.answers).toEqual({
      "reflection/main": { type: "reflection", text: { p2: "B2" } },
      [`${OWN}/${PART}`]: { type: "reflection", text: { b: "y2", c: "new" } },
      [`concept/${PART}`]: { type: "rating", values: { s2: 5 } },
    });
  });

  it("sends a reflection the learner emptied", () => {
    const acked = state({ reflection: { p1: "Something", p2: "", p3: "" } });
    expect(patchSince(acked, state())?.answers).toEqual({
      "reflection/main": { type: "reflection", text: { p1: "" } },
    });
  });

  it("sends a quick check tried again, without the store's mark", () => {
    const acked = state({ assessment: { answers: { q1: "x" }, checked: true } });
    const latest = state({ assessment: { answers: {}, checked: false, retaken: true } });
    expect(patchSince(acked, latest)?.answers).toEqual({
      "assessment/main": { type: "quiz", answers: {}, checked: false },
    });
  });

  it("never sends a completion the server already has", () => {
    const done = "2026-11-10T09:00:00.000Z";
    expect(patchSince(state({ completedAt: done }), state({ completedAt: done }))).toBeNull();
  });

  it("is a patch the server takes as it is", () => {
    const latest = state({
      stagesCompleted: ["context"],
      sectionsCompleted: [OWN],
      reflection: { p1: "a", p2: "", p3: "" },
      responses: { [`${OWN}/${PART}`]: { type: "rating", values: { s: 3 } } },
      completedAt: "2026-11-10T09:00:00.000Z",
    });
    const r = parseProgressPatch(patchSince(EMPTY_PROGRESS, latest), new Date("2026-11-10T09:00:00.000Z"));
    expect(r.ok && r.patch.refused).toEqual([]);
  });
});

describe("applyPatch", () => {
  it("round-trips: once the patch is confirmed, nothing is left to send", () => {
    const latest = state({
      stagesCompleted: ["context", "concept"],
      sectionsCompleted: [OWN],
      simulation: { choice: "a", correct: true },
      scenario: { root: "c1", followup: null },
      reflection: { p1: "x", p2: "", p3: "z" },
      assessment: { answers: { q1: "a" }, checked: false },
      responses: {
        [`${OWN}/${PART}`]: { type: "reflection", text: { a: "1" } },
        [`${OWN}/main`]: { type: "quiz", answers: {}, checked: false, retaken: true },
      },
      completedAt: "2026-11-10T09:00:00.000Z",
    });
    const p = patchSince(EMPTY_PROGRESS, latest)!;
    const acked = applyPatch(EMPTY_PROGRESS, p);
    expect(patchSince(acked, latest)).toBeNull();
    expect(acked.completedAt).toBe(latest.completedAt);
  });

  it("keeps what it already has for what the patch leaves out", () => {
    const acked = state({ reflection: { p1: "keep", p2: "", p3: "" }, stagesCompleted: ["context"] });
    const next = applyPatch(acked, { v: 2, answers: { "reflection/main": { type: "reflection", text: { p2: "new" } } } });
    expect(next.reflection).toEqual({ p1: "keep", p2: "new", p3: "" });
    expect(next.stagesCompleted).toEqual(["context"]);
  });

  it("sends a value changed back while a save was on its way", () => {
    const acked = state({ simulation: { choice: "a", correct: true } });
    const changed = state({ simulation: { choice: "b", correct: false } });
    const sent = patchSince(acked, changed)!;
    // Before the save is confirmed, the learner picks "a" again.
    const latest = acked;
    const confirmed = applyPatch(acked, sent);
    expect(patchSince(confirmed, latest)?.answers).toEqual({
      "simulation/main": { type: "practice", optionId: "a", correct: true },
    });
  });

  it("ends with the newest value sent when confirmations come back out of order", () => {
    const first = state({ responses: { [`${OWN}/main`]: { type: "practice", optionId: "a", correct: true } } });
    const second = state({ responses: { [`${OWN}/main`]: { type: "practice", optionId: "b", correct: false } } });
    const p1 = patchSince(EMPTY_PROGRESS, first)!;
    const p2 = patchSince(EMPTY_PROGRESS, second)!; // worked out while p1 wasn't confirmed yet
    const acked = applyPatch(applyPatch(EMPTY_PROGRESS, p2), p1);
    // The server may hold either; the newest is sent again until confirmed last.
    expect(patchSince(acked, second)?.answers).toEqual(p2.answers);
    expect(patchSince(applyPatch(acked, p2), second)).toBeNull();
  });
});

describe("withoutRefused", () => {
  it("leaves out the keys and lessons the server refused, so they aren't marked as saved", () => {
    const p: ProgressPatch = {
      v: 2,
      completed: ["context", OWN],
      answers: {
        "simulation/main": { type: "practice", optionId: "a", correct: true },
        [`${OWN}/main`]: { type: "practice", optionId: "b", correct: true },
      },
    };
    expect(
      withoutRefused(p, [
        { key: OWN, reason: "invalid" },
        { key: `${OWN}/main`, reason: "row-full" },
      ])
    ).toEqual({
      v: 2,
      completed: ["context"],
      answers: { "simulation/main": { type: "practice", optionId: "a", correct: true } },
    });
  });
});

describe("fitPatch", () => {
  it("sends a patch that fits as it is", () => {
    const p: ProgressPatch = { v: 2, completed: ["context"], completedAt: "2026-11-10T09:00:00.000Z" };
    expect(fitPatch(p)).toEqual({ patch: p, held: [], more: false });
  });

  it("holds back what the server would refuse, and sends the rest", () => {
    const p: ProgressPatch = {
      v: 2,
      completed: ["context", "CONCEPT"],
      answers: {
        [`${OWN}/main`]: { type: "practice", optionId: "", correct: true },
        [`${OWN}/${PART}`]: { type: "rating", values: { s: 3 } },
      },
    };
    expect(fitPatch(p)).toEqual({
      patch: { v: 2, completed: ["context"], answers: { [`${OWN}/${PART}`]: { type: "rating", values: { s: 3 } } } },
      held: [
        { key: "CONCEPT", reason: "invalid" },
        { key: `${OWN}/main`, reason: "invalid" },
      ],
      more: false,
    });
  });

  it("holds back only the reflection answer that is too long, and sends the others beside it", () => {
    const long = "x".repeat(RESPONSE_LIMITS.reflectionChars + 1);
    const r = fitPatch({
      v: 2,
      answers: {
        "reflection/main": { type: "reflection", text: { p1: "fine", p2: long } },
        [`${OWN}/${PART}`]: { type: "reflection", text: { a: long } },
      },
    });
    expect(r.patch).toEqual({ v: 2, answers: { "reflection/main": { type: "reflection", text: { p1: "fine" } } } });
    expect(r.held).toEqual([
      { key: "reflection/main", reason: "too-long" },
      { key: `${OWN}/${PART}`, reason: "too-long" },
    ]);
  });

  it("is null when nothing can be sent", () => {
    expect(fitPatch({ v: 2, completed: ["nope"] })).toEqual({
      patch: null,
      held: [{ key: "nope", reason: "invalid" }],
      more: false,
    });
  });

  it("splits a patch at the limit; the rest goes in the next save", () => {
    const text = "y".repeat(RESPONSE_LIMITS.reflectionChars);
    const responses: ProgressState["responses"] = {};
    for (let i = 0; i < 80; i++) {
      responses[`${OWN}/p-${String(i).padStart(8, "0")}`] = { type: "reflection", text: { a: text } };
    }
    const latest = state({ responses, completedAt: "2026-11-10T09:00:00.000Z" });
    let acked = EMPTY_PROGRESS;
    let sends = 0;
    for (let p = patchSince(acked, latest); p; p = patchSince(acked, latest)) {
      const fit = fitPatch(p);
      expect(fit.patch).not.toBeNull();
      expect(JSON.stringify(fit.patch).length).toBeLessThanOrEqual(RESPONSE_LIMITS.patchJsonChars);
      const r = parseProgressPatch(fit.patch, new Date("2026-11-10T09:00:00.000Z"));
      expect(r.ok).toBe(true);
      acked = applyPatch(acked, fit.patch!);
      sends++;
      expect(fit.more).toBe(patchSince(acked, latest) !== null);
    }
    expect(sends).toBe(2);
    expect(Object.keys(acked.responses)).toHaveLength(80);
  });

  it("splits at the number of keys and finished lessons a patch may hold", () => {
    const responses: ProgressState["responses"] = {};
    for (let i = 0; i < RESPONSE_LIMITS.keysPerPatch + 5; i++) {
      responses[`${OWN}/p-${String(i).padStart(8, "0")}`] = { type: "rating", values: { s: 1 } };
    }
    const sectionsCompleted = Array.from({ length: RESPONSE_LIMITS.completedPerPatch + 3 }, (_, i) =>
      `s-${String(i).padStart(8, "0")}`
    );
    const fit = fitPatch(patchSince(EMPTY_PROGRESS, state({ responses, sectionsCompleted }))!);
    expect(Object.keys(fit.patch!.answers!)).toHaveLength(RESPONSE_LIMITS.keysPerPatch);
    expect(fit.patch!.completed).toHaveLength(RESPONSE_LIMITS.completedPerPatch);
    expect(fit.more).toBe(true);
  });

  it("sends a rating or reflection with more questions than one save may carry a save's worth at a time, holding none back", () => {
    // An editor may swap a statement or a prompt of a live question (D33),
    // so a learner can hold more answers to one than a save may carry —
    // all of them new to the server when a guest's course moves in.
    const values = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`st${i + 1}`, 3 as const]));
    const text = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`q${i + 1}`, `Answer ${i + 1}`]));
    const latest = state({
      responses: {
        [`${OWN}/p-rating01`]: { type: "rating", values },
        [`${OWN}/${PART}`]: { type: "reflection", text },
      },
    });
    let acked = EMPTY_PROGRESS;
    let sends = 0;
    for (let p = patchSince(acked, latest); p && sends < 5; p = patchSince(acked, latest)) {
      const fit = fitPatch({ ...p, fill: true });
      expect(fit.held).toEqual([]);
      const r = parseProgressPatch(fit.patch, new Date("2026-11-10T09:00:00.000Z"));
      expect(r.ok && r.patch.refused).toEqual([]);
      acked = applyPatch(acked, fit.patch!);
      sends++;
      expect(fit.more).toBe(patchSince(acked, latest) !== null);
    }
    expect(sends).toBe(2);
    expect(acked.responses).toEqual(latest.responses);
  });

  it("keeps the fill flag", () => {
    expect(fitPatch({ v: 2, completed: ["context"], fill: true }).patch).toEqual({
      v: 2,
      completed: ["context"],
      fill: true,
    });
  });
});
