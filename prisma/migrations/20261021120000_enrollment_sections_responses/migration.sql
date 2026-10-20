-- Release 2 (D62). Additive: two nullable columns, one function, one trigger.
-- No default, no backfill, no index. Release 1 keeps serving while this
-- applies (vercel-build migrates before it builds): it never names the new
-- columns, and the trigger only stops what no build should do — clear a
-- saved completion or drop a completed standard lesson. Rollback: redeploy
-- Release 1; columns and trigger stay and are harmless. Resetting a
-- learner's progress (Release 3's admin reset) deletes the row.

-- Lessons of the course's own the learner finished ("s-…"), in the order
-- finished. Standard lessons stay in stagesCompleted. NULL = none.
ALTER TABLE "CourseEnrollment" ADD COLUMN IF NOT EXISTS "sectionsCompleted" JSONB;
-- Every answer without a column of its own, by "lessonId/contentId":
-- { v: 1, items: { [key]: answer & { at } } }. NULL = none.
ALTER TABLE "CourseEnrollment" ADD COLUMN IF NOT EXISTS "responses" JSONB;

-- Completed lessons and completedAt only grow, whichever build writes them:
-- a saved completion is never cleared (the first one is kept), and a
-- completed standard lesson is never dropped (the stored ones first, in
-- their order, then any new ones). Inserts aren't touched, so restores and
-- test seeding work as before.
CREATE OR REPLACE FUNCTION "course_enrollment_keep_progress"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."completedAt" := COALESCE(OLD."completedAt", NEW."completedAt");
  NEW."stagesCompleted" := ARRAY(
    SELECT t.s
    FROM unnest(COALESCE(OLD."stagesCompleted", '{}'::"StageKey"[])
             || COALESCE(NEW."stagesCompleted", '{}'::"StageKey"[]))
         WITH ORDINALITY AS t(s, i)
    GROUP BY t.s
    ORDER BY min(t.i));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "CourseEnrollment_keep_progress" ON "CourseEnrollment";
CREATE TRIGGER "CourseEnrollment_keep_progress"
  BEFORE UPDATE ON "CourseEnrollment"
  FOR EACH ROW EXECUTE FUNCTION "course_enrollment_keep_progress"();
