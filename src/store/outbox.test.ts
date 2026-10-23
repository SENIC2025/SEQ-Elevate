import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RESPONSE_LIMITS, type ProgressPatch, type ProgressState } from "@/lib/learner-progress/contract";
import { EMPTY_PROGRESS } from "@/lib/learner-progress/patch";
import {
  OUTBOX_PREFIX,
  clearEveryOutbox,
  clearOutbox,
  outboxKey,
  putInOutbox,
  readOutbox,
  restoreOutbox,
  type OutboxStorage,
} from "./outbox";

/*
 * U12 (spec 5.4, D68): a save the server can't take because this page is
 * from an older build is kept in the tab's outbox, read back after the
 * reload for the same learner only, and cleared (course-save.test.ts:
 * once nothing the page holds is left to send).
 */

/** sessionStorage, in memory. */
function storage(): OutboxStorage & { items: Map<string, string>; readonly length: number; key(i: number): string | null } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, String(v)),
    removeItem: (k) => void items.delete(k),
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
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

/*
 * Found at integration review (finding 4: data #2 with security #5). The
 * outbox was applied over whatever the server held when the page loaded
 * again: a stale tab answers X (kept, the build gone), the learner's phone
 * saves Y, the tab reloads — and X replaced Y. The same after a rollback
 * and roll-forward, since Release 1 never reads or clears the outbox. And
 * it outlived the learner: after a sign-out (or the account's erasure) the
 * tab still held their answers, reflection text included.
 */
const server = (p: Partial<ProgressState>): ProgressState => ({ ...EMPTY_PROGRESS, ...p });
const practiceOf = (optionId: string) => ({ choice: optionId, correct: false });

describe("restoreOutbox: what the outbox brings back over what the server holds now", () => {
  const kept: ProgressPatch = {
    v: 2,
    completed: ["context", OWN],
    answers: {
      "simulation/main": { type: "practice", optionId: "x", correct: false },
      [`${OWN}/${PART}`]: { type: "reflection", text: { q1: "Tab", q2: "Tab two" } },
      [`concept/${PART}`]: { type: "rating", values: { s1: 2, s2: 4 } },
    },
    completedAt: "2026-11-10T09:00:00.000Z",
  };
  // What the server held when the tab's save failed.
  const base = server({
    simulation: practiceOf("y0"),
    responses: { [`${OWN}/${PART}`]: { type: "reflection", text: { q1: "Before", q2: "Before two" } } },
  });

  it("brings back every answer the server still holds as it was when the tab kept it", () => {
    const s = storage();
    putInOutbox(s, ANA, SLUG, kept, base);
    expect(restoreOutbox(s, ANA, SLUG, base)).toEqual(kept);
    // Kept until a save of it is confirmed (course-save.ts).
    expect(readOutbox(s, ANA, SLUG)).toEqual(kept);
  });

  it("never brings an answer back over a newer one saved elsewhere since, field by field", () => {
    const s = storage();
    putInOutbox(s, ANA, SLUG, kept, base);
    const now = server({
      // The phone saved Y; and the first reflection question, and a rating.
      simulation: practiceOf("y"),
      responses: {
        [`${OWN}/${PART}`]: { type: "reflection", text: { q1: "Phone", q2: "Before two" } },
        [`concept/${PART}`]: { type: "rating", values: { s1: 5 } },
      },
    });
    const restored = {
      v: 2,
      completed: ["context", OWN],
      answers: {
        [`${OWN}/${PART}`]: { type: "reflection", text: { q2: "Tab two" } },
        [`concept/${PART}`]: { type: "rating", values: { s2: 4 } },
      },
      completedAt: "2026-11-10T09:00:00.000Z",
    };
    expect(restoreOutbox(s, ANA, SLUG, now)).toEqual(restored);
    // What the server moved past is gone from the outbox for good.
    expect(readOutbox(s, ANA, SLUG)).toEqual(restored);
  });

  it("clears the outbox when nothing in it can come back", () => {
    const s = storage();
    putInOutbox(s, ANA, SLUG, { v: 2, answers: { "simulation/main": kept.answers!["simulation/main"] } }, base);
    expect(restoreOutbox(s, ANA, SLUG, server({ simulation: practiceOf("y") }))).toBeNull();
    expect(readOutbox(s, ANA, SLUG)).toBeNull();
  });

  it("brings back an answer kept with no record of the server's only where the server has none", () => {
    const s = storage();
    putInOutbox(s, ANA, SLUG, { v: 2, answers: { "simulation/main": kept.answers!["simulation/main"] } });
    expect(restoreOutbox(s, ANA, SLUG, server({ simulation: practiceOf("y") }))).toBeNull();
    putInOutbox(s, ANA, SLUG, { v: 2, answers: { "simulation/main": kept.answers!["simulation/main"] } });
    expect(restoreOutbox(s, ANA, SLUG, EMPTY_PROGRESS)).toEqual({
      v: 2,
      answers: { "simulation/main": kept.answers!["simulation/main"] },
    });
  });

  it("brings an answer back over what the server held, or what it holds if a save of it whose answer was lost was written; never over anything else", () => {
    const answer: ProgressPatch = {
      v: 2,
      answers: {
        "simulation/main": { type: "practice", optionId: "x", correct: false },
        [`${OWN}/${PART}`]: { type: "reflection", text: { q1: "Tab", q2: "Tab two" } },
      },
    };
    // The lost save sent practice "w" and both questions.
    const written = server({
      simulation: practiceOf("w"),
      responses: { [`${OWN}/${PART}`]: { type: "reflection", text: { q1: "Lost", q2: "Lost two" } } },
    });
    for (const now of [base, written]) {
      const s = storage();
      putInOutbox(s, ANA, SLUG, answer, base, written);
      expect(restoreOutbox(s, ANA, SLUG, now)).toEqual(answer);
    }
    const s = storage();
    putInOutbox(s, ANA, SLUG, answer, base, written);
    const elsewhere = server({
      simulation: practiceOf("z"),
      responses: { [`${OWN}/${PART}`]: { type: "reflection", text: { q1: "Phone", q2: "Lost two" } } },
    });
    expect(restoreOutbox(s, ANA, SLUG, elsewhere)).toEqual({
      v: 2,
      answers: { [`${OWN}/${PART}`]: { type: "reflection", text: { q2: "Tab two" } } },
    });
    // What's left keeps both of its values.
    expect(restoreOutbox(s, ANA, SLUG, written)).toEqual({
      v: 2,
      answers: { [`${OWN}/${PART}`]: { type: "reflection", text: { q2: "Tab two" } } },
    });
  });

  it("is null for another learner, or with no storage", () => {
    const s = storage();
    putInOutbox(s, ANA, SLUG, kept, base);
    expect(restoreOutbox(s, BEN, SLUG, base)).toBeNull();
    expect(restoreOutbox(null, ANA, SLUG, base)).toBeNull();
  });
});

describe("clearEveryOutbox: nothing of a learner stays in the tab once the store lets go of them", () => {
  it("forgets every outbox entry in the tab, and nothing else", () => {
    const s = storage();
    putInOutbox(s, ANA, SLUG, first);
    putInOutbox(s, ANA, "receiving-feedback", second);
    putInOutbox(s, BEN, SLUG, second);
    s.setItem("someone-else's-key", "kept");
    clearEveryOutbox(s);
    expect([...s.items.keys()]).toEqual(["someone-else's-key"]);
  });

  it("never throws, with no storage or a storage that does", () => {
    expect(() => clearEveryOutbox(null)).not.toThrow();
    expect(() =>
      clearEveryOutbox({
        get length(): number {
          throw new Error("blocked");
        },
        key: () => null,
        removeItem: () => undefined,
      })
    ).not.toThrow();
  });

  it("is what the learner store does when it lets go of a learner (signed out, another account, erased)", () => {
    const source = readFileSync(fileURLToPath(new URL("./demo-state.tsx", import.meta.url)), "utf8");
    const letGo = source.slice(source.indexOf("const letGo = React.useCallback("));
    expect(letGo.slice(0, letGo.indexOf("}, ["))).toMatch(/clearEveryOutbox\(tabStorage\(\)\)/);
    // And a course's outbox is brought back against what the server holds now.
    expect(source).toMatch(/restoreOutbox\(tabStorage\(\), forUser, slug, /);
    expect(source).not.toMatch(/readOutbox\(/);
  });
});
