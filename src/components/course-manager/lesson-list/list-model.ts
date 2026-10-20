/**
 * The lesson list's small rules that aren't about the server: where "Add
 * lesson" puts a lesson, where focus goes after a move or a delete, and how a
 * publishing blocker, a refusal or the 1 December date is put into words.
 * Pure, so they are tested without a browser.
 */

import type { Locale } from "@/lib/cms/types";
import type { StageKey } from "@/lib/cms/types";
import { sectionLabel } from "@/lib/cms/sections/label";
import {
  LEGACY_ORDER,
  isLegacySectionId,
  type AddSectionChoice,
  type LabelSource,
  type NewOnlyReason,
  type NewSectionTemplate,
  type PublishBlocker,
  type SectionsError,
  type StoredSection,
} from "@/lib/cms/sections/contract";

/* ---------------------------------- names ---------------------------------- */

/**
 * The names the page needs in each CONTENT language, which the client's
 * messages (the menu language only) don't have: the standard lesson names,
 * the template names and "Lesson {n}". The course page (server) builds them
 * from the message files.
 */
export interface ContentNames {
  standard: Record<Locale, Record<StageKey, string>>;
  template: Record<Locale, Record<NewSectionTemplate, string>>;
  /** "Lesson {n}" with the placeholder kept. */
  numbered: Record<Locale, string>;
}

/**
 * A lesson's name in `lang` by the step-name rules (label.ts), from what the
 * page has: used for the name a lesson goes by once its own name there is
 * cleared, and as the rename box's placeholder.
 */
export function nameIn(
  section: Pick<StoredSection, "id" | "template" | "label">,
  lang: Locale,
  names: ContentNames,
  opts: { title?: string | null; n: number }
): { text: string; source: LabelSource } {
  return sectionLabel(section, lang, {
    standardName: (k) => names.standard[lang][k],
    templateName: (t) => names.template[lang][t],
    title: opts.title ?? null,
    generic: () => names.numbered[lang].replace("{n}", String(opts.n)),
  });
}

/** The same lesson without its own name in `lang`: what it is called once that is cleared. */
export function fallbackName(
  section: Pick<StoredSection, "id" | "template" | "label">,
  lang: Locale,
  names: ContentNames,
  opts: { title?: string | null; n: number }
): string {
  const label = { ...(section.label ?? {}) };
  delete label[lang];
  return nameIn({ ...section, label }, lang, names, opts).text;
}

/* ---------------------------------- where ---------------------------------- */

/** "auto" = the usual place (a reused or added-back standard lesson); else the index to insert before. */
export type Where = "auto" | number;

/**
 * Where a new lesson goes unless the editor says otherwise: a standard
 * lesson its usual place; otherwise after the lesson "Add lesson after" was
 * opened from, or at the end.
 */
export function defaultWhere(reuses: boolean, from: number | null, count: number): Where {
  if (reuses) return "auto";
  return from === null ? count : Math.min(from + 1, count);
}

/** addSection's `at`: null for the usual place (the end, for a lesson of the course's own). */
export const whereToAt = (w: Where): number | null => (w === "auto" ? null : w);

/** The Where select's value as a string, and back. */
export const whereValue = (w: Where) => String(w);
export const parseWhere = (v: string): Where => (v === "auto" ? "auto" : Number(v));

/* ---------------------------------- focus ---------------------------------- */

/**
 * After a move, focus stays on the pressed button, or goes to the opposite
 * one when the lesson reached an end (the pressed one is then disabled).
 */
export function focusAfterMove(index: number, dir: -1 | 1, total: number): "up" | "down" {
  const to = index + dir;
  if (dir === -1) return to <= 0 ? "down" : "up";
  return to >= total - 1 ? "up" : "down";
}

/** After a delete: the next lesson in the list, else the one before it, else none. */
export function focusAfterDelete(ids: readonly string[], deleted: string): string | null {
  const i = ids.indexOf(deleted);
  if (i === -1) return null;
  return ids[i + 1] ?? ids[i - 1] ?? null;
}

/* ---------------------------------- words ---------------------------------- */

type T = (key: string, values?: Record<string, string | number>) => string;

const REASON_KEY: Record<NewOnlyReason["code"], string> = {
  "custom-section": "customSection",
  "hidden-section": "hiddenSection",
  "removed-section": "removedSection",
  reordered: "reordered",
  "extra-parts": "extraParts",
  unreadable: "unreadable",
};

/** Where a lesson's name goes in a sentence, so it can be marked as content-language text. */
export const NAME_SLOT = "\uE000";

/**
 * A sentence around one name: the words before and after it, from a
 * formatter given a stand-in for the name (null if the name isn't in it).
 * The course page marks the name with the content language (WCAG 3.1.2)
 * while the sentence is in the menu language.
 */
export function aroundName(format: (name: string) => string): { before: string; after: string } | null {
  const s = format(NAME_SLOT);
  const i = s.indexOf(NAME_SLOT);
  if (i === -1) return null;
  return { before: s.slice(0, i), after: s.slice(i + NAME_SLOT.length) };
}

/**
 * The standard lessons of a list in their usual (Release 0) order, hidden
 * ones included: the order "The lessons are in a new order" asks for back.
 */
export function usualOrder(ids: readonly string[]): StageKey[] {
  return ids.filter(isLegacySectionId).sort((a, b) => LEGACY_ORDER.indexOf(a) - LEGACY_ORDER.indexOf(b));
}

/**
 * One of Release 1's publishing blockers in words ("“Wrap-up” is a new
 * lesson"), shown only under a kill switch (spec 3.4), with the lesson to
 * link to when it is on the page (a deleted one isn't). `format` gives the
 * same words for a given name (the lesson's, or for a new order the usual
 * order), and `name` is that name: the page marks it with the content
 * language. `t` is the lessonList.publish.reason translator.
 */
export function reasonText(
  reason: NewOnlyReason,
  nameOf: (id: string) => string,
  t: T,
  /** The usual order of the standard lessons, by name ("Context, Skill concept, …"). */
  order = ""
): { text: string; href: string | null; name: string; format: (name: string) => string } {
  const id = reason.sectionId;
  const key = REASON_KEY[reason.code];
  const name = reason.code === "reordered" ? order : id ? nameOf(id) : "";
  const format = (n: string) => t(key, reason.code === "reordered" ? { order: n } : { name: n });
  const linked = id && reason.code !== "removed-section";
  return { text: format(name), href: linked ? `#lesson-${id}` : null, name, format };
}

/**
 * One of Release 2's publishing blockers in words (D66): no lesson learners
 * would see, a lesson list that can't be read, or a lesson whose content
 * can't be read (linked, and named in the content language).
 */
export function blockerText(
  blocker: PublishBlocker,
  nameOf: (id: string) => string,
  t: T
): { text: string; href: string | null; name: string; format: (name: string) => string } {
  if (blocker.code === "unreadable" && blocker.sectionId) {
    const format = (n: string) => t("unreadableLesson", { name: n });
    const name = nameOf(blocker.sectionId);
    return { text: format(name), href: `#lesson-${blocker.sectionId}`, name, format };
  }
  const key = blocker.code === "no-lessons" ? "noLessons" : "unreadable";
  return { text: t(key), href: null, name: "", format: () => t(key) };
}

/**
 * The 1 December cut-off's date in the menu language (liveChanges.closed),
 * as a day in Brussels, where the pilot runs: the default
 * 2026-12-01T00:00:00+01:00 is "1 December 2026", not 30 November in UTC.
 */
export function closedDate(iso: string | null | undefined, locale: string): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  try {
    // The platform's English is British: "1 December 2026", not "December 1".
    return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Brussels",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * The values of liveChanges.hasLearners.delete for one lesson (spec 7.2).
 * On a published course every learner of the course keeps every lesson
 * from being deleted ("course": "2 learners have started this course");
 * on one that isn't, only the learners with something in that lesson do
 * ("lesson", learnersWithData: "1 learner has already worked on this
 * lesson"). "You can hide it instead" is said only where Hide can be
 * pressed: not for a hidden lesson, nor for the last one learners see.
 */
export function deleteBlockedValues(args: {
  published: boolean;
  count: number;
  canHide: boolean;
}): { count: number; scope: "course" | "lesson"; hide: "yes" | "no" } {
  return {
    count: args.count,
    scope: args.published ? "course" : "lesson",
    hide: args.canHide ? "yes" : "no",
  };
}

/**
 * Whether a refused change was about a lesson that the page's fresh list
 * no longer has (a colleague deleted it): then the refusal is said for the
 * whole list, since the lesson's row and its message box are gone.
 * `after` is the fresh list's ids, when the refusal brought them.
 */
export function refusalGone(at: string, error: SectionsError | "invalid", after: readonly string[] | null): boolean {
  if (at === "picker" || at === "list") return false;
  if (error === "not-a-section") return true;
  return after !== null && !after.includes(at);
}

/**
 * The message that explains a refused lesson-list change: a key under
 * `lessonList`, or under `liveChanges` for the rules for a course people
 * are taking (has-learners is a delete's, with deleteBlockedValues;
 * restructure-closed takes the date, closedDate).
 */
export function refusalWords(error: SectionsError | "invalid"): { ns: "lessonList" | "liveChanges"; key: string } {
  const list = (key: string) => ({ ns: "lessonList" as const, key });
  switch (error) {
    case "changed-elsewhere":
    case "at-edge":
    case "not-restorable":
      return list("conflict");
    case "has-learners":
      return { ns: "liveChanges", key: "hasLearners.delete" };
    case "restructure-closed":
      return { ns: "liveChanges", key: "closed" };
    case "last-lesson":
      return { ns: "liveChanges", key: "lastLesson" };
    case "too-many-sections":
      return list("max");
    case "label-too-long":
      return list("rename.tooLong");
    case "not-a-section":
      return list("errors.notASection");
    case "outline-unreadable":
      return list("errors.unreadable");
    case "forbidden":
      return list("errors.forbidden");
    case "unknown-course":
      return list("errors.unknownCourse");
    default:
      return list("errors.generic");
  }
}

/** Does a refusal mean the page is behind, so it should re-read the course? */
export function refusalRefreshes(error: SectionsError | "invalid"): boolean {
  return (
    error === "changed-elsewhere" ||
    error === "at-edge" ||
    error === "not-restorable" ||
    error === "not-a-section" ||
    error === "has-learners" ||
    error === "needs-confirmation" ||
    error === "restructure-closed" ||
    error === "last-lesson" ||
    error === "too-many-sections"
  );
}

/** The picker's message key for one choice: "Practice question", "Add back: …". */
export function choiceKey(choice: AddSectionChoice): { label: string; hint: string } {
  if (choice.startsWith("restore:")) return { label: "picker.restore", hint: "picker.restoreHint" };
  return { label: `picker.${choice}`, hint: `picker.${choice}Hint` };
}
