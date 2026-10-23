import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applyR3Deltas, LIVE, R2_PLACEHOLDER2 } from "./r3-deltas";
import { applyR2Deltas, type Captured } from "./r2-deltas";

/**
 * Release 3 (spec 18.4): the closed list of differences the recorded walk
 * allows. The reflection hint is placed (Stream E) and the built-in course's
 * second English reflection placeholder reworded (owner's decision, 22 Oct),
 * so R3-D1 and R3-D2 are live: the walk expects Release 2's recording with
 * the hint after each reflection's intro and the new placeholder, and
 * nothing else.
 */

const r1 = JSON.parse(readFileSync(new URL("./r1-learner-baseline.json", import.meta.url), "utf8")) as Record<
  string,
  Captured
>;
const r2 = JSON.parse(readFileSync(new URL("./r2-learner-baseline.json", import.meta.url), "utf8")) as Record<
  string,
  Captured
>;
const ALL = new Set(["R3-D1", "R3-D2"] as const);
const added = (before: string, after: string) => after.split("\n").length - before.split("\n").length;

describe("applyR3Deltas", () => {
  it("has R3-D1 and R3-D2 live (the hint placed, the placeholder reworded), and changes nothing without a live difference", () => {
    expect([...LIVE]).toEqual(["R3-D1", "R3-D2"]);
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

  it("R3-D2: the built-in course's second English answer box is named \"Be honest. Only you see this.\", and nothing else changes", () => {
    const key = "builtin:en:6-reflection";
    const before = r1[key].aria.split("\n");
    const after = applyR3Deltas(key, r1[key], new Set(["R3-D2"] as const)).aria.split("\n");
    expect(before.filter((l) => l.includes(R2_PLACEHOLDER2))).toEqual([`  - textbox "${R2_PLACEHOLDER2}"`]);
    expect(after.length).toBe(before.length);
    const changed = after.map((line, i) => [before[i], line]).filter(([a, b]) => a !== b);
    expect(changed).toEqual([[`  - textbox "${R2_PLACEHOLDER2}"`, '  - textbox "Be honest. Only you see this."']]);
    // No snapshot of either recording keeps the old promise once the list applies.
    for (const [k, captured] of [...Object.entries(r1), ...Object.entries(r2)]) {
      expect(applyR3Deltas(k, captured).aria, k).not.toMatch(/unless you choose to share/);
    }
  });

  it("R3-D2: also where Release 2 names the box by its question: its placeholder line, as the walk compares it", () => {
    // Phases 1 and 2 compare with Release 2's differences applied first
    // (D3: the box is named by its question, the placeholder printed below).
    const key = "builtin:en:6-reflection";
    const r2 = applyR2Deltas(key, r1[key]);
    const before = r2.aria.split("\n");
    expect(before.filter((l) => l.includes(R2_PLACEHOLDER2)).map((l) => l.trim())).toEqual([
      `- /placeholder: ${R2_PLACEHOLDER2}`,
    ]);
    const after = applyR3Deltas(key, r2, new Set(["R3-D2"] as const)).aria.split("\n");
    const changed = after.map((line, i) => [before[i], line]).filter(([a, b]) => a !== b);
    expect(changed.map(([a, b]) => [a.trim(), b.trim()])).toEqual([
      [`- /placeholder: ${R2_PLACEHOLDER2}`, "- /placeholder: Be honest. Only you see this."],
    ]);
    expect(applyR3Deltas(key, r2).aria).not.toMatch(/unless you choose to share/);
  });

  it("R3-D2: only English pages: the German walk's answer boxes keep their names", () => {
    for (const key of Object.keys(r1).filter((k) => k.split(":")[1] === "de")) {
      expect(applyR3Deltas(key, r1[key], new Set(["R3-D2"] as const)), key).toEqual(r1[key]);
    }
  });
});
