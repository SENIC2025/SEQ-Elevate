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
 *
 * A title and description are cleaned once, here, for the form and the
 * actions alike; a title is compared with the address it opens as it reads
 * (titleMisleads).
 */

import { checkLinkHref, emailAddressOf } from "@/lib/rich-text/link-url";
import { linkTextProblem } from "@/lib/rich-text/link-text";
import { cleanPlainText } from "@/lib/rich-text/sanitize";
import type { LessonLinkRef } from "./reading-types";
import type { Locale } from "./types";

/**
 * The limits of a further-reading link (D107), refused, never cut: a title
 * of 1–200 characters and a description of at most 300, once cleaned, and
 * at most 30 links per lesson.
 */
export const LINK_LIMITS = { title: 200, description: 300, perLesson: 30 } as const;

/**
 * A title or description as stored (spec 4.2), and as the form measures it:
 * one line (tabs and line breaks become spaces), control and direction
 * characters removed (cleanPlainText, as a lesson title is cleaned),
 * trimmed; the spaces typed stay. Null, refused and never cut, when it is
 * over `max` characters; a string over twice `max` is refused before it is
 * cleaned, since whatever cleaning removes, reading it is wasted work.
 */
export function cleanLinkLine(value: string, max: number): string | null {
  if (value.length > 2 * max) return null;
  const line = cleanPlainText(value).replace(/[\t\n\r]+/g, " ").trim();
  return line.length > max ? null : line;
}

/**
 * Characters that show nothing: Unicode's default-ignorable code points
 * (zero-width spaces and joiners, direction marks, invisible operators,
 * Hangul fillers, variation selectors, the soft hyphen, and the like).
 */
const SHOWS_NOTHING = /\p{Default_Ignorable_Code_Point}/gu;

/**
 * Text as it reads: compatibility forms folded into the characters they
 * show (NFKC: "\u2024" is ".", a fullwidth ":" is ":"), then every character
 * that shows nothing removed.
 */
function asItReads(text: string): string {
  return text.normalize("NFKC").replace(SHOWS_NOTHING, "");
}

/** A title that shows nothing at all: only spaces and characters that show nothing. */
export function titleShowsNothing(title: string): boolean {
  return !asItReads(title).trim();
}

/**
 * "www." starting a word: a host as people write it ("www.bpb.de/x"), read
 * as the web address it names. Not when glued to what comes before it: a
 * letter or digit ("awww."), an address ("https://www.", "info@www."), a
 * host ("sub.www.").
 */
const WWW_HOST = /(^|[^\p{L}\p{N}\p{M}_@./:+-])(www\.)/giu;

/**
 * Whether a further-reading title shows another address than `href` opens
 * (D104's rule, linkTextProblem, as D107 applies it to titles). The title
 * is compared as written and as it reads (asItReads), so characters that
 * show nothing or only look like others never hide an address from the
 * comparison; and a host written with "www." counts as the web address it
 * names. A title that names the link's own site, however it is written, is
 * accepted.
 */
export function titleMisleads(title: string, href: string): boolean {
  const read = asItReads(title).replace(WWW_HOST, "$1https://$2");
  return linkTextProblem(title, href) === "misleading" || linkTextProblem(read, href) === "misleading";
}

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
 * An email address as shown under its link: its domain in ASCII (an
 * international domain in punycode, as a web host is shown), the part
 * before "@" as written.
 */
function shownEmail(address: string): string {
  if (/^[\x00-\x7f]*$/.test(address)) return address;
  const at = address.lastIndexOf("@");
  try {
    return `${address.slice(0, at)}@${new URL(`https://${address.slice(at + 1)}`).hostname}`;
  } catch {
    return address;
  }
}

/**
 * Where an accepted link goes, as shown under its title: the host of a web
 * address (international hosts in punycode, as the check normalised them),
 * or the bare address of an email link (its domain in ASCII too). "" for
 * anything else.
 */
export function linkPlace(link: { url: string; kind: LessonLinkRef["kind"] | null }): string {
  if (link.kind === "email") {
    const address = emailAddressOf(link.url);
    return address ? shownEmail(address) : "";
  }
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
