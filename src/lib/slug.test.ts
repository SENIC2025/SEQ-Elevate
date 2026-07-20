import { describe, it, expect } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates words", () => {
    expect(slugify("Giving Feedback")).toBe("giving-feedback");
  });

  it("drops punctuation rather than encoding it", () => {
    expect(slugify("Asking for what you need!")).toBe(
      "asking-for-what-you-need"
    );
    expect(slugify("Conflict: a how-to")).toBe("conflict-a-how-to");
  });

  it("strips accents so DE/EL titles stay URL-safe", () => {
    expect(slugify("Röckchen")).toBe("rockchen");
    expect(slugify("Émotions au travail")).toBe("emotions-au-travail");
  });

  it("collapses runs of separators and trims the ends", () => {
    expect(slugify("  --Hello   世界--  ")).toBe("hello");
  });

  it("never ends in a dash, even when the length cap cuts mid-word", () => {
    const slug = slugify("a".repeat(58) + " word");
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  it("returns empty string when there is nothing usable", () => {
    // The action treats this as "bad-title" rather than creating a course
    // reachable at a blank URL.
    expect(slugify("!!!")).toBe("");
    expect(slugify("   ")).toBe("");
  });
});
