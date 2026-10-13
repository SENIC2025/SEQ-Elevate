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
import type {
  MainKind,
  NewOnlyReason,
  PartId,
  PartsView,
  SectionStage,
  SectionView,
  SectionsMeta,
} from "./sections/contract";

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
   * fallback  — a CMS course with no copy in this language yet (or only
   *             blanks): the values above are what learners see instead
   *             (from `fallbackFrom`).
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
  /**
   * An editor has written this language (vs. the built-in or fallback text).
   * A stored version with nothing but blanks doesn't count: learners get the
   * built-in or fallback text there.
   */
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
  /**
   * The lesson's id: a standard lesson's stage key, or "s-xxxxxxxx" for a
   * lesson added in Release 1 (sections/contract.ts). Only created courses
   * have the latter.
   */
  key: string;
  /** Learners see this lesson (it is in getCourse().stages). */
  present: boolean;
  /** A CMS interactive lesson that isn't written yet — offered as "Add …". */
  addable: boolean;
  body: "narrative" | "reflection" | "interactive";
  /**
   * What the lesson's main content is, so which editor edits it: the
   * narrative or reflection text editor, or StructureAuthor for that kind.
   * A standard lesson's is fixed by its key (mainKindOf).
   */
  mainKind: MainKind;
  /**
   * body  — false for a built-in course's reflection and interactive lessons
   *         (they come from code; the server refuses edits).
   * media — false until the lesson exists, since learners couldn't see it.
   */
  editable: { body: boolean; media: boolean };
  /**
   * Per language: what learners see (`stage`, standard lessons only), the
   * narrative editor's start point, and the editor's preview of a lesson
   * learners don't get yet — a Release 1 lesson, or one with extra content
   * (`sectioned`, null otherwise).
   */
  byLang: Record<
    Locale,
    {
      stage: CourseStage | null;
      narrative: NarrativeInitial | null;
      sectioned: SectionStage | null;
    }
  >;
  /** The stored interactive structure (CMS courses), or null. */
  structure: StoredStructure | null;
  /**
   * An editor's unfinished version of the interactive structure (CMS
   * courses), or null. Learners never see it (db-course.ts).
   */
  draft: StoredStructure | null;
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
  // The four below are for the lesson list of a created course: null for
  // built-in courses and for "Add …" slots.
  /** The lesson in the course's lesson list: name, hidden, number, bases. */
  section: SectionView | null;
  /** The lesson's content in order, main content included, with its bases. */
  parts: PartsView | null;
  /** Base of deleteSection (sectionContentVersion), null when there is no row. */
  contentVersion: string | null;
  /** Learners get this lesson now (it is in getCourse().stages). */
  live: boolean;
}

export interface ReadinessIssue {
  /** Blockers stop publishing (D57); warnings and info never do. */
  level: "blocker" | "warning" | "info";
  code:
    | "copy-missing"
    | "lesson-empty"
    | "lesson-untranslated"
    | "lesson-draft"
    | "no-interactive"
    | "needs-release-2"
    | "part-draft"
    | "labels-later"
    | "sections-many";
  locale?: Locale;
  /** The lesson's id (a stage key, or a Release 1 lesson's "s-…"). */
  stage?: string;
  /** part-draft: the content with an unsaved-for-learners draft. */
  part?: PartId;
  /** needs-release-2: one issue per reason learners couldn't get yet. */
  reason?: NewOnlyReason;
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
  /**
   * In the course's lesson order (learner order for a standard layout),
   * including "Add …" slots for CMS courses.
   */
  lessons: LessonOutline[];
  /** Shown before publishing: blockers stop it (D57), the rest never do. */
  readiness: ReadinessIssue[];
  /** The lesson list's bases and reasons: created courses only, else null. */
  sections: SectionsMeta | null;
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
  /**
   * Set when the course's lesson list is stored (Course.outline): its
   * lessons in order with their names in the grid's language, hidden ones
   * left out. Otherwise the card names `lessonKeys` as before.
   */
  sections?: { id: string; name: string }[];
  languages: Record<Locale, LanguageCoverage>;
  /** ISO time of the latest edit, or null when never edited. */
  lastEdited: string | null;
}
