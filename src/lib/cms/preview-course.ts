import "server-only";

/**
 * What an editor's "Preview as learner" shows (D56, spec 9.2): the learner
 * view itself for every course learners can get as built — bundled,
 * published, or standard — and, for a draft course with lessons or content
 * learners don't get until Release 2, the same course in the editor's
 * layout (SectionedCourseContent), played by the sectioned preview player.
 *
 * Until the Foundation's loaders land (F2) every course is previewed as
 * learners see it: `learner` itself, which is also what this returns on any
 * error later (fail open to today's preview).
 */

import type { SectionedCourseContent } from "./sections/contract";
import type { CourseContent, Locale } from "./types";

export async function getPreviewCourse(
  projectId: string,
  slug: string,
  locale: Locale,
  learner: CourseContent
): Promise<CourseContent | SectionedCourseContent> {
  void projectId;
  void slug;
  void locale;
  return learner;
}
