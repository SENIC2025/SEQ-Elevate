import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applyR3Deltas, LIVE } from "./r3-deltas";
import type { Captured } from "./r2-deltas";

/**
 * Release 3 (spec 18.4): the closed list of differences the recorded walk
 * allows. The reflection hint is placed (Stream E), so R3-D1 is live: the
 * walk expects Release 2's recording with the hint after each reflection's
 * intro, and nothing else.
 */

const r1 = JSON.parse(readFileSync(new URL("./r1-learner-baseline.json", import.meta.url), "utf8")) as Record<
  string,
  Captured
>;
const r2 = JSON.parse(readFileSync(new URL("./r2-learner-baseline.json", import.meta.url), "utf8")) as Record<
  string,
  Captured
>;
const ALL = new Set(["R3-D1"] as const);
const added = (before: string, after: string) => after.split("\n").length - before.split("\n").length;

describe("applyR3Deltas", () => {
  it("has R3-D1 live (the reflection hint is placed), and changes nothing without a live difference", () => {
    expect([...LIVE]).toEqual(["R3-D1"]);
    for (const [key, captured] of [...Object.entries(r1), ...Object.entries(r2)]) {
      expect(applyR3Deltas(key, captured, new Set())).toEqual(captured);
    }
  });

  it("R3-D1: a standard reflection gains the hint after its intro, in the step's language", () => {
    const en = applyR3Deltas("created:en:6-reflection", r1["created:en:6-reflection"], ALL).aria.split("\n");
    const intro = en.indexOf("  - paragraph: Think about the last time you needed help.");
    expect(en.slice(intro + 1, intro + 6)).toEqual([
      "  - paragraph:",
      "    - text: Facilitators don't read what you write here. If you need help,",
      '    - link "contact someone directly":',
      "      - /url: /en/help",
      "    - text: .",
    ]);
    const de = applyR3Deltas("created:de:6-reflection", r1["created:de:6-reflection"], ALL).aria;
    expect(de).toContain("      - /url: /de/help");
  });

  it("R3-D1: a reflection of the lesson's extra content gains it after its heading", () => {
    const before = r2["flexible:en:2-idea"].aria;
    const after = applyR3Deltas("flexible:en:2-idea", r2["flexible:en:2-idea"], ALL).aria.split("\n");
    const heading = after.indexOf('    - heading "Reflection questions" [level=3]');
    expect(after[heading + 1]).toBe("    - paragraph:");
    expect(added(before, after.join("\n"))).toBe(5);
  });

  it("R3-D1: nothing else changes", () => {
    for (const key of ["created:en:5-scenario", "created:en:7-assessment", "flexible:en:5-wrapup", "builtin:en:8-complete"]) {
      const captured = (r1[key] ?? r2[key])!;
      expect(applyR3Deltas(key, captured, ALL), key).toEqual(captured);
    }
    // One hint per reflection: the built-in course's reflection step too.
    const builtin = r1["builtin:en:6-reflection"];
    expect(added(builtin.aria, applyR3Deltas("builtin:en:6-reflection", builtin, ALL).aria)).toBe(5);
  });
});
