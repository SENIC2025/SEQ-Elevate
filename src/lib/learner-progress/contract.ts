/**
 * Release 2 — a learner's progress and answers per lesson and per item
 * (D62, spec 2.3–2.4). The shapes the learner store, the patch it sends
 * and the server's merge share.
 *
 * Every answer has exactly one home (D56 rejected two copies):
 *   simulation/main, scenario/main   their CourseEnrollment columns;
 *   reflection/main (p1–p3 only)     CourseEnrollment.reflection;
 *   assessment/main                  CourseEnrollment.assessment (D49);
 *   every other "lessonId/contentId" CourseEnrollment.responses.items.
 * Standard lessons finished stay in stagesCompleted (the StageKey enum);
 * the course's own ("s-…") go to sectionsCompleted.
 *
 * Client-safe: types, constants and nothing that reads the database. Owned
 * by the Foundation; the streams code against it and don't edit it.
 */

import type { AssessmentProgress } from "@/lib/assessment-progress";
import type { PartKey } from "@/lib/cms/sections/contract";

/** One answer as it is stored and sent. */
export type StoredAnswer =
  /** `correct` is worked out by the client, as simulationCorrect is today. */
  | { type: "practice"; optionId: string; correct: boolean }
  | { type: "scenario"; rootId: string; followupId?: string }
  /** D49: the latest check counts. */
  | { type: "quiz"; answers: Record<string, string>; checked: boolean }
  /** By prompt id. */
  | { type: "reflection"; text: Record<string, string> }
  /** By statement id. */
  | { type: "rating"; values: Record<string, 1 | 2 | 3 | 4 | 5> };
export type AnswerType = StoredAnswer["type"];
export const ANSWER_TYPES: readonly AnswerType[] = [
  "practice",
  "scenario",
  "quiz",
  "reflection",
  "rating",
];

/** CourseEnrollment.responses. `at` = the server's time of the value's last change. */
export interface StoredResponses {
  v: 1;
  items: Partial<Record<PartKey, StoredAnswer & { at: string }>>;
}

/** The four keys whose answers keep their Release 0 columns, and the one type each takes. */
export const LEGACY_TYPE = {
  "simulation/main": "practice",
  "scenario/main": "scenario",
  "reflection/main": "reflection",
  "assessment/main": "quiz",
} as const satisfies Record<string, AnswerType>;
export type LegacyKey = keyof typeof LEGACY_TYPE;
export const isLegacyKey = (key: string): key is LegacyKey => key in LEGACY_TYPE;

/** What the standard reflection keeps in CourseEnrollment.reflection. */
export const LEGACY_PROMPT_IDS = ["p1", "p2", "p3"] as const;

/**
 * A save: only what changed since the last save the server confirmed
 * (patchSince, patch.ts). Unknown to Release 1's action, which is kept for
 * pages loaded before the deploy (saveCourseProgress).
 */
export interface ProgressPatch {
  v: 2;
  /** Finished lesson ids: standard keys lower case, "s-…" as they are. */
  completed?: string[];
  /** PartKey → answer; a reflection or rating carries only its changed fields. */
  answers?: Record<string, PatchAnswer>;
  /** ISO; only when this tab finished the course. */
  completedAt?: string;
  /** A guest's progress moving into the account: only what the account lacks. */
  fill?: true;
}
/** A reflection's text and a rating's values may hold only some fields. */
export type PatchAnswer = StoredAnswer;

export const RESPONSE_LIMITS = {
  /** = MAX_ASSESSMENT_ID_LENGTH */
  idChars: 100,
  completedPerPatch: 64,
  keysPerPatch: 200,
  /** The client splits below this; the server refuses the whole patch above it. */
  patchJsonChars: 300_000,
  /** Stored responses; growth refused per key ("row-full"). */
  rowJsonChars: 1_000_000,
  /**
   * Lessons of the course's own stored as finished (sectionsCompleted); more
   * refused per id ("row-full"). A course has at most 15 lessons at a time:
   * this leaves room for every one an editor replaces over its life.
   */
  ownLessonsPerRow: 500,
  /** Per prompt, new writes only. */
  reflectionChars: 5_000,
  /** = PART_LIMITS.reflectionPrompts */
  promptsPerAnswer: 10,
  /** = PART_LIMITS.ratingStatements */
  statementsPerAnswer: 12,
  /** = MAX_ASSESSMENT_ANSWERS */
  quizAnswers: 100,
} as const;

/** Why one key of a patch wasn't saved. The rest of the patch was. */
export type KeyRefusal = "invalid" | "too-long" | "row-full";
export interface RefusedKey {
  key: string;
  reason: KeyRefusal;
}

export type SaveProgressResult =
  | { ok: true; refused: RefusedKey[] }
  | { ok: false; error: "other-account" | "unknown-course" | "bad-input" | "too-large" };

/**
 * One course's progress as the learner store holds it: what a patch is
 * worked out from (patch.ts) and what an answer lands in (answers.ts). The
 * store's CourseProgress has these fields and more (the course's slug and
 * title).
 */
export interface ProgressState {
  /** Standard lessons finished, lower case. Never an "s-…" id. */
  stagesCompleted: string[];
  /** Lessons of the course's own finished ("s-…"). */
  sectionsCompleted: string[];
  simulation: { choice: string; correct: boolean } | null;
  scenario: {
    root: string | null;
    followup: string | null;
    /** The choices' text, for the Comp Card and facilitator evidence. */
    rootLabel?: string | null;
    followupLabel?: string | null;
  };
  reflection: { p1: string; p2: string; p3: string };
  assessment: AssessmentProgress;
  /** Every other answer, by PartKey. `retaken` steers merging, like assessment's. */
  responses: Partial<Record<PartKey, StoredAnswer & { retaken?: true }>>;
  completedAt: string | null;
}
