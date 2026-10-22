/**
 * Release 4 (D107, D108; spec 4.3–4.6): a lesson's further-reading links and
 * the languages of its documents and links, as pages get them. Pure and
 * client-safe: the actions, the loaders and the screens share it, so a
 * stored row is read the same way everywhere.
 *
 * Every stored address is checked again when it is read (D36: content is
 * checked on every render, whatever wrote it). Learners and preview get a
 * link only when checkLinkHref accepts its address, with the address and its
 * kind as the check gives them; staff get every row, and one whose address
 * the check refuses is marked `unusable`, to be shown as text and fixed,
 * never drawn as a link.
 */

import { checkLinkHref, emailAddressOf } from "@/lib/rich-text/link-url";
import type { LessonLinkRef } from "./reading-types";
import type { Locale } from "./types";

/**
 * The limits of a further-reading link (D107), refused, never cut: a title
 * of 1–200 characters and a description of at most 300, once cleaned, and
 * at most 30 links per lesson.
 */
export const LINK_LIMITS = { title: 200, description: 300, perLesson: 30 } as const;

/** The languages in the order they are stored and named (spec 4.2). */
const LANGUAGES: readonly Locale[] = ["en", "de", "el"];

/**
 * A stored list of languages, read: the known values, once each, in the
 * order en, de, el; all three, nothing, or a database NULL is every
 * language ([]). Values the actions never store are left out.
 */
export function storedLanguages(raw: unknown): Locale[] {
  if (!Array.isArray(raw)) return [];
  const given = new Set<unknown>(raw);
  const known = LANGUAGES.filter((l) => given.has(l));
  return known.length === LANGUAGES.length ? [] : known;
}

/** A LessonLink row as the loaders and actions select it. */
export interface StoredLink {
  id: string;
  title: string;
  url: string;
  description: string | null;
  languages: unknown;
  published: boolean;
}

/**
 * A stored link as learners and preview get it (spec 4.4): its address
 * checked again by the quick-link rules (an address of our own file store
 * is drawn, as a typed one is), its `url` and `kind` taken from the check.
 * Null when the check refuses the address: learners never get that row.
 */
export function learnerLink(row: StoredLink): LessonLinkRef | null {
  const check = checkLinkHref(row.url);
  if (!check.ok) return null;
  return {
    id: row.id,
    title: row.title,
    url: check.href,
    kind: check.kind,
    description: row.description ?? "",
    languages: storedLanguages(row.languages),
    published: row.published,
  };
}

/**
 * A link as staff screens get it (getLessonLinks, the course page): every
 * row, drafts included. A row whose stored address the check refuses (only
 * a direct database write leaves one) keeps its address as stored, with no
 * kind, and is `unusable`: shown as text with Edit and Remove, never as a
 * link.
 */
export type StaffLessonLink =
  | (LessonLinkRef & { unusable?: undefined })
  | (Omit<LessonLinkRef, "kind"> & { kind: null; unusable: true });

export function staffLink(row: StoredLink): StaffLessonLink {
  const fields = {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    languages: storedLanguages(row.languages),
    published: row.published,
  };
  const check = checkLinkHref(row.url);
  return check.ok
    ? { ...fields, url: check.href, kind: check.kind }
    : { ...fields, url: row.url, kind: null, unusable: true };
}

/**
 * Where an accepted link goes, as shown under its title: the host of a web
 * address (international hosts in punycode, as the check normalised them),
 * or the bare address of an email link. "" for anything else.
 */
export function linkPlace(link: { url: string; kind: LessonLinkRef["kind"] | null }): string {
  if (link.kind === "email") return emailAddressOf(link.url) ?? "";
  if (link.kind !== "web") return "";
  try {
    return new URL(link.url).host;
  } catch {
    return "";
  }
}

/**
 * The language a learner's document or link is marked with (spec 4.5),
 * or null: an item for some languages only, none of them the one the course
 * text is shown in (`text`), is marked with the language of the page
 * (`page`) when it is one of them, else with its first. An item for every
 * language, or for the course text's, isn't marked: it reads in the course
 * text's language. So a German-only worksheet shown to someone reading the
 * course in English says "In German".
 */
export function itemLanguageMark(
  languages: readonly Locale[] | undefined,
  text: Locale,
  page: Locale
): Locale | null {
  if (!languages?.length || languages.includes(text)) return null;
  return languages.includes(page) ? page : languages[0];
}
