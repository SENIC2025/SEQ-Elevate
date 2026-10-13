import { describe, it, expect, vi } from "vitest";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import { sectionLabel } from "./label";
import type { NewSectionTemplate, StoredSection } from "./contract";
import type { Locale, StageKey } from "../types";

/*
 * A lesson's step name in one language (spec 2.5). Blank counts as not
 * written (D51), the result is never blank, and the standard name is only
 * ever asked for a standard lesson: next-intl's tStage has no key for a
 * lesson of the course's own and would print the key path.
 */

function ctx(locale: Locale, title?: string | null) {
  const messages = locale === "de" ? de : en;
  const tStage = createTranslator({ locale, messages, namespace: "course.stageLabel" });
  const tTemplate = createTranslator({ locale, messages, namespace: "course.sectionTemplate" });
  return {
    standardName: vi.fn((k: StageKey) => tStage(k)),
    templateName: vi.fn((t: NewSectionTemplate) => tTemplate(t)),
    title,
    generic: vi.fn(() => (locale === "de" ? "Lektion 3" : "Lesson 3")),
  };
}

const own = (s: Partial<StoredSection>): Pick<StoredSection, "id" | "template" | "label"> => ({
  id: "s-abcdefgh",
  template: "text",
  ...s,
});

describe("sectionLabel", () => {
  it("takes the lesson's own name in the language", () => {
    expect(sectionLabel({ id: "concept", template: "concept", label: { de: "Die Idee" } }, "de", ctx("de"))).toEqual({
      text: "Die Idee",
      source: "own",
    });
    expect(sectionLabel(own({ label: { en: "Warm-up" } }), "en", ctx("en"))).toEqual({ text: "Warm-up", source: "own" });
  });

  it("gives a standard lesson its standard name when it has none in the language", () => {
    // Not its English name: learners in German see the German standard name.
    expect(sectionLabel({ id: "concept", template: "concept", label: { en: "The idea" } }, "de", ctx("de"))).toEqual({
      text: "Skill-Konzept",
      source: "standard",
    });
    expect(sectionLabel({ id: "simulation", template: "simulation" }, "en", ctx("en"))).toEqual({
      text: "Guided practice",
      source: "standard",
    });
  });

  it("treats a blank name as not written", () => {
    expect(sectionLabel({ id: "context", template: "context", label: { en: "   " } }, "en", ctx("en"))).toEqual({
      text: "Context",
      source: "standard",
    });
    expect(sectionLabel(own({ label: { de: " ", en: "Warm-up" } }), "de", ctx("de"))).toEqual({
      text: "Warm-up",
      source: "other-language",
    });
  });

  it("gives a lesson of the course's own its name in English, then the first language written", () => {
    expect(sectionLabel(own({ label: { el: "Ζέσταμα", de: "Aufwärmen" } }), "en", ctx("en"))).toEqual({
      text: "Ζέσταμα",
      source: "other-language",
    });
    expect(sectionLabel(own({ label: { el: "Ζέσταμα", en: "Warm-up" } }), "de", ctx("de"))).toEqual({
      text: "Warm-up",
      source: "other-language",
    });
  });

  it("then its title, its template's name, and last 'Lesson n'", () => {
    expect(sectionLabel(own({}), "en", ctx("en", "Speaking up"))).toEqual({ text: "Speaking up", source: "title" });
    expect(sectionLabel(own({ template: "quiz" }), "de", ctx("de", "  "))).toEqual({
      text: "Schnellcheck",
      source: "template",
    });
    expect(sectionLabel(own({ template: "reflectionRating" }), "en", ctx("en", null))).toEqual({
      text: "Reflection & self-assessment",
      source: "template",
    });
    const blank = { ...ctx("en"), templateName: () => " " };
    expect(sectionLabel(own({}), "en", blank)).toEqual({ text: "Lesson 3", source: "generic" });
  });

  it("never asks for a standard name with a lesson of the course's own", () => {
    for (const template of ["blank", "text", "practice", "scenario", "quiz", "reflectionRating"] as const) {
      const c = ctx("en");
      sectionLabel(own({ template }), "en", c);
      expect(c.standardName).not.toHaveBeenCalled();
    }
    // Even with a standard key as its template (an outline written by hand).
    const c = ctx("en");
    expect(sectionLabel(own({ template: "concept" }), "en", c).source).toBe("generic");
    expect(c.standardName).not.toHaveBeenCalled();
    expect(c.templateName).not.toHaveBeenCalled();
  });

  it("is never blank, even when every name it could use is", () => {
    const empty = { standardName: () => "", templateName: () => "", generic: () => " " };
    expect(sectionLabel(own({}), "en", empty)).toEqual({ text: "s-abcdefgh", source: "generic" });
    expect(sectionLabel({ id: "context", template: "context" }, "en", empty)).toEqual({
      text: "context",
      source: "generic",
    });
  });
});
