import { describe, it, expect } from "vitest";
import { isRefusedAward } from "./badge-award";

describe("isRefusedAward", () => {
  it("spots a refusal", () => {
    expect(isRefusedAward({ ok: false, reason: "no-badge" })).toBe(true);
    expect(isRefusedAward({ ok: false, reason: "other-account" })).toBe(true);
  });

  it("takes anything else as no refusal: a saved award, or a write with no answer", () => {
    expect(isRefusedAward({ ok: true })).toBe(false);
    expect(isRefusedAward(undefined)).toBe(false);
    expect(isRefusedAward(null)).toBe(false);
  });
});
