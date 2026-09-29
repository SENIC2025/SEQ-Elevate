/**
 * The contract between the "Manage courses" loaders (course-admin.ts, server)
 * and the pages and components that show them (grid, course page, editors).
 *
 * Types plus two tiny pure guards — no server imports, so client components
 * can import it freely. Everything a loader returns is plain JSON (dates as
 * ISO strings), because it crosses the server → client component boundary.
 */

import { STAGES } from "@/data/course";
import type {
  CourseStage,
  LessonDocumentRef,
  Locale,
  NarrativeBlock,
  StageKey,
  VideoContent,
} from "./types";
import type { StoredStructure } from "./structure";
import type { CourseStatus } from "./course-status";

export type { CourseStatus };

/** The languages a course can be written in, in the order the UI lists them. */
export const CONTENT_LOCALES: readonly Locale[] = ["en", "de", "el"];

/** Is `value` one of the content languages? (Validates `?lang=` and action input.) */
export function isContentLocale(value: unknown): value is Locale {
  return (CONTENT_LOCALES as readonly unknown[]).includes(value);
}

/** Is `value` one of the seven lesson keys? (Validates `?lesson=` and action input.) */
export function isStageKey(value: unknown): value is StageKey {
  return (STAGES as readonly unknown[]).includes(value);
}

/** "bundled" = ships with the platform (copy in messages); "cms" = created here. */
export type CourseKind = "bundled" | "cms";

export type LanguageState = "complete" | "partial" | "missing";

/** How far a course is written in one language. */
export interface LanguageCoverage {
  state: LanguageState;
  /** Lessons learners see in this language (of `total`). */
  covered: number;
  total: number;
}

/** The course's title/subtitle for one language, and where it comes from. */
export interface CourseCopyState {
  title: string;
  /** Shown to learners as the subtitle ("clusterLabel · tagline"). */
  tagline: string;
  clusterLabel: string;
  /**
   * authored — a CMS course's own copy for this language;
   * override  — a built-in course's copy, reworded by an editor;
   * built-in  — a built-in course's copy, as it ships;
   * fallback  — a CMS course with no copy in this language yet: the values
   *             above are what learners see instead (from `fallbackFrom`).
   */
  source: "authored" | "override" | "built-in" | "fallback";
  fallbackFrom?: Locale;
  /** The wording the platform ships with — built-in courses only. */
  builtIn?: { title: string; tagline: string };
}

/** What a narrative editor starts from: the effective text, and whether it's stored. */
export interface NarrativeInitial {
  title: string;
  subtitle: string;
  blocks: NarrativeBlock[];
  /** An editor has written this language (vs. the built-in or fallback text). */
  hasOverride: boolean;
  /**
   * Fingerprint of this language's stored text (null = none stored). A save
   * sends it back, so one made from an out-of-date page can't silently undo
   * a colleague's newer save (stored-json.ts, D33).
   */
  version: string | null;
  /** CMS only: nothing written in this language yet; learners see this one. */
  fallbackFrom?: Locale;
}

export interface LessonOutline {
  key: StageKey;
  /** Learners see this lesson (it is in getCourse().stages). */
  present: boolean;
  /** A CMS interactive lesson that isn't written yet — offered as "Add …". */
  addable: boolean;
  body: "narrative" | "reflection" | "interactive";
  /**
   * body  — false for a built-in course's reflection and interactive lessons
   *         (they come from code; the server refuses edits).
   * media — false until the lesson exists, since learners couldn't see it.
   */
  editable: { body: boolean; media: boolean };
  /** What learners see per language, and the narrative editor's start point. */
  byLang: Record<
    Locale,
    { stage: CourseStage | null; narrative: NarrativeInitial | null }
  >;
  /** The stored interactive structure (CMS courses), or null. */
  structure: StoredStructure | null;
  /** The video stored for this lesson, or null (none in the DB). */
  video: VideoContent | null;
  /**
   * The platform ships a video for this lesson, which learners see whenever
   * none is stored (built-in courses only).
   */
  builtInVideo: boolean;
  /** Every document, drafts included, in the learner's order. */
  documents: LessonDocumentRef[];
  /** ISO time the lesson row last changed, or null when there is no row. */
  updatedAt: string | null;
}

export interface ReadinessIssue {
  level: "warning" | "info";
  code: "copy-missing" | "lesson-empty" | "lesson-untranslated" | "no-interactive";
  locale?: Locale;
  stage?: StageKey;
  /** lesson-untranslated: how many lessons lack text in `locale`. */
  count?: number;
}

/** Everything the course page shows for one course. */
export interface CourseOutline {
  slug: string;
  kind: CourseKind;
  status: CourseStatus;
  publishedAt: string | null;
  durationMinutes: number;
  enrolled: number;
  lastEdited: string | null;
  copy: Record<Locale, CourseCopyState>;
  languages: Record<Locale, LanguageCoverage>;
  /** In learner (STAGES) order, including "Add …" slots for CMS courses. */
  lessons: LessonOutline[];
  /** Warnings shown before publishing — they never block it. */
  readiness: ReadinessIssue[];
}

/** One card on the course grid. */
export interface CourseGridEntry {
  slug: string;
  /** In the viewer's language, falling back like the learner catalogue. */
  title: string;
  tagline: string;
  clusterLabel: string;
  kind: CourseKind;
  status: CourseStatus;
  durationMinutes: number;
  enrolled: number;
  /** The lessons learners see, in STAGES order (count = length). */
  lessonKeys: StageKey[];
  languages: Record<Locale, LanguageCoverage>;
  /** ISO time of the latest edit, or null when never edited. */
  lastEdited: string | null;
}
