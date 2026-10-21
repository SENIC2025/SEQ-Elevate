-- Release 3 (D90, D93): two new columns, after 20261120090100 has committed, each
-- in a statement of its own. With no BEGIN, Prisma commits each statement on its
-- own, so each is a transaction that locks one table and nothing else, and can't
-- deadlock with anything Release 2 does. One transaction that held Course or
-- Project together with User could: Release 2 locks each of them and User in both
-- orders (a learner's save locks the course row before it checks the learner, a
-- first enrolment checks the learner before the course; an audit row checks the
-- project before its author, an editor's change counts learners before it
-- audits). Both statements are idempotent, so after a failure a retry runs both.

SET lock_timeout = '5s';   -- a blocked ALTER fails the build (retry later), never stalls the site

-- D93: the safeguarding contacts, an admin setting.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "safeguarding" JSONB;

-- D90 (column DDL exactly as Prisma generates it for String[] @default([])).
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "readyLocales" TEXT[] DEFAULT ARRAY[]::TEXT[];
