/**
 * A lesson's step name in one language (D58, spec 2.5): what the course
 * page, the course card and the sectioned preview call it. Learners keep the
 * standard names until Release 2 (their player is frozen), so this is the
 * editor's view only for now.
 *
 * Text is chosen in this order, blank counting as not written (D51):
 *   1. the lesson's own name in this language;
 *   2. a standard lesson's standard name in this language — its own name in
 *      another language would read as a translation gap, the standard name
 *      is already translated;
 *   3. (a lesson of the course's own) its own name in English, then in the
 *      first language written;
 *   4. its title;
 *   5. the name of the template it was made from;
 *   6. "Lesson n".
 * The standard name is only ever asked for a standard lesson: next-intl has
 * no key for an "s-…" id and would show the key path instead.
 *
 * Pure and client-safe; the caller passes its translators in.
 */

import { fallbackOrder, firstText } from "../text-fallback";
import {
  NEW_SECTION_TEMPLATES,
  isLegacySectionId,
  type LabelSource,
  type NewSectionTemplate,
  type SectionLabel,
} from "./contract";

const isNewTemplate = (t: unknown): t is NewSectionTemplate =>
  (NEW_SECTION_TEMPLATES as readonly unknown[]).includes(t);

export const sectionLabel: SectionLabel = (s, locale, ctx) => {
  const label = s.label ?? {};
  const pick = (text: string | undefined, source: LabelSource) =>
    text === undefined ? null : { text: text.trim(), source };

  const own = pick(firstText(label[locale]), "own");
  if (own) return own;

  if (isLegacySectionId(s.id)) {
    const standard = pick(firstText(ctx.standardName(s.id)), "standard");
    if (standard) return standard;
  } else {
    const other = pick(
      firstText(...fallbackOrder(label, locale).map((k) => label[k as keyof typeof label])),
      "other-language"
    );
    if (other) return other;
  }

  return (
    pick(firstText(ctx.title), "title") ??
    (isNewTemplate(s.template) && !isLegacySectionId(s.id)
      ? pick(firstText(ctx.templateName(s.template)), "template")
      : null) ??
    pick(firstText(ctx.generic()), "generic") ??
    // Only when every translation above is blank: the id is better than nothing.
    { text: s.id, source: "generic" }
  );
};
