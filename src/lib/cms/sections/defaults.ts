/**
 * The platform's standard wording for the flexible editor's new content
 * (spec 9.3): the three standard reflection questions a created course's
 * learners already get, and the end labels of a 1–5 self-assessment.
 *
 * The questions are db-course.ts's own DEFAULTS — shared, not copied — so
 * the editor's prefilled questions, the preview and the learner reader can
 * never drift apart. That makes this module server-side (db-course reads the
 * database); the actions and loaders hand the values to the pure rules
 * (emptyPart, prefillParts, resolveSectionStage), which take them as input.
 *
 * The German and Greek end labels are for partner review.
 */

import { CMS_STAGE_DEFAULTS } from "../db-course";
import type { LocalizedText } from "../structure";
import type { Locale } from "../types";
import { STANDARD_PROMPT_IDS, type PartDefaults } from "./contract";

const LOCALES: readonly Locale[] = ["en", "de", "el"];

/** p1–p3: the ids learners' answers are kept under (CourseEnrollment.reflection). */
export const STANDARD_REFLECTION_PROMPTS: PartDefaults["reflectionPrompts"] =
  STANDARD_PROMPT_IDS.map((id, i) => ({
    id,
    label: Object.fromEntries(
      LOCALES.map((l) => [l, CMS_STAGE_DEFAULTS[l].reflectionPrompts[i]])
    ) as LocalizedText,
  }));

/** What 1 and 5 mean on a new self-assessment, until the editor words it. */
export const DEFAULT_RATING_LABELS: PartDefaults["ratingLabels"] = {
  min: { en: "Not at all like me", de: "Trifft gar nicht zu", el: "Καθόλου" },
  max: { en: "Very much like me", de: "Trifft voll zu", el: "Απόλυτα" },
};

/** What new content starts from (emptyPart, prefillParts). */
export const PART_DEFAULTS: PartDefaults = {
  reflectionPrompts: STANDARD_REFLECTION_PROMPTS,
  ratingLabels: DEFAULT_RATING_LABELS,
};

/**
 * What the preview's lessons fall back to in one language
 * (resolveSectionStage): the standard questions, plus the reflection title
 * and intro learners get when nobody wrote one.
 */
export function previewDefaults(
  locale: Locale
): PartDefaults & { reflectionTitle: string; reflectionIntro: string } {
  const d = CMS_STAGE_DEFAULTS[locale] ?? CMS_STAGE_DEFAULTS.en;
  return {
    ...PART_DEFAULTS,
    reflectionTitle: d.reflectionTitle,
    reflectionIntro: d.reflectionIntro,
  };
}
