/**
 * The lesson list's small rules that aren't about the server: where "Add
 * lesson" puts a lesson, where focus goes after a move or a delete, and how a
 * publishing blocker or a refusal is put into words. Pure, so they are
 * tested without a browser.
 */

import type { Locale } from "@/lib/cms/types";
import type { StageKey } from "@/lib/cms/types";
import { sectionLabel } from "@/lib/cms/sections/label";
import type {
  AddSectionChoice,
  LabelSource,
  NewOnlyReason,
  NewSectionTemplate,
  SectionsError,
  StoredSection,
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

/**
 * One publishing blocker in words ("“Wrap-up” is a new lesson"), with the
 * lesson to link to when it is on the page (a deleted one isn't).
 * `t` is the lessonList.publish.reason translator.
 */
export function reasonText(
  reason: NewOnlyReason,
  nameOf: (id: string) => string,
  t: T
): { text: string; href: string | null } {
  const id = reason.sectionId;
  const text = t(REASON_KEY[reason.code], { name: id ? nameOf(id) : "" });
  const linked = id && reason.code !== "removed-section";
  return { text, href: linked ? `#lesson-${id}` : null };
}

/** The lessonList message key that explains a refused lesson-list change. */
export function refusalKey(error: SectionsError | "invalid"): string {
  switch (error) {
    case "changed-elsewhere":
    case "at-edge":
    case "not-restorable":
      return "conflict";
    case "live-course-standard-only":
      return "errors.liveLocked";
    case "has-learners":
      return "delete.blockedLearners";
    case "too-many-sections":
      return "max";
    case "label-too-long":
      return "rename.tooLong";
    case "not-a-section":
      return "errors.notASection";
    case "outline-unreadable":
      return "errors.unreadable";
    case "forbidden":
      return "errors.forbidden";
    case "unknown-course":
      return "errors.unknownCourse";
    default:
      return "errors.generic";
  }
}

/** Does a refusal mean the page is behind, so it should re-read the course? */
export function refusalRefreshes(error: SectionsError | "invalid"): boolean {
  return (
    error === "changed-elsewhere" ||
    error === "at-edge" ||
    error === "not-restorable" ||
    error === "not-a-section" ||
    error === "live-course-standard-only" ||
    error === "has-learners" ||
    error === "too-many-sections"
  );
}

/** The picker's message key for one choice: "Practice question", "Add back: …". */
export function choiceKey(choice: AddSectionChoice): { label: string; hint: string } {
  if (choice.startsWith("restore:")) return { label: "picker.restore", hint: "picker.restoreHint" };
  return { label: `picker.${choice}`, hint: `picker.${choice}Hint` };
}
