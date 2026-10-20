/**
 * The course as the completion screen reads it (addendum 11). The player
 * ends on CompletionStage, which takes a CourseContent: this hands it the
 * course's slug, title, badge and completion text with no lessons — it
 * reads none of them — so no cast is needed, and none of the learner
 * course's lessons (LearnerCourse, D63) reach it.
 */
import type { CourseContent } from "@/lib/cms/types";

export function completionCourse(
  c: Omit<CourseContent, "stages"> & { stages?: unknown; lessons?: unknown; unseen?: unknown; sectioned?: unknown }
): CourseContent {
  const { stages: _stages, lessons: _lessons, unseen: _unseen, sectioned: _flag, ...rest } = c;
  void _stages;
  void _lessons;
  void _unseen;
  void _flag;
  return { ...rest, stages: [] };
}
