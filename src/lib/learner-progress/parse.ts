/**
 * Checking a progress patch from the browser (D62, spec 2.4), and reading
 * what an enrolment holds.
 *
 * A save is refused whole only when it isn't a patch at all (`bad-input`)
 * or is bigger than any patch may be (`too-large`). Inside it, every value
 * is checked against its own key and refused for that key alone, never cut
 * (D62.d): one oversized answer must not block every later save, and a cut
 * answer would be saved as something the learner never wrote. An answer to
 * content an editor has just removed is still a valid key, and is kept, so
 * it isn't lost; the size limits bound what that can store.
 *
 * The readers (readAnswer, readResponses, readIds) are for what is already
 * stored and the learner can't fix: they skip what they can't read, never
 * refuse, and don't apply the limits of a new write. They are for reading
 * only; a write keeps what is stored as it is (merge-server.ts).
 *
 * Pure and total: nothing here throws. Client-safe, so the store leaves out
 * what the server would refuse by the same rules (patch.ts).
 */

import {
  isCustomSectionId,
  isSectionId,
  type CustomSectionId,
  type PartKey,
  type SectionId,
} from "@/lib/cms/sections/contract";
import {
  ANSWER_TYPES,
  LEGACY_PROMPT_IDS,
  LEGACY_TYPE,
  RESPONSE_LIMITS,
  isLegacyKey,
  type AnswerType,
  type PatchAnswer,
  type RefusedKey,
  type StoredAnswer,
} from "./contract";

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** "lessonId/contentId": a standard key or the course's own lesson, then main or extra content. */
const PATCH_KEY =
  /^(context|concept|behaviour|simulation|scenario|reflection|assessment|s-[a-z0-9]{8})\/(main|p-[a-z0-9]{8})$/;
export const isPatchKey = (key: string): key is PartKey => PATCH_KEY.test(key);

/** An option, question, prompt or statement id: some text, not too long. */
const isId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= RESPONSE_LIMITS.idChars;

/** The fields each type has; anything else makes a value invalid. */
const FIELDS: Record<AnswerType, readonly string[]> = {
  practice: ["type", "optionId", "correct"],
  scenario: ["type", "rootId", "followupId"],
  quiz: ["type", "answers", "checked"],
  reflection: ["type", "text"],
  rating: ["type", "values"],
};

type Checked = { ok: true; answer: StoredAnswer } | { ok: false; reason: "invalid" | "too-long" };
const invalid: Checked = { ok: false, reason: "invalid" };

/**
 * One answer's value, as a write (`limits`) or a read of what is stored
 * (no limits on counts and lengths: what was saved may stay, D52). A copy,
 * with only the type's own fields; `extra` names fields a stored value may
 * carry besides them (its `at`).
 */
function checkValue(key: string, raw: unknown, limits: boolean, extra: readonly string[] = []): Checked {
  if (!isRecord(raw) || !(ANSWER_TYPES as readonly unknown[]).includes(raw.type)) return invalid;
  const type = raw.type as AnswerType;
  if (isLegacyKey(key) && LEGACY_TYPE[key] !== type) return invalid;
  if (Object.keys(raw).some((f) => !FIELDS[type].includes(f) && !extra.includes(f))) return invalid;

  switch (type) {
    case "practice":
      if (!isId(raw.optionId) || typeof raw.correct !== "boolean") return invalid;
      return { ok: true, answer: { type, optionId: raw.optionId, correct: raw.correct } };
    case "scenario":
      if (!isId(raw.rootId)) return invalid;
      if (raw.followupId !== undefined && !isId(raw.followupId)) return invalid;
      return {
        ok: true,
        answer: { type, rootId: raw.rootId, ...(raw.followupId !== undefined ? { followupId: raw.followupId } : {}) },
      };
    case "quiz": {
      if (!isRecord(raw.answers) || typeof raw.checked !== "boolean") return invalid;
      const entries = Object.entries(raw.answers);
      if (limits && entries.length > RESPONSE_LIMITS.quizAnswers) return invalid;
      if (!entries.every(([q, a]) => isId(q) && isId(a))) return invalid;
      return { ok: true, answer: { type, answers: Object.fromEntries(entries) as Record<string, string>, checked: raw.checked } };
    }
    case "reflection": {
      if (!isRecord(raw.text)) return invalid;
      const entries = Object.entries(raw.text);
      if (limits && entries.length > RESPONSE_LIMITS.promptsPerAnswer) return invalid;
      const promptOk = isLegacyKey(key)
        ? (p: string) => (LEGACY_PROMPT_IDS as readonly string[]).includes(p)
        : isId;
      if (!entries.every(([p, t]) => promptOk(p) && typeof t === "string")) return invalid;
      if (limits && entries.some(([, t]) => (t as string).length > RESPONSE_LIMITS.reflectionChars)) {
        return { ok: false, reason: "too-long" };
      }
      return { ok: true, answer: { type, text: Object.fromEntries(entries) as Record<string, string> } };
    }
    case "rating": {
      if (!isRecord(raw.values)) return invalid;
      const entries = Object.entries(raw.values);
      if (limits && entries.length > RESPONSE_LIMITS.statementsPerAnswer) return invalid;
      const isScore = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5;
      if (!entries.every(([s, v]) => isId(s) && isScore(v))) return invalid;
      return {
        ok: true,
        answer: { type, values: Object.fromEntries(entries) as Record<string, 1 | 2 | 3 | 4 | 5> },
      };
    }
  }
}

/**
 * One answer of a patch, checked as the server will check it: refused as
 * `invalid` when it isn't one this key can take, `too-long` when a
 * reflection text is over the limit. The learner store leaves such a key
 * out of its saves (patch.ts) and tells the learner.
 */
export function checkAnswer(key: string, value: unknown): Checked {
  if (!isPatchKey(key)) return invalid;
  return checkValue(key, value, true);
}

/**
 * One answer as it was saved (or kept to be sent), read without the limits
 * of a new write: it may hold more questions than a save may carry — an
 * editor can swap a live question's statement or prompt (D33), and the
 * learner answer the new one too — or a longer text (D52). Null when it
 * isn't one this key can take. `extra` names fields it may carry besides
 * its type's own (a stored answer's `at`).
 */
export function readAnswer(key: string, raw: unknown, extra: readonly string[] = []): StoredAnswer | null {
  if (!isPatchKey(key)) return null;
  const checked = checkValue(key, raw, false, extra);
  return checked.ok ? checked.answer : null;
}

export interface ParsedPatch {
  /** Finished lessons, once each, in the patch's order. */
  completed: SectionId[];
  /** The answers that passed, in the patch's order. */
  answers: [PartKey, PatchAnswer][];
  /**
   * The client's time, never later than the server's (D118), or the
   * server's when it can't be read; null when the patch has none. The
   * merge holds it no earlier than the enrolment's start too.
   */
  completedAt: Date | null;
  fill: boolean;
  /** What wasn't taken, key by key. */
  refused: RefusedKey[];
}

export type ParseResult =
  | { ok: true; patch: ParsedPatch }
  | { ok: false; error: "bad-input" | "too-large" };

const PATCH_FIELDS = ["v", "completed", "answers", "completedAt", "fill"];

/** The JSON's length, or null when it can't be written as JSON. */
function jsonLength(v: unknown): number | null {
  try {
    return JSON.stringify(v)?.length ?? null;
  } catch {
    return null;
  }
}

/** A patch from the browser, checked (spec 2.4); `now` is the server's time. */
export function parseProgressPatch(raw: unknown, now: Date): ParseResult {
  const bad: ParseResult = { ok: false, error: "bad-input" };
  if (!isRecord(raw) || raw.v !== 2) return bad;
  if (Object.keys(raw).some((f) => !PATCH_FIELDS.includes(f))) return bad;
  const { completed, answers, completedAt, fill } = raw;
  if (completed !== undefined && !(Array.isArray(completed) && completed.every((c) => typeof c === "string"))) {
    return bad;
  }
  if (answers !== undefined && !isRecord(answers)) return bad;
  if (completedAt !== undefined && typeof completedAt !== "string") return bad;
  if (fill !== undefined && fill !== true) return bad;

  const length = jsonLength(raw);
  if (length === null) return bad;
  const ids = (completed as string[] | undefined) ?? [];
  const entries = Object.entries((answers as Rec | undefined) ?? {});
  if (
    length > RESPONSE_LIMITS.patchJsonChars ||
    entries.length > RESPONSE_LIMITS.keysPerPatch ||
    ids.length > RESPONSE_LIMITS.completedPerPatch
  ) {
    return { ok: false, error: "too-large" };
  }

  const refused: RefusedKey[] = [];
  const done: SectionId[] = [];
  for (const id of ids) {
    if (!isSectionId(id)) refused.push({ key: id, reason: "invalid" });
    else if (!done.includes(id)) done.push(id);
  }
  const taken: [PartKey, PatchAnswer][] = [];
  for (const [key, value] of entries) {
    const checked = checkAnswer(key, value);
    if (checked.ok) taken.push([key as PartKey, checked.answer]);
    else refused.push({ key, reason: checked.reason });
  }

  let at: Date | null = null;
  if (typeof completedAt === "string") {
    const t = Date.parse(completedAt);
    at = Number.isFinite(t) ? new Date(Math.min(t, now.getTime())) : now;
  }
  return { ok: true, patch: { completed: done, answers: taken, completedAt: at, fill: fill === true, refused } };
}

/* ------------------------------------------------------------- readers --- */

/**
 * CourseEnrollment.responses as the learner gets it back: every entry it
 * can read, without the time of its last change. Entries under one of the
 * four keys with columns of their own are skipped (their answer lives
 * there, D56). Null, or anything that isn't version 1, is none.
 */
export function readResponses(raw: unknown): Partial<Record<PartKey, StoredAnswer>> {
  if (!isRecord(raw) || raw.v !== 1 || !isRecord(raw.items)) return {};
  const out: Partial<Record<PartKey, StoredAnswer>> = {};
  for (const [key, value] of Object.entries(raw.items)) {
    if (!isPatchKey(key) || isLegacyKey(key)) continue;
    const answer = readAnswer(key, value, ["at"]);
    if (answer) out[key] = answer;
  }
  return out;
}

/** CourseEnrollment.sectionsCompleted as a list of the course's own lessons, once each, in order. */
export function readIds(raw: unknown): CustomSectionId[] {
  if (!Array.isArray(raw)) return [];
  // A Set, not out.includes: every counter reads every enrolment.
  const seen = new Set<string>();
  const out: CustomSectionId[] = [];
  for (const id of raw) {
    if (!isCustomSectionId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
