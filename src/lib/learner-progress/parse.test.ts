import { describe, it, expect } from "vitest";
import { RESPONSE_LIMITS } from "./contract";
import { checkAnswer, isPatchKey, parseProgressPatch, readIds, readResponses } from "./parse";

/*
 * U2 (spec 2.4): a patch from the browser is checked before anything is
 * merged. A patch that isn't one, or is too big, is refused whole; a bad
 * value is refused for its own key only, never cut, so one oversized answer
 * can't block every later save. The readers of what is stored are tolerant
 * instead: they skip what they can't read.
 */

const NOW = new Date("2026-11-10T09:00:00.000Z");
const OWN = "s-abcdefgh";
const PART = "p-12345678";
const parse = (raw: unknown) => parseProgressPatch(raw, NOW);
const ok = (raw: unknown) => {
  const r = parse(raw);
  if (!r.ok) throw new Error(`refused: ${r.error}`);
  return r.patch;
};

describe("parseProgressPatch: the whole patch", () => {
  it.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "v2"],
    ["an array", [{ v: 2 }]],
    ["no version", { completed: [] }],
    ["Release 1's progress", { stagesCompleted: ["context"], completedAt: null }],
    ["version 1", { v: 1 }],
    ["completed not a list", { v: 2, completed: "context" }],
    ["a completed id that isn't text", { v: 2, completed: [7] }],
    ["answers not an object", { v: 2, answers: [] }],
    ["completedAt not text", { v: 2, completedAt: 1700000000000 }],
    ["fill not true", { v: 2, fill: false }],
    ["a field it doesn't know", { v: 2, extra: 1 }],
  ])("refuses %s as bad-input", (_name, raw) => {
    expect(parse(raw)).toEqual({ ok: false, error: "bad-input" });
  });

  it("refuses a patch whose JSON is over the limit as too-large", () => {
    const big = "x".repeat(RESPONSE_LIMITS.patchJsonChars);
    expect(
      parse({ v: 2, answers: { [`${OWN}/${PART}`]: { type: "reflection", text: { a: big } } } })
    ).toEqual({ ok: false, error: "too-large" });
  });

  it("refuses more keys, or more finished lessons, than a patch may hold", () => {
    const answers = Object.fromEntries(
      Array.from({ length: RESPONSE_LIMITS.keysPerPatch + 1 }, (_, i) => [
        `${OWN}/p-${String(i).padStart(8, "0")}`,
        { type: "practice", optionId: "a", correct: true },
      ])
    );
    expect(parse({ v: 2, answers })).toEqual({ ok: false, error: "too-large" });
    const completed = Array.from({ length: RESPONSE_LIMITS.completedPerPatch + 1 }, () => "context");
    expect(parse({ v: 2, completed })).toEqual({ ok: false, error: "too-large" });
  });

  it("takes the limits themselves", () => {
    const completed = Array.from({ length: RESPONSE_LIMITS.completedPerPatch }, () => OWN);
    expect(parse({ v: 2, completed }).ok).toBe(true);
  });

  it("reads an empty patch as nothing to do", () => {
    expect(ok({ v: 2 })).toEqual({
      completed: [],
      answers: [],
      completedAt: null,
      fill: false,
      refused: [],
    });
  });

  it("reads fill mode", () => {
    expect(ok({ v: 2, fill: true }).fill).toBe(true);
  });

  it("never throws, whatever it is given", () => {
    const cyclic: Record<string, unknown> = { v: 2 };
    cyclic.answers = cyclic;
    expect(() => parse(cyclic)).not.toThrow();
    expect(parse(cyclic).ok).toBe(false);
  });
});

describe("parseProgressPatch: finished lessons", () => {
  it("keeps standard keys and the course's own ids, once each, in order", () => {
    expect(ok({ v: 2, completed: ["context", OWN, "context", "assessment"] }).completed).toEqual([
      "context",
      OWN,
      "assessment",
    ]);
  });

  it("refuses an id that is no lesson's, by itself", () => {
    const p = ok({ v: 2, completed: ["CONTEXT", "complete", "s-ABCDEFGH", "concept"] });
    expect(p.completed).toEqual(["concept"]);
    expect(p.refused).toEqual([
      { key: "CONTEXT", reason: "invalid" },
      { key: "complete", reason: "invalid" },
      { key: "s-ABCDEFGH", reason: "invalid" },
    ]);
  });
});

describe("parseProgressPatch: completedAt", () => {
  it("keeps the client's time when it is the past or now (the merge holds it to the enrolment's start)", () => {
    expect(ok({ v: 2, completedAt: "2026-11-10T08:30:00.000Z" }).completedAt?.toISOString()).toBe(
      "2026-11-10T08:30:00.000Z"
    );
    expect(ok({ v: 2, completedAt: NOW.toISOString() }).completedAt).toEqual(NOW);
  });

  it("uses the server's time for any time ahead of it (D118: never later than now), or one it can't read", () => {
    expect(ok({ v: 2, completedAt: "2026-11-10T09:00:00.001Z" }).completedAt).toEqual(NOW);
    expect(ok({ v: 2, completedAt: "2026-11-10T09:04:59.000Z" }).completedAt).toEqual(NOW);
    expect(ok({ v: 2, completedAt: "2026-11-10T09:05:01.000Z" }).completedAt).toEqual(NOW);
    expect(ok({ v: 2, completedAt: "yesterday-ish" }).completedAt).toEqual(NOW);
  });
});

describe("parseProgressPatch: answers, key by key", () => {
  it("accepts every type under a key of the right shape, in the patch's order", () => {
    const answers = {
      "simulation/main": { type: "practice", optionId: "a", correct: true },
      "scenario/main": { type: "scenario", rootId: "c1", followupId: "f2" },
      "reflection/main": { type: "reflection", text: { p2: "Better" } },
      "assessment/main": { type: "quiz", answers: { q1: "x" }, checked: true },
      [`${OWN}/main`]: { type: "scenario", rootId: "c1" },
      [`concept/${PART}`]: { type: "rating", values: { s1: 1, s2: 5 } },
      [`${OWN}/p-reflect1`]: { type: "reflection", text: { q: "" } },
    };
    const p = ok({ v: 2, answers });
    expect(p.refused).toEqual([]);
    expect(p.answers).toEqual(Object.entries(answers));
  });

  it("accepts answers to content no longer in the course: the limits bound them", () => {
    expect(ok({ v: 2, answers: { "s-zzzzzzzz/p-zzzzzzzz": { type: "practice", optionId: "o", correct: false } } }).answers)
      .toHaveLength(1);
  });

  it.each([
    ["no part", "context"],
    ["a made-up lesson", "intro/main"],
    ["capitals", "Context/main"],
    ["a short id", "s-abc/main"],
    ["a made-up part", "context/extra"],
    ["three levels", "context/main/x"],
  ])("refuses a key with %s", (_name, key) => {
    const p = ok({ v: 2, answers: { [key]: { type: "practice", optionId: "a", correct: true } } });
    expect(p.answers).toEqual([]);
    expect(p.refused).toEqual([{ key, reason: "invalid" }]);
  });

  it("refuses only the bad key; the others are kept", () => {
    const p = ok({
      v: 2,
      answers: {
        "simulation/main": { type: "practice", optionId: "a", correct: "yes" },
        [`${OWN}/main`]: { type: "practice", optionId: "b", correct: false },
      },
    });
    expect(p.answers).toEqual([[`${OWN}/main`, { type: "practice", optionId: "b", correct: false }]]);
    expect(p.refused).toEqual([{ key: "simulation/main", reason: "invalid" }]);
  });

  it("refuses the four standard keys with any type but their own", () => {
    for (const [key, value] of [
      ["simulation/main", { type: "scenario", rootId: "c1" }],
      ["scenario/main", { type: "practice", optionId: "a", correct: true }],
      ["reflection/main", { type: "rating", values: { s: 3 } }],
      ["assessment/main", { type: "reflection", text: { p1: "x" } }],
    ] as const) {
      expect(ok({ v: 2, answers: { [key]: value } }).refused).toEqual([{ key, reason: "invalid" }]);
    }
  });

  it("takes only p1–p3 under the standard reflection", () => {
    expect(
      ok({ v: 2, answers: { "reflection/main": { type: "reflection", text: { p4: "x" } } } }).refused
    ).toEqual([{ key: "reflection/main", reason: "invalid" }]);
  });
});

describe("checkAnswer", () => {
  const KEY = `${OWN}/${PART}`;
  const check = (value: unknown, key = KEY) => checkAnswer(key, value);
  const long = (n: number) => "x".repeat(n);

  it.each([
    ["not an object", "a"],
    ["no type", { optionId: "a" }],
    ["a type it doesn't know", { type: "essay", text: "x" }],
    ["practice without its choice", { type: "practice", correct: true }],
    ["practice with an empty choice", { type: "practice", optionId: "", correct: true }],
    ["practice with a long choice id", { type: "practice", optionId: long(101), correct: true }],
    ["practice with another field", { type: "practice", optionId: "a", correct: true, at: "x" }],
    ["scenario without a root", { type: "scenario", followupId: "f" }],
    ["scenario with a follow-up that isn't text", { type: "scenario", rootId: "c", followupId: 3 }],
    ["quiz with an open question", { type: "quiz", answers: { q1: null }, checked: false }],
    ["quiz without its check", { type: "quiz", answers: {} }],
    [
      "quiz with too many answers",
      {
        type: "quiz",
        answers: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`q${i}`, "a"])),
        checked: false,
      },
    ],
    ["reflection with text that isn't text", { type: "reflection", text: { a: 5 } }],
    [
      "reflection with eleven prompts",
      { type: "reflection", text: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`p${i}`, "x"])) },
    ],
    ["rating of 0", { type: "rating", values: { s: 0 } }],
    ["rating of 6", { type: "rating", values: { s: 6 } }],
    ["rating of 2.5", { type: "rating", values: { s: 2.5 } }],
    ["rating as text", { type: "rating", values: { s: "3" } }],
    [
      "rating of thirteen statements",
      { type: "rating", values: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`s${i}`, 3])) },
    ],
  ])("refuses %s as invalid", (_name, value) => {
    expect(check(value)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a reflection answer over 5,000 characters as too-long, never cuts it", () => {
    expect(check({ type: "reflection", text: { a: long(RESPONSE_LIMITS.reflectionChars + 1) } })).toEqual({
      ok: false,
      reason: "too-long",
    });
    expect(
      check({ type: "reflection", text: { p1: "ok", p2: long(5_001) } }, "reflection/main")
    ).toEqual({ ok: false, reason: "too-long" });
  });

  it("takes the limits themselves", () => {
    expect(check({ type: "reflection", text: { a: long(5_000) } }).ok).toBe(true);
    expect(check({ type: "practice", optionId: long(100), correct: false }).ok).toBe(true);
    expect(
      check({
        type: "rating",
        values: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`s${i}`, 1 + (i % 5)])),
      }).ok
    ).toBe(true);
  });

  it("returns a copy of what it checked, nothing more", () => {
    const value = { type: "quiz", answers: { q1: "a" }, checked: false };
    const r = check(value);
    expect(r).toEqual({ ok: true, answer: value });
    if (r.ok) expect(r.answer).not.toBe(value);
  });
});

describe("isPatchKey", () => {
  it("knows the keys answers are saved under", () => {
    expect(isPatchKey("assessment/main")).toBe(true);
    expect(isPatchKey(`${OWN}/${PART}`)).toBe(true);
    expect(isPatchKey(`${OWN}/main/`)).toBe(false);
  });
});

describe("readResponses", () => {
  it("reads what is stored, without the time of each change", () => {
    expect(
      readResponses({
        v: 1,
        items: {
          [`${OWN}/main`]: { type: "practice", optionId: "a", correct: true, at: "2026-11-01T00:00:00.000Z" },
          [`concept/${PART}`]: { type: "rating", values: { s1: 4 }, at: "2026-11-01T00:00:00.000Z" },
        },
      })
    ).toEqual({
      [`${OWN}/main`]: { type: "practice", optionId: "a", correct: true },
      [`concept/${PART}`]: { type: "rating", values: { s1: 4 } },
    });
  });

  it("skips what it can't read, and the four keys that have columns of their own", () => {
    expect(
      readResponses({
        v: 1,
        items: {
          "simulation/main": { type: "practice", optionId: "a", correct: true },
          "bad key": { type: "practice", optionId: "a", correct: true },
          [`${OWN}/main`]: "garbage",
          [`${OWN}/${PART}`]: { type: "rating", values: { s1: 9 } },
          [`${OWN}/p-00000001`]: { type: "reflection", text: { a: "kept" } },
        },
      })
    ).toEqual({ [`${OWN}/p-00000001`]: { type: "reflection", text: { a: "kept" } } });
  });

  it("reads a long stored answer as it is: only new writes are limited", () => {
    const text = "x".repeat(6_000);
    expect(readResponses({ v: 1, items: { [`${OWN}/main`]: { type: "reflection", text: { a: text } } } }))
      .toEqual({ [`${OWN}/main`]: { type: "reflection", text: { a: text } } });
  });

  it.each([null, undefined, "x", [], { v: 2, items: {} }, { v: 1, items: [] }])(
    "reads %j as none",
    (raw) => {
      expect(readResponses(raw)).toEqual({});
    }
  );
});

describe("readIds", () => {
  it("reads the course's own lessons finished, once each, in order", () => {
    expect(readIds([OWN, "s-00000001", OWN])).toEqual([OWN, "s-00000001"]);
  });

  it("skips what isn't one", () => {
    expect(readIds([OWN, 4, "context", "s-BAD", null])).toEqual([OWN]);
  });

  it.each([null, undefined, "s-abcdefgh", { 0: OWN }])("reads %j as none", (raw) => {
    expect(readIds(raw)).toEqual([]);
  });
});
