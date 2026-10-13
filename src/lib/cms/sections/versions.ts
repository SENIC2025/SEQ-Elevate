/**
 * The bases of the flexible editor's saves (D56, spec 2.4): short
 * fingerprints (stored-json.ts) of exactly what each save may change, never
 * the whole JSON. A save sends back the fingerprint it started from, and the
 * server writes only while what it holds still has it (D33) — so two editors
 * can work on one course without either undoing the other unseen.
 *
 * Each version covers as little as it can, so unrelated edits never refuse
 * each other: renaming a lesson doesn't change the lesson list's version
 * (a colleague's move still goes through), and a German text save doesn't
 * change the English one's.
 *
 * Pure and client-safe: the course page computes nothing here itself, but
 * the server and the loader must agree exactly.
 */

import type { Locale } from "../types";
import { fingerprint } from "../stored-json";
import type {
  ItemVersion,
  LabelVersion,
  OutlineVersion,
  PartsOrderVersion,
  PartVersions,
  SectionContentVersion,
  TextPartVersion,
} from "./contract";

/*
 * fingerprint() is null only for null or undefined; the lists below are
 * arrays, so these versions are always strings. The fallback keeps the
 * types honest without a cast.
 */
const listVersion = (list: unknown[]): string => fingerprint(list) ?? "";

/** The lesson list: ids, templates and hidden flags in order. Step names are left out. */
export const outlineVersion: OutlineVersion = (o) =>
  listVersion(o.sections.map((s) => [s.id, s.template, s.hidden === true]));

/** One lesson's step name in one language; null when none is written. */
export const labelVersion: LabelVersion = (o, id, locale) =>
  fingerprint(o.sections.find((s) => s.id === id)?.label?.[locale] ?? null);

/** A lesson's content list: which parts, of which type, in which order. */
export const partsOrderVersion: PartsOrderVersion = (items) =>
  listVersion(items.map((i) => [i.id, i.type]));

/** A question part's live version and draft, each on its own (PartBase). */
export const partVersions: PartVersions = (item) =>
  item.type === "main" || item.type === "text"
    ? { data: null, draft: null }
    : { data: fingerprint(item.data), draft: fingerprint(item.draft) };

/** The whole item: the base of removing it, so nobody removes what they haven't seen. */
export const itemVersion: ItemVersion = (item) => fingerprint(item) ?? "";

/** One language of a text part: its save is live at once, per language (D33). */
export const textPartVersion: TextPartVersion = (item, locale: Locale) =>
  item.type === "text" ? fingerprint(item.blocks[locale] ?? null) : null;

/**
 * Everything deleting a lesson would remove: its text, exercise, draft,
 * extra content, video and which documents it has (in any order). Null when
 * the lesson has no row. A missing column and a null one are the same.
 */
export const sectionContentVersion: SectionContentVersion = (row) =>
  row
    ? fingerprint({
        narrative: row.narrative ?? null,
        structure: row.structure ?? null,
        structureDraft: row.structureDraft ?? null,
        parts: row.parts ?? null,
        video: row.video ?? null,
        documentIds: [...row.documentIds].sort(),
      })
    : null;
