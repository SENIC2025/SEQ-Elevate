/**
 * Merging a signed-in learner's saved progress with what they did before it
 * arrived.
 *
 * The learner store starts empty and loads the saved data from the server.
 * On a cold server that takes seconds, and the learner may already be
 * walking a course — even to the end, badge included — when it arrives.
 * Swapping the saved copy in would throw those steps away, and the
 * write-through skips everything done while loading, so the two are merged
 * instead: nothing either side recorded is lost, and where both answered
 * the same question the saved answer comes first unless noted.
 *
 * Pure (no React, no server): DemoStateProvider in demo-state.tsx applies it.
 */

import type { CompCardData, CourseProgress } from "./demo-state";

/** An answer counts once it has more than whitespace in it. */
const answered = (text: string) => text.trim() !== "";

/** Has the learner done anything in this course yet? */
export function hasCourseProgress(course: CourseProgress): boolean {
  const { reflection: r, assessment: a } = course;
  return (
    course.stagesCompleted.length > 0 ||
    course.simulation !== null ||
    !!course.scenario.root ||
    answered(r.p1) ||
    answered(r.p2) ||
    answered(r.p3) ||
    a.q1 !== null ||
    a.q2 !== null ||
    a.q3 !== null ||
    course.completedAt !== null
  );
}

/**
 * One course's progress from both sides. Only for the same course: for a
 * different courseSlug there is nothing to merge and `local` comes back.
 *
 * - stages: the saved ones in their order, then any new local ones;
 * - simulation, assessment answers: the local choice, else the saved one;
 * - scenario: the local path if one was started (root and follow-up belong
 *   together), else the saved path;
 * - reflection: each local answer that isn't empty, else the saved one;
 * - completedAt: the saved date — the first completion stays the date —
 *   else the local one;
 * - courseTitle: the local (displayed) title, else the saved one.
 */
export function mergeCourseProgress(
  local: CourseProgress,
  saved: CourseProgress
): CourseProgress {
  if (local.courseSlug !== saved.courseSlug) return local;
  const text = (l: string, s: string) => (answered(l) ? l : s);
  return {
    courseSlug: local.courseSlug,
    courseTitle: local.courseTitle ?? saved.courseTitle,
    stagesCompleted: [
      ...saved.stagesCompleted,
      ...local.stagesCompleted.filter((s) => !saved.stagesCompleted.includes(s)),
    ],
    simulation: local.simulation ?? saved.simulation,
    scenario: local.scenario.root ? local.scenario : saved.scenario,
    reflection: {
      p1: text(local.reflection.p1, saved.reflection.p1),
      p2: text(local.reflection.p2, saved.reflection.p2),
      p3: text(local.reflection.p3, saved.reflection.p3),
    },
    assessment: {
      q1: local.assessment.q1 ?? saved.assessment.q1,
      q2: local.assessment.q2 ?? saved.assessment.q2,
      q3: local.assessment.q3 ?? saved.assessment.q3,
    },
    completedAt: saved.completedAt ?? local.completedAt,
  };
}

/**
 * The course state once `slug`'s saved progress (`saved`, null if none) has
 * loaded, or null for "leave it as it is": the learner has moved on to
 * another course, or there's nothing saved and nothing done yet (opening a
 * course doesn't enroll anyone).
 *
 * Otherwise it's always a NEW object — the merge, or a copy of the current
 * progress when nothing was saved — so the store's debounced write-through
 * runs and saves what the learner did while this loaded.
 */
export function courseAfterLoad(
  current: CourseProgress,
  slug: string,
  saved: CourseProgress | null
): CourseProgress | null {
  if (current.courseSlug !== slug) return null;
  if (saved?.courseSlug === slug) return mergeCourseProgress(current, saved);
  return hasCourseProgress(current) ? { ...current } : null;
}

/**
 * The course state once a guest's last-played course (`migrated`) has moved
 * to their account on sign-in — it's already saved there — or null for
 * "leave it as it is". It's merged in only when it's the course being
 * played, as courseAfterLoad does, keeping what the learner did while their
 * account loaded; shown when no course is being played; and any other
 * course being played is left alone, so its steps stay its own: the
 * migrated course loads like any other when it's opened.
 */
export function courseAfterMigration(
  current: CourseProgress,
  migrated: CourseProgress
): CourseProgress | null {
  if (!migrated.courseSlug) return null;
  if (current.courseSlug === null) return { ...migrated };
  return courseAfterLoad(current, migrated.courseSlug, migrated);
}

/**
 * The Comp Card once the saved one (`saved`, null if none) has loaded.
 * `local` is the card in the store, which started as `blank`. If the
 * learner filled it in while the saved card loaded (updatedAt set), what
 * they entered is newer and wins, field by field: a text with more than
 * whitespace in it, a confidence or privacy changed from the blank card's.
 * A field they didn't touch keeps the saved value — they never saw it, so
 * leaving it isn't clearing it. updatedAt stays set, so the store's
 * write-through saves the merged card. Nothing entered: the saved card.
 */
export function mergeCompCardOnHydrate(
  local: CompCardData,
  saved: CompCardData | null,
  blank: CompCardData
): CompCardData {
  if (!saved) return local;
  if (!local.updatedAt) return saved;
  const text = (l: string, s: string) => (answered(l) ? l : s);
  return {
    wentWell: text(local.wentWell, saved.wentWell),
    difficult: text(local.difficult, saved.difficult),
    improve: text(local.improve, saved.improve),
    behaviour: text(local.behaviour, saved.behaviour),
    confidence:
      local.confidence !== blank.confidence ? local.confidence : saved.confidence,
    privacy: local.privacy !== blank.privacy ? local.privacy : saved.privacy,
    updatedAt: local.updatedAt,
  };
}

/** Badges are only ever earned: the server's, then any earned locally. */
export function mergeBadges(db: string[], local: string[]): string[] {
  const known = new Set(db);
  return [...db, ...local.filter((b) => !known.has(b))];
}
