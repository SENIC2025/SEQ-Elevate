import { describe, it, expect } from "vitest";
import { claimTooLarge, maxOf, parseGuestClaim, sameText, tooLongIn } from "./guest-claim";

/*
 * Release 3 (D79, D80, D62.d): what "Add it to my account" sends is checked
 * whole before anything is written: a text too long to add, or a claim too
 * big for one save, means nothing is; what no one can read is left out and
 * counted; a Comp Card with no answer in it isn't work.
 */

const NOW = new Date("2026-11-21T10:00:00.000Z");
const patch = { v: 2, completed: ["context"], answers: { "reflection/main": { type: "reflection", text: { p1: "Mine" } } } };
const card = { wentWell: "Went", difficult: "", improve: "", behaviour: "", confidence: 3 };

describe("parseGuestClaim", () => {
  it("takes a course, a Comp Card and badges, each once", () => {
    const parsed = parseGuestClaim({ claim: 1, course: { slug: "workplace-conflict", patch }, compCard: card, badges: ["a", "a", "b"] }, NOW);
    expect(parsed).toEqual({
      ok: true,
      claim: {
        course: {
          slug: "workplace-conflict",
          patch: {
            completed: ["context"],
            answers: [["reflection/main", { type: "reflection", text: { p1: "Mine" } }]],
            completedAt: null,
            fill: false,
            refused: [],
          },
        },
        compCard: { ...card, confidence: 3 },
        badges: ["a", "b"],
        unreadable: 0,
      },
    });
  });

  it("reads a course's answers as stored answers are read: more questions than one save carries are kept", () => {
    const text = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`q${i}`, "x"]));
    const parsed = parseGuestClaim({ claim: 1, course: { slug: "c", patch: { v: 2, answers: { "s-abcdefgh/main": { type: "reflection", text } } } } }, NOW);
    expect(parsed.ok && parsed.claim.course?.patch.answers[0][1]).toEqual({ type: "reflection", text });
  });

  it("leaves out, and counts, a lesson or an answer no one can read", () => {
    const parsed = parseGuestClaim(
      {
        claim: 1,
        course: {
          slug: "c",
          patch: { v: 2, completed: ["context", "nonsense"], answers: { "simulation/main": { type: "practice", optionId: 5 }, "concept/main": { type: "quiz", answers: {}, checked: true } } },
        },
      },
      NOW
    );
    expect(parsed).toMatchObject({ ok: true, claim: { unreadable: 2, course: { patch: { completed: ["context"] } } } });
    expect(parsed.ok && parsed.claim.course?.patch.answers).toEqual([["concept/main", { type: "quiz", answers: {}, checked: true }]]);
  });

  it("takes the completion's time when it is believable, else the server's", () => {
    const at = (completedAt: string) => {
      const parsed = parseGuestClaim({ claim: 1, course: { slug: "c", patch: { v: 2, completedAt } } }, NOW);
      return parsed.ok ? parsed.claim.course?.patch.completedAt : null;
    };
    expect(at("2026-11-20T09:00:00.000Z")).toEqual(new Date("2026-11-20T09:00:00.000Z"));
    expect(at("2027-01-01T00:00:00.000Z")).toEqual(NOW);
    expect(at("not a date")).toEqual(NOW);
  });

  it("doesn't count a Comp Card with no answer in it as work", () => {
    const parsed = parseGuestClaim({ claim: 1, compCard: { ...card, wentWell: "  ", confidence: 5 } }, NOW);
    expect(parsed).toMatchObject({ ok: true, claim: { compCard: null } });
  });

  it("names every text too long to add: a reflection answer over 5,000 characters, a Comp Card answer over 2,000", () => {
    const claim = {
      claim: 1,
      course: { slug: "c", patch: { v: 2, answers: { "reflection/main": { type: "reflection", text: { p1: "ok", p3: "y".repeat(5001) } } } } },
      compCard: { ...card, behaviour: "x".repeat(2001), improve: "x".repeat(2000) },
    };
    const texts = [
      { part: "course", key: "reflection/main", prompt: "p3" },
      { part: "compCard", field: "behaviour" },
    ];
    expect(tooLongIn(claim)).toEqual(texts);
    expect(parseGuestClaim(claim, NOW)).toEqual({ ok: false, error: "too-long", texts });
    expect(texts.map((t) => maxOf(t as never))).toEqual([5000, 2000]);
    expect(sameText(texts[0] as never, { part: "course", key: "reflection/main", prompt: "p3" })).toBe(true);
    expect(sameText(texts[1] as never, { part: "compCard", field: "improve" })).toBe(false);
  });

  it("refuses a claim bigger than one save, and anything that isn't a claim", () => {
    const answers = Object.fromEntries(
      Array.from({ length: 70 }, (_, i) => [`s-abcde${String(i).padStart(3, "0")}/main`, { type: "reflection", text: { q: "z".repeat(4500) } }])
    );
    expect(parseGuestClaim({ claim: 1, course: { slug: "c", patch: { v: 2, answers } } }, NOW)).toEqual({ ok: false, error: "too-large" });
    // The browser says so before sending it (a claim past 1 MB never reaches the action).
    expect(claimTooLarge({ claim: 1, course: { slug: "c", patch: { v: 2, answers } } })).toBe(true);
    expect(claimTooLarge({ claim: 1, course: { slug: "c", patch } })).toBe(false);
    for (const bad of [
      null,
      [],
      { claim: 2 },
      { claim: 1, other: true },
      { claim: 1, course: { slug: "Not A Slug", patch } },
      { claim: 1, course: { slug: "c", patch: { ...patch, fill: true } } },
      { claim: 1, course: { slug: "c", patch: { v: 1 } } },
      { claim: 1, compCard: { ...card, confidence: 0 } },
      { claim: 1, compCard: { ...card, wentWell: 5 } },
      { claim: 1, badges: [""] },
      { claim: 1, badges: Array.from({ length: 101 }, (_, i) => `b${i}`) },
    ]) {
      expect(parseGuestClaim(bad, NOW), JSON.stringify(bad)?.slice(0, 80)).toEqual({ ok: false, error: "bad-input" });
    }
  });
});
