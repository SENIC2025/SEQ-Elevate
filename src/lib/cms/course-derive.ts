/**
 * Pure facts about a course for the "Manage courses" screens — which lessons
 * learners see, how far each language is written, when it was last edited,
 * and what to mention before publishing. No DB, no server-only boundary, so
 * it is unit-tested; course-admin.ts feeds it the rows.
 *
 * The rules mirror how the learner side builds a course, so the grid never
 * promises something the player won't show:
 *   - bundled courses always have all seven lessons (local-provider.ts), in
 *     every language (their copy is in the message catalogue);
 *   - CMS courses always have the four narrative-family lessons, plus each
 *     interactive lesson whose structure is written (db-course.ts).
 */

import { STAGES } from "@/data/course";
import {
  STRUCTURE_STAGE_KEYS,
  type LocalizedText,
  type StoredScenarioChoice,
  type StoredStructure,
} from "./structure";
import {
  isStageKey,
  type CourseKind,
  type CourseOutline,
  type LanguageCoverage,
  type LessonOutline,
  type ReadinessIssue,
} from "./course-admin-types";
import type { Locale, StageKey } from "./types";
import { blockHasText, metaHasText, narrativeHasText } from "./text-fallback";
import type { MainKind, NewOnlyReason, PublishBlocker } from "./sections/contract";

const LOCALES: readonly Locale[] = ["en", "de", "el"];

/** The subset of a Lesson row these rules read. */
export interface LessonFacts {
  stageKey: string;
  /**
   * What the lesson's main content is (its section's mainKindOf). Needed for
   * a lesson of the course's own ("s-…"), whose key doesn't say; a standard
   * lesson's is its key's, which is also the default.
   */
  mainKind?: MainKind;
  narrative?: unknown;
  structure?: unknown;
  updatedAt?: Date | string | null;
  documents?: { createdAt: Date | string }[];
  /** Release 4 (D107): the lesson's further-reading links, as far as "last edited" reads them. */
  links?: { updatedAt: Date | string }[];
}

const isInteractive = (key: string): boolean =>
  (STRUCTURE_STAGE_KEYS as readonly string[]).includes(key);

/** A standard lesson's main content, by its key (sections/contract mainKindOf). */
function keyKind(key: string): MainKind {
  if (isInteractive(key)) return key as MainKind;
  return key === "reflection" ? "reflection" : "narrative";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The lessons learners see, in STAGES order. */
export function presentStageKeys(
  kind: CourseKind,
  lessons: LessonFacts[]
): StageKey[] {
  if (kind === "bundled") return [...STAGES];
  const authored = new Set(
    lessons.filter((l) => l.structure != null).map((l) => l.stageKey)
  );
  return STAGES.filter((k) => !isInteractive(k) || authored.has(k));
}

/** Every piece of learner-facing text in a stored structure. */
function structureTexts(s: StoredStructure): (LocalizedText | undefined)[] {
  const out: (LocalizedText | undefined)[] = [s.title];
  if (s.kind === "simulation") {
    out.push(s.prompt, s.instruction);
    for (const o of s.options ?? []) out.push(o.text, o.feedback);
  } else if (s.kind === "scenario") {
    out.push(s.setup, s.question, s.followupQuestion);
    const walk = (choices: StoredScenarioChoice[] | undefined) => {
      for (const c of choices ?? []) {
        out.push(c.text, c.outcome);
        walk(c.followups);
      }
    };
    walk(s.choices);
  } else if (s.kind === "assessment") {
    out.push(s.intro);
    for (const q of s.questions ?? []) {
      out.push(q.question);
      for (const o of q.options ?? []) out.push(o.text);
    }
  }
  return out;
}

const filled = (v: unknown) => typeof v === "string" && v.trim() !== "";

/**
 * Is the structure written in `locale`? True when every text that is written
 * in some language is also written in this one. (Blank everywhere is a gap
 * validateStructure reports, not a translation gap.)
 */
export function structureHasLocale(s: StoredStructure, locale: Locale): boolean {
  return structureTexts(s).every((t) => {
    if (!t || !Object.values(t).some(filled)) return true;
    return filled(t[locale]);
  });
}

type LessonState = "authored" | "default" | "missing";

/**
 * Where a lesson's text in `locale` comes from: written by an editor (or the
 * platform, for bundled courses), the platform's localised default (a CMS
 * reflection nobody wrote), or missing — learners see another language.
 */
function lessonState(
  kind: CourseKind,
  key: string,
  lesson: LessonFacts | undefined,
  locale: Locale
): LessonState {
  if (kind === "bundled") return "authored";
  // A standard lesson's key decides, as before; a lesson of the course's own
  // is read by its main content's kind.
  const main = isStageKey(key) ? keyKind(key) : (lesson?.mainKind ?? "narrative");
  if (isInteractive(main)) {
    const s = asRecord(lesson?.structure);
    return s && structureHasLocale(s as unknown as StoredStructure, locale)
      ? "authored"
      : "missing";
  }
  // A language version with nothing but blanks (typed, then cleared) isn't
  // written: learners get another language's text there.
  const narrative = asRecord(lesson?.narrative);
  if (narrativeHasText(narrative?.[locale])) return "authored";
  // A reflection nobody wrote uses generic prompts localised for every
  // language (db-course.ts DEFAULTS), so it reads fine in each of them.
  const written =
    narrative && Object.values(narrative).some(narrativeHasText);
  if (main === "reflection" && !written) return "default";
  return "missing";
}

/** Do learners get this lesson in `locale`, rather than another language? */
export function lessonCoveredIn(
  kind: CourseKind,
  key: string,
  lesson: LessonFacts | undefined,
  locale: Locale
): boolean {
  return lessonState(kind, key, lesson, locale) !== "missing";
}

/**
 * How far the course is written in each language.
 *
 * complete — title/subtitle and every lesson are in this language;
 * partial  — some of it is (its own title/subtitle, or at least one lesson an
 *            editor wrote in it);
 * missing  — not started. Platform defaults alone don't count as starting,
 *            so a brand-new course isn't "partly German" just because its
 *            generic reflection prompts are.
 */
export function languageCoverage(
  kind: CourseKind,
  meta: unknown,
  lessons: LessonFacts[],
  presentKeys: readonly string[]
): Record<Locale, LanguageCoverage> {
  const byStage = new Map(lessons.map((l) => [l.stageKey, l]));
  const copy = asRecord(meta);
  const out = {} as Record<Locale, LanguageCoverage>;
  for (const locale of LOCALES) {
    const copyOk = kind === "bundled" || metaHasText(copy?.[locale]);
    const states = presentKeys.map((k) =>
      lessonState(kind, k, byStage.get(k), locale)
    );
    const covered = states.filter((s) => s !== "missing").length;
    const total = presentKeys.length;
    const state =
      copyOk && covered === total
        ? "complete"
        : copyOk || states.includes("authored")
          ? "partial"
          : "missing";
    out[locale] = { state, covered, total };
  }
  return out;
}

const time = (d: Date | string) => new Date(d).getTime();

/**
 * When the course was last edited: the latest of the course row, its lesson
 * rows, its documents' upload times (documents have no updatedAt) and its
 * further-reading links' last changes (Release 4, spec 4.7: added, changed,
 * shown or hidden). Null when there is nothing to go on. Returned as an ISO
 * string.
 */
export function lastEdited(
  courseUpdatedAt: Date | string | null | undefined,
  lessons: LessonFacts[]
): string | null {
  const stamps: number[] = [];
  if (courseUpdatedAt) stamps.push(time(courseUpdatedAt));
  for (const l of lessons) {
    if (l.updatedAt) stamps.push(time(l.updatedAt));
    for (const d of l.documents ?? []) stamps.push(time(d.createdAt));
    for (const k of l.links ?? []) stamps.push(time(k.updatedAt));
  }
  const valid = stamps.filter((t) => Number.isFinite(t));
  return valid.length ? new Date(Math.max(...valid)).toISOString() : null;
}

/**
 * Should the course page offer "Add …" for this lesson? Only while nothing
 * of it is written: a practice lesson that so far exists only as a draft is
 * already being worked on, so the lesson list and the lesson itself offer
 * to edit it (with a "Draft" mark) rather than to add something new.
 */
export function offersAdd(lesson: Pick<LessonOutline, "addable" | "draft">): boolean {
  return lesson.addable && !lesson.draft;
}

/** The server's publish blockers (sections/publish-blockers.ts) as the page lists them first. */
export function publishBlockerIssues(blockers: readonly PublishBlocker[]): ReadinessIssue[] {
  return blockers.map((blocker) => ({
    level: "blocker",
    code: "cannot-publish",
    blocker,
    ...(blocker.code === "unreadable" && blocker.sectionId ? { stage: blocker.sectionId } : {}),
  }));
}

/**
 * Release 1's blockers (D57), one per way the lesson list differs from the
 * standard layout: only while a kill switch puts that guard back
 * (R2_PUBLISH_GUARD=on or R2_LEARNER_PLAYER=off, spec 3.4).
 */
export function release1BlockerIssues(reasons: readonly NewOnlyReason[]): ReadinessIssue[] {
  return reasons.map((reason) => ({
    level: "blocker",
    code: "needs-release-2",
    reason,
    ...(reason.sectionId ? { stage: reason.sectionId } : {}),
  }));
}

/**
 * Things worth knowing before publishing. Warnings and info never block
 * publishing, since a course half-translated today is still useful in the
 * language it is written in (learners get fallbacks). Blockers do, and come
 * first: the course page's loader works them out on the server, where the
 * lesson plan is (D66: a list or lesson that can't be read, or no lesson
 * learners would see — publishBlockerIssues; Release 1's reasons under a
 * kill switch — release1BlockerIssues), and passes them in.
 *
 * - copy-missing:        a CMS course has no title/subtitle in a language;
 * - lesson-empty:        a CMS narrative lesson has no blocks in any language;
 * - lesson-untranslated: lessons with text in some language but not this one
 *                        (empty lessons are already reported above);
 * - lesson-draft:        an interactive lesson has an unfinished draft that
 *                        learners don't see (whether or not they see an
 *                        earlier version of the lesson);
 * - part-draft:          a lesson's extra content has a draft that isn't
 *                        saved for learners (or the preview);
 * - sections-many:       more than 12 lessons learners would see — fine,
 *                        but long for one sitting;
 * - no-interactive:      a CMS course has no simulation/scenario/quick check
 *                        saved for learners.
 *
 * Step names are never mentioned: learners get them (D58). Without the
 * lesson list (`sections` absent or null: a built-in course, or a loader
 * before Release 1) the issues are exactly Release 0's.
 *
 * Release 3 (D90): English is the source language, so a copy-missing or
 * lesson-untranslated in English is also
 * - english-incomplete:  a blocker until the course is first published
 *                        (`publishedAt` null; guardPublish refuses it the
 *                        same way, from englishGaps), a warning after that
 *                        (nothing is unpublished). Without it, learners of a
 *                        language that isn't switched on would get another
 *                        language's text labelled as English;
 * and, with `ready` and `languages`:
 * - language-live-incomplete: German or Greek is live for learners but no
 *                        longer complete (usually: the English changed);
 *                        it isn't switched off;
 * - language-not-live:   German or Greek is partly written but not
 *                        switched on: its learners get English.
 */
export function publishReadiness(
  outline: Pick<CourseOutline, "kind" | "copy" | "lessons"> &
    Partial<Pick<CourseOutline, "sections" | "publishedAt" | "ready" | "languages">>,
  blockers: readonly ReadinessIssue[] = []
): ReadinessIssue[] {
  if (outline.kind !== "cms") return [];
  const issues: ReadinessIssue[] = [...blockers];
  const sections = outline.sections ?? null;

  for (const locale of LOCALES) {
    if (outline.copy[locale]?.source === "fallback") {
      issues.push({ level: "warning", code: "copy-missing", locale });
    }
  }

  const present = outline.lessons.filter((l) => l.present);
  // Lesson ids, not only stage keys: a created course's own lessons count too.
  const empty = new Set<string>();
  for (const l of present) {
    if (l.body !== "narrative") continue;
    // Blocks with nothing in them don't count: learners would see none.
    const blocks = LOCALES.map(
      (loc) => l.byLang[loc]?.narrative?.blocks.filter(blockHasText).length ?? 0
    );
    if (blocks.every((n) => n === 0)) {
      empty.add(l.key);
      issues.push({ level: "warning", code: "lesson-empty", stage: l.key });
    }
  }

  for (const locale of LOCALES) {
    const count = present.filter((l) => {
      if (empty.has(l.key)) return false;
      if (l.body === "interactive") {
        return l.structure ? !structureHasLocale(l.structure, locale) : false;
      }
      // Narrative and reflection: written in another language, not this one.
      const written = LOCALES.filter((loc) => l.byLang[loc]?.narrative?.hasOverride);
      return written.length > 0 && !written.includes(locale);
    }).length;
    if (count > 0) {
      issues.push({
        level: "warning",
        code: "lesson-untranslated",
        locale,
        count,
      });
    }
  }

  for (const l of outline.lessons) {
    if (l.draft) {
      issues.push({ level: "warning", code: "lesson-draft", stage: l.key });
    }
  }

  for (const l of outline.lessons) {
    for (const p of l.parts?.items ?? []) {
      if (p.type !== "main" && p.type !== "text" && p.draft) {
        issues.push({ level: "warning", code: "part-draft", stage: l.key, part: p.id });
      }
    }
  }

  if (sections) {
    const visible = sections.resolved.sections.filter((s) => !s.hidden).length;
    if (visible > sections.warnAbove) {
      issues.push({ level: "warning", code: "sections-many", count: visible });
    }
  }

  // An exercise lesson counts once its exercise is saved for learners: a
  // stored lesson list can hold one with nothing saved in it yet.
  if (!present.some((l) => l.body === "interactive" && l.structure)) {
    issues.push({ level: "info", code: "no-interactive" });
  }

  // English is the source language (D90): before the first publish a
  // blocker, listed with the others; after it a warning.
  const englishMissing = issues.some(
    (i) => (i.code === "copy-missing" || i.code === "lesson-untranslated") && i.locale === "en"
  );
  if (englishMissing) {
    if (outline.publishedAt) issues.push({ level: "warning", code: "english-incomplete" });
    else issues.splice(blockers.length, 0, { level: "blocker", code: "english-incomplete" });
  }
  if (outline.ready && outline.languages) {
    for (const locale of ["de", "el"] as const) {
      const state = outline.languages[locale]?.state;
      if (outline.ready[locale] && state !== "complete") {
        issues.push({ level: "warning", code: "language-live-incomplete", locale });
      } else if (!outline.ready[locale] && state !== undefined && state !== "missing") {
        issues.push({ level: "info", code: "language-not-live", locale });
      }
    }
  }
  return issues;
}

/** A listed lesson as englishGaps reads it from its row. */
export interface EnglishFacts {
  mainKind: MainKind;
  narrative?: unknown;
  structure?: unknown;
}

/**
 * What of a created course isn't written in English (D90), from the stored
 * rows: guardPublish's form of publishReadiness's copy-missing and
 * lesson-untranslated for English. `copy`: no English title or subtitle.
 * `lessons`: listed lessons written in another language but not English —
 * an exercise whose saved structure lacks English, a text or reflection
 * lesson written only in other languages (a text lesson only once it has
 * a block with text: before that it is lesson-empty, not untranslated).
 */
export function englishGaps(meta: unknown, lessons: readonly EnglishFacts[]): { copy: boolean; lessons: number } {
  const copy = !metaHasText(asRecord(meta)?.en);
  let missing = 0;
  for (const l of lessons) {
    if (l.mainKind !== "narrative" && l.mainKind !== "reflection") {
      const s = asRecord(l.structure);
      if (s && !structureHasLocale(s as unknown as StoredStructure, "en")) missing += 1;
      continue;
    }
    const narrative = asRecord(l.narrative);
    const written = LOCALES.filter((loc) => narrativeHasText(narrative?.[loc]));
    if (!written.length || written.includes("en")) continue;
    const hasBlocks = LOCALES.some((loc) => {
      const blocks = asRecord(narrative?.[loc])?.blocks;
      return Array.isArray(blocks) && blocks.some(blockHasText);
    });
    if (l.mainKind === "reflection" || hasBlocks) missing += 1;
  }
  return { copy, lessons: missing };
}
