/**
 * What the course page is sent about one lesson of a created course's
 * lesson list (spec 9.1): its content with the bases each change needs, what
 * deleting it would remove, and the title its step name can fall back to.
 * The loader (course-admin.ts) reads the rows; these turn them into the
 * view types of contract.ts.
 *
 * Pure and total: a stored value of the wrong shape is shown as nothing (or
 * as unreadable), never thrown on.
 */

import { pickText, type LocalizedText } from "../structure";
import { blocksHaveText, firstText, narrativeHasText, resolveNarrative } from "../text-fallback";
import type { Locale } from "../types";
import {
  type DeleteSummary,
  type ExerciseValue,
  type MainKind,
  type PartIssue,
  type PartsView,
  type PartView,
} from "./contract";
import { validateExercise } from "./part-kinds";
import { partsOf } from "./section-parts";
import { itemVersion, partsOrderVersion, partVersions, textPartVersion } from "./versions";

const LOCALES: readonly Locale[] = ["en", "de", "el"];

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Why a question isn't ready; nothing for a value too broken to check (it can't be saved anyway). */
function issuesOf(v: ExerciseValue | null): PartIssue[] {
  if (!v) return [];
  try {
    return validateExercise(v);
  } catch {
    return [];
  }
}

/**
 * A lesson's content in order, main content included, with the bases of
 * every change: the list's own (`order`), each text part's per language,
 * each question's live version and draft, and each item whole (for removing
 * it). Null when Lesson.parts can't be read: nothing about it can be changed
 * until an admin repairs it, and the publish blocker says so.
 */
export function partsView(raw: unknown): PartsView | null {
  const items = partsOf(raw);
  if (items === "unreadable") return null;
  const views = items.map((item): PartView => {
    if (item.type === "main") return item;
    if (item.type === "text") {
      return {
        id: item.id,
        type: "text",
        blocks: item.blocks,
        versions: Object.fromEntries(
          LOCALES.map((l) => [l, textPartVersion(item, l)])
        ) as Record<Locale, string | null>,
        itemVersion: itemVersion(item),
      };
    }
    return {
      id: item.id,
      type: item.type,
      data: item.data,
      draft: item.draft,
      versions: partVersions(item),
      itemVersion: itemVersion(item),
      // What still keeps the version being worked on from learners.
      issues: issuesOf(item.draft ?? item.data),
    };
  });
  return { items: views, order: partsOrderVersion(items) };
}

/** One Lesson row, as far as deleting it is concerned. */
export interface DeletableRow {
  narrative?: unknown;
  structure?: unknown;
  structureDraft?: unknown;
  parts?: unknown;
  video?: unknown;
  documentCount?: number;
}

/**
 * What "Delete lesson" would remove, for its confirmation: the languages it
 * has text in, how many texts and questions, the video, the documents. The
 * main content counts as one text or one question when anything of it is
 * stored.
 */
export function deleteSummary(row: DeletableRow | undefined): DeleteSummary {
  const narrative = isRecord(row?.narrative) ? row.narrative : {};
  const items = partsOf(row?.parts);
  const extras = items === "unreadable" ? [] : items.filter((i) => i.type !== "main");
  const texts = extras.filter((i) => i.type === "text");
  const languages = LOCALES.filter(
    (l) =>
      narrativeHasText(narrative[l]) ||
      texts.some((t) => t.type === "text" && blocksHaveText(t.blocks[l]))
  );
  const mainText = LOCALES.some((l) => narrativeHasText(narrative[l])) ? 1 : 0;
  const mainQuestion = row?.structure != null || row?.structureDraft != null ? 1 : 0;
  return {
    languages,
    textBlocks: mainText + texts.length,
    questionBlocks: mainQuestion + extras.length - texts.length,
    video: row?.video != null,
    documents: row?.documentCount ?? 0,
  };
}

/**
 * The lesson's title in `locale`, for its step name to fall back to: the
 * text's title, or the exercise's (from what learners get, else the draft).
 * Null when none is written.
 */
export function sectionTitle(
  row: { narrative?: unknown; structure?: unknown; structureDraft?: unknown } | undefined,
  mainKind: MainKind,
  locale: Locale
): string | null {
  if (mainKind === "narrative" || mainKind === "reflection") {
    return resolveNarrative(row?.narrative ?? null, locale).title ?? null;
  }
  for (const v of [row?.structure, row?.structureDraft]) {
    const title = isRecord(v) && isRecord(v.title) ? (v.title as LocalizedText) : undefined;
    const text = firstText(pickText(title, locale));
    if (text) return text;
  }
  return null;
}

/** Does the lesson hold content besides its main content (or content that can't be read)? */
export function hasExtraOrUnreadable(raw: unknown): boolean {
  const items = partsOf(raw);
  return items === "unreadable" || items.length > 1;
}
