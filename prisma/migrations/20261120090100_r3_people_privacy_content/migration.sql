-- Release 3 (D72–D93, D101). Additive: new types and tables, nullable or defaulted
-- columns, two triggers, one default change and two data updates. Release 2 keeps
-- serving while this applies (vercel-build migrates before it builds), and every
-- statement here is one Release 2 code tolerates. Rollback: redeploy Release 2
-- after the pre-rollback step; everything here stays.
--
-- One transaction, BEGIN to COMMIT: Prisma applies a migration's statements one
-- by one, and without them each would commit on its own, so a failure half-way
-- would leave half of this applied. With them a failure leaves nothing (Prisma
-- then reports only "current transaction is aborted"; prisma/migrate-deploy.mjs
-- shows the database's own error). Every lock is held until COMMIT, so the order
-- of the statements that lock tables Release 2 uses is what lets its writes go on
-- (r3-migration.test.ts checks it against each of them):
--   - those statements come after the new tables and the backfills;
--   - a table Release 2 inserts into is locked before the tables that insert's
--     foreign keys then check: Observation, Validation and CompCard first, then
--     the Membership trigger, and User last. An insert under way finishes first;
--     a later one waits holding nothing this needs;
--   - User, which every signed-in request reads, is held exclusively only by the
--     last statements (Part 7);
--   - Project and Course aren't locked exclusively here at all: Release 2 locks
--     each of them and User in both orders (a learner's save locks the course
--     row before it checks the learner; a first enrolment checks the learner
--     before the course), so their new columns are 20261120090200's, one
--     statement each.

BEGIN;

SET LOCAL lock_timeout = '5s';   -- a blocked ALTER fails the build (retry later), never stalls the site

-- Part 1: new types and tables, no foreign keys yet (nothing Release 2 uses is locked)

CREATE TYPE "Country" AS ENUM ('DE', 'CY', 'BE', 'GR', 'OTHER');
CREATE TYPE "AgeRule" AS ENUM ('SELF_MIN_AGE', 'INVITED_WITH_GUARDIAN_CONSENT');

-- One row per person per project (D72): the only place scoping reads a person's
-- organisation. organisationId is written only by setPersonOrganisation (D101).
CREATE TABLE "ProjectProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "country" "Country",
    "organisationId" TEXT,
    "organisationSource" TEXT,
    "profileCompletedAt" TIMESTAMP(3),
    "termsVersion" TEXT,
    "termsAcceptedAt" TIMESTAMP(3),
    "ageRule" "AgeRule",
    "ageConfirmedAt" TIMESTAMP(3),
    "consentVersion" TEXT,
    "consentAt" TIMESTAMP(3),
    "guardianConsentRecordedAt" TIMESTAMP(3),
    "guardianSharingConsentAt" TIMESTAMP(3),
    "testAccountAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectProfile_userId_projectId_key" ON "ProjectProfile"("userId", "projectId");
CREATE INDEX "ProjectProfile_projectId_organisationId_idx" ON "ProjectProfile"("projectId", "organisationId");

-- D73: which organisation supports learners from a country.
CREATE TABLE "CountryMapping" (
    "projectId" TEXT NOT NULL,
    "country" "Country" NOT NULL,
    "organisationId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CountryMapping_pkey" PRIMARY KEY ("projectId","country")
);

-- D84: everyone who ever held a staff role in a project.
CREATE TABLE "StaffHistory" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstRole" "Role",
    "source" TEXT NOT NULL,

    CONSTRAINT "StaffHistory_pkey" PRIMARY KEY ("userId","projectId")
);

-- D92: course files whose record went, deleted later by the logged admin run.
CREATE TABLE "PendingFileDeletion" (
    "url" TEXT NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,

    CONSTRAINT "PendingFileDeletion_pkey" PRIMARY KEY ("url")
);

-- Part 2: backfills (ordinary reads of Membership, AuditLog, Observation,
-- Validation, User, Organisation; writes to the new tables only). Every one is
-- ON CONFLICT DO NOTHING, so running it again changes nothing. The new tables
-- have no database default for "id" or "updatedAt" (Prisma fills them in), so
-- the statements supply both; ids are derived as 20261013120000 derives its own.

-- 1. A profile for everyone with a membership in the project, every answer
--    empty, so every existing account sees the profile step. The organisation
--    is carried over only for people who hold no staff role and whose rows
--    agree on one (staff organisations are set by an ADMIN later).
INSERT INTO "ProjectProfile" ("id", "userId", "projectId", "organisationId", "organisationSource", "updatedAt")
SELECT
  'pp-' || md5(m."userId" || ':' || m."projectId"),
  m."userId",
  m."projectId",
  CASE WHEN bool_and(m."role" = 'LEARNER') AND count(DISTINCT m."organisationId") = 1
       THEN min(m."organisationId") END,
  CASE WHEN bool_and(m."role" = 'LEARNER') AND count(DISTINCT m."organisationId") = 1
       THEN 'backfill' END,
  CURRENT_TIMESTAMP
FROM "Membership" m
WHERE m."projectId" = 'seq-elevate'
GROUP BY m."userId", m."projectId"
ON CONFLICT ("userId", "projectId") DO NOTHING;

-- 2a. Staff history from every staff membership: the earliest one's time and role.
INSERT INTO "StaffHistory" ("userId", "projectId", "firstAt", "firstRole", "source")
SELECT DISTINCT ON (m."userId", m."projectId")
  m."userId", m."projectId", m."createdAt", m."role", 'membership'
FROM "Membership" m
WHERE m."role" <> 'LEARNER'
ORDER BY m."userId", m."projectId", m."createdAt", m."role"
ON CONFLICT ("userId", "projectId") DO NOTHING;

-- 2b. From the audit log: the actor of any action a learner can't cause. The
--     list is the action literals of the learner-callable files, and Release
--     3's own two; r3-migration.test.ts checks it against the code.
INSERT INTO "StaffHistory" ("userId", "projectId", "firstAt", "firstRole", "source")
SELECT a."actorId", a."projectId", min(a."createdAt"), NULL, 'audit'
FROM "AuditLog" a
WHERE a."actorId" IS NOT NULL
  AND a."action" NOT IN ('course.opened', 'stage.time', 'video.cue_answered', 'account.exported', 'account.deleted', 'profile.completed', 'compcard.sharing_changed')
GROUP BY a."actorId", a."projectId"
ON CONFLICT ("userId", "projectId") DO NOTHING;

-- 2c. Authors of facilitator notes and validations (notes carry no project).
INSERT INTO "StaffHistory" ("userId", "projectId", "firstAt", "firstRole", "source")
SELECT n."userId", p."id", min(n."at"), NULL, 'notes'
FROM (
  SELECT o."observerId" AS "userId", o."createdAt" AS "at" FROM "Observation" o
  UNION ALL
  SELECT v."validatorId", v."createdAt" FROM "Validation" v
) n
JOIN "Project" p ON p."id" = 'seq-elevate'
WHERE n."userId" IS NOT NULL
GROUP BY n."userId", p."id"
ON CONFLICT ("userId", "projectId") DO NOTHING;

-- 2d. The staff demo profiles' addresses, old and new.
INSERT INTO "StaffHistory" ("userId", "projectId", "firstAt", "firstRole", "source")
SELECT u."id", p."id", u."createdAt", NULL, 'demo-profile'
FROM "User" u
JOIN "Project" p ON p."id" = 'seq-elevate'
WHERE lower(u."email") IN ('stefan@senic.org', 'demo-admin@seq-elevate.eu', 'demo123@seq-elevate.eu', 'demo321@seq-elevate.eu')
ON CONFLICT ("userId", "projectId") DO NOTHING;

-- 3. Country mapping (Q24 default), only for the organisations the seed makes,
--    and only where they exist. Otherwise an ADMIN sets it on the screen.
INSERT INTO "CountryMapping" ("projectId", "country", "organisationId", "updatedAt")
SELECT o."projectId", v."country"::"Country", o."id", CURRENT_TIMESTAMP
FROM (VALUES
  ('DE', 'seq-elevate-proarbeit'),
  ('CY', 'seq-elevate-synthesis'),
  ('GR', 'seq-elevate-uom'),
  ('BE', 'seq-elevate-diesis'),
  ('OTHER', 'seq-elevate-diesis')
) AS v("country", "organisationId")
JOIN "Organisation" o ON o."id" = v."organisationId" AND o."projectId" = 'seq-elevate'
ON CONFLICT ("projectId", "country") DO NOTHING;

-- Part 3: foreign keys of the new tables (SHARE ROW EXCLUSIVE on User, Project,
-- Organisation from here to the end: writes to those three wait, briefly: a
-- sign-up, a reading-help setting, an organisation; reads, and inserts that only
-- check them, don't). Deleting an organisation someone belongs to, or a country
-- maps to, fails in the database.

ALTER TABLE "ProjectProfile" ADD CONSTRAINT "ProjectProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectProfile" ADD CONSTRAINT "ProjectProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectProfile" ADD CONSTRAINT "ProjectProfile_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CountryMapping" ADD CONSTRAINT "CountryMapping_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CountryMapping" ADD CONSTRAINT "CountryMapping_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffHistory" ADD CONSTRAINT "StaffHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffHistory" ADD CONSTRAINT "StaffHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Part 4: the tables Release 2 writes notes, validations and Comp Cards to
-- (ACCESS EXCLUSIVE on each from here to the end), each locked before the tables
-- its rows refer to (a note: User, then CompCard).

-- D89: notes and validations outlive their author, unsigned (their foreign keys
-- follow in Part 7).
ALTER TABLE "Observation" ALTER COLUMN "observerId" DROP NOT NULL;
ALTER TABLE "Validation" ALTER COLUMN "validatorId" DROP NOT NULL;

-- D80: Comp Card sharing. Every card starts on "Only me". Release 3 reads a card
-- as shared only with "sharedAt" and the learner's current organisation, which
-- only Release 3's own sharing action writes, so a later write of "privacy"
-- alone shares nothing.
ALTER TABLE "CompCard" ALTER COLUMN "privacy" SET DEFAULT 'SELF';
ALTER TABLE "CompCard" ADD COLUMN IF NOT EXISTS "sharedAt" TIMESTAMP(3);
ALTER TABLE "CompCard" ADD COLUMN IF NOT EXISTS "sharedWithOrganisationId" TEXT;
ALTER TABLE "CompCard" ADD COLUMN IF NOT EXISTS "sharingVersion" TEXT;
ALTER TABLE "CompCard" ADD CONSTRAINT "CompCard_sharedWithOrganisationId_fkey" FOREIGN KEY ("sharedWithOrganisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "CompCard" SET "privacy" = 'SELF';

-- Part 5: triggers

-- D84: every writer of a staff Membership row passes here, whatever code writes
-- it (people management, the ADMIN_EMAILS grant, demo sign-in, the seed).
CREATE OR REPLACE FUNCTION "record_staff_history"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "StaffHistory" ("userId", "projectId", "firstAt", "firstRole", "source")
  VALUES (NEW."userId", NEW."projectId", now(), NEW."role", 'trigger')
  ON CONFLICT ("userId", "projectId") DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS "Membership_record_staff_history" ON "Membership";
CREATE TRIGGER "Membership_record_staff_history"
  AFTER INSERT OR UPDATE OF "role" ON "Membership"
  FOR EACH ROW WHEN (NEW."role" <> 'LEARNER')
  EXECUTE FUNCTION "record_staff_history"();
-- (CREATE TRIGGER holds SHARE ROW EXCLUSIVE on Membership: no new Membership row
-- can be written from here to the end of the file.)

-- D101: any change of a person's organisation unshares their Comp Card, whatever
-- code (or person) writes it. Backs up setPersonOrganisation.
CREATE OR REPLACE FUNCTION "unshare_comp_card_on_organisation_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "CompCard"
     SET "privacy" = 'SELF', "sharedAt" = NULL, "sharedWithOrganisationId" = NULL
   WHERE "userId" = NEW."userId" AND "projectId" = NEW."projectId"
     AND ("sharedAt" IS NOT NULL OR "privacy" <> 'SELF');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS "ProjectProfile_unshare_on_organisation_change" ON "ProjectProfile";
CREATE TRIGGER "ProjectProfile_unshare_on_organisation_change"
  AFTER UPDATE OF "organisationId" ON "ProjectProfile"
  FOR EACH ROW WHEN (OLD."organisationId" IS DISTINCT FROM NEW."organisationId")
  EXECUTE FUNCTION "unshare_comp_card_on_organisation_change"();

-- Part 6: the Membership-based backfills (Part 2, 1 and 2a) once more. Rows
-- Release 2 wrote while Part 2 ran are caught here; after Part 5 none can be
-- written.

INSERT INTO "ProjectProfile" ("id", "userId", "projectId", "organisationId", "organisationSource", "updatedAt")
SELECT
  'pp-' || md5(m."userId" || ':' || m."projectId"),
  m."userId",
  m."projectId",
  CASE WHEN bool_and(m."role" = 'LEARNER') AND count(DISTINCT m."organisationId") = 1
       THEN min(m."organisationId") END,
  CASE WHEN bool_and(m."role" = 'LEARNER') AND count(DISTINCT m."organisationId") = 1
       THEN 'backfill' END,
  CURRENT_TIMESTAMP
FROM "Membership" m
WHERE m."projectId" = 'seq-elevate'
GROUP BY m."userId", m."projectId"
ON CONFLICT ("userId", "projectId") DO NOTHING;

INSERT INTO "StaffHistory" ("userId", "projectId", "firstAt", "firstRole", "source")
SELECT DISTINCT ON (m."userId", m."projectId")
  m."userId", m."projectId", m."createdAt", m."role", 'membership'
FROM "Membership" m
WHERE m."role" <> 'LEARNER'
ORDER BY m."userId", m."projectId", m."createdAt", m."role"
ON CONFLICT ("userId", "projectId") DO NOTHING;

-- Part 7, last: the notes' author keys again, now ON DELETE SET NULL (D89).
-- Dropping a foreign key locks the table it refers to, User, exclusively: from
-- here to COMMIT every signed-in request waits (it reads User), so only COMMIT
-- follows.
ALTER TABLE "Observation" DROP CONSTRAINT "Observation_observerId_fkey";
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_observerId_fkey" FOREIGN KEY ("observerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Validation" DROP CONSTRAINT "Validation_validatorId_fkey";
ALTER TABLE "Validation" ADD CONSTRAINT "Validation_validatorId_fkey" FOREIGN KEY ("validatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
