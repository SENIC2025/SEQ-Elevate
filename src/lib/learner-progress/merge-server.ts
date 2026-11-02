/**
 * How a progress patch lands in a learner's enrolment (D62, spec 4.2): the
 * one rule saveCourseProgressPatch applies, under the enrolment's row lock,
 * to what the row holds now.
 *
 *   - Finished lessons only grow: standard ones appended to
 *     stagesCompleted (upper case, the StageKey enum), the course's own to
 *     sectionsCompleted — up to a limit per row, past which each is
 *     refused for itself (`row-full`).
 *   - completedAt: the stored one, else the patch's, but only when the
 *     finished lessons, once the patch is in, cover every lesson the
 *     learner's player gives the course (`completion.lessons`: never for a
 *     course with none, nor when they aren't known), at the patch's time
 *     held between the enrolment's start and now (D118). Never null again.
 *     A completion the lessons don't cover is left out; the rest of the
 *     patch is taken as it would be.
 *   - The four standard answers keep their columns (D56): a practice and a
 *     scenario are replaced whole (a new root clears the follow-up, as the
 *     store does), the standard reflection merges p1–p3 one by one, and the
 *     quick check is replaced whole: the latest check counts (D49).
 *   - Every other answer goes to responses: a practice, scenario or quick
 *     check replaced whole, a reflection or rating merged question by
 *     question, each stamped with the server's time — only when its value
 *     changes, so a patch applied twice is the same as once. An entry it
 *     can't read is kept as it is unless the patch answers that key again.
 *     An answer that would grow the stored answers past the limit is
 *     refused for its own key (`row-full`).
 *   - Fill mode (a guest's progress moving into the account): what the
 *     account holds stays; a reflection or rating gets only the questions
 *     it has no answer to. The standard quick check is the account's once
 *     it has one: answers, a check, "Try again" (saved empty), or its
 *     lesson done (D49: the latest check counts), as a quick check of the
 *     course's own is once it has an entry. Where the account's answer
 *     stays over a different one of the patch's, its key is reported
 *     (`kept`): the page says the account kept its own.
 *
 * Pure: no Prisma (the action maps the result to columns), never throws,
 * never changes the row it is given.
 */

import { isLegacySectionId, type PartKey } from "@/lib/cms/sections/contract";
import { parseAssessmentInput, readAssessment } from "@/lib/assessment-progress";
import {
  LEGACY_PROMPT_IDS,
  RESPONSE_LIMITS,
  isLegacyKey,
  type PatchAnswer,
  type RefusedKey,
} from "./contract";
import { completedLessonIds } from "./enrolment-read";
import { readAnswer } from "./parse";
import type { ParsedPatch } from "./parse";

/** The columns of CourseEnrollment that hold a learner's progress, as Prisma reads them. */
export interface EnrollmentProgress {
  /** StageKey enum values (upper case). */
  stagesCompleted: string[];
  sectionsCompleted: unknown;
  simulationChoice: string | null;
  simulationCorrect: boolean | null;
  scenarioRoot: string | null;
  scenarioFollowup: string | null;
  reflection: unknown;
  assessment: unknown;
  responses: unknown;
  completedAt: Date | null;
}
export type ProgressColumn = keyof EnrollmentProgress;

/** A new enrolment: what the columns hold before anything is saved. */
export const EMPTY_ENROLLMENT: EnrollmentProgress = Object.freeze({
  stagesCompleted: [],
  sectionsCompleted: null,
  simulationChoice: null,
  simulationCorrect: null,
  scenarioRoot: null,
  scenarioFollowup: null,
  reflection: {},
  assessment: {},
  responses: null,
  completedAt: null,
}) as EnrollmentProgress;

/**
 * What a completion needs (D118), worked out by the action that saves:
 * the lessons the learner's player gives the course, in its spelling
 * (standard ones lower case, the course's own "s-…": lessonPlanOf's ids),
 * and when the enrolment started (its enrolledAt; a new one starts now).
 */
export interface CompletionRule {
  lessons: readonly string[];
  startedAt: Date;
}

/**
 * Do the finished lessons of `row` cover every lesson of `lessons`? Never
 * for a course with no lessons: a completion of nothing gives no badge.
 */
export function finishesCourse(row: Pick<EnrollmentProgress, "stagesCompleted" | "sectionsCompleted">, lessons: readonly string[]): boolean {
  if (!lessons.length) return false;
  const done = new Set(completedLessonIds(row));
  return lessons.every((id) => done.has(id));
}

/**
 * A completion's time, held between the enrolment's start and now. The
 * start is the database's clock (enrolledAt's default) and now the
 * server's: should the database be a moment ahead, the start wins, so a
 * course is never completed before it was started.
 */
export function completionTime(at: Date, startedAt: Date, now: Date): Date {
  return new Date(Math.max(Math.min(at.getTime(), now.getTime()), startedAt.getTime()));
}

export interface MergeResult {
  /** The enrolment after the patch. */
  next: EnrollmentProgress;
  /** The columns whose value changed: the only ones to write. */
  changed: ProgressColumn[];
  /** What wasn't saved, key by key: the patch's own refusals, then the merge's. */
  refused: RefusedKey[];
  /** completedAt went from none to set: the badge is saved with it. */
  completedNow: boolean;
  /** Fill mode: the keys where the account's answer stayed over a different one of the patch's. */
  kept: string[];
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** JSON with object keys in order, so equal values compare equal. */
function canonical(v: unknown): string {
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isRecord(v)) {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "undefined";
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** A text answer the learner has written something in. */
const written = (v: unknown) => typeof v === "string" && v.trim() !== "";

/**
 * `incoming`'s fields over `stored`'s; in fill mode only where `stored` has
 * none (`has`), and `kept` is called when one of `stored`'s stays over a
 * different value of `incoming`'s.
 */
function mergeFields(
  stored: Rec,
  incoming: Rec,
  fill: boolean,
  has: (v: unknown) => boolean,
  kept: () => void = () => {}
): Rec {
  const out: Rec = { ...stored };
  for (const [field, value] of Object.entries(incoming)) {
    if (fill && has(stored[field])) {
      if (has(value) && !same(stored[field], value)) kept();
      continue;
    }
    out[field] = value;
  }
  return out;
}

/**
 * A stored answer's value without its time, if it is one of `type` this key
 * can take. Read as it was saved, not as a new write is checked: it may
 * hold more questions than one patch may carry, or longer texts, and every
 * one of them is kept.
 */
function storedAnswer(key: PartKey, raw: unknown, type: PatchAnswer["type"]): PatchAnswer | null {
  const answer = readAnswer(key, raw, ["at"]);
  return answer?.type === type ? answer : null;
}

/**
 * A response entry's next value: the answer replacing a practice, scenario
 * or quick check whole, merged into a reflection or rating; null for "leave
 * it" (fill mode, where the account has its own). `kept` is called when the
 * account's answer stays over a different one.
 */
function nextResponse(
  key: PartKey,
  stored: unknown,
  answer: PatchAnswer,
  fill: boolean,
  kept: () => void
): PatchAnswer | null {
  const before = storedAnswer(key, stored, answer.type);
  // Fill mode leaves the account's entry alone, even one it can't read.
  if (fill && stored !== undefined && before === null) {
    kept();
    return null;
  }
  if (answer.type === "reflection") {
    const text = before?.type === "reflection" ? before.text : {};
    return { type: "reflection", text: mergeFields(text, answer.text, fill, written, kept) as Record<string, string> };
  }
  if (answer.type === "rating") {
    const values = before?.type === "rating" ? before.values : {};
    return {
      type: "rating",
      values: mergeFields(values, answer.values, fill, (v) => v !== undefined, kept) as Record<string, 1 | 2 | 3 | 4 | 5>,
    };
  }
  if (fill && stored !== undefined) {
    if (!same(before, answer)) kept();
    return null;
  }
  return answer;
}

/**
 * Has the account a standard quick check of its own, which fill mode
 * leaves alone (D49: the latest check counts)? Answers or a check; or
 * "Try again" pressed, which saves it empty (`answers` written, a column
 * no save has written holds none); or its lesson done, a check made
 * before answers were saved, or tried again since.
 */
function ownQuickCheck(before: EnrollmentProgress): boolean {
  const stored = readAssessment(before.assessment);
  return (
    Object.keys(stored.answers).length > 0 ||
    stored.checked ||
    (isRecord(before.assessment) && "answers" in before.assessment) ||
    before.stagesCompleted.includes("ASSESSMENT")
  );
}

/** `"key":value` as it stands in the stored JSON. */
const entryLength = (key: string, value: unknown) =>
  JSON.stringify(key).length + 1 + (JSON.stringify(value)?.length ?? 0);

/** CourseEnrollment.responses' items, or null when the column holds something else. */
function storedItems(raw: unknown): Rec | null {
  if (raw === null || raw === undefined) return {};
  if (isRecord(raw) && raw.v === 1 && isRecord(raw.items)) return { ...raw.items };
  return null;
}

/**
 * `patch` merged into `row` (null: no enrolment yet) at the server's time
 * `now`. `completion` says what completing the course takes (D118); null
 * (or none given) when that isn't known, and then the patch completes
 * nothing.
 */
export function mergeIntoEnrollment(
  row: EnrollmentProgress | null,
  patch: ParsedPatch,
  now: Date,
  completion: CompletionRule | null
): MergeResult {
  const before = row ?? EMPTY_ENROLLMENT;
  const next: EnrollmentProgress = { ...before };
  const refused: RefusedKey[] = [...patch.refused];
  const fill = patch.fill;
  const kept: string[] = [];
  const keep = (key: string) => () => {
    if (!kept.includes(key)) kept.push(key);
  };

  /* ---------------------------------------------------- finished lessons */
  const stages = [...before.stagesCompleted];
  const ownStored = before.sectionsCompleted ?? [];
  const own = Array.isArray(ownStored) ? [...ownStored] : null;
  const ownHas = new Set<unknown>(own);
  for (const id of patch.completed) {
    if (isLegacySectionId(id)) {
      const key = id.toUpperCase();
      if (!stages.includes(key)) stages.push(key);
    } else if (own === null) {
      // Something else is stored there: kept, and nothing added to it.
      refused.push({ key: id, reason: "invalid" });
    } else if (ownHas.has(id)) {
      continue;
    } else if (own.length >= RESPONSE_LIMITS.ownLessonsPerRow) {
      // Any "s-" id passes the patch's checks: the list is bounded per row.
      refused.push({ key: id, reason: "row-full" });
    } else {
      own.push(id);
      ownHas.add(id);
    }
  }
  next.stagesCompleted = stages;
  if (own !== null) next.sectionsCompleted = own.length ? own : before.sectionsCompleted;

  /* ----------------------------------------------------------- answers */
  const items = storedItems(before.responses);
  let itemsChanged = false;
  let itemsLength = items ? JSON.stringify({ v: 1, items }).length : 0;
  const at = now.toISOString();

  for (const [key, answer] of patch.answers) {
    if (isLegacyKey(key)) {
      if (answer.type === "practice") {
        if (fill && before.simulationChoice !== null) {
          if (before.simulationChoice !== answer.optionId) keep(key)();
          continue;
        }
        next.simulationChoice = answer.optionId;
        next.simulationCorrect = answer.correct;
      } else if (answer.type === "scenario") {
        if (fill && before.scenarioRoot !== null) {
          if (before.scenarioRoot !== answer.rootId || (before.scenarioFollowup ?? null) !== (answer.followupId ?? null)) {
            keep(key)();
          }
          continue;
        }
        next.scenarioRoot = answer.rootId;
        next.scenarioFollowup = answer.followupId ?? null;
      } else if (answer.type === "reflection") {
        const stored = isRecord(before.reflection) ? before.reflection : {};
        const text: Rec = {};
        for (const p of LEGACY_PROMPT_IDS) if (p in answer.text) text[p] = answer.text[p];
        next.reflection = mergeFields(stored, text, fill, written, keep(key));
      } else if (answer.type === "quiz") {
        if (fill && ownQuickCheck(before)) {
          const stored = readAssessment(before.assessment);
          if (!same({ answers: stored.answers, checked: stored.checked }, { answers: answer.answers, checked: answer.checked })) {
            keep(key)();
          }
          continue;
        }
        // Checked as Release 1's action checks it (parse.ts already checked
        // the same limits, so this doesn't refuse; never null for this shape).
        try {
          next.assessment = parseAssessmentInput({ answers: answer.answers, checked: answer.checked });
        } catch {
          refused.push({ key, reason: "invalid" });
        }
      }
      continue;
    }

    if (items === null) {
      refused.push({ key, reason: "invalid" });
      continue;
    }
    const stored = items[key];
    const value = nextResponse(key, stored, answer, fill, keep(key));
    if (value === null) continue;
    if (isRecord(stored) && same({ ...stored, at: undefined }, { ...value, at: undefined })) continue;
    const entry = { ...value, at };
    // The stored JSON's length after this entry, without writing it all out again.
    const had = key in items;
    const length =
      itemsLength +
      entryLength(key, entry) -
      (had ? entryLength(key, stored) : 0) +
      (!had && Object.keys(items).length > 0 ? 1 : 0);
    if (length > RESPONSE_LIMITS.rowJsonChars && length > itemsLength) {
      refused.push({ key, reason: "row-full" });
      continue;
    }
    items[key] = entry;
    itemsLength = length;
    itemsChanged = true;
  }
  if (items !== null && itemsChanged) next.responses = { v: 1, items };

  /* -------------------------------------------------------- completion */
  // Only once every lesson of the course is finished, this patch's
  // included (D118); the time no earlier than the enrolment's start.
  if (
    before.completedAt === null &&
    patch.completedAt !== null &&
    completion != null &&
    finishesCourse(next, completion.lessons)
  ) {
    next.completedAt = completionTime(patch.completedAt, completion.startedAt, now);
  }

  const changed = (Object.keys(next) as ProgressColumn[]).filter((c) => !same(before[c], next[c]));
  return {
    next,
    changed,
    refused,
    completedNow: before.completedAt === null && next.completedAt !== null,
    kept,
  };
}
