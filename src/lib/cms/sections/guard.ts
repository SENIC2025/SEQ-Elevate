/**
 * The publish guard's one question (D57, spec 2.2): where does the editor's
 * lesson list differ from what learners get?
 *
 * Learners only ever get the Release 0 view of a course (the reader and the
 * player are frozen until Release 2): the four text lessons and each saved
 * exercise, in the standard order, each lesson's main content only. So a
 * course whose list is the standard one is exactly what learners get — and
 * every way a list can differ from it is named here:
 *
 *   custom-section   a lesson of the course's own (s-xxxxxxxx);
 *   hidden-section   a hidden lesson (learners would still get it);
 *   removed-section  a deleted standard text lesson (learners would get it
 *                    back, empty);
 *   reordered        the standard lessons out of the standard order;
 *   extra-parts      a lesson with content besides its main content;
 *   unreadable       a stored list or a listed lesson's content that can't
 *                    be read — nothing can be promised about it.
 *
 * Step names are never a reason: learners keep the standard names until
 * Release 2 (D58), and a renamed course publishes as before.
 *
 * Why an empty list means learners get what the editor sees: with no lesson
 * of its own, hidden or deleted, every standard text lesson is listed (one
 * missing is put back, outline.ts), and so is every saved exercise; with
 * none reordered they are in the standard order; so the list, less empty
 * exercise lessons, is presentStageKeys — what getDbCourse plays. With no
 * extra content, each lesson's content is the main content learners read.
 *
 * Pure and client-safe: the course page greys out what the server would
 * refuse by asking these same functions (predictOutlineOp, predictPartOp).
 */

import {
  LEGACY_ORDER,
  reasonKey,
  type InteractiveKey,
  type LiveWriteAllowed,
  type NewOnlyReason,
  type NewOnlyReasons,
  type OutlineReasons,
  type PredictOutlineOp,
  type PredictPartOp,
  type ResolvedOutline,
  type SectionId,
} from "./contract";
import { applyOutlineOpWith } from "./outline";
import { partsOf } from "./section-parts";

const rank = (id: string) => (LEGACY_ORDER as readonly string[]).indexOf(id);

/** The reasons the lesson list alone gives (codes 1–4 of spec 2.2). */
function listReasons(o: ResolvedOutline): NewOnlyReason[] {
  if (o.unreadable) return [{ code: "unreadable" }];
  const reasons: NewOnlyReason[] = [];
  for (const s of o.sections) {
    if (s.custom) reasons.push({ code: "custom-section", sectionId: s.id });
    if (s.hidden) reasons.push({ code: "hidden-section", sectionId: s.id });
  }
  for (const k of o.removed) reasons.push({ code: "removed-section", sectionId: k });
  // Hidden lessons count: learners would still get them, in this order.
  const ranks = o.sections.map((s) => rank(s.id)).filter((r) => r >= 0);
  if (ranks.some((r, i) => i > 0 && r <= ranks[i - 1])) reasons.push({ code: "reordered" });
  return reasons;
}

/** The outline-only reasons, for the page to predict lesson-list changes with. */
export const outlineReasons: OutlineReasons = (kind, o) =>
  kind === "bundled" ? [] : listReasons(o);

/**
 * Every reason, in the order of spec 2.2: unreadable alone; else per lesson
 * custom and hidden; the deleted lessons; reordered once; then each lesson
 * with extra content. Only listed lessons' rows count: a stray row is
 * nothing learners or the editor see.
 */
export const newOnlyReasons: NewOnlyReasons = (kind, o, lessons) => {
  if (kind === "bundled") return [];
  const row = (id: SectionId) => lessons.find((l) => l.stageKey === id);
  const parts = o.sections.map((s) => ({ id: s.id, items: partsOf(row(s.id)?.parts) }));
  if (o.unreadable || parts.some((p) => p.items === "unreadable")) return [{ code: "unreadable" }];
  const reasons = listReasons(o);
  for (const p of parts) {
    if (p.items !== "unreadable" && p.items.length > 1) {
      reasons.push({ code: "extra-parts", sectionId: p.id });
    }
  }
  return reasons;
};

/** The reasons in `after` that `before` doesn't have (each lesson's counted on its own). */
export function introducedReasons(
  before: readonly NewOnlyReason[],
  after: readonly NewOnlyReason[]
): NewOnlyReason[] {
  const had = new Set(before.map(reasonKey));
  return after.filter((r) => !had.has(reasonKey(r)));
}

/**
 * G3: may a published course take this change? Only if it adds no reason.
 * A standard live course therefore stays standard, and one published past
 * the guard (an old page, a rollback) can still be cleaned up.
 */
export const liveWriteAllowed: LiveWriteAllowed = (before, after) =>
  introducedReasons(before, after).length === 0;

const unreadable = (reasons: readonly NewOnlyReason[]) =>
  reasons.some((r) => r.code === "unreadable");

/**
 * The page's forecast of G3 for one lesson-list change, from what it was
 * sent: the resolved list, its reasons and the free standard keys. The
 * change is worked out by the server's own rules (applyOutlineOpWith); the
 * extra content of each lesson is known only through its reason, which a
 * lesson keeps while it stays listed and loses when it is deleted. A new
 * "Reflection & self-assessment" lesson comes with extra content.
 *
 * Nothing is offered for a built-in course, nor while anything can't be
 * read: the server refuses every structural write then (G8) until an admin
 * repairs it.
 */
export const predictOutlineOp: PredictOutlineOp = ({ kind, status, outline, reasons, freeKeys, op }) => {
  const refused = { allowed: false, introduced: [] };
  if (kind === "bundled" || outline.unreadable || unreadable(reasons)) return refused;
  const r = applyOutlineOpWith(outline, op, {
    isFree: (key: InteractiveKey) => freeKeys.includes(key),
    idTaken: (id) => outline.sections.some((s) => s.id === id),
  });
  if (!r.ok) return refused;

  const withExtra = new Set(
    reasons.filter((x) => x.code === "extra-parts").map((x) => x.sectionId)
  );
  if (op.op === "add" && op.choice === "reflectionRating") withExtra.add(r.id);
  const after: NewOnlyReason[] = [
    ...listReasons(r.outline),
    ...r.outline.sections
      .filter((s) => withExtra.has(s.id))
      .map((s): NewOnlyReason => ({ code: "extra-parts", sectionId: s.id })),
  ];
  const introduced = introducedReasons(reasons, after);
  return { allowed: status !== "published" || introduced.length === 0, introduced };
};

/**
 * The page's forecast of G3 for a content change inside one lesson: on a
 * published course the lesson may end up with extra content only if it
 * already had some (removing it is always allowed). Nothing while anything
 * can't be read.
 */
export const predictPartOp: PredictPartOp = ({ status, reasons, sectionId, extraPartsAfter }) => {
  if (unreadable(reasons)) return { allowed: false };
  if (status !== "published") return { allowed: true };
  const had = reasons.some((r) => r.code === "extra-parts" && r.sectionId === sectionId);
  return { allowed: extraPartsAfter === 0 || had };
};

