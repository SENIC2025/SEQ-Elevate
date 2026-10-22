import { itemLanguageOn } from "@/lib/r4-switches";
import { CONTENT_LOCALES } from "./course-admin-types";
import type { Locale } from "./types";

/**
 * Which documents and further-reading links a learner gets, by the
 * languages each is for (D108, spec 4.2 and 4.4). Pure.
 *
 * Stored languages are distinct values of en, de and el; [] means every
 * language, and all three are stored as []. Learners get an item when it is
 * for every language, or for one of the languages they read in: the language
 * of their pages and the language the course text is shown in (Release 3's
 * effective content language), so a German learner on a course still shown
 * in English also gets German-only material. Lessons, progress and completion
 * never depend on this: callers filter only what they draw.
 */

/**
 * An item's languages as stored (spec 4.2): distinct values of en, de and
 * el, in that order, all three as []; [] stays [] (every language). Null for
 * anything else: not an array, a value that isn't one of the three, or a
 * value given twice.
 */
export function normaliseLanguages(input: unknown): Locale[] | null {
  if (!Array.isArray(input) || input.length > CONTENT_LOCALES.length) return null;
  const given = new Set<Locale>();
  for (const value of input) {
    if (!(CONTENT_LOCALES as readonly unknown[]).includes(value) || given.has(value as Locale)) return null;
    given.add(value as Locale);
  }
  if (given.size === CONTENT_LOCALES.length) return [];
  return CONTENT_LOCALES.filter((locale) => given.has(locale));
}

/** Something with the languages it is for; a database NULL reads as every language. */
export type WithLanguages = { languages?: readonly string[] | null };

/**
 * The items for a learner who reads in `locales` (the content language the
 * course is shown in, and the language of their pages: one value when they
 * are the same): those for every language (languages empty or absent) and
 * those for one of `locales`. With R4_ITEM_LANGUAGE=off, every item.
 */
export function forLanguage<T extends WithLanguages>(
  items: readonly T[],
  locales: readonly Locale[],
  env: Record<string, string | undefined> = process.env
): T[] {
  if (!itemLanguageOn(env)) return [...items];
  return items.filter(
    (item) => !item.languages?.length || item.languages.some((language) => (locales as readonly string[]).includes(language))
  );
}
