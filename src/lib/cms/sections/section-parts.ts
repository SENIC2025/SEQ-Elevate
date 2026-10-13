/**
 * Lesson.parts: a lesson's extra content, around its main content (D56,
 * spec 2.4).
 *
 * The main content never moves: it stays in Lesson.narrative / structure /
 * structureDraft, where Release 0 and the learner reader keep it. The column
 * only holds the extra parts, plus one `{ id: "main", type: "main" }`
 * placeholder for where the main content sits among them. Null — the value
 * of every lesson before Release 1 — is "main content only", and writing
 * "main content only" back gives null again (storedPartsValue), so removing
 * a lesson's last extra content really makes it standard again.
 *
 * Reading is strict: anything that isn't exactly a list the editor writes is
 * "unreadable", never partly read. A partly read list written back would
 * silently drop the content it skipped; unreadable instead refuses every
 * write and blocks publishing (fail closed for writes, open for reads, D18)
 * until an admin repairs it.
 *
 * Pure and client-safe.
 */

import type { Locale } from "../types";
import {
  EXTRA_PART_ID,
  KIND_OF_PART,
  MAIN_PART_ID,
  SECTION_LIMITS,
  type ApplyPartOp,
  type EmptyPart,
  type ExtraPartId,
  type PartDefaults,
  type PartsOf,
  type PrefillParts,
  type QuestionPartType,
  type StoredPart,
  type StoredPartsValue,
  type StoredRating,
} from "./contract";
import { emptyExercise } from "./part-kinds";

export {
  itemVersion,
  partsOrderVersion,
  partVersions,
  sectionContentVersion,
  textPartVersion,
} from "./versions";

/** The placeholder for the lesson's main content. */
export const MAIN_PART: StoredPart = Object.freeze({ id: MAIN_PART_ID, type: "main" }) as StoredPart;

const LOCALES: readonly Locale[] = ["en", "de", "el"];
const QUESTION_TYPES = Object.keys(KIND_OF_PART) as QuestionPartType[];

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** One stored item, or null when it isn't one the editor writes. */
function readItem(raw: unknown): StoredPart | null {
  if (!isRecord(raw)) return null;
  if (raw.id === MAIN_PART_ID) return raw.type === "main" ? { id: MAIN_PART_ID, type: "main" } : null;
  if (typeof raw.id !== "string" || !EXTRA_PART_ID.test(raw.id)) return null;
  const id = raw.id as ExtraPartId;

  if (raw.type === "text") {
    if (!isRecord(raw.blocks)) return null;
    const blocks: Rec = {};
    for (const locale of LOCALES) {
      const value = raw.blocks[locale];
      if (value === undefined) continue;
      if (!Array.isArray(value)) return null;
      blocks[locale] = value;
    }
    return { id, type: "text", blocks } as StoredPart;
  }

  if (!QUESTION_TYPES.includes(raw.type as QuestionPartType)) return null;
  const type = raw.type as QuestionPartType;
  // A question's two versions: each a question of the part's own kind, or
  // nothing yet. Their contents are checked where they are used
  // (sanitizeExercise), which never trusts stored JSON either.
  const version = (v: unknown) =>
    v === null || (isRecord(v) && v.kind === KIND_OF_PART[type]);
  if (!("data" in raw) || !("draft" in raw)) return null;
  if (!version(raw.data) || !version(raw.draft)) return null;
  return { id, type, data: raw.data, draft: raw.draft } as StoredPart;
}

/**
 * The lesson's content in order, main content included: [MAIN] for an empty
 * column, "unreadable" for anything that isn't a version-1 list of valid
 * items with exactly one main content and no id twice. Never cuts a long
 * list short (more than the limit are all shown; adding is refused).
 */
export const partsOf: PartsOf = (raw) => {
  if (raw === null || raw === undefined) return [MAIN_PART];
  if (!isRecord(raw) || raw.v !== 1 || !Array.isArray(raw.items)) return "unreadable";
  const items: StoredPart[] = [];
  for (const entry of raw.items) {
    const item = readItem(entry);
    if (!item) return "unreadable";
    items.push(item);
  }
  const ids = items.map((i) => i.id);
  if (new Set(ids).size !== ids.length) return "unreadable";
  if (ids.filter((id) => id === MAIN_PART_ID).length !== 1) return "unreadable";
  return items;
};

/**
 * Does the lesson have content besides its main content? An unreadable
 * column says nothing for sure, so it is false here; callers that must fail
 * closed check partsOf(…) === "unreadable" themselves.
 */
export function hasExtraParts(raw: unknown): boolean {
  const items = partsOf(raw);
  return items !== "unreadable" && items.length > 1;
}

/** What to write: null (Prisma.DbNull) for the main content alone, else the list. */
export const storedPartsValue: StoredPartsValue = (items) =>
  items.length === 1 && items[0].type === "main" ? null : { v: 1, items: [...items] };

/**
 * One change to a lesson's content list. Adds go at the top (after: null)
 * or after the named part; a lesson holds at most 12 items, main content
 * included. Any part moves, the main content too; only extra content is
 * removed. A part to add must be new extra content (the server makes it with
 * emptyPart); anything else — a second main content, an id in use — is
 * refused as unknown-part.
 */
export const applyPartOp: ApplyPartOp = (items, op) => {
  const at = (id: string) => items.findIndex((i) => i.id === id);

  if (op.op === "add") {
    const part = op.part;
    if (part.type === "main" || !EXTRA_PART_ID.test(part.id) || at(part.id) !== -1) {
      return { ok: false, error: "unknown-part" };
    }
    if (items.length >= SECTION_LIMITS.maxPartsPerSection) {
      return { ok: false, error: "too-many-parts" };
    }
    const after = op.after === null ? -1 : at(op.after);
    if (op.after !== null && after === -1) return { ok: false, error: "unknown-part" };
    const next = [...items];
    next.splice(after + 1, 0, part);
    return { ok: true, items: next };
  }

  const index = at(op.id);
  if (op.op === "remove") {
    if (op.id === MAIN_PART_ID) return { ok: false, error: "main-required" };
    if (index === -1) return { ok: false, error: "unknown-part" };
    return { ok: true, items: items.filter((_, i) => i !== index) };
  }

  if (index === -1) return { ok: false, error: "unknown-part" };
  const to = index + op.dir;
  if ((op.dir !== -1 && op.dir !== 1) || to < 0 || to >= items.length) {
    return { ok: false, error: "at-edge" };
  }
  const next = [...items];
  [next[index], next[to]] = [next[to], next[index]];
  return { ok: true, items: next };
};

/**
 * New extra content. Text starts with no language written. A question starts
 * as a draft (learners and the preview get nothing until it is saved for
 * them): Release 0's empty exercise, or — for reflection questions and a
 * self-assessment — the platform's standard questions and end labels, which
 * the editor can change.
 */
export const emptyPart: EmptyPart = (type, id, defaults) => {
  if (type === "text") return { id, type, blocks: {} };
  if (type === "reflection") {
    return {
      id,
      type,
      data: null,
      draft: { kind: "reflection", prompts: defaults.reflectionPrompts.map((p) => ({ ...p })) },
    };
  }
  if (type === "rating") return { id, type, data: null, draft: ratingDraft(defaults) };
  return { id, type, data: null, draft: emptyExercise(KIND_OF_PART[type]) };
};

/** A self-assessment to finish: the standard end labels, no statements yet. */
const ratingDraft = (defaults: PartDefaults): StoredRating => ({
  kind: "rating",
  minLabel: { ...defaults.ratingLabels.min },
  maxLabel: { ...defaults.ratingLabels.max },
  statements: [],
});

/**
 * What a new lesson starts with. Every lesson has its main content; the
 * "Reflection & self-assessment" lesson also gets the platform's three
 * standard reflection questions, ready for learners as they are, and a
 * self-assessment to finish (its statements are the editor's to write).
 */
export const prefillParts: PrefillParts = (choice, newPartId, defaults) => {
  if (choice !== "reflectionRating") return [MAIN_PART];
  return [
    MAIN_PART,
    {
      id: newPartId(),
      type: "reflection",
      data: { kind: "reflection", prompts: defaults.reflectionPrompts.map((p) => ({ ...p })) },
      draft: null,
    },
    { id: newPartId(), type: "rating", data: null, draft: ratingDraft(defaults) },
  ];
};
