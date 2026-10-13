/**
 * Which lesson-list controls a course page offers, and why one isn't (spec
 * 11.1). Pure, so the rules are tested without a browser.
 *
 * The page asks the same pure functions the server runs (predictOutlineOp,
 * guard.ts): on a published course a change may not add anything learners
 * couldn't get yet (G3), so such a control is aria-disabled with the reason
 * rather than taken away — it stays focusable and says why. Deleting a lesson
 * needs nobody enrolled (G4), whatever the status. A move at either end is a
 * plain native `disabled` (nothing to explain). The server stays the
 * authority: a stale page still gets its refusal.
 */

import type { CourseKind } from "@/lib/cms/course-admin-types";
import type { CourseStatus } from "@/lib/cms/course-status";
import { predictOutlineOp } from "@/lib/cms/sections/guard";
import {
  CUSTOM_SECTION_ID,
  NEW_SECTION_TEMPLATES,
  STANDARD_KEY_OF,
  type AddSectionChoice,
  type CustomSectionId,
  type NewOnlyReason,
  type OutlineOp,
  type SectionId,
  type SectionsMeta,
} from "@/lib/cms/sections/contract";

/** One control's state. */
export type Control =
  /**
   * Offered. `nonStandard`: on a draft, this change makes the course one
   * that can only be published from Release 2 (predictOutlineOp's
   * `introduced`), which the page says before and after it is made.
   */
  | { kind: "enabled"; nonStandard?: true }
  /** A move at the top or bottom: natively disabled. */
  | { kind: "edge" }
  /** Refused as things stand: aria-disabled, described by `why`. */
  | { kind: "locked"; why: "live" | "unreadable" | "max" }
  /** Delete with learners enrolled (G4). */
  | { kind: "learners"; count: number };

export interface ListContext {
  kind: CourseKind;
  status: CourseStatus;
  sections: SectionsMeta;
  enrolled: number;
  /**
   * The lessons learners get now (LessonOutline.live). Only these are kept
   * from deleting while learners are enrolled (G4); without it, all are.
   */
  learnerKeys?: readonly string[];
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

/** What G3 would answer for one lesson-list change, from what the page was sent. */
export function predict(ctx: ListContext, op: OutlineOp): { allowed: boolean; introduced: NewOnlyReason[] } {
  return predictOutlineOp({
    kind: ctx.kind,
    status: ctx.status,
    outline: ctx.sections.resolved,
    reasons: ctx.sections.reasons,
    freeKeys: ctx.sections.freeKeys,
    op,
  });
}

/**
 * A change the rules allow: enabled (marked when it would make the course
 * one for Release 2), or locked with the reason.
 */
function gate(ctx: ListContext, op: OutlineOp): Control {
  if (listUnreadable(ctx.sections)) return { kind: "locked", why: "unreadable" };
  const p = predict(ctx, op);
  if (!p.allowed) return { kind: "locked", why: "live" };
  return p.introduced.length > 0 ? { kind: "enabled", nonStandard: true } : ENABLED;
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
 * Adding one choice at `at` (null = its usual place): allowed, and whether
 * it makes the course one that can only be published from Release 2.
 */
export function choiceState(
  ctx: ListContext,
  choice: AddSectionChoice,
  at: number | null
): { control: Control; nonStandard: boolean } {
  const opener = addControl(ctx);
  if (opener.kind !== "enabled") return { control: opener, nonStandard: false };
  const p = predict(ctx, { op: "add", choice, at, newId: predictionId(ctx.sections) });
  return {
    control: p.allowed ? ENABLED : { kind: "locked", why: "live" },
    nonStandard: p.introduced.length > 0,
  };
}

/** "Add lesson" as a whole: refused at the limit (hidden lessons count) or while unreadable. */
export function addControl(ctx: ListContext): Control {
  if (listUnreadable(ctx.sections)) return { kind: "locked", why: "unreadable" };
  if (ctx.sections.resolved.sections.length >= ctx.sections.max) return { kind: "locked", why: "max" };
  return ENABLED;
}

/**
 * Whether any lesson could be added: on a published course only a free
 * practice, scenario or quick check in its usual place, so "Add lesson"
 * says why when there is none.
 */
export function anyAddAllowed(ctx: ListContext): Control {
  const opener = addControl(ctx);
  if (opener.kind !== "enabled") return opener;
  const allowed = addChoices(ctx.sections).some((c) => choiceState(ctx, c, null).control.kind === "enabled");
  return allowed ? ENABLED : { kind: "locked", why: "live" };
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
    addAfter: anyAddAllowed(ctx),
    delete:
      ctx.enrolled > 0 && (ctx.learnerKeys?.includes(id) ?? true)
        ? { kind: "learners", count: ctx.enrolled }
        : gate(ctx, { op: "delete", id }),
  };
}
