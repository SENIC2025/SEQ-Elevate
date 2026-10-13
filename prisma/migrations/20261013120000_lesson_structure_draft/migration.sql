-- AlterTable
-- Additive: an editor's unfinished interactive stage, kept apart from the
-- structure learners see. IF NOT EXISTS so a re-run is harmless.
ALTER TABLE "Lesson" ADD COLUMN IF NOT EXISTS "structureDraft" JSONB;
