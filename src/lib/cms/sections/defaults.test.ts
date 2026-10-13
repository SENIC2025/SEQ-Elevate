import { describe, it, expect, vi } from "vitest";
import { validateExercise } from "./part-kinds";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { CMS_STAGE_DEFAULTS } = await import("../db-course");
const { DEFAULT_RATING_LABELS, PART_DEFAULTS, previewDefaults, STANDARD_REFLECTION_PROMPTS } =
  await import("./defaults");

/*
 * The platform's standard reflection questions are the ones a created
 * course's learners already get (db-course.ts). The editor's prefilled
 * questions and the preview must be those same words in every language —
 * shared, not copied, so they can never drift apart.
 */

describe("the standard reflection questions", () => {
  it("are db-course's prompts, as p1–p3 in every language", () => {
    expect(STANDARD_REFLECTION_PROMPTS.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    for (const locale of ["en", "de", "el"] as const) {
      expect(STANDARD_REFLECTION_PROMPTS.map((p) => p.label[locale])).toEqual(
        CMS_STAGE_DEFAULTS[locale].reflectionPrompts
      );
    }
    expect(PART_DEFAULTS.reflectionPrompts).toBe(STANDARD_REFLECTION_PROMPTS);
  });

  it("make a reflection part that is ready for learners as it is", () => {
    expect(validateExercise({ kind: "reflection", prompts: STANDARD_REFLECTION_PROMPTS })).toEqual([]);
  });
});

describe("the self-assessment's standard end labels", () => {
  it("name both ends in every language", () => {
    expect(DEFAULT_RATING_LABELS).toEqual({
      min: { en: "Not at all like me", de: "Trifft gar nicht zu", el: "Καθόλου" },
      max: { en: "Very much like me", de: "Trifft voll zu", el: "Απόλυτα" },
    });
    expect(PART_DEFAULTS.ratingLabels).toBe(DEFAULT_RATING_LABELS);
  });
});

describe("previewDefaults", () => {
  it("gives the preview the learner's reflection title and intro in its language", () => {
    expect(previewDefaults("de")).toMatchObject({
      reflectionTitle: CMS_STAGE_DEFAULTS.de.reflectionTitle,
      reflectionIntro: CMS_STAGE_DEFAULTS.de.reflectionIntro,
      reflectionPrompts: STANDARD_REFLECTION_PROMPTS,
      ratingLabels: DEFAULT_RATING_LABELS,
    });
  });
});
