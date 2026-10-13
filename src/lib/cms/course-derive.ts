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
import type {
  CourseKind,
  CourseOutline,
  LanguageCoverage,
  LessonOutline,
  ReadinessIssue,
} from "./course-admin-types";
import type { Locale, StageKey } from "./types";

const LOCALES: readonly Locale[] = ["en", "de", "el"];

/** The subset of a Lesson row these rules read. */
export interface LessonFacts {
  stageKey: string;
  narrative?: unknown;
  structure?: unknown;
  updatedAt?: Date | string | null;
  documents?: { createdAt: Date | string }[];
}

const isInteractive = (key: string): boolean =>
  (STRUCTURE_STAGE_KEYS as readonly string[]).includes(key);

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
  key: StageKey,
  lesson: LessonFacts | undefined,
  locale: Locale
): LessonState {
  if (kind === "bundled") return "authored";
  if (isInteractive(key)) {
    const s = asRecord(lesson?.structure);
    return s && structureHasLocale(s as unknown as StoredStructure, locale)
      ? "authored"
      : "missing";
  }
  const narrative = asRecord(lesson?.narrative);
  if (narrative?.[locale]) return "authored";
  // A reflection nobody wrote uses generic prompts localised for every
  // language (db-course.ts DEFAULTS), so it reads fine in each of them.
  const written = narrative && Object.values(narrative).some(Boolean);
  if (key === "reflection" && !written) return "default";
  return "missing";
}

/** Do learners get this lesson in `locale`, rather than another language? */
export function lessonCoveredIn(
  kind: CourseKind,
  key: StageKey,
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
  presentKeys: readonly StageKey[]
): Record<Locale, LanguageCoverage> {
  const byStage = new Map(lessons.map((l) => [l.stageKey, l]));
  const copy = asRecord(meta);
  const out = {} as Record<Locale, LanguageCoverage>;
  for (const locale of LOCALES) {
    const copyOk = kind === "bundled" || Boolean(copy?.[locale]);
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
 * rows, and its documents' upload times (documents have no updatedAt). Null
 * when there is nothing to go on. Returned as an ISO string.
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

/**
 * Things worth knowing before publishing. Warnings only — publishing is never
 * blocked, since a course half-translated today is still useful in the
 * language it is written in (learners get fallbacks).
 *
 * - copy-missing:        a CMS course has no title/subtitle in a language;
 * - lesson-empty:        a CMS narrative lesson has no blocks in any language;
 * - lesson-untranslated: lessons with text in some language but not this one
 *                        (empty lessons are already reported above);
 * - lesson-draft:        an interactive lesson has an unfinished draft that
 *                        learners don't see (whether or not they see an
 *                        earlier version of the lesson);
 * - no-interactive:      a CMS course has no simulation/scenario/quick check.
 */
export function publishReadiness(
  outline: Pick<CourseOutline, "kind" | "copy" | "lessons">
): ReadinessIssue[] {
  if (outline.kind !== "cms") return [];
  const issues: ReadinessIssue[] = [];

  for (const locale of LOCALES) {
    if (outline.copy[locale]?.source === "fallback") {
      issues.push({ level: "warning", code: "copy-missing", locale });
    }
  }

  const present = outline.lessons.filter((l) => l.present);
  const empty = new Set<StageKey>();
  for (const l of present) {
    if (l.body !== "narrative") continue;
    const blocks = LOCALES.map(
      (loc) => l.byLang[loc]?.narrative?.blocks.length ?? 0
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

  if (!present.some((l) => l.body === "interactive")) {
    issues.push({ level: "info", code: "no-interactive" });
  }
  return issues;
}
