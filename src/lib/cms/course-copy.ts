/**
 * Editor rewording of a BUNDLED course's title and subtitle, per locale
 * (`Course.copyOverride`). Pure and unit-tested; the DB read lives in
 * course-overlay.ts and the write in the updateCourseMeta action.
 *
 * Why a separate column rather than `Course.meta`: a non-null `meta` is what
 * marks a course as CMS-created (db-course.ts, structure.ts), so writing it on
 * a bundled row would list the course twice and let the structure editor
 * write stages getCourse then ignores. See DECISIONS.md · D34.
 *
 * Each field overrides on its own and never falls back across languages: a
 * German title override leaves the German subtitle, and every other language,
 * on the built-in wording.
 */

import type { Locale } from "./types";

export interface CopyFields {
  title?: string;
  tagline?: string;
}
export type CopyOverride = Partial<Record<Locale, CopyFields>>;

const LOCALES: readonly Locale[] = ["en", "de", "el"];

/**
 * Read the stored JSON defensively — it is untrusted data in a DB column.
 * Unknown locales, unknown fields, non-strings and blank strings are dropped.
 */
export function readCopyOverride(json: unknown): CopyOverride {
  const out: CopyOverride = {};
  if (!json || typeof json !== "object" || Array.isArray(json)) return out;
  const src = json as Record<string, unknown>;
  for (const locale of LOCALES) {
    const entry = src[locale];
    if (!entry || typeof entry !== "object") continue;
    const { title, tagline } = entry as Record<string, unknown>;
    const fields: CopyFields = {};
    if (typeof title === "string" && title.trim()) fields.title = title;
    if (typeof tagline === "string" && tagline.trim()) fields.tagline = tagline;
    if (fields.title !== undefined || fields.tagline !== undefined) {
      out[locale] = fields;
    }
  }
  return out;
}

/** The copy learners see in `locale`: each overridden field replaces its base. */
export function applyCopy<T extends { title: string; tagline: string }>(
  base: T,
  override: CopyOverride | null,
  locale: Locale
): T {
  const fields = override?.[locale];
  if (!fields) return base;
  return {
    ...base,
    title: fields.title || base.title,
    tagline: fields.tagline || base.tagline,
  };
}

/**
 * Set one locale's override. An empty string removes that field (back to the
 * built-in wording); a locale with nothing left is removed; null when no
 * override remains at all, so the column can go back to NULL.
 */
export function mergeCopyOverride(
  override: CopyOverride | null,
  locale: Locale,
  fields: { title: string; tagline: string }
): CopyOverride | null {
  const next: CopyOverride = { ...(override ?? {}) };
  const entry: CopyFields = {};
  if (fields.title) entry.title = fields.title;
  if (fields.tagline) entry.tagline = fields.tagline;
  if (entry.title !== undefined || entry.tagline !== undefined) {
    next[locale] = entry;
  } else {
    delete next[locale];
  }
  return Object.keys(next).length ? next : null;
}

// C0 controls except the newline, DEL, and the bidi embedding/override and
// isolate characters, which can make a title display differently from how it
// was typed.
const UNSAFE_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F‪-‮⁦-⁩]/g;

/** Tidy one piece of editor-typed copy: strip unsafe characters, trim, cap. */
export function cleanCopyText(value: string, max: number): string {
  return value.replace(UNSAFE_CHARS, "").trim().slice(0, max).trim();
}
