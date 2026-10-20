/**
 * How a progress patch lands in a learner's enrolment (D62, spec 4.2): the
 * one rule saveCourseProgressPatch applies, under the enrolment's row lock,
 * to what the row holds now.
 *
 *   - Finished lessons only grow: standard ones appended to
 *     stagesCompleted (upper case, the StageKey enum), the course's own to
 *     sectionsCompleted — up to a limit per row, past which each is
 *     refused for itself (`row-full`).
 *   - completedAt: the stored one, else the patch's. Never null again.
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
 *     it has no answer to.
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

export interface MergeResult {
  /** The enrolment after the patch. */
  next: EnrollmentProgress;
  /** The columns whose value changed: the only ones to write. */
  changed: ProgressColumn[];
  /** What wasn't saved, key by key: the patch's own refusals, then the merge's. */
  refused: RefusedKey[];
  /** completedAt went from none to set: the badge is saved with it. */
  completedNow: boolean;
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

/** `incoming`'s fields over `stored`'s; in fill mode only where `stored` has none (`has`). */
function mergeFields(
  stored: Rec,
  incoming: Rec,
  fill: boolean,
  has: (v: unknown) => boolean
): Rec {
  const out: Rec = { ...stored };
  for (const [field, value] of Object.entries(incoming)) {
    if (fill && has(stored[field])) continue;
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
 * it" (fill mode, where the account has its own).
 */
function nextResponse(key: PartKey, stored: unknown, answer: PatchAnswer, fill: boolean): PatchAnswer | null {
  const before = storedAnswer(key, stored, answer.type);
  // Fill mode leaves the account's entry alone, even one it can't read.
  if (fill && stored !== undefined && before === null) return null;
  if (answer.type === "reflection") {
    const text = before?.type === "reflection" ? before.text : {};
    return { type: "reflection", text: mergeFields(text, answer.text, fill, written) as Record<string, string> };
  }
  if (answer.type === "rating") {
    const values = before?.type === "rating" ? before.values : {};
    return {
      type: "rating",
      values: mergeFields(values, answer.values, fill, (v) => v !== undefined) as Record<string, 1 | 2 | 3 | 4 | 5>,
    };
  }
  if (fill && stored !== undefined) return null;
  return answer;
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

export function mergeIntoEnrollment(
  row: EnrollmentProgress | null,
  patch: ParsedPatch,
  now: Date
): MergeResult {
  const before = row ?? EMPTY_ENROLLMENT;
  const next: EnrollmentProgress = { ...before };
  const refused: RefusedKey[] = [...patch.refused];
  const fill = patch.fill;

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
        if (fill && before.simulationChoice !== null) continue;
        next.simulationChoice = answer.optionId;
        next.simulationCorrect = answer.correct;
      } else if (answer.type === "scenario") {
        if (fill && before.scenarioRoot !== null) continue;
        next.scenarioRoot = answer.rootId;
        next.scenarioFollowup = answer.followupId ?? null;
      } else if (answer.type === "reflection") {
        const stored = isRecord(before.reflection) ? before.reflection : {};
        const text: Rec = {};
        for (const p of LEGACY_PROMPT_IDS) if (p in answer.text) text[p] = answer.text[p];
        next.reflection = mergeFields(stored, text, fill, written);
      } else if (answer.type === "quiz") {
        if (fill) {
          const stored = readAssessment(before.assessment);
          if (Object.keys(stored.answers).length > 0 || stored.checked) continue;
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
    const value = nextResponse(key, stored, answer, fill);
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
  if (before.completedAt === null && patch.completedAt !== null) next.completedAt = patch.completedAt;

  const changed = (Object.keys(next) as ProgressColumn[]).filter((c) => !same(before[c], next[c]));
  return {
    next,
    changed,
    refused,
    completedNow: before.completedAt === null && next.completedAt !== null,
  };
}
