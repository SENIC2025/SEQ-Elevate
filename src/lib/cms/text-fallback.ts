/**
 * Which language's text learners get, when a translation is missing or
 * blank. Pure and unit-tested; db-course.ts (courses created in the CMS),
 * lesson-overlay.ts (editor rewording of built-in lessons), structure.ts
 * (exercise text) and the course page's translation warnings all read text
 * through these, so they agree on what "written" means.
 *
 * WHY blank counts as missing: the editors save exactly what is in each box,
 * so a field typed in and then cleared is stored as "" (or as the spaces
 * left in it). Treating that as real text showed learners a blank heading,
 * prompt or lesson instead of the English one, and told editors the language
 * was translated when learners actually saw nothing.
 */

import { blockPlainText } from "@/lib/rich-text/narrative";
import type { Locale, NarrativeBlock } from "./types";

/** A string with something in it besides spaces. */
export function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** The first value with text (see hasText), or undefined. */
export function firstText(...values: unknown[]): string | undefined {
  return values.find(hasText);
}

/**
 * The languages to try, best first: the learner's, then English, then the
 * others in the order they were written (a record's own key order). Only
 * keys the record has.
 */
export function fallbackOrder(
  record: Record<string, unknown>,
  locale: Locale
): string[] {
  const keys = Object.keys(record);
  return [locale, "en", ...keys].filter(
    (k, i, all) => keys.includes(k) && all.indexOf(k) === i
  );
}

/* --------------------------------- blocks --------------------------------- */

/**
 * Would a learner see any text in this block? Read from stored JSON, which a
 * direct database write may have shaped differently, so anything that isn't
 * a block has none.
 */
export function blockHasText(block: unknown): boolean {
  if (!block || typeof block !== "object") return false;
  const b = block as Record<string, unknown>;
  switch (b.kind) {
    case "paragraph":
    case "callout":
      return hasText(blockPlainText(b));
    case "list":
      return Array.isArray(b.items) && b.items.some(hasText);
    case "compare":
      return (
        Array.isArray(b.compare) &&
        b.compare.some(
          (side) =>
            !!side &&
            typeof side === "object" &&
            (hasText((side as Record<string, unknown>).text) ||
              hasText((side as Record<string, unknown>).label))
        )
      );
    default:
      return false;
  }
}

/** Blocks with at least one that has text — else they count as unwritten. */
export function blocksHaveText(blocks: unknown): blocks is NarrativeBlock[] {
  return Array.isArray(blocks) && blocks.some(blockHasText);
}

/* ------------------------------ lesson text ------------------------------- */

/** One language's stored lesson text (Lesson.narrative[locale]). */
export interface NarrativeVersion {
  title?: string;
  subtitle?: string;
  blocks?: NarrativeBlock[];
}

/**
 * Is anything in this language version written? A version whose title,
 * subtitle and blocks are all blank is an untranslated lesson, however it
 * came to be stored.
 */
export function narrativeHasText(version: unknown): boolean {
  if (!version || typeof version !== "object") return false;
  const v = version as NarrativeVersion;
  return hasText(v.title) || hasText(v.subtitle) || blocksHaveText(v.blocks);
}

/**
 * A created course's lesson text for `locale`, field by field: the title,
 * the subtitle and the blocks each come from the first language that has
 * them (see fallbackOrder). Blocks count as a whole: a language whose blocks
 * are all blank falls back to the next language's blocks. Undefined fields
 * have no text in any language.
 */
export function resolveNarrative(
  narrative: unknown,
  locale: Locale
): NarrativeVersion {
  if (!narrative || typeof narrative !== "object") return {};
  const record = narrative as Record<string, unknown>;
  const versions = fallbackOrder(record, locale)
    .map((k) => record[k])
    .filter((v): v is NarrativeVersion => !!v && typeof v === "object");
  return {
    title: firstText(...versions.map((v) => v.title)),
    subtitle: firstText(...versions.map((v) => v.subtitle)),
    blocks: versions.map((v) => v.blocks).find(blocksHaveText),
  };
}

/**
 * A built-in lesson with an editor's rewording for its language on top.
 * Each field the editor filled in replaces the built-in one; a blank field
 * leaves the built-in text. Never another language's rewording: built-in
 * courses ship every language, and their own wording is the better
 * fallback.
 */
export function overlayNarrative<
  T extends { title: string; subtitle?: string; blocks?: NarrativeBlock[] },
>(base: T, rewording: unknown): T {
  if (!rewording || typeof rewording !== "object") return base;
  const ov = rewording as NarrativeVersion;
  return {
    ...base,
    title: firstText(ov.title) ?? base.title,
    subtitle: firstText(ov.subtitle) ?? base.subtitle,
    blocks: blocksHaveText(ov.blocks) ? ov.blocks : base.blocks,
  };
}

/* ------------------------------ course copy ------------------------------- */

export interface CourseMetaEntry {
  title: string;
  tagline: string;
  clusterLabel: string;
}
export type CourseMeta = Partial<Record<Locale, CourseMetaEntry>>;

/** Does this language have its own title or subtitle? */
export function metaHasText(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Partial<CourseMetaEntry>;
  return hasText(e.title) || hasText(e.tagline);
}

/**
 * The best copy of a created course for a locale, field by field: the
 * requested language, else English, else the first language written. A
 * half-translated course still renders instead of showing blanks; the editor
 * fills the gaps as they go. Null only when the course has no copy at all.
 */
export function pickMeta(
  meta: CourseMeta | null,
  locale: Locale
): CourseMetaEntry | null {
  if (!meta || typeof meta !== "object") return null;
  const entries = fallbackOrder(meta, locale)
    .map((k) => meta[k as Locale])
    .filter((e): e is CourseMetaEntry => !!e && typeof e === "object");
  if (!entries.length) return null;
  const field = (key: keyof CourseMetaEntry) =>
    firstText(...entries.map((e) => e[key])) ?? "";
  return {
    title: field("title"),
    tagline: field("tagline"),
    clusterLabel: field("clusterLabel"),
  };
}

/**
 * Which language a created course's copy in `locale` comes from when it has
 * none of its own: English if written, else the first language that is.
 */
export function metaFallbackFrom(
  meta: CourseMeta | null,
  locale: Locale
): Locale | undefined {
  if (!meta) return undefined;
  return fallbackOrder(meta, locale).find(
    (k) => k !== locale && metaHasText(meta[k as Locale])
  ) as Locale | undefined;
}
