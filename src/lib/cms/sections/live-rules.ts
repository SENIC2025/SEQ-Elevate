/**
 * Changing a course people are taking (D66, D67, spec 7.2): one pure rule,
 * which the server applies under the Course lock (store.server.ts
 * guardStructure) and the course page asks to predict it (guard.ts,
 * live-controls.ts, part-list.ts), so what the page offers and what the
 * server does agree.
 *
 * "Learners" is the D53 count: enrolments of learners only, never staff
 * trying a course out. An enrolment exists once a learner has saved
 * something, so opening a course makes nobody a learner of it.
 *
 *   Change                   no learners  learners,      published,    published,
 *                                         not published before 1 Dec  from 1 Dec
 *   add / move a lesson      allowed      confirm       confirm       restructure-closed
 *   hide / show a lesson     allowed      confirm       confirm       confirm ("use Hide")
 *   delete a lesson          allowed      has-learners if anyone has  has-learners
 *                                         data in it, else allowed    (Hide is offered)
 *   add / move content       allowed      confirm       confirm       restructure-closed
 *   remove text content      allowed      confirm       confirm       restructure-closed
 *   remove a live question   allowed      has-learners  has-learners  has-learners
 *   Remove stage (live)      allowed      has-learners  has-learners  has-learners
 *
 * On a published course, hiding or deleting the last lesson learners see is
 * refused (last-lesson): learners would be left a course with nothing in it,
 * whose badge comes for free. Renames, text and question saves, video and
 * documents are never asked about here: they are live at once (D33, D58).
 *
 * "confirm" is needs-confirmation: the server refuses until the change is
 * sent again with `confirm`, which the page does once the editor has seen
 * how many learners it touches (LiveChangeConfirm.tsx). A page from before
 * Release 2 never sends it, so it is told first.
 */

import type { CourseStatus } from "../course-status";
import type { OutlineOp, PartOp, PartType } from "./contract";

export type LiveOp =
  | "add-lesson"
  | "move-lesson"
  | "hide"
  | "show"
  | "delete-lesson"
  | "add-part"
  | "move-part"
  /** Text, or a question learners don't get (only a draft so far). */
  | "remove-part"
  /** A question with a live version (`data`), which learners may have answered. */
  | "remove-question"
  /** "Remove stage" on a lesson's main exercise that learners get. */
  | "remove-stage";

export type LiveVerdict =
  | "allowed"
  | "needs-confirmation"
  | "restructure-closed"
  | "has-learners"
  | "last-lesson";

export interface LiveFacts {
  status: CourseStatus;
  /** Learners of the course (D53 count). */
  learners: number;
  /** The cut-off has passed (cutoff.ts restructureClosedFrom). */
  closed: boolean;
  /**
   * delete-lesson: learners with any trace of the lesson (store.server.ts
   * learnersWithData). Unknown counts as some.
   */
  withData?: number;
  /** hide and delete-lesson: it is the only lesson learners see now. */
  lastVisible?: boolean;
}

/** Changes the 1 December rule closes (adding, moving or removing lessons and content). */
const RESTRUCTURE: ReadonlySet<LiveOp> = new Set(["add-lesson", "move-lesson", "add-part", "move-part", "remove-part"]);

export function liveRule(op: LiveOp, f: LiveFacts): LiveVerdict {
  const published = f.status === "published";
  const emptiesCourse = published && f.lastVisible === true && (op === "hide" || op === "delete-lesson");
  if (f.learners <= 0) return emptiesCourse ? "last-lesson" : "allowed";

  switch (op) {
    case "remove-question":
    case "remove-stage":
      return "has-learners";
    case "delete-lesson":
      if (published) return "has-learners";
      return (f.withData ?? f.learners) > 0 ? "has-learners" : "allowed";
    case "hide":
      return emptiesCourse ? "last-lesson" : "needs-confirmation";
    case "show":
      return "needs-confirmation";
    default:
      return RESTRUCTURE.has(op) && published && f.closed ? "restructure-closed" : "needs-confirmation";
  }
}

/** The rule a lesson-list change follows; null for a rename, which is never guarded (D58). */
export function outlineLiveOp(op: OutlineOp): LiveOp | null {
  switch (op.op) {
    case "add":
      return "add-lesson";
    case "move":
      return "move-lesson";
    case "hide":
      return op.hidden ? "hide" : "show";
    case "delete":
      return "delete-lesson";
    case "rename":
      return null;
  }
}

/**
 * The rule a content change follows. Removing a question that has a live
 * version is removing something learners may have answered; text, or a
 * question that is only a draft, is ordinary restructuring.
 */
export function partLiveOp(op: PartOp["op"], removed?: { type: PartType | "main"; live?: boolean }): LiveOp {
  if (op === "add") return "add-part";
  if (op === "move") return "move-part";
  return removed && removed.type !== "text" && removed.type !== "main" && removed.live ? "remove-question" : "remove-part";
}
