/**
 * Release 3 pre-deploy and post-deploy check (spec 2.8). Counts only: it
 * never prints a name, an email or any other personal data.
 *
 *   DATABASE_URL=<the rehearsal branch, or production right after the deploy> npx tsx scripts/r3-check.ts
 *
 * Run after migrate-deploy.mjs. It checks, and fails on:
 *   - migrations B, C and D have finished, and everyone with a membership made
 *     before B started has a profile. A membership made while B ran may
 *     have none: Release 2 keeps writing while the build migrates, and a
 *     membership that waited for B's lock commits after B with the time the
 *     app gave it before the wait. So only memberships from more than a
 *     minute before B started (the app's clock, and a write queued in its
 *     pool) are judged; the others are counted;
 *   - every current staff membership has a staff-history row;
 *   - the four triggers exist, and a smoke test in a transaction that is
 *     rolled back shows them working: a staff membership writes a history
 *     row; an organisation change unshares a Comp Card and clears the old
 *     organisation's record of a guardian's permission; a privacy written as
 *     anything but FACILITATOR unshares a card;
 *   - the Role enum has PARTNER_ADMIN.
 * And prints, without judging (they may legitimately move): memberships made
 * while B ran and since, profiles with an organisation and complete, staff history by
 * source, Comp Cards by privacy and shared, the country mapping, partner
 * admin memberships (must be 0 before any rollback to Release 2), partner
 * staff with an organisation, and demo sessions.
 *
 * Exit code 0 when every check holds, 1 when one fails, 2 when it couldn't
 * run. Imports nothing from the app, so it runs under plain Node.
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const PROJECT = "seq-elevate";
const MIGRATION_B = "20261120090100_r3_people_privacy_content";
const MIGRATION_C = "20261120090200_r3_course_project_columns";
const MIGRATION_D = "20261120090300_r3_sharing_and_guardian_triggers";
const TAG = "[r3-check]";

type Count = { n: number };

/** Thrown to roll the smoke test's transaction back, carrying what it saw. */
class Rollback extends Error {
  constructor(readonly seen: { history: boolean; unshared: boolean; guardianCleared: boolean; privacyUnshared: boolean }) {
    super("rollback");
  }
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(`${TAG} DATABASE_URL is not set — nothing checked.`);
    return 2;
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const failures: string[] = [];
  const check = (ok: boolean, line: string) => {
    console.log(`${TAG} ${ok ? "ok  " : "FAIL"} ${line}`);
    if (!ok) failures.push(line);
  };
  const info = (line: string) => console.log(`${TAG}      ${line}`);
  try {
    // Migrations B, C and D, and when B ran.
    const applied = await prisma.$queryRaw<{ migration_name: string; started_at: Date; finished_at: Date }[]>`
      SELECT migration_name, started_at, finished_at FROM "_prisma_migrations"
      WHERE migration_name IN (${MIGRATION_B}, ${MIGRATION_C}, ${MIGRATION_D}) AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    const b = applied.find((m) => m.migration_name === MIGRATION_B);
    check(!!b, `migration ${MIGRATION_B} applied`);
    check(applied.some((m) => m.migration_name === MIGRATION_C), `migration ${MIGRATION_C} applied`);
    check(applied.some((m) => m.migration_name === MIGRATION_D), `migration ${MIGRATION_D} applied`);
    if (!b) return 1;
    // Judged from a minute before B started: see the header.
    const judgedBefore = new Date(b.started_at.getTime() - 60_000);

    // Profiles.
    const [profileless] = await prisma.$queryRaw<{ before: number; during: number; since: number }[]>`
      SELECT count(DISTINCT m."userId") FILTER (WHERE m."createdAt" < ${judgedBefore})::int AS before,
             count(DISTINCT m."userId") FILTER (WHERE m."createdAt" >= ${judgedBefore} AND m."createdAt" <= ${b.finished_at})::int AS during,
             count(DISTINCT m."userId") FILTER (WHERE m."createdAt" > ${b.finished_at})::int AS since
      FROM "Membership" m
      WHERE m."projectId" = ${PROJECT}
        AND NOT EXISTS (SELECT 1 FROM "ProjectProfile" p WHERE p."userId" = m."userId" AND p."projectId" = m."projectId")`;
    check(profileless.before === 0, `people with a membership from before the migration and no profile: ${profileless.before}`);
    info(
      `people with a membership made while the migration ran and no profile yet: ${profileless.during} (a write that waited for it; from a minute before it started)`
    );
    info(`people with a membership made since the migration and no profile yet: ${profileless.since}`);
    const [profiles] = await prisma.$queryRaw<{ total: number; organisation: number; complete: number; test: number }[]>`
      SELECT count(*)::int AS total,
             count("organisationId")::int AS organisation,
             count("profileCompletedAt")::int AS complete,
             count("testAccountAt")::int AS test
      FROM "ProjectProfile" WHERE "projectId" = ${PROJECT}`;
    info(
      `profiles: ${profiles.total}; with an organisation: ${profiles.organisation}; complete: ${profiles.complete}; marked test accounts: ${profiles.test}`
    );

    // Staff history.
    const sources = await prisma.$queryRaw<{ source: string; n: number }[]>`
      SELECT "source", count(*)::int AS n FROM "StaffHistory" WHERE "projectId" = ${PROJECT}
      GROUP BY "source" ORDER BY "source"`;
    info(`staff history by source: ${sources.map((s) => `${s.source} ${s.n}`).join(", ") || "none"}`);
    const [untraced] = await prisma.$queryRaw<Count[]>`
      SELECT count(DISTINCT m."userId")::int AS n FROM "Membership" m
      WHERE m."role" <> 'LEARNER'
        AND NOT EXISTS (SELECT 1 FROM "StaffHistory" s WHERE s."userId" = m."userId" AND s."projectId" = m."projectId")`;
    check(untraced.n === 0, `current staff without a staff-history row: ${untraced.n}`);

    // Comp Cards.
    const privacy = await prisma.$queryRaw<{ privacy: string; n: number }[]>`
      SELECT "privacy"::text AS privacy, count(*)::int AS n FROM "CompCard" GROUP BY 1 ORDER BY 1`;
    const [shared] = await prisma.$queryRaw<Count[]>`
      SELECT count(*)::int AS n FROM "CompCard" WHERE "sharedAt" IS NOT NULL`;
    info(`Comp Cards by privacy: ${privacy.map((p) => `${p.privacy} ${p.n}`).join(", ") || "none"}; shared (sharedAt set): ${shared.n}`);

    // Country mapping.
    const mapping = await prisma.$queryRaw<{ country: string; organisationId: string }[]>`
      SELECT "country"::text AS country, "organisationId" FROM "CountryMapping"
      WHERE "projectId" = ${PROJECT} ORDER BY 1`;
    const mapped = new Map(mapping.map((m) => [m.country, m.organisationId]));
    info(
      `country mapping: ${["DE", "CY", "BE", "GR", "OTHER"].map((c) => `${c} → ${mapped.get(c) ?? "none"}`).join(", ")}`
    );

    // Triggers.
    const triggers = await prisma.$queryRaw<{ tgname: string }[]>`
      SELECT t.tgname FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgenabled <> 'D' AND (
        (t.tgrelid = '"Membership"'::regclass AND t.tgname = 'Membership_record_staff_history' AND p.proname = 'record_staff_history')
        OR (t.tgrelid = '"ProjectProfile"'::regclass AND t.tgname = 'ProjectProfile_unshare_on_organisation_change'
            AND p.proname = 'unshare_comp_card_on_organisation_change')
        OR (t.tgrelid = '"ProjectProfile"'::regclass AND t.tgname = 'ProjectProfile_clear_guardian_permission_on_move'
            AND p.proname = 'clear_guardian_permission_on_move')
        OR (t.tgrelid = '"CompCard"'::regclass AND t.tgname = 'CompCard_unshare_on_privacy_change'
            AND p.proname = 'unshare_comp_card_on_privacy_change'))`;
    const names = new Set(triggers.map((t) => t.tgname));
    check(names.has("Membership_record_staff_history"), "staff-history trigger on Membership present");
    check(names.has("ProjectProfile_unshare_on_organisation_change"), "unshare trigger on ProjectProfile present");
    check(names.has("ProjectProfile_clear_guardian_permission_on_move"), "guardian-permission trigger on ProjectProfile present");
    check(names.has("CompCard_unshare_on_privacy_change"), "unshare-on-privacy trigger on CompCard present");

    // Smoke test, rolled back: nothing it writes stays. It needs the project.
    const [project] = await prisma.$queryRaw<Count[]>`SELECT count(*)::int AS n FROM "Project" WHERE "id" = ${PROJECT}`;
    check(project.n === 1, `project ${PROJECT} exists`);
    if (project.n === 1) {
      const seen = await smoke(prisma);
      check(seen.history, "smoke: a staff membership wrote a staff-history row (rolled back)");
      check(seen.unshared, "smoke: an organisation change unshared the Comp Card (rolled back)");
      check(seen.guardianCleared, "smoke: a move cleared the organisation's record of a guardian's permission (rolled back)");
      check(seen.privacyUnshared, "smoke: a privacy written as anything but FACILITATOR unshared the Comp Card (rolled back)");
    }

    // Roles.
    const [partnerRole] = await prisma.$queryRaw<Count[]>`
      SELECT count(*)::int AS n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'Role' AND e.enumlabel = 'PARTNER_ADMIN'`;
    check(partnerRole.n === 1, "Role has PARTNER_ADMIN");
    const [partnerAdmins] = await prisma.$queryRaw<Count[]>`
      SELECT count(*)::int AS n FROM "Membership" WHERE "role"::text = 'PARTNER_ADMIN'`;
    info(`PARTNER_ADMIN memberships: ${partnerAdmins.n} (must be 0 before any rollback to Release 2)`);
    const [partnerStaff] = await prisma.$queryRaw<Count[]>`
      SELECT count(DISTINCT m."userId")::int AS n FROM "Membership" m
      JOIN "ProjectProfile" p ON p."userId" = m."userId" AND p."projectId" = m."projectId"
      WHERE m."projectId" = ${PROJECT} AND m."role"::text IN ('FACILITATOR', 'PARTNER_ADMIN')
        AND p."organisationId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "Membership" a WHERE a."userId" = m."userId" AND a."projectId" = m."projectId" AND a."role" = 'ADMIN')`;
    info(`facilitators and partner admins (not ADMIN) with an organisation: ${partnerStaff.n}`);

    // Demo sessions.
    const [demo] = await prisma.$queryRaw<Count[]>`
      SELECT count(*)::int AS n FROM "Session" WHERE "sessionToken" LIKE 'demo-%'`;
    info(`demo sessions: ${demo.n} (0 after the clean-up run)`);

    console.log(`${TAG} ${failures.length === 0 ? "all checks hold" : `${failures.length} check(s) failed`}`);
    return failures.length === 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * In one transaction that is always rolled back: a made-up person gets a
 * staff membership (the history trigger must write a row), a profile in an
 * organisation, with a guardian's permission recorded, and a card shared
 * with it; the organisation then changes (the unshare trigger must put the
 * card back to "Only me", and the guardian trigger clear the record). Then
 * the card is shared again and its privacy alone written "SELF" (the
 * privacy trigger must clear its sharing). Uses an existing organisation of
 * the project, or makes one inside the transaction.
 */
async function smoke(
  prisma: PrismaClient
): Promise<{ history: boolean; unshared: boolean; guardianCleared: boolean; privacyUnshared: boolean }> {
  const id = `r3-check-${randomUUID()}`;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "User" ("id", "email", "updatedAt") VALUES (${id}, ${`${id}@invalid.example`}, now())`;
      await tx.$executeRaw`INSERT INTO "Membership" ("id", "userId", "projectId", "role", "updatedAt")
        VALUES (${id}, ${id}, ${PROJECT}, 'FACILITATOR', now())`;
      const [history] = await tx.$queryRaw<Count[]>`
        SELECT count(*)::int AS n FROM "StaffHistory" WHERE "userId" = ${id} AND "projectId" = ${PROJECT} AND "source" = 'trigger'`;

      const existing = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Organisation" WHERE "projectId" = ${PROJECT} ORDER BY "createdAt" LIMIT 1`;
      let organisationId = existing[0]?.id;
      if (!organisationId) {
        organisationId = id;
        await tx.$executeRaw`INSERT INTO "Organisation" ("id", "projectId", "name", "shortName", "updatedAt")
          VALUES (${id}, ${PROJECT}, 'r3-check', 'r3-check', now())`;
      }
      await tx.$executeRaw`INSERT INTO "ProjectProfile" ("id", "userId", "projectId", "organisationId", "guardianConsentRecordedAt", "guardianSharingConsentAt", "updatedAt")
        VALUES (${id}, ${id}, ${PROJECT}, ${organisationId}, now(), now(), now())`;
      await tx.$executeRaw`INSERT INTO "CompCard" ("id", "userId", "projectId", "privacy", "sharedAt", "sharedWithOrganisationId", "updatedAt")
        VALUES (${id}, ${id}, ${PROJECT}, 'FACILITATOR', now(), ${organisationId}, now())`;
      await tx.$executeRaw`UPDATE "ProjectProfile" SET "organisationId" = NULL WHERE "id" = ${id}`;
      const [card] = await tx.$queryRaw<{ privacy: string; sharedAt: Date | null; sharedWith: string | null }[]>`
        SELECT "privacy"::text AS privacy, "sharedAt", "sharedWithOrganisationId" AS "sharedWith" FROM "CompCard" WHERE "id" = ${id}`;
      const [guardian] = await tx.$queryRaw<{ recorded: Date | null; sharing: Date | null }[]>`
        SELECT "guardianConsentRecordedAt" AS recorded, "guardianSharingConsentAt" AS sharing FROM "ProjectProfile" WHERE "id" = ${id}`;
      await tx.$executeRaw`UPDATE "CompCard" SET "privacy" = 'FACILITATOR', "sharedAt" = now(), "sharedWithOrganisationId" = ${organisationId} WHERE "id" = ${id}`;
      await tx.$executeRaw`UPDATE "CompCard" SET "privacy" = 'SELF' WHERE "id" = ${id}`;
      const [again] = await tx.$queryRaw<{ sharedAt: Date | null; sharedWith: string | null }[]>`
        SELECT "sharedAt", "sharedWithOrganisationId" AS "sharedWith" FROM "CompCard" WHERE "id" = ${id}`;
      throw new Rollback({
        history: history.n === 1,
        unshared: card?.privacy === "SELF" && card.sharedAt === null && card.sharedWith === null,
        guardianCleared: guardian?.recorded === null && guardian.sharing === null,
        privacyUnshared: again?.sharedAt === null && again.sharedWith === null,
      });
    });
  } catch (e) {
    if (e instanceof Rollback) return e.seen;
    throw e;
  }
  throw new Error("the smoke transaction committed");
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    // The error's kind and code only: a message can carry values from the database.
    const { name, code } = error as { name?: string; code?: string };
    console.error(`${TAG} couldn't run: ${name ?? "error"}${code ? ` ${code}` : ""}`);
    process.exit(2);
  });
