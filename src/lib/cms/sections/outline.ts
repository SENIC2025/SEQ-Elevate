/**
 * Course.outline: the lesson list of a course created here (D56, spec 2.1
 * and 2.3).
 *
 * Null — every course before Release 1, and every course nobody has changed
 * the list of — is today's layout, derived from the Lesson rows by exactly
 * the rule the learner reader uses (presentStageKeys, db-course.ts): the
 * four text lessons always, and each practice / scenario / quick check whose
 * exercise is saved for learners. So for a course nobody has touched, the
 * editor's list is the learners' list by construction.
 *
 * A stored list is the editor's order, hidden flags, step names, lessons of
 * the course's own (s-xxxxxxxx) and the standard text lessons deleted from
 * it. Reading it never loses a lesson learners would get: a standard lesson
 * missing from it (written by an old page, or during a deploy) is put back
 * at its standard place, never at the end, which would read as "reordered".
 * Lessons of the course's own come only from the stored list, never from
 * Lesson rows: the video and document actions create rows for any key, and
 * such strays must never turn into lessons.
 *
 * Pure, total and client-safe: the course page predicts with the same
 * functions the server runs (guard.ts).
 */

import { cleanInlineText } from "@/lib/rich-text/sanitize";
import type { CourseKind } from "../course-admin-types";
import { hasText } from "../text-fallback";
import type { Locale, StageKey } from "../types";
import {
  INTERACTIVE_KEYS,
  LEGACY_ORDER,
  NARRATIVE_KEYS,
  NEW_SECTION_TEMPLATES,
  SECTION_LIMITS,
  STANDARD_KEY_OF,
  isCustomSectionId,
  isLegacySectionId,
  isSectionId,
  type AddSectionChoice,
  type ApplyOutlineOp,
  type CanonicalInsertIndex,
  type InteractiveKey,
  type NarrativeKey,
  type NewSectionTemplate,
  type OutlineOp,
  type OutlineOpError,
  type ParseStoredOutline,
  type ResolvedOutline,
  type ResolvedSection,
  type ResolveOutline,
  type SectionFacts,
  type SectionId,
  type StoredSection,
  type ToStoredOutline,
} from "./contract";
import { partsOf } from "./section-parts";

export { labelVersion, outlineVersion } from "./versions";

const LOCALES: readonly Locale[] = ["en", "de", "el"];

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isInteractiveKey = (v: unknown): v is InteractiveKey =>
  (INTERACTIVE_KEYS as readonly unknown[]).includes(v);
const isNarrativeKey = (v: unknown): v is NarrativeKey =>
  (NARRATIVE_KEYS as readonly unknown[]).includes(v);
const isNewTemplate = (v: unknown): v is NewSectionTemplate =>
  (NEW_SECTION_TEMPLATES as readonly unknown[]).includes(v);

/* ---------------------------------- parse ---------------------------------- */

/** Step names: only the content languages, only where something is written (D51). */
function readLabel(raw: unknown): StoredSection["label"] {
  if (!isRecord(raw)) return undefined;
  const label: NonNullable<StoredSection["label"]> = {};
  for (const locale of LOCALES) {
    if (hasText(raw[locale])) label[locale] = raw[locale];
  }
  return Object.keys(label).length ? label : undefined;
}

/**
 * The stored list as written, or null for an empty column, or "unreadable"
 * when it isn't a version-1 list at all. Entries with a bad id, and repeats
 * of an id, are dropped (nothing could show them); a standard lesson's
 * template is always its own key, and a lesson of the course's own with a
 * template this release doesn't know is a text lesson. Never cuts a long
 * list short.
 */
export const parseStoredOutline: ParseStoredOutline = (raw) => {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw) || raw.v !== 1 || !Array.isArray(raw.sections)) return "unreadable";

  const sections: StoredSection[] = [];
  const seen = new Set<string>();
  for (const entry of raw.sections) {
    if (!isRecord(entry) || !isSectionId(entry.id) || seen.has(entry.id)) continue;
    const id = entry.id;
    seen.add(id);
    const label = readLabel(entry.label);
    sections.push({
      id,
      template: isLegacySectionId(id) ? id : isNewTemplate(entry.template) ? entry.template : "text",
      ...(entry.hidden === true ? { hidden: true as const } : {}),
      ...(label ? { label } : {}),
    });
  }

  // A deleted lesson that is listed again isn't deleted.
  const removed = Array.isArray(raw.removed)
    ? raw.removed.filter(
        (k, i, all): k is NarrativeKey => isNarrativeKey(k) && !seen.has(k) && all.indexOf(k) === i
      )
    : [];
  return { v: 1, sections, ...(removed.length ? { removed } : {}) };
};

/* --------------------------------- resolve --------------------------------- */

/**
 * Is this standard practice / scenario / quick check a lesson of the list?
 * When learners get it (its exercise is saved for them), as today — and
 * also when its row holds extra content (or content that can't be read),
 * even with no exercise saved, so that content and the publish blocker it
 * raises never drop out of sight with the exercise (addendum 3). A row
 * without extra content keeps today's rule exactly.
 */
function interactiveIsSection(key: InteractiveKey, lessons: readonly SectionFacts[]): boolean {
  return lessons.some((l) => {
    if (l.stageKey !== key) return false;
    if (l.structure != null) return true;
    if (l.parts == null) return false;
    const items = partsOf(l.parts);
    return items === "unreadable" || items.length > 1;
  });
}

/** Today's list: what the learner reader derives from the rows, in its order. */
function derived(lessons: readonly SectionFacts[]): ResolvedSection[] {
  return LEGACY_ORDER.filter((k) => !isInteractiveKey(k) || interactiveIsSection(k, lessons)).map(
    (id) => ({ id, template: id, custom: false })
  );
}

/**
 * Where a standard lesson goes back into a list: right after the last
 * standard lesson that comes before it in the standard order; with none,
 * right before the first one that comes after it; with neither, at the end.
 * Lessons of the course's own don't count, so a put-back lesson never
 * changes the order of the standard ones.
 */
export const canonicalInsertIndex: CanonicalInsertIndex = (sections, key) => {
  const rank = (id: string) => (LEGACY_ORDER as readonly string[]).indexOf(id);
  const own = rank(key);
  let lastBefore = -1;
  let firstAfter = -1;
  sections.forEach((s, i) => {
    const r = rank(s.id);
    if (r < 0 || r === own) return;
    if (r < own) lastBefore = i;
    else if (firstAfter === -1) firstAfter = i;
  });
  if (lastBefore !== -1) return lastBefore + 1;
  if (firstAfter !== -1) return firstAfter;
  return sections.length;
};

/**
 * The lesson list as the editor works with it. Built-in courses: all seven
 * standard lessons (their list can't change). Created courses: today's list
 * while nothing is stored; the stored list otherwise, with any standard
 * lesson learners would get put back where it belongs (`recovered`). A
 * stored value that can't be read gives today's list, marked unreadable:
 * the page still shows the lessons, but writes are refused and publishing
 * is blocked until it is repaired.
 */
export const resolveOutline: ResolveOutline = (kind: CourseKind, raw, lessons) => {
  if (kind === "bundled") {
    return {
      sections: LEGACY_ORDER.map((id) => ({ id, template: id, custom: false })),
      removed: [],
      materialised: false,
    };
  }
  const parsed = parseStoredOutline(raw);
  if (parsed === null) return { sections: derived(lessons), removed: [], materialised: false };
  if (parsed === "unreadable") {
    return { sections: derived(lessons), removed: [], materialised: true, unreadable: true };
  }

  const sections: ResolvedSection[] = parsed.sections.map((s) => ({
    ...s,
    custom: isCustomSectionId(s.id),
  }));
  const removed = parsed.removed ?? [];
  // In the standard order, so each put-back lesson sees the ones before it.
  for (const key of LEGACY_ORDER) {
    if (sections.some((s) => s.id === key)) continue;
    const back = isInteractiveKey(key)
      ? interactiveIsSection(key, lessons)
      : !removed.includes(key as NarrativeKey);
    if (!back) continue;
    sections.splice(canonicalInsertIndex(sections, key), 0, {
      id: key,
      template: key,
      custom: false,
      recovered: true,
    });
  }
  return { sections, removed: [...removed], materialised: true };
};

/** What to store: the resolved list (put-back lessons included), never client JSON. */
export const toStoredOutline: ToStoredOutline = (o) => ({
  v: 1,
  sections: o.sections.map((s) => ({
    id: s.id,
    template: s.template,
    ...(s.hidden ? { hidden: true as const } : {}),
    ...(s.label && Object.keys(s.label).length ? { label: { ...s.label } } : {}),
  })),
  ...(o.removed.length ? { removed: [...o.removed] } : {}),
});

/* ---------------------------------- free keys ---------------------------------- */

/**
 * Is a standard practice / scenario / quick check free for "Add lesson" to
 * reuse? Only while it isn't in the list and its row (if any) holds nothing
 * an editor made: no text, exercise, extra content, video or documents. A
 * draft alone doesn't count (addendum 8): the course page shows such a key
 * as an "Add …" row marked Draft, and the reuse takes over that lesson and
 * its draft rather than adding a second practice lesson beside it.
 */
function keyIsFree(
  key: InteractiveKey,
  o: ResolvedOutline,
  lessons: readonly SectionFacts[]
): boolean {
  if (o.sections.some((s) => s.id === key)) return false;
  return lessons.every((l) => {
    if (l.stageKey !== key) return true;
    const items = partsOf(l.parts);
    return (
      l.narrative == null &&
      l.structure == null &&
      items !== "unreadable" &&
      items.length === 1 &&
      l.video == null &&
      !((l.documentCount ?? 0) > 0)
    );
  });
}

/** The standard keys "Add practice / scenario / quick check" would reuse now. */
export function freeInteractiveKeys(
  o: ResolvedOutline,
  lessons: readonly SectionFacts[]
): InteractiveKey[] {
  return INTERACTIVE_KEYS.filter((k) => keyIsFree(k, o, lessons));
}

/* --------------------------------- changes --------------------------------- */

type OpResult =
  | { ok: true; outline: ResolvedOutline; id: SectionId }
  | { ok: false; error: OutlineOpError };

const refuse = (error: OutlineOpError): OpResult => ({ ok: false, error });
const done = (o: ResolvedOutline, sections: ResolvedSection[], id: SectionId, removed = o.removed): OpResult => ({
  ok: true,
  outline: { sections, removed: [...removed], materialised: true },
  id,
});

/** The choices "Add lesson" offers (a restore only for a standard text lesson). */
function isChoice(v: unknown): v is AddSectionChoice {
  return (
    isNewTemplate(v) ||
    (typeof v === "string" && v.startsWith("restore:") && isNarrativeKey(v.slice("restore:".length)))
  );
}

/**
 * The rules of one lesson-list change, given how to tell a free standard key
 * and a taken id. applyOutlineOp answers both from the rows (the server);
 * guard.ts's predictOutlineOp from what the page was sent.
 */
export function applyOutlineOpWith(
  o: ResolvedOutline,
  op: OutlineOp,
  facts: { isFree: (key: InteractiveKey) => boolean; idTaken: (id: string) => boolean }
): OpResult {
  // Changing a list that can't be read would store a guess (G8).
  if (o.unreadable) return refuse("bad-input");
  const sections = o.sections;

  if (op.op === "add") {
    if (!isChoice(op.choice)) return refuse("bad-input");
    if (op.at !== null && !(Number.isInteger(op.at) && op.at >= 0 && op.at <= sections.length)) {
      return refuse("bad-input");
    }
    if (sections.length >= SECTION_LIMITS.maxSections) return refuse("too-many-sections");

    const place = (key: StageKey, entry: ResolvedSection, removed = o.removed) => {
      const next = [...sections];
      next.splice(op.at ?? canonicalInsertIndex(sections, key), 0, entry);
      return done(o, next, entry.id, removed);
    };

    if (op.choice.startsWith("restore:")) {
      const key = op.choice.slice("restore:".length) as NarrativeKey;
      if (!o.removed.includes(key) || sections.some((s) => s.id === key)) {
        return refuse("not-restorable");
      }
      return place(key, { id: key, template: key, custom: false }, o.removed.filter((k) => k !== key));
    }

    const template = op.choice as NewSectionTemplate;
    const standard = STANDARD_KEY_OF[template];
    if (standard && facts.isFree(standard)) {
      return place(standard, { id: standard, template: standard, custom: false });
    }
    // A lesson of the course's own, under an id nothing has used: never a
    // stray row's, which would then turn up inside it.
    if (!isCustomSectionId(op.newId) || facts.idTaken(op.newId)) return refuse("bad-input");
    const next = [...sections];
    next.splice(op.at ?? sections.length, 0, { id: op.newId, template, custom: true });
    return done(o, next, op.newId);
  }

  const index = sections.findIndex((s) => s.id === op.id);
  if (index === -1) return refuse("unknown-section");
  const section = sections[index];

  switch (op.op) {
    case "move": {
      if (op.dir !== -1 && op.dir !== 1) return refuse("bad-input");
      const to = index + op.dir;
      if (to < 0 || to >= sections.length) return refuse("at-edge");
      const next = [...sections];
      [next[index], next[to]] = [next[to], next[index]];
      return done(o, next, section.id);
    }
    case "hide": {
      const { hidden: _was, ...rest } = section;
      void _was;
      const next = [...sections];
      next[index] = op.hidden ? { ...rest, hidden: true } : rest;
      return done(o, next, section.id);
    }
    case "rename": {
      if (!LOCALES.includes(op.locale) || typeof op.label !== "string") return refuse("bad-input");
      const max = SECTION_LIMITS.labelChars;
      // Refused, not cut (like D36): a name cut short reads as a typo.
      // Twice the limit is refused before cleaning, which would be wasted.
      if (op.label.length > 2 * max) return refuse("label-too-long");
      const name = cleanInlineText(op.label).trim();
      if (name.length > max) return refuse("label-too-long");
      const label = { ...section.label };
      if (name) label[op.locale] = name;
      else delete label[op.locale];
      const { label: _old, ...rest } = section;
      void _old;
      const next = [...sections];
      next[index] = Object.keys(label).length ? { ...rest, label } : rest;
      return done(o, next, section.id);
    }
    case "delete": {
      const next = sections.filter((_, i) => i !== index);
      // A standard text lesson is remembered as deleted: the learner reader
      // always shows the four text lessons, so it would otherwise come back
      // (empty). An exercise or a lesson of the course's own just goes.
      const removed =
        isNarrativeKey(section.id) && !o.removed.includes(section.id)
          ? [...o.removed, section.id]
          : o.removed;
      return done(o, next, section.id, removed);
    }
  }
}

/**
 * One change to the lesson list (spec 2.3), worked out on the resolved list
 * and stored with toStoredOutline — never the client's JSON:
 * - add: at most 15 lessons, hidden ones counted. Practice, scenario and
 *   quick check reuse their standard key when it is free, in its standard
 *   place unless `at` says otherwise (which makes the list "reordered");
 *   otherwise, and for every other choice, a lesson of the course's own
 *   (`newId`), at the end unless `at` says otherwise. "restore:<key>" adds
 *   back a deleted standard text lesson, empty.
 * - move: one place up or down; refused at either end.
 * - hide: hidden or shown.
 * - rename: one language's step name, cleaned and trimmed; blank removes it;
 *   over 40 characters is refused.
 * - delete: out of the list; a standard text lesson is remembered as deleted.
 */
export const applyOutlineOp: ApplyOutlineOp = (o, op, lessons) =>
  applyOutlineOpWith(o, op, {
    isFree: (key) => keyIsFree(key, o, lessons),
    idTaken: (id) => o.sections.some((s) => s.id === id) || lessons.some((l) => l.stageKey === id),
  });
