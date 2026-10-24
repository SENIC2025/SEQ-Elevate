import { CONTENT_LOCALES } from "./course-admin-types";
import { fallbackOrder, hasText } from "./text-fallback";
import type { Locale } from "./types";

/**
 * A created course's references and bibliography as stored (D109, spec 5.2):
 * CourseBibliography.content = { v: 1, locales: { en?: { text, rich? }, de?:
 * …, el?: … } }, one list per language in the lesson-text format, with the
 * plain `text` the save derived from it. Pure: parsing what a row holds and
 * choosing the language learners get. A row is read as stored JSON, which a
 * direct database write may have shaped differently, so anything that isn't
 * this shape is left out rather than trusted; `rich` itself is sanitized
 * where it is drawn (RichTextView), like any stored rich text.
 */

/** One language's list: its plain text, and its rich text when it has one. */
export interface BibliographyEntry {
  text: string;
  rich?: unknown;
}

export interface BibliographyContent {
  v: 1;
  locales: Partial<Record<Locale, BibliographyEntry>>;
}

/** No list in any language. */
export const EMPTY_BIBLIOGRAPHY: BibliographyContent = Object.freeze({ v: 1, locales: Object.freeze({}) }) as BibliographyContent;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A stored row's content: version 1 with, for each content language, an
 * entry whose `text` is a string (`rich` kept as stored when there is one).
 * Anything else (another version, an unknown language, an entry without
 * text) is left out; unreadable content is no list at all. The languages
 * keep the order they were stored in.
 */
export function parseBibliography(raw: unknown): BibliographyContent {
  if (!isRecord(raw) || raw.v !== 1 || !isRecord(raw.locales)) return { v: 1, locales: {} };
  const locales: Partial<Record<Locale, BibliographyEntry>> = {};
  for (const [locale, entry] of Object.entries(raw.locales)) {
    if (!(CONTENT_LOCALES as readonly string[]).includes(locale)) continue;
    if (!isRecord(entry) || typeof entry.text !== "string") continue;
    locales[locale as Locale] = entry.rich == null ? { text: entry.text } : { text: entry.text, rich: entry.rich };
  }
  return { v: 1, locales };
}

/** The languages with a written list (text besides spaces), in the order they were stored. */
export function writtenLocales(content: BibliographyContent): Locale[] {
  return (Object.keys(content.locales) as Locale[]).filter((locale) => hasText(content.locales[locale]?.text));
}

/**
 * The list a learner gets (spec 5.2): in `locale` (their effective content
 * language) when it is written there, else in English, else in the first
 * language written (text-fallback.ts's fallbackOrder); null when no language
 * has one.
 */
export function bibliographyFor(
  content: BibliographyContent,
  locale: Locale
): { locale: Locale; entry: BibliographyEntry } | null {
  const written = Object.fromEntries(writtenLocales(content).map((l) => [l, content.locales[l]]));
  const chosen = fallbackOrder(written, locale)[0] as Locale | undefined;
  return chosen ? { locale: chosen, entry: content.locales[chosen]! } : null;
}
