/**
 * Release 1's publish guard's one question (D57, spec 2.2): where does the
 * editor's lesson list differ from the standard layout? Release 2 lifts the
 * guard (D66: publish-blockers.ts); the question stays for the kill
 * switches (R2_PUBLISH_GUARD=on, R2_LEARNER_PLAYER=off, which give learners
 * Release 1's view again), the pre-deploy check (derivation-check.ts) and
 * the "can't be read" test every structural change makes (G8).
 *
 * Release 1's learners only ever got the Release 0 view of a course: the
 * four text lessons and each saved exercise, in the standard order, each
 * lesson's main content only. So a course whose list is the standard one
 * is exactly that view — and every way a list can differ from it is named
 * here:
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
 * Step names are never a reason (D58): a renamed course always published.
 *
 * Why an empty list means learners get what the editor sees: with no lesson
 * of its own, hidden or deleted, every standard text lesson is listed (one
 * missing is put back, outline.ts), and so is every saved exercise; with
 * none reordered they are in the standard order; so the list, less empty
 * exercise lessons, is presentStageKeys — what getDbCourse plays. With no
 * extra content, each lesson's content is the main content learners read.
 *
 * Also here, the page's forecasts of the rules for changing a course
 * people are taking (predictOutlineOp, predictPartOp: live-rules.ts), so
 * the course page offers what the server would take. Pure and client-safe.
 */

import type { CourseKind } from "../course-admin-types";
import {
  LEGACY_ORDER,
  type InteractiveKey,
  type NewOnlyReason,
  type NewOnlyReasons,
  type OutlineOp,
  type OutlineReasons,
  type ResolvedOutline,
  type SectionId,
} from "./contract";
import { liveRule, outlineLiveOp, type LiveFacts, type LiveOp, type LiveVerdict } from "./live-rules";
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

const unreadable = (reasons: readonly NewOnlyReason[]) =>
  reasons.some((r) => r.code === "unreadable");

/**
 * What the page predicts for one change of a course people may be taking
 * (live-rules.ts): `verdict` is liveRule's answer, null when the change
 * can't be made at all (a built-in course, a list that can't be read, or
 * the change itself refused, at an edge say). `allowed` once nothing but a
 * confirmation stands in the way.
 */
export interface LivePrediction {
  allowed: boolean;
  verdict: LiveVerdict | null;
}

const predicted = (verdict: LiveVerdict | null): LivePrediction => ({
  allowed: verdict === "allowed" || verdict === "needs-confirmation",
  verdict,
});

/**
 * The page's forecast of the server's answer to one lesson-list change,
 * from what it was sent: the resolved list, its reasons (only "unreadable"
 * matters any more), the free standard keys, and the facts the rules need
 * (learners, the cut-off, who has data in the lesson, whether it is the
 * last one learners see). The change itself is worked out by the server's
 * own rules (applyOutlineOpWith); a rename is never guarded (D58).
 *
 * Nothing is offered for a built-in course, nor while anything can't be
 * read: the server refuses every structural write then (G8) until an admin
 * repairs it.
 */
export function predictOutlineOp(args: {
  kind: CourseKind;
  outline: ResolvedOutline;
  reasons: readonly NewOnlyReason[];
  freeKeys: readonly InteractiveKey[];
  op: OutlineOp;
  facts: LiveFacts;
}): LivePrediction {
  const { kind, outline, reasons, freeKeys, op, facts } = args;
  if (kind === "bundled" || outline.unreadable || unreadable(reasons)) return predicted(null);
  const r = applyOutlineOpWith(outline, op, {
    isFree: (key: InteractiveKey) => freeKeys.includes(key),
    idTaken: (id) => outline.sections.some((s) => s.id === id),
  });
  if (!r.ok) return predicted(null);
  const live = outlineLiveOp(op);
  return predicted(live ? liveRule(live, facts) : "allowed");
}

/**
 * The page's forecast for a content change inside one lesson (add, move,
 * remove; partLiveOp says which rule a removal follows). Nothing while
 * anything can't be read.
 */
export function predictPartOp(args: {
  reasons: readonly NewOnlyReason[];
  op: LiveOp;
  facts: LiveFacts;
}): LivePrediction {
  if (unreadable(args.reasons)) return predicted(null);
  return predicted(liveRule(args.op, args.facts));
}
