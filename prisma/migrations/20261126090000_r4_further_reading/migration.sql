-- Release 4 (D107–D109). Additive: two new tables and one defaulted column.
-- Release 3 keeps serving while this applies (vercel-build migrates before it
-- builds), and every statement here is one Release 3 code tolerates: it never
-- names the new tables, reads documents with an explicit select or gains a
-- field it ignores, and creates documents naming only its own fields, which
-- the column's default fills.
-- Rollback: redeploy Release 3; everything here stays and is ignored.
--
-- One transaction, BEGIN to COMMIT: Prisma applies a migration's statements
-- one by one, and without them each would commit on its own, so a failure
-- half-way would leave half of this applied. With them a failure leaves
-- nothing, and `prisma migrate resolve --rolled-back` then clears the record.
-- Every lock is held until COMMIT, so the statements that lock tables Release 3
-- uses come after the new tables, and the one change to a table Release 3
-- reads comes last (r4-migration.test.ts checks the order).

BEGIN;

SET LOCAL lock_timeout = '5s';   -- a blocked statement fails the build (retry later), never stalls the site

-- Part 1: new tables and their index (nothing Release 3 uses is locked)

-- A further-reading link of a lesson (D107).
CREATE TABLE "LessonLink" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "order" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonLink_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LessonLink_lessonId_idx" ON "LessonLink"("lessonId");

-- A created course's references and bibliography, one row per course (D109).
CREATE TABLE "CourseBibliography" (
    "courseId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseBibliography_pkey" PRIMARY KEY ("courseId")
);

-- Part 2: foreign keys (SHARE ROW EXCLUSIVE on Lesson and Course until COMMIT:
-- an editor's write to them waits briefly; learners' reads and FOR KEY SHARE don't)

ALTER TABLE "LessonLink" ADD CONSTRAINT "LessonLink_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseBibliography" ADD CONSTRAINT "CourseBibliography_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Part 3: the one change to a table Release 3 reads (ACCESS EXCLUSIVE on
-- LessonDocument until COMMIT; metadata only: a constant default needs no
-- rewrite of the table). D108: [] = every language, what every document means
-- today, so nothing is backfilled. Column DDL exactly as Prisma generates it
-- for String[] @default([]), so migrate finds no drift.

ALTER TABLE "LessonDocument" ADD COLUMN IF NOT EXISTS "languages" TEXT[] DEFAULT ARRAY[]::TEXT[];

COMMIT;
