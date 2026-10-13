/**
 * The badge of a course CREATED IN THE CMS (C9).
 *
 * A bundled course's Badge row comes from the seed. A created course needs
 * one too: the learner's award (awardBadgeAction) and the completed-course
 * save (saveCourseProgress) both write a UserBadge pointing at a Badge row,
 * and without one the badge showed on the completion screen but was gone
 * after a reload. createCourse makes it with the course and links it
 * through Course.badgeId; the migration 20261013120000_created_course_badges
 * does the same for courses created before, with the same rules as here,
 * and runs again on every deploy (prisma/backfill-course-badges.mjs). A
 * course the old code makes while a deploy builds gets its badge when it is
 * published, reworded or finished (ensure-course-badge.ts, which writes it).
 *
 * The Badge row holds one language (it appears in the learner's data
 * export), so it follows the course's English copy, or its first language
 * when it has no English yet: the same pick as pickMeta(meta, "en"). What
 * learners see on screen comes from the course's copy in their language.
 *
 * Pure (no server imports), so it can be tested without a database.
 */

/** The lucide icon a created course's badge shows. */
export const COURSE_BADGE_ICON = "award";

/**
 * The badge slug for a created course: `<course slug>-complete`, the slug
 * the player has always awarded for one. When some other badge already has
 * it (`taken`), the first free `-2`, `-3`… after it, so a course is never
 * linked to another course's badge.
 */
export function courseBadgeSlug(
  courseSlug: string,
  taken: ReadonlySet<string> = new Set()
): string {
  const base = `${courseSlug}-complete`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const slug = `${base}-${n}`;
    if (!taken.has(slug)) return slug;
  }
}

/**
 * The badge's name and meaning: the course's title, and its subtitle
 * (tagline), or a plain sentence when it has none. `entry` is the course's
 * English copy (pickMeta(meta, "en")); the slug stands in for a title only
 * if there is no copy at all.
 */
export function courseBadgeCopy(
  entry: { title?: string; tagline?: string } | null,
  courseSlug: string
): { name: string; meaning: string } {
  const name = entry?.title?.trim() || courseSlug;
  const meaning = entry?.tagline?.trim() || `Completed the course “${name}”.`;
  return { name, meaning };
}
