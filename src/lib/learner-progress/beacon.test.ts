import { describe, it, expect } from "vitest";
import { RESPONSE_LIMITS, type ProgressPatch } from "./contract";
import {
  BEACON_BUDGET_BYTES,
  BEACON_MAX_BYTES,
  beaconBody,
  cardBeaconBody,
  fitBeacon,
  fitCardBeacon,
  readBeaconBody,
  readCardBeaconBody,
} from "./beacon";

/*
 * A course save sent as the page goes (D37 as built, 24 October): one
 * course's patch, for the learner it was made for, in a body the route
 * reads no further than BEACON_MAX_BYTES; the page sends at most
 * BEACON_BUDGET_BYTES of them, every course together.
 */

const SLUG = "workplace-conflict";
const ANA = "user-ana";
const reflectionPatch = (text: Record<string, string>): ProgressPatch => ({
  v: 2,
  answers: { "reflection/main": { type: "reflection", text } },
});
const bytes = (text: string) => new TextEncoder().encode(text).length;

describe("beaconBody and readBeaconBody", () => {
  it("read back what the page sends", () => {
    const patch = reflectionPatch({ p1: "X" });
    expect(readBeaconBody(JSON.parse(beaconBody(SLUG, ANA, patch)))).toEqual({ slug: SLUG, forUser: ANA, patch });
  });

  it.each([
    ["null", null],
    ["a list", [SLUG, {}, ANA]],
    ["another version", { v: 2, slug: SLUG, forUser: ANA, patch: {} }],
    ["no course", { v: 1, forUser: ANA, patch: {} }],
    ["a course that isn't text", { v: 1, slug: 7, forUser: ANA, patch: {} }],
    ["no learner", { v: 1, slug: SLUG, patch: {} }],
    ["no patch", { v: 1, slug: SLUG, forUser: ANA }],
    ["a course and a Comp Card", { v: 1, slug: SLUG, forUser: ANA, patch: {}, card: {} }],
  ])("read nothing from %s", (_, raw) => {
    expect(readBeaconBody(raw)).toBeNull();
  });

  it("the page's budget fits within what the route reads", () => {
    expect(BEACON_BUDGET_BYTES).toBeLessThanOrEqual(BEACON_MAX_BYTES);
  });
});

describe("fitBeacon", () => {
  it("sends the whole patch when it fits", () => {
    const patch: ProgressPatch = { ...reflectionPatch({ p1: "X" }), completed: ["context"] };
    const fitted = fitBeacon(SLUG, ANA, patch, 1_000);
    expect(fitted && readBeaconBody(JSON.parse(fitted.body))?.patch).toEqual(patch);
    expect(fitted?.bytes).toBe(bytes(fitted!.body));
  });

  it("stays within the bytes given for text of two bytes a character, leaving out the answers that don't fit", () => {
    const patch: ProgressPatch = {
      v: 2,
      completed: ["context"],
      answers: {
        "reflection/main": { type: "reflection", text: { p1: "λ".repeat(2_000) } },
        "simulation/main": { type: "practice", optionId: "a", correct: true },
      },
    };
    const fitted = fitBeacon(SLUG, ANA, patch, 3_000);
    expect(fitted!.bytes).toBeLessThanOrEqual(3_000);
    expect(readBeaconBody(JSON.parse(fitted!.body))?.patch).toEqual({
      v: 2,
      completed: ["context"],
      answers: { "simulation/main": { type: "practice", optionId: "a", correct: true } },
    });
    expect(fitBeacon(SLUG, ANA, patch, 10_000)!.bytes).toBeLessThanOrEqual(10_000);
  });

  it("never sends what the server would refuse", () => {
    const patch = reflectionPatch({ p1: "x".repeat(RESPONSE_LIMITS.reflectionChars + 1), p2: "kept" });
    expect(readBeaconBody(JSON.parse(fitBeacon(SLUG, ANA, patch, 64_000)!.body))?.patch).toEqual(reflectionPatch({ p2: "kept" }));
  });

  it("nothing when nothing fits", () => {
    expect(fitBeacon(SLUG, ANA, reflectionPatch({ p1: "x".repeat(4_000) }), 1_000)).toBeNull();
    expect(fitBeacon(SLUG, ANA, reflectionPatch({ p1: "X" }), 10)).toBeNull();
  });
});

describe("cardBeaconBody and readCardBeaconBody: the Comp Card's save", () => {
  it("read back what the page sends", () => {
    const card = { wentWell: "W", confidence: 4 };
    expect(readCardBeaconBody(JSON.parse(cardBeaconBody(ANA, card)))).toEqual({ forUser: ANA, card });
    expect(readBeaconBody(JSON.parse(cardBeaconBody(ANA, card))), "not a course save").toBeNull();
  });

  it.each([
    ["null", null],
    ["another version", { v: 2, forUser: ANA, card: {} }],
    ["no learner", { v: 1, card: {} }],
    ["no card", { v: 1, forUser: ANA }],
    ["a card and a course", { v: 1, forUser: ANA, card: {}, slug: SLUG }],
    ["a card and a patch", { v: 1, forUser: ANA, card: {}, patch: {} }],
    ["a course save", JSON.parse(beaconBody(SLUG, ANA, reflectionPatch({ p1: "X" })))],
  ])("read nothing from %s", (_, raw) => {
    expect(readCardBeaconBody(raw)).toBeNull();
  });
});

describe("fitCardBeacon", () => {
  it("sends the whole card when it fits", () => {
    const card = { wentWell: "W", difficult: "D", improve: "I", behaviour: "B", confidence: 2 };
    const fitted = fitCardBeacon(ANA, card, 1_000);
    expect(readCardBeaconBody(JSON.parse(fitted!.body))?.card).toEqual(card);
    expect(fitted?.bytes).toBe(bytes(fitted!.body));
  });

  it("stays within the bytes given, the confidence first and each text that fits in the card's order", () => {
    const card = { wentWell: "λ".repeat(2_000), difficult: "short", improve: "ι".repeat(2_000), confidence: 5 };
    const fitted = fitCardBeacon(ANA, card, 4_500);
    expect(fitted!.bytes).toBeLessThanOrEqual(4_500);
    expect(readCardBeaconBody(JSON.parse(fitted!.body))?.card).toEqual({ confidence: 5, wentWell: card.wentWell, difficult: "short" });
  });

  it("the four texts at their limit fit within the page's budget, in any script", () => {
    const card = { wentWell: "€".repeat(2_000), difficult: "€".repeat(2_000), improve: "€".repeat(2_000), behaviour: "€".repeat(2_000), confidence: 1 };
    expect(readCardBeaconBody(JSON.parse(fitCardBeacon(ANA, card, BEACON_BUDGET_BYTES)!.body))?.card).toEqual(card);
  });

  it("nothing when nothing fits", () => {
    expect(fitCardBeacon(ANA, { wentWell: "x".repeat(4_000) }, 1_000)).toBeNull();
    expect(fitCardBeacon(ANA, {}, 1_000)).toBeNull();
  });
});
