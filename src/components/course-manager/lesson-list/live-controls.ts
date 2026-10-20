/**
 * Which lesson-list controls a course page offers, and why one isn't (spec
 * 11.1, Release 2 spec 7.3). Pure, so the rules are tested without a
 * browser.
 *
 * The page asks the same rule the server runs (live-rules.ts, through
 * guard.ts predictOutlineOp) with the facts it was sent (SectionsMeta:
 * learners, the 1 December cut-off; each lesson's learners with data; the
 * lessons learners get now):
 *   - a change the rule allows outright is offered;
 *   - one it allows once the editor has confirmed (the course has
 *     learners) is offered with `confirm`: pressing it opens
 *     LiveChangeConfirm first;
 *   - one it refuses is aria-disabled with the reason — the cut-off
 *     ("closed"), the last lesson learners see ("last-lesson"), or for a
 *     delete the learners who have it ("learners", with Hide offered
 *     instead) — so it stays focusable and says why.
 * A move at either end is a plain native `disabled` (nothing to explain).
 * The server stays the authority: a stale page still gets its refusal.
 */

import type { CourseKind } from "@/lib/cms/course-admin-types";
import type { CourseStatus } from "@/lib/cms/course-status";
import { predictOutlineOp, type LivePrediction } from "@/lib/cms/sections/guard";
import { liveRule, type LiveFacts } from "@/lib/cms/sections/live-rules";
import {
  CUSTOM_SECTION_ID,
  NEW_SECTION_TEMPLATES,
  STANDARD_KEY_OF,
  type AddSectionChoice,
  type CustomSectionId,
  type OutlineOp,
  type SectionId,
  type SectionsMeta,
} from "@/lib/cms/sections/contract";

/** One control's state. */
export type Control =
  /** Offered. `confirm`: the course has learners, so the change asks first (LiveChangeConfirm). */
  | { kind: "enabled"; confirm?: true }
  /** A move at the top or bottom: natively disabled. */
  | { kind: "edge" }
  /** Refused as things stand: aria-disabled, described by `why`. */
  | { kind: "locked"; why: "unreadable" | "max" | "closed" | "last-lesson" }
  /** Delete refused while learners have it (spec 7.2): Hide is offered instead. */
  | { kind: "learners"; count: number };

export interface ListContext {
  kind: CourseKind;
  status: CourseStatus;
  sections: SectionsMeta;
  /** Learners (D53); SectionsMeta.learners when the loader sent it. */
  enrolled: number;
  /** The lessons learners get now (LessonOutline.live): a published course keeps one (last-lesson). */
  learnerKeys?: readonly string[];
  /** Learners with any trace of each lesson (LessonOutline.learnersWithData): the delete rule. */
  withData?: Readonly<Record<string, number>>;
}

export interface RowControls {
  moveUp: Control;
  moveDown: Control;
  hide: Control;
  rename: Control;
  addAfter: Control;
  delete: Control;
}

const ENABLED: Control = { kind: "enabled" };

/** Is anything about the list unreadable? Then every change is refused (G8). */
export function listUnreadable(sections: SectionsMeta): boolean {
  return sections.resolved.unreadable === true || sections.reasons.some((r) => r.code === "unreadable");
}

/** How many learners the course has, as the page knows it. */
export const learnersOf = (ctx: ListContext): number => ctx.sections.learners ?? ctx.enrolled;

/** The facts spec 7.2's rule needs, for the course and (when given) one lesson. */
export function liveFacts(ctx: ListContext, id?: string): LiveFacts {
  const shown = ctx.learnerKeys;
  return {
    status: ctx.status,
    learners: learnersOf(ctx),
    closed: ctx.sections.restructureClosed === true,
    ...(id !== undefined && ctx.withData?.[id] !== undefined ? { withData: ctx.withData[id] } : {}),
    ...(id !== undefined && shown ? { lastVisible: shown.length === 1 && shown[0] === id } : {}),
  };
}

/**
 * An id for predicting "add a lesson of the course's own": any free one
 * will do, since the server picks the real id.
 */
export function predictionId(sections: SectionsMeta): CustomSectionId {
  const taken = new Set(sections.resolved.sections.map((s) => s.id));
  for (let n = 0; ; n++) {
    const id = `s-${n.toString(36).padStart(8, "0")}` as CustomSectionId;
    if (CUSTOM_SECTION_ID.test(id) && !taken.has(id)) return id;
  }
}

/** What the server would answer for one lesson-list change, from what the page was sent. */
export function predict(ctx: ListContext, op: OutlineOp): LivePrediction {
  return predictOutlineOp({
    kind: ctx.kind,
    outline: ctx.sections.resolved,
    reasons: ctx.sections.reasons,
    freeKeys: ctx.sections.freeKeys,
    op,
    facts: liveFacts(ctx, op.op === "add" ? undefined : op.id),
  });
}

/** A prediction as the control shows it. */
function controlOf(p: LivePrediction, facts: LiveFacts): Control {
  switch (p.verdict) {
    case null:
      // The change itself can't be made here (the rules refuse it): nothing to explain.
      return { kind: "edge" };
    case "allowed":
      return ENABLED;
    case "needs-confirmation":
      return { kind: "enabled", confirm: true };
    case "restructure-closed":
      return { kind: "locked", why: "closed" };
    case "last-lesson":
      return { kind: "locked", why: "last-lesson" };
    case "has-learners":
      return { kind: "learners", count: facts.status === "published" ? facts.learners : (facts.withData ?? facts.learners) };
  }
}

/** One change, by the rules: offered (asking first with learners), or why not. */
function gate(ctx: ListContext, op: OutlineOp): Control {
  if (listUnreadable(ctx.sections)) return { kind: "locked", why: "unreadable" };
  return controlOf(predict(ctx, op), liveFacts(ctx, op.op === "add" ? undefined : op.id));
}

/** Does this choice reuse a standard lesson (a free practice / scenario / quick check, or one added back)? */
export function reusesStandard(choice: AddSectionChoice, sections: SectionsMeta): boolean {
  if (choice.startsWith("restore:")) return true;
  const key = STANDARD_KEY_OF[choice as keyof typeof STANDARD_KEY_OF];
  return key !== undefined && sections.freeKeys.includes(key);
}

/** The choices "Add lesson" offers: the six kinds, then each deleted standard lesson. */
export function addChoices(sections: SectionsMeta): AddSectionChoice[] {
  return [
    ...NEW_SECTION_TEMPLATES,
    ...sections.resolved.removed.map((k): AddSectionChoice => `restore:${k}`),
  ];
}

/**
 * "Add lesson" as a whole: refused at the limit (hidden lessons count),
 * while unreadable, or from the cut-off on a course with learners
 * (published or not); with learners it asks first.
 */
export function addControl(ctx: ListContext): Control {
  if (listUnreadable(ctx.sections)) return { kind: "locked", why: "unreadable" };
  if (ctx.sections.resolved.sections.length >= ctx.sections.max) return { kind: "locked", why: "max" };
  const facts = liveFacts(ctx);
  return controlOf({ allowed: true, verdict: liveRule("add-lesson", facts) }, facts);
}

/** Adding one choice at `at` (null = its usual place). */
export function choiceState(ctx: ListContext, choice: AddSectionChoice, at: number | null): Control {
  const opener = addControl(ctx);
  if (opener.kind !== "enabled") return opener;
  return gate(ctx, { op: "add", choice, at, newId: predictionId(ctx.sections) });
}

/**
 * How many lessons learners would see once one more is added: the list's
 * lessons that aren't hidden, plus the new one. Above SectionsMeta.warnAbove
 * (12) the picker warns (Q7); the hard limit of 15 counts hidden lessons
 * too (addControl).
 */
export function visibleAfterAdd(sections: SectionsMeta): number {
  return sections.resolved.sections.filter((s) => !s.hidden).length + 1;
}

/** Every control of one lesson's "Actions for …" panel. */
export function rowControls(ctx: ListContext, id: SectionId): RowControls {
  const list = ctx.sections.resolved.sections;
  const index = list.findIndex((s) => s.id === id);
  const section = list[index];
  const hidden = section?.hidden === true;
  const move = (dir: -1 | 1): Control => {
    const to = index + dir;
    if (index < 0 || to < 0 || to >= list.length) return { kind: "edge" };
    return gate(ctx, { op: "move", id, dir });
  };
  return {
    moveUp: move(-1),
    moveDown: move(1),
    hide: gate(ctx, { op: "hide", id, hidden: !hidden }),
    rename: gate(ctx, { op: "rename", id, locale: "en", label: "" }),
    addAfter: addControl(ctx),
    delete: gate(ctx, { op: "delete", id }),
  };
}
