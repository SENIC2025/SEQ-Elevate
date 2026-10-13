/**
 * Where an exercise editor (StructureAuthor) reads and writes (spec 7,
 * "ExerciseTarget adapter").
 *
 * The editor keeps Release 0's model whatever it edits: it loads the live
 * version and the draft as whole JSON (`ExerciseState`), and sends that
 * pair back with each write as its base. Two targets:
 *
 * - a lesson's main content (`lessonTarget`): Release 0's actions in
 *   actions/structure.ts, unchanged — the base is the whole pair, as today;
 * - a question in the lesson's extra content (`partTarget`): the actions in
 *   actions/parts.ts, whose base is a fingerprint of each (`PartBase`), so
 *   the request never carries the stored JSON back. The fingerprints are
 *   made here from what the editor loaded, with the same function the
 *   server uses (stored-json.ts), so they match exactly what it holds.
 *
 * Both answer in one union (`TargetSaveResult` …), so the editor's conflict
 * banner, "Not ready" list, size-limit list and field focus work the same
 * for either.
 */

import {
  clearStructure,
  discardStructureDraft,
  getStructure,
  saveStructure,
  saveStructureDraft,
  type StructureState,
} from "@/app/actions/structure";
import { discardPartDraft, getPart, savePart, savePartDraft } from "@/app/actions/parts";
import { fingerprint } from "@/lib/cms/stored-json";
import type { StoredStructure, StructureStageKey } from "@/lib/cms/structure";
import {
  KIND_OF_PART,
  type CustomSectionId,
  type ExerciseKind,
  type ExerciseState,
  type ExerciseValue,
  type ExtraPartId,
  type PartBase,
  type PartIssue,
  type PartLimitBreach,
  type QuestionPartType,
  type SectionId,
} from "@/lib/cms/sections/contract";
import type { WriteRefusal } from "./write-errors";

/** Refused for a reason the editor shows as a message, or because the base is stale. */
export type TargetRefused = { ok: false } & WriteRefusal;

export type TargetSaveResult =
  | { ok: true; value: ExerciseValue }
  | { ok: false; error: "invalid"; issues: PartIssue[] }
  | { ok: false; error: "too-large"; at: PartLimitBreach }
  | TargetRefused;
export type TargetDraftResult =
  | { ok: true; draft: ExerciseValue }
  | { ok: false; error: "too-large"; at: PartLimitBreach }
  | TargetRefused;
export type TargetDoneResult = { ok: true } | TargetRefused;

export interface ExerciseTarget {
  /** Changes when the editor edits something else: it then loads again. */
  key: string;
  kind: ExerciseKind;
  /** The lesson's main content (has "Remove stage") or extra content. */
  scope: "main" | "part";
  /** Null when it couldn't be read (the editor says so, and offers nothing to save over it). */
  load(): Promise<ExerciseState | null>;
  save(value: ExerciseValue, base: ExerciseState): Promise<TargetSaveResult>;
  saveDraft(value: ExerciseValue, base: ExerciseState): Promise<TargetDraftResult>;
  discardDraft(base: ExerciseState): Promise<TargetDoneResult>;
  /** "Remove stage" — main content only. */
  clear?(base: ExerciseState): Promise<TargetDoneResult>;
}

/** The fingerprints the part actions compare with what the part holds (versions.ts partVersions). */
export function partBase(base: ExerciseState): PartBase {
  return { data: fingerprint(base.structure), draft: fingerprint(base.draft) };
}

/** Any action refusal, as the editor handles it (its count kept for has-learners). */
export function refusalOf(res: { error: string; count?: unknown }): TargetRefused {
  return {
    ok: false,
    error: res.error,
    ...(typeof res.count === "number" ? { count: res.count } : {}),
  };
}

type ActionAnswer = { ok: boolean; error?: string; [k: string]: unknown };

/** A save's answer, from either kind of action. */
export function toSaveResult(
  res: ActionAnswer & { structure?: unknown; issues?: unknown; at?: unknown }
): TargetSaveResult {
  if (res.ok) return { ok: true, value: res.structure as ExerciseValue };
  if (res.error === "invalid") return { ok: false, error: "invalid", issues: res.issues as PartIssue[] };
  if (res.error === "too-large") return { ok: false, error: "too-large", at: res.at as PartLimitBreach };
  return refusalOf({ error: String(res.error), count: res.count });
}

/** A draft save's answer, from either kind of action. */
export function toDraftResult(
  res: ActionAnswer & { draft?: unknown; at?: unknown }
): TargetDraftResult {
  if (res.ok) return { ok: true, draft: res.draft as ExerciseValue };
  if (res.error === "too-large") return { ok: false, error: "too-large", at: res.at as PartLimitBreach };
  return refusalOf({ error: String(res.error), count: res.count });
}

/** A discard's or removal's answer. */
export function toDoneResult(res: ActionAnswer): TargetDoneResult {
  return res.ok ? { ok: true } : refusalOf({ error: String(res.error), count: res.count });
}

/**
 * A lesson's exercise — its main content — through Release 0's actions,
 * exactly as before: a standard lesson by its key, a lesson of the course's
 * own by its id with the kind its template gives (G6).
 */
export function lessonTarget(
  slug: string,
  stageKey: string,
  kind: StructureStageKey
): ExerciseTarget {
  const key = stageKey as StructureStageKey | CustomSectionId;
  const state = (base: ExerciseState) => base as StructureState;
  return {
    key: `${slug}:${stageKey}:main`,
    kind,
    scope: "main",
    load: () => getStructure(slug, key) as Promise<ExerciseState | null>,
    save: async (value, base) =>
      toSaveResult(await saveStructure(slug, key, value as StoredStructure, state(base))),
    saveDraft: async (value, base) =>
      toDraftResult(await saveStructureDraft(slug, key, value as StoredStructure, state(base))),
    discardDraft: async (base) => toDoneResult(await discardStructureDraft(slug, key, state(base))),
    clear: async (base) => toDoneResult(await clearStructure(slug, key, state(base))),
  };
}

/** A question in a lesson's extra content, by the lesson's and the part's ids. */
export function partTarget(
  slug: string,
  sectionId: SectionId,
  partId: ExtraPartId,
  type: QuestionPartType
): ExerciseTarget {
  return {
    key: `${slug}:${sectionId}:${partId}`,
    kind: KIND_OF_PART[type],
    scope: "part",
    load: () => getPart(slug, sectionId, partId),
    save: async (value, base) =>
      toSaveResult(await savePart(slug, sectionId, partId, value, partBase(base))),
    saveDraft: async (value, base) =>
      toDraftResult(await savePartDraft(slug, sectionId, partId, value, partBase(base))),
    discardDraft: async (base) =>
      toDoneResult(await discardPartDraft(slug, sectionId, partId, partBase(base))),
  };
}
