-- Badges for courses created in the platform (C9).
--
-- A course an editor created in the CMS had no Badge row and no
-- Course.badgeId, so the badge a learner earned on it was never saved and
-- was gone after a reload. createCourse now makes one with the course
-- (src/lib/cms/course-badge.ts). This gives every course created before a
-- badge by the same rules, links it, and saves the badge for every learner
-- who had already completed such a course.
--
-- A created course is one whose "meta" is not NULL: the test the code uses
-- (listDbCourses / getDbCourse in src/lib/cms/db-course.ts).
--
-- Additive and idempotent: it only adds rows, only touches courses still
-- without a badge, uses ids derived from the course and enrollment ids, and
-- skips anything already there, so running it again changes nothing.

-- 1. A Badge for each created course without one. Name and meaning follow
--    the course's English copy, else its first language (pickMeta(meta,
--    "en")): the title, and the subtitle or a plain sentence. The slug is
--    "<course slug>-complete", what the player awards; should another badge
--    already have it, the course's id makes it unique.
INSERT INTO "Badge" ("id", "projectId", "slug", "name", "meaning", "iconRef", "createdAt", "updatedAt")
SELECT
  'course-badge-' || c."id",
  c."projectId",
  CASE
    WHEN EXISTS (
      SELECT 1 FROM "Badge" b
      WHERE b."projectId" = c."projectId" AND b."slug" = c."slug" || '-complete'
    )
    THEN c."slug" || '-complete-' || c."id"
    ELSE c."slug" || '-complete'
  END,
  course_copy."name",
  COALESCE(NULLIF(btrim(course_copy."tagline"), ''), 'Completed the course “' || course_copy."name" || '”.'),
  'award',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Course" c
CROSS JOIN LATERAL (
  SELECT
    COALESCE(NULLIF(btrim(pick."entry" ->> 'title'), ''), c."slug") AS "name",
    pick."entry" ->> 'tagline' AS "tagline"
  FROM (
    SELECT CASE
      WHEN jsonb_typeof(c."meta") = 'object' THEN COALESCE(
        NULLIF(c."meta" -> 'en', 'null'::jsonb),
        (SELECT j."value" FROM jsonb_each(c."meta") AS j LIMIT 1)
      )
    END AS "entry"
  ) pick
) course_copy
WHERE c."meta" IS NOT NULL
  AND c."badgeId" IS NULL
ON CONFLICT DO NOTHING;

-- 2. Link each of those courses to its badge.
UPDATE "Course" c
SET "badgeId" = 'course-badge-' || c."id"
WHERE c."meta" IS NOT NULL
  AND c."badgeId" IS NULL
  AND EXISTS (SELECT 1 FROM "Badge" b WHERE b."id" = 'course-badge-' || c."id");

-- 3. Save the badge for every enrollment already completed on a created
--    course, dated when the course was completed. A learner who already
--    holds it keeps the row they have.
INSERT INTO "UserBadge" ("id", "userId", "badgeId", "awardedAt")
SELECT
  'course-award-' || e."id",
  e."userId",
  c."badgeId",
  e."completedAt"
FROM "CourseEnrollment" e
JOIN "Course" c ON c."id" = e."courseId"
WHERE c."meta" IS NOT NULL
  AND c."badgeId" IS NOT NULL
  AND e."completedAt" IS NOT NULL
ON CONFLICT DO NOTHING;
