/**
 * The course as the completion screen reads it (addendum 11). The
 * sectioned preview ends on the learner player's own CompletionStage
 * (frozen), which takes a CourseContent: this hands it the course's
 * slug, title, badge and completion text with no lessons — it reads none
 * of them — so no cast is needed, and nothing of the editor's layout
 * reaches a learner type.
 */
import type { SectionedCourseContent } from "@/lib/cms/sections/contract";
import type { CourseContent } from "@/lib/cms/types";

export function completionCourse(c: SectionedCourseContent): CourseContent {
  const { stages: _sections, sectioned: _flag, ...rest } = c;
  void _sections;
  void _flag;
  return { ...rest, stages: [] };
}
