import { describe, it, expect } from "vitest";
import { RESPONSE_LIMITS, type ProgressPatch } from "@/lib/learner-progress/contract";
import {
  OUTBOX_PREFIX,
  clearOutbox,
  outboxKey,
  putInOutbox,
  readOutbox,
  type OutboxStorage,
} from "./outbox";

/*
 * U12 (spec 5.4, D68): a save the server can't take because this page is
 * from an older build is kept in the tab's outbox, read back after the
 * reload for the same learner only, and cleared (course-save.test.ts:
 * once nothing the page holds is left to send).
 */

/** sessionStorage, in memory. */
function storage(): OutboxStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, String(v)),
    removeItem: (k) => void items.delete(k),
  };
}

const OWN = "s-abcdefgh";
const PART = "p-12345678";
const ANA = "user-ana";
const BEN = "user-ben";
const SLUG = "workplace-conflict";

const first: ProgressPatch = {
  v: 2,
  completed: ["context", OWN],
  answers: {
    "simulation/main": { type: "practice", optionId: "a", correct: false },
    [`${OWN}/${PART}`]: { type: "reflection", text: { q1: "First", q2: "Kept" } },
    [`concept/${PART}`]: { type: "rating", values: { s1: 2 } },
  },
};
const second: ProgressPatch = {
  v: 2,
  completed: [OWN, "concept"],
  answers: {
    "simulation/main": { type: "practice", optionId: "b", correct: true },
    [`${OWN}/${PART}`]: { type: "reflection", text: { q1: "Second" } },
    [`concept/${PART}`]: { type: "rating", values: { s2: 5 } },
  },
  completedAt: "2026-11-10T09:00:00.000Z",
};

describe("the outbox's key", () => {
  it("names the learner and the course", () => {
    expect(outboxKey(ANA, SLUG)).toBe(`${OUTBOX_PREFIX}${ANA}:${SLUG}`);
    expect(OUTBOX_PREFIX).toBe("seq-elevate-outbox-v1:");
  });
});

describe("putInOutbox and readOutbox", () => {
  it("keeps a patch for the learner and course it was made for", () => {
    const s = storage();
    expect(putInOutbox(s, ANA, SLUG, first)).toBe(true);
    expect(readOutbox(s, ANA, SLUG)).toEqual(first);
  });

  it("keeps a later patch in place of what is waiting: the page sending it holds all of that, or changed it since", () => {
    // `first`'s practice "a" was changed to "b" since: merged in, "a"
    // would come back after the reload over the learner's later answer.
    const s = storage();
    putInOutbox(s, ANA, SLUG, first);
    putInOutbox(s, ANA, SLUG, second);
    expect(readOutbox(s, ANA, SLUG)).toEqual(second);
  });

  it("never hands one learner's outbox to another", () => {
    const s = storage();
    putInOutbox(s, ANA, SLUG, first);
    expect(readOutbox(s, BEN, SLUG)).toBeNull();
    // Another course of the same learner has its own.
    expect(readOutbox(s, ANA, "receiving-feedback")).toBeNull();
    // Ben's own changes don't touch Ana's.
    putInOutbox(s, BEN, SLUG, second);
    expect(readOutbox(s, ANA, SLUG)).toEqual(first);
  });

  it("is cleared for that learner and course only", () => {
    const s = storage();
    putInOutbox(s, ANA, SLUG, first);
    putInOutbox(s, BEN, SLUG, second);
    clearOutbox(s, ANA, SLUG);
    expect(readOutbox(s, ANA, SLUG)).toBeNull();
    expect(readOutbox(s, BEN, SLUG)).toEqual(second);
  });

  it("never sends a guest's move again: fill mode isn't kept", () => {
    const s = storage();
    putInOutbox(s, ANA, SLUG, { ...first, fill: true });
    expect(readOutbox(s, ANA, SLUG)).toEqual(first);
  });

  it("reads back only what a patch can hold, and keeps a reflection over the length limit for the learner to shorten", () => {
    const s = storage();
    const long = "x".repeat(RESPONSE_LIMITS.reflectionChars + 1);
    s.setItem(
      outboxKey(ANA, SLUG),
      JSON.stringify({
        v: 2,
        completed: ["context", "nonsense", "context"],
        answers: {
          "simulation/main": { type: "practice", optionId: "a", correct: false },
          "not a key": { type: "practice", optionId: "a", correct: false },
          "scenario/main": { type: "rating", values: { s1: 1 } },
          [`${OWN}/${PART}`]: { type: "reflection", text: { q1: long } },
        },
        completedAt: "not a date",
      })
    );
    expect(readOutbox(s, ANA, SLUG)).toEqual({
      v: 2,
      completed: ["context"],
      answers: {
        "simulation/main": { type: "practice", optionId: "a", correct: false },
        [`${OWN}/${PART}`]: { type: "reflection", text: { q1: long } },
      },
    });
  });

  it("reads back a rating or reflection with more questions than one save may carry: the store sends it a save's worth at a time", () => {
    const s = storage();
    const values = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`st${i + 1}`, 3 as const]));
    const text = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`q${i + 1}`, `Answer ${i + 1}`]));
    const kept: ProgressPatch = {
      v: 2,
      answers: {
        [`${OWN}/${PART}`]: { type: "rating", values },
        [`${OWN}/p-87654321`]: { type: "reflection", text },
      },
    };
    s.setItem(outboxKey(ANA, SLUG), JSON.stringify(kept));
    expect(readOutbox(s, ANA, SLUG)).toEqual(kept);
  });

  it("is null for an entry it can't read, or one with nothing in it", () => {
    const s = storage();
    s.setItem(outboxKey(ANA, SLUG), "{not json");
    expect(readOutbox(s, ANA, SLUG)).toBeNull();
    s.setItem(outboxKey(ANA, SLUG), JSON.stringify({ v: 1, completed: ["context"] }));
    expect(readOutbox(s, ANA, SLUG)).toBeNull();
    s.setItem(outboxKey(ANA, SLUG), JSON.stringify({ v: 2, answers: { x: 1 } }));
    expect(readOutbox(s, ANA, SLUG)).toBeNull();
  });

  it("never throws when the browser's storage does, and says the patch wasn't kept", () => {
    const broken: OutboxStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(putInOutbox(broken, ANA, SLUG, first)).toBe(false);
    expect(readOutbox(broken, ANA, SLUG)).toBeNull();
    expect(() => clearOutbox(broken, ANA, SLUG)).not.toThrow();
    expect(putInOutbox(null, ANA, SLUG, first)).toBe(false);
    expect(readOutbox(null, ANA, SLUG)).toBeNull();
  });
});
