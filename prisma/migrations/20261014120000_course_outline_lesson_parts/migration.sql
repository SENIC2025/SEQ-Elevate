-- Release 1 (flexible editor, D56). Additive and nullable only: the previous
-- deployment keeps serving while this applies (vercel-build runs migrations
-- before next build). Its learner reader selects explicit columns or ignores
-- unknown ones, so it never depends on these. No backfill, no default, no index.
-- Rollback: redeploy Release 0; both columns are simply ignored.

-- The lesson list of a course created here (order, hidden, per-language step
-- names, Release 1 lessons, deleted standard lessons). NULL = today's layout.
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "outline" JSONB;

-- A lesson's extra content around its main content. NULL = main content only;
-- the main content stays in narrative / structure / structureDraft.
ALTER TABLE "Lesson" ADD COLUMN IF NOT EXISTS "parts" JSONB;
