import { describe, it, expect } from "vitest";
import { COUNTRIES, isCountry } from "./countries";

describe("COUNTRIES", () => {
  it("is Germany, Cyprus, Belgium, Greece and Other, in that order", () => {
    expect(COUNTRIES).toEqual(["DE", "CY", "BE", "GR", "OTHER"]);
  });

  it("recognises exactly those codes", () => {
    for (const c of COUNTRIES) expect(isCountry(c)).toBe(true);
    for (const v of ["de", "EL", "GB", "", null, undefined, 1, {}, "OTHER "]) {
      expect(isCountry(v), String(v)).toBe(false);
    }
  });
});
