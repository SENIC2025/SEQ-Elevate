/**
 * What stops a created course being published (D66, spec 4.8), now that
 * learners get courses as they are built: only
 *
 *   unreadable   the stored lesson list, or a listed lesson's content
 *                (Lesson.parts), can't be read — nothing can be promised
 *                about it (fails closed; `sectionId` names the lesson);
 *   no-lessons   learners would see no lesson at all (lessonPlanOf: every
 *                lesson hidden, or with nothing in it), so finishing the
 *                course would hand out its badge for nothing.
 *
 * Everything else — lessons of its own, hidden or deleted standard lessons,
 * a new order, extra content, step names — publishes. Release 1's reasons
 * (guard.ts newOnlyReasons) come back only under a kill switch
 * (R2_PUBLISH_GUARD=on or R2_LEARNER_PLAYER=off, switches.ts), which the
 * callers check.
 *
 * Pure, but it reads the lesson plan, which reads the step-name messages:
 * for the server (publishing, the course page's loader), never imported by
 * a client component.
 */

import type { CourseKind } from "../course-admin-types";
import type { PublishBlocker, SectionFacts } from "./contract";
import { lessonPlanOf, type LessonFacts } from "./learner-path";
import { resolveOutline } from "./outline";
import { partsOf } from "./section-parts";

export function publishBlockers(
  kind: CourseKind,
  rawOutline: unknown,
  rows: readonly (SectionFacts & LessonFacts)[]
): PublishBlocker[] {
  if (kind === "bundled") return [];
  const outline = resolveOutline("cms", rawOutline, rows);
  if (outline.unreadable) return [{ code: "unreadable" }];
  const rowOf = new Map(rows.map((r) => [r.stageKey, r]));
  const unreadable: PublishBlocker[] = outline.sections
    .filter((s) => partsOf(rowOf.get(s.id)?.parts) === "unreadable")
    .map((s) => ({ code: "unreadable", sectionId: s.id }));
  if (unreadable.length) return unreadable;
  return lessonPlanOf("cms", rawOutline, rows, "en").lessons.length ? [] : [{ code: "no-lessons" }];
}
