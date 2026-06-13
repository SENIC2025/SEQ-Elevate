import { describe, it, expect } from "vitest";
import { localProvider } from "./local-provider";
import { COURSE_DEFS, COURSE_ORDER, STAGES } from "@/data/course";
import type { Locale } from "./types";

const LOCALES: Locale[] = ["en", "de", "el"];
const PROJECT = "seq-elevate";

describe("local CMS provider", () => {
  it("lists every defined course for every locale", async () => {
    for (const locale of LOCALES) {
      const courses = await localProvider.listCourses(PROJECT, locale);
      expect(courses.map((c) => c.slug).sort()).toEqual(
        [...COURSE_ORDER].sort()
      );
      for (const c of courses) {
        expect(c.title.length).toBeGreaterThan(0);
        expect(c.clusterLabel.length).toBeGreaterThan(0);
        expect(c.badgeSlug).toBeTruthy();
      }
    }
  });

  it("returns null for an unknown course", async () => {
    const c = await localProvider.getCourse(PROJECT, "nope", "en");
    expect(c).toBeNull();
  });

  it.each(COURSE_ORDER)(
    "builds a complete, valid course for '%s' in all locales",
    async (slug) => {
      const def = COURSE_DEFS[slug];
      for (const locale of LOCALES) {
        const course = await localProvider.getCourse(PROJECT, slug, locale);
        expect(course).not.toBeNull();
        if (!course) return;

        // All 7 WP3 stages, in order
        expect(course.stages.map((s) => s.key)).toEqual([...STAGES]);

        // Every stage has a non-empty title
        for (const s of course.stages) {
          expect(s.title.length).toBeGreaterThan(0);
        }

        // Simulation: right number of options, exactly one "best"
        const sim = course.stages.find((s) => s.key === "simulation")?.simulation;
        expect(sim?.options.length).toBe(def.simulation.options.length);
        expect(sim?.options.filter((o) => o.isBest).length).toBe(1);
        for (const o of sim?.options ?? []) {
          expect(o.text.length).toBeGreaterThan(0);
          expect(o.feedback.length).toBeGreaterThan(0);
        }

        // Scenario: roots + followups all have text + outcomes
        const sc = course.stages.find((s) => s.key === "scenario")?.scenario;
        expect(sc?.choices.length).toBe(def.scenario.roots.length);
        for (const root of sc?.choices ?? []) {
          expect(root.text.length).toBeGreaterThan(0);
          expect(root.outcome.length).toBeGreaterThan(0);
          expect(["best", "okay", "poor"]).toContain(root.quality);
          for (const f of root.followups ?? []) {
            expect(f.text.length).toBeGreaterThan(0);
            expect(f.outcome.length).toBeGreaterThan(0);
          }
        }

        // Assessment: every question's correct id is a real option
        const a = course.stages.find((s) => s.key === "assessment")?.assessment;
        for (const q of a?.questions ?? []) {
          expect(q.options.map((o) => o.id)).toContain(q.correctOptionId);
        }

        // Badge present
        expect(course.badge.slug).toBe(def.badgeId);
        expect(course.badge.name.length).toBeGreaterThan(0);
      }
    }
  );

  it("returns localized content (titles differ across locales)", async () => {
    const en = await localProvider.getCourse(PROJECT, "workplace-conflict", "en");
    const de = await localProvider.getCourse(PROJECT, "workplace-conflict", "de");
    const el = await localProvider.getCourse(PROJECT, "workplace-conflict", "el");
    expect(en?.title).not.toBe(de?.title);
    expect(en?.title).not.toBe(el?.title);
    expect(de?.title).not.toBe(el?.title);
  });

  it("provides a Comp Card template with the WP3 fields", async () => {
    const tpl = await localProvider.getCompCardTemplate(PROJECT, "en");
    const keys = tpl.fields.map((f) => f.key);
    expect(keys).toContain("wentWell");
    expect(keys).toContain("difficult");
    expect(keys).toContain("improve");
    expect(keys).toContain("behaviour");
    expect(keys).toContain("confidence");
  });
});
