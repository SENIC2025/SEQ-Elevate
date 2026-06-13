import { describe, it, expect } from "vitest";
import { COURSE_DEFS, COURSE_ORDER, SKILL_CLUSTERS } from "./course";

describe("course definitions integrity", () => {
  it("COURSE_ORDER references only defined courses", () => {
    for (const slug of COURSE_ORDER) {
      expect(COURSE_DEFS[slug]).toBeDefined();
      expect(COURSE_DEFS[slug].id).toBe(slug);
    }
  });

  it.each(COURSE_ORDER)("'%s' is structurally sound", (slug) => {
    const def = COURSE_DEFS[slug];

    // Cluster is a real skill cluster
    expect(SKILL_CLUSTERS).toContain(def.cluster);

    // Simulation: the correct answer is one of the options
    expect(def.simulation.options).toContain(def.simulation.correct);

    // Scenario: root + followup ids are all unique within the course
    const ids: string[] = [];
    for (const root of def.scenario.roots) {
      ids.push(root.id);
      for (const f of root.followups) ids.push(f.id);
      // Each root has at least one followup
      expect(root.followups.length).toBeGreaterThan(0);
    }
    expect(new Set(ids).size).toBe(ids.length);

    // Quality tags are valid
    const quals = def.scenario.roots.flatMap((r) => [
      r.quality,
      ...r.followups.map((f) => f.quality),
    ]);
    for (const q of quals) expect(["best", "okay", "poor"]).toContain(q);

    // Assessment: each question's correct id is among its options
    for (const q of def.assessment) {
      expect(q.options).toContain(q.correct);
    }

    // Sensible metadata
    expect(def.durationMinutes).toBeGreaterThan(0);
    expect(def.badgeId.length).toBeGreaterThan(0);
    expect(def.contentKey.length).toBeGreaterThan(0);
  });

  it("badge slugs are unique across courses", () => {
    const badges = COURSE_ORDER.map((s) => COURSE_DEFS[s].badgeId);
    expect(new Set(badges).size).toBe(badges.length);
  });
});
