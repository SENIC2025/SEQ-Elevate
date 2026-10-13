/**
 * The rules of a lesson's content list on the course page (PartList), pure
 * so they are tested without a browser: what each item is called, what its
 * header says about it, where a text in the extra content starts from, which
 * changes a live course takes, where focus goes after a change, and when a
 * text re-read after a conflict has its answer.
 */

import type { NarrativeInitial } from "@/lib/cms/course-admin-types";
import type { CourseStatus } from "@/lib/cms/course-status";
import {
  MAIN_PART_ID,
  type MainKind,
  type NewOnlyReason,
  type PartId,
  type PartType,
  type PartView,
  type SectionId,
} from "@/lib/cms/sections/contract";
import { predictPartOp } from "@/lib/cms/sections/guard";
import { blocksHaveText, fallbackOrder } from "@/lib/cms/text-fallback";
import type { Locale } from "@/lib/cms/types";
import { focusAfterMove } from "@/components/role/exercise/item-list";

/** The content types the "Add content" picker offers, in its order. */
export const PART_TYPES: readonly PartType[] = [
  "text",
  "practice",
  "scenario",
  "quiz",
  "reflection",
  "rating",
];

/** What the main content is called among the lesson's content. */
export const MAIN_TYPE: Readonly<Record<MainKind, PartType>> = {
  narrative: "text",
  reflection: "reflection",
  simulation: "practice",
  scenario: "scenario",
  assessment: "quiz",
};

export type TextPartView = Extract<PartView, { type: "text" }>;
export type QuestionPartView = Exclude<PartView, { type: "main" } | { type: "text" }>;

export function partTypeOf(item: PartView, mainKind: MainKind): PartType {
  return item.type === "main" ? MAIN_TYPE[mainKind] : item.type;
}

/** How many items besides the main content. */
export function extraCount(items: readonly PartView[]): number {
  return items.filter((i) => i.type !== MAIN_PART_ID).length;
}

/**
 * What a content's header says about it, besides its name: a question's
 * draft and how many things keep the version being worked on from
 * learners; whether a text is written in the language on screen. Null for
 * the main content — its own editor says all that.
 */
export type PartStatus =
  | { kind: "question"; draft: boolean; notReady: number; saved: boolean }
  | { kind: "text"; written: boolean };

export function partStatus(item: PartView, lang: Locale): PartStatus | null {
  if (item.type === "main") return null;
  if (item.type === "text") return { kind: "text", written: blocksHaveText(item.blocks[lang]) };
  return {
    kind: "question",
    draft: item.draft !== null,
    notReady: item.issues.length,
    saved: item.data !== null,
  };
}

/**
 * Where the editor of a text in the extra content starts in `lang`: its own
 * text there, else (like the lesson's own text) the first language written
 * in the order learners would get it, marked as such, so saving creates
 * this language's version. The base is this language's own fingerprint.
 */
export function textInitial(item: TextPartView, lang: Locale): NarrativeInitial {
  const own = item.blocks[lang];
  const written = blocksHaveText(own);
  const from = written
    ? undefined
    : (fallbackOrder(item.blocks as Record<string, unknown>, lang).find(
        (l) => l !== lang && blocksHaveText(item.blocks[l as Locale])
      ) as Locale | undefined);
  return {
    title: "",
    subtitle: "",
    blocks: (written ? own : from ? item.blocks[from] : own) ?? [],
    hasOverride: written,
    version: item.versions[lang] ?? null,
    ...(from ? { fallbackFrom: from } : {}),
  };
}

export type PartOpKind = "add" | "move" | "remove";

/**
 * May this content change go through on this course (G3, as the server
 * will decide)? On a live course a lesson may end up with extra content
 * only if it already had some; removing it is always fine.
 */
export function partOpAllowed(args: {
  status: CourseStatus;
  reasons: readonly NewOnlyReason[];
  sectionId: SectionId;
  op: PartOpKind;
  extras: number;
}): boolean {
  const { op, extras } = args;
  const extraPartsAfter = op === "add" ? extras + 1 : op === "remove" ? Math.max(extras - 1, 0) : extras;
  return predictPartOp({
    status: args.status,
    reasons: args.reasons,
    sectionId: args.sectionId,
    op,
    extraPartsAfter,
  }).allowed;
}

/** Where focus goes after a change to the list (spec 11.3: predictable, 2.4.3). */
export type PartFocus =
  | { id: PartId; target: "up" | "down" | "label" | "field" | "add"; n: number };

/** After a move: the button pressed, or the other at the end it reached. */
export function focusAfterPartMove(
  items: readonly { id: PartId }[],
  id: PartId,
  dir: -1 | 1
): "up" | "down" {
  return focusAfterMove(
    items.findIndex((i) => i.id === id),
    dir,
    items.length
  );
}

/**
 * After removing `id` (from the list as it was): the next content's name,
 * else the one before it. When only the main content is left it has no
 * header any more, so focus goes to the "Add content" after it.
 */
export function focusAfterRemove(
  before: readonly { id: PartId }[],
  id: PartId
): { id: PartId; target: "label" | "add" } {
  const index = before.findIndex((i) => i.id === id);
  const rest = before.filter((i) => i.id !== id);
  if (rest.length <= 1) return { id: rest[0]?.id ?? MAIN_PART_ID, target: "add" };
  const next = rest[Math.min(Math.max(index, 0), rest.length - 1)];
  return { id: next.id, target: "label" };
}

/** The re-read key of one text's language. */
export const textPair = (partId: PartId, lang: Locale) => `${partId}:${lang}`;

/**
 * A text's "Load the saved version" waits for a refreshed page whose
 * version of it differs from the one the editor had (`pending`); then its
 * revision bumps and the editor starts over from the fresh text. A text
 * that is gone needs no re-read any more.
 */
export function settleRereads(
  pending: Readonly<Record<string, string | null>>,
  revs: Readonly<Record<string, number>>,
  items: readonly PartView[]
): { pending: Record<string, string | null>; revs: Record<string, number> } {
  const nextPending: Record<string, string | null> = {};
  const nextRevs = { ...revs };
  for (const [id, stale] of Object.entries(pending)) {
    const at = id.lastIndexOf(":");
    const partId = id.slice(0, at);
    const lang = id.slice(at + 1) as Locale;
    const item = items.find((i) => i.id === partId);
    if (!item || item.type !== "text") continue;
    if ((item.versions[lang] ?? null) !== stale) nextRevs[id] = (nextRevs[id] ?? 0) + 1;
    else nextPending[id] = stale;
  }
  return { pending: nextPending, revs: nextRevs };
}

/**
 * A text saved here that the page may not show yet: what was saved, and
 * the version the page held for it when the save went through (`from`).
 * Saving a text re-reads the page; until that lands, an editor that starts
 * over (switching language and back) starts from the save, not from the
 * older text with an older base.
 */
export interface SavedText {
  from: string | null;
  value: NarrativeInitial;
}

/** Where a text's editor starts: the save the page hasn't caught up with, else the page. */
export function textStart(
  item: TextPartView,
  lang: Locale,
  saved: SavedText | undefined
): NarrativeInitial {
  if (saved && (item.versions[lang] ?? null) === saved.from) return saved.value;
  return textInitial(item, lang);
}

/**
 * The saves the page still doesn't show: one is dropped once the page holds
 * another version of that text (this save, or a later one), or the text is gone.
 */
export function settleSaves(
  saved: Readonly<Record<string, SavedText>>,
  items: readonly PartView[]
): Record<string, SavedText> {
  const next: Record<string, SavedText> = {};
  for (const [id, entry] of Object.entries(saved)) {
    const at = id.lastIndexOf(":");
    const item = items.find((i) => i.id === id.slice(0, at));
    if (!item || item.type !== "text") continue;
    if ((item.versions[id.slice(at + 1) as Locale] ?? null) === entry.from) next[id] = entry;
  }
  return next;
}
