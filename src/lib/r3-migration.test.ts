import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Release 3's migrations (spec 2.2–2.4) run while the Release 2 deployment is
// still serving (vercel-build migrates before it builds). They stay safe only
// while they are what they were reviewed as: one enum value on its own; then,
// in one transaction (BEGIN to COMMIT: Prisma applies a file's statements one
// by one, each committing on its own otherwise), new types and tables, the
// backfills, and only then the statements that lock tables Release 2 uses,
// in an order that can't deadlock with its writes (checked below against
// each of them), the two triggers, a repeat of the Membership-based
// backfills, and last the one lock on User; then two new columns, each a
// statement and a transaction of its own; then two more triggers, each
// statement a transaction of its own.
//
// Each file's normalised text is pinned (a hash, and its statements' first
// lines in order, so a change shows where it is). A deliberate change
// updates both here, after the same review.

const root = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS = "prisma/migrations";
const A = `${MIGRATIONS}/20261120090000_r3_role_partner_admin/migration.sql`;
const B = `${MIGRATIONS}/20261120090100_r3_people_privacy_content/migration.sql`;
const C = `${MIGRATIONS}/20261120090200_r3_course_project_columns/migration.sql`;
const D = `${MIGRATIONS}/20261120090300_r3_sharing_and_guardian_triggers/migration.sql`;
const read = (file: string) => readFileSync(`${root}${file}`, "utf8");

/** The SQL with comments left out and every run of whitespace one space. */
const normalised = (sql: string) =>
  sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The statements of a normalised file, in order. A function body between
 * `$$` holds semicolons of its own, so it is kept whole.
 */
function statements(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  let inBody = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql.startsWith("$$", i)) {
      inBody = !inBody;
      current += "$$";
      i++;
      continue;
    }
    if (sql[i] === ";" && !inBody) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += sql[i];
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** The body of one Prisma model or enum. */
function block(kind: "model" | "enum", name: string): string {
  const match = new RegExp(`${kind} ${name} \\{([\\s\\S]*?)\\n\\}`).exec(read("prisma/schema.prisma"));
  if (!match) throw new Error(`${kind} ${name} not found`);
  return match[1];
}

/** The field line of `field` in `model`, comments left out, whitespace collapsed. */
function field(model: string, name: string): string {
  const line = block("model", model)
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim().replace(/\s+/g, " "))
    .find((l) => l.startsWith(`${name} `));
  if (!line) throw new Error(`${model}.${name} not found`);
  return line;
}

/** Tables that exist before Release 3: every CREATE TABLE of an earlier migration. */
function existingTables(): Set<string> {
  const tables = new Set<string>();
  for (const dir of readdirSync(`${root}${MIGRATIONS}`)) {
    if (dir >= "20261120090000" || !existsSync(`${root}${MIGRATIONS}/${dir}/migration.sql`)) continue;
    for (const m of read(`${MIGRATIONS}/${dir}/migration.sql`).matchAll(/CREATE TABLE "(\w+)"/g)) {
      tables.add(m[1]);
    }
  }
  return tables;
}

/**
 * The audit actions a learner can cause: every action literal written in the
 * files a learner can call (spec 2.4, item 2), read when the test runs.
 */
const LEARNER_CALLABLE = [
  "src/app/actions/learner.ts",
  "src/app/actions/telemetry.ts",
  "src/app/actions/video.ts",
  "src/app/actions/gdpr.ts",
  "src/app/actions/a11y.ts",
  "src/app/actions/profile.ts",
  "src/app/api/me/export/route.ts",
  // The records of a person's own erasure and export (gdpr.ts and the
  // export route write them through it); the admin actions write their own
  // rows in admin-data.ts.
  "src/lib/account-data.ts",
];
/** Release 3's own learner actions, named by the spec before their code exists. */
const RELEASE_3_LEARNER_ACTIONS = ["profile.completed", "compcard.sharing_changed"];
/**
 * Release 3's learner actions that migration B's list doesn't name: no row
 * of them can exist when its backfill runs (it runs before any Release 3
 * code), so leaving them out of the list changes nothing. Each with why it
 * is learner-caused.
 */
const AFTER_MIGRATION_B: Record<string, string> = {
  // completeProfile, when the country a learner picks doesn't match a
  // partner admin's organisation (spec 5.4 (c)).
  "profile.organisation_released": "the learner's own profile step",
};

function learnerActionLiterals(): Set<string> {
  const found = new Set<string>();
  for (const file of LEARNER_CALLABLE) {
    if (!existsSync(`${root}${file}`)) continue;
    for (const m of read(file).matchAll(/\baction:\s*["'`]([a-z0-9_.-]+)["'`]/g)) found.add(m[1]);
  }
  return found;
}

const EXPECTED_A = `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PARTNER_ADMIN';`;

/** The first words of each statement of migration B, in order. */
const SHAPE_B = [
  "BEGIN",
  "SET LOCAL lock_timeout = '5s'",
  'CREATE TYPE "Country"',
  'CREATE TYPE "AgeRule"',
  'CREATE TABLE "ProjectProfile"',
  'CREATE UNIQUE INDEX "ProjectProfile_userId_projectId_key"',
  'CREATE INDEX "ProjectProfile_projectId_organisationId_idx"',
  'CREATE TABLE "CountryMapping"',
  'CREATE TABLE "StaffHistory"',
  'CREATE TABLE "PendingFileDeletion"',
  'INSERT INTO "ProjectProfile"',
  'INSERT INTO "StaffHistory"',
  'INSERT INTO "StaffHistory"',
  'INSERT INTO "StaffHistory"',
  'INSERT INTO "StaffHistory"',
  'INSERT INTO "CountryMapping"',
  'ALTER TABLE "ProjectProfile" ADD CONSTRAINT "ProjectProfile_userId_fkey"',
  'ALTER TABLE "ProjectProfile" ADD CONSTRAINT "ProjectProfile_projectId_fkey"',
  'ALTER TABLE "ProjectProfile" ADD CONSTRAINT "ProjectProfile_organisationId_fkey"',
  'ALTER TABLE "CountryMapping" ADD CONSTRAINT "CountryMapping_projectId_fkey"',
  'ALTER TABLE "CountryMapping" ADD CONSTRAINT "CountryMapping_organisationId_fkey"',
  'ALTER TABLE "StaffHistory" ADD CONSTRAINT "StaffHistory_userId_fkey"',
  'ALTER TABLE "StaffHistory" ADD CONSTRAINT "StaffHistory_projectId_fkey"',
  'ALTER TABLE "Observation" ALTER COLUMN "observerId" DROP NOT NULL',
  'ALTER TABLE "Validation" ALTER COLUMN "validatorId" DROP NOT NULL',
  'ALTER TABLE "CompCard" ALTER COLUMN "privacy" SET DEFAULT',
  'ALTER TABLE "CompCard" ADD COLUMN IF NOT EXISTS "sharedAt"',
  'ALTER TABLE "CompCard" ADD COLUMN IF NOT EXISTS "sharedWithOrganisationId"',
  'ALTER TABLE "CompCard" ADD COLUMN IF NOT EXISTS "sharingVersion"',
  'ALTER TABLE "CompCard" ADD CONSTRAINT "CompCard_sharedWithOrganisationId_fkey"',
  'UPDATE "CompCard" SET "privacy" = \'SELF\'',
  'CREATE OR REPLACE FUNCTION "record_staff_history"()',
  'DROP TRIGGER IF EXISTS "Membership_record_staff_history"',
  'CREATE TRIGGER "Membership_record_staff_history"',
  'CREATE OR REPLACE FUNCTION "unshare_comp_card_on_organisation_change"()',
  'DROP TRIGGER IF EXISTS "ProjectProfile_unshare_on_organisation_change"',
  'CREATE TRIGGER "ProjectProfile_unshare_on_organisation_change"',
  'INSERT INTO "ProjectProfile"',
  'INSERT INTO "StaffHistory"',
  'ALTER TABLE "Observation" DROP CONSTRAINT "Observation_observerId_fkey"',
  'ALTER TABLE "Observation" ADD CONSTRAINT "Observation_observerId_fkey"',
  'ALTER TABLE "Validation" DROP CONSTRAINT "Validation_validatorId_fkey"',
  'ALTER TABLE "Validation" ADD CONSTRAINT "Validation_validatorId_fkey"',
  "COMMIT",
];
const SHA256_B = "c48e69858e043a0161926ca87227b69a6a4b00395c907d8ee5ec0b5cce598cc3";
/** Migration C, word for word: a lock timeout, then each new column in a statement of its own. */
const EXPECTED_C = [
  "SET lock_timeout = '5s'",
  'ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "safeguarding" JSONB',
  'ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "readyLocales" TEXT[] DEFAULT ARRAY[]::TEXT[]',
];
/**
 * Migration D, word for word: a lock timeout, then two triggers, each made
 * by statements that each lock one table at most and can run again.
 * - A card whose privacy is written as anything but FACILITATOR is no
 *   longer shared (D80): Release 2's save writes privacy alone, so after a
 *   rollback its "Only me" followed by an older tab's "facilitator" would
 *   otherwise find the card's sharing columns still set.
 * - A move away from an organisation clears that organisation's record of a
 *   guardian's permission, whatever writes the move (setPersonOrganisation
 *   does the same).
 */
const EXPECTED_D = [
  "SET lock_timeout = '5s'",
  'CREATE OR REPLACE FUNCTION "unshare_comp_card_on_privacy_change"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW."sharedAt" := NULL; NEW."sharedWithOrganisationId" := NULL; RETURN NEW; END; $$',
  'DROP TRIGGER IF EXISTS "CompCard_unshare_on_privacy_change" ON "CompCard"',
  'CREATE TRIGGER "CompCard_unshare_on_privacy_change" BEFORE UPDATE OF "privacy" ON "CompCard" FOR EACH ROW WHEN (NEW."privacy" <> \'FACILITATOR\') EXECUTE FUNCTION "unshare_comp_card_on_privacy_change"()',
  'CREATE OR REPLACE FUNCTION "clear_guardian_permission_on_move"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW."guardianConsentRecordedAt" := NULL; NEW."guardianSharingConsentAt" := NULL; RETURN NEW; END; $$',
  'DROP TRIGGER IF EXISTS "ProjectProfile_clear_guardian_permission_on_move" ON "ProjectProfile"',
  'CREATE TRIGGER "ProjectProfile_clear_guardian_permission_on_move" BEFORE UPDATE OF "organisationId" ON "ProjectProfile" FOR EACH ROW WHEN (OLD."organisationId" IS NOT NULL AND OLD."organisationId" IS DISTINCT FROM NEW."organisationId") EXECUTE FUNCTION "clear_guardian_permission_on_move"()',
];

describe("the Release 3 migrations", () => {
  const b = statements(normalised(read(B)));
  const index = (start: string, from = 0) => b.findIndex((s, i) => i >= from && s.startsWith(start));

  it("sort after every earlier migration", () => {
    const dirs = readdirSync(`${root}${MIGRATIONS}`).filter((d) => /^\d{14}_/.test(d)).sort();
    expect(dirs.slice(-4)).toEqual([
      "20261120090000_r3_role_partner_admin",
      "20261120090100_r3_people_privacy_content",
      "20261120090200_r3_course_project_columns",
      "20261120090300_r3_sharing_and_guardian_triggers",
    ]);
  });

  it("A adds the partner admin role on its own, and nothing else", () => {
    expect(normalised(read(A))).toBe(EXPECTED_A);
  });

  it("B is pinned: its statements, in order, and its whole text", () => {
    expect(b.map((s) => SHAPE_B.find((start) => s.startsWith(start)) ?? s.slice(0, 80))).toEqual(SHAPE_B);
    expect(sha256(normalised(read(B)))).toBe(SHA256_B);
  });

  it("is one transaction that sets its lock timeout first and commits last", () => {
    expect(b[0]).toBe("BEGIN");
    expect(b[1]).toBe("SET LOCAL lock_timeout = '5s'");
    expect(b[b.length - 1]).toBe("COMMIT");
    expect(b.filter((s) => /^(BEGIN|COMMIT|ROLLBACK|END|START TRANSACTION)\b/.test(s))).toEqual(["BEGIN", "COMMIT"]);
  });

  it("changes no table Release 2 uses, and adds no foreign key, before the last backfill of Part 2", () => {
    const lastBackfill = index('INSERT INTO "CountryMapping"');
    expect(lastBackfill).toBeGreaterThan(0);
    const existing = existingTables();
    expect(existing.has("CompCard") && existing.has("Membership")).toBe(true);
    b.forEach((s, i) => {
      const altered = /^(ALTER TABLE|UPDATE|CREATE TRIGGER|DROP TRIGGER IF EXISTS) "?(\w+)"?/.exec(s);
      const onTable = /\bON "(\w+)"/.exec(s);
      const table = s.startsWith("ALTER TABLE") || s.startsWith("UPDATE") ? altered?.[2] : onTable?.[1];
      if (s.startsWith("ALTER TABLE") || (table && existing.has(table) && !s.startsWith("INSERT"))) {
        expect(i, s.slice(0, 80)).toBeGreaterThan(lastBackfill);
      }
    });
  });

  it("locks Release 2's tables only after the new tables' foreign keys, and repeats the backfills after the trigger", () => {
    const firstExisting = index('ALTER TABLE "Observation"');
    const lastNewKey = index('ALTER TABLE "StaffHistory" ADD CONSTRAINT "StaffHistory_projectId_fkey"');
    const membershipTrigger = index('CREATE TRIGGER "Membership_record_staff_history"');
    expect(lastNewKey).toBeLessThan(firstExisting);
    expect(index('ALTER TABLE "CompCard"')).toBeLessThan(membershipTrigger);
    // Part 6 repeats the Membership-based backfills after the trigger, so no row
    // Release 2 wrote while Part 2 ran is missed.
    expect(index('INSERT INTO "ProjectProfile"', membershipTrigger)).toBeGreaterThan(membershipTrigger);
    expect(index('INSERT INTO "StaffHistory"', membershipTrigger)).toBeGreaterThan(membershipTrigger);
    // Neither Project nor Course: their columns are C's.
    expect(b.filter((s) => /^ALTER TABLE "(Project|Course)"/.test(s))).toEqual([]);
  });

  it("repeats Part 2's profile and membership backfills word for word in Part 6", () => {
    const trigger = index('CREATE TRIGGER "Membership_record_staff_history"');
    expect(b[index('INSERT INTO "ProjectProfile"', trigger)]).toBe(b[index('INSERT INTO "ProjectProfile"')]);
    expect(b[index('INSERT INTO "StaffHistory"', trigger)]).toBe(b[index('INSERT INTO "StaffHistory"')]);
  });

  it("supplies id and updatedAt where the table has no database default, and never overwrites", () => {
    const profiles = b.filter((s) => s.startsWith('INSERT INTO "ProjectProfile"'));
    expect(profiles).toHaveLength(2);
    for (const s of profiles) {
      expect(s).toContain('("id", "userId", "projectId", "organisationId", "organisationSource", "updatedAt")');
      expect(s).toContain("'pp-' || md5(m.\"userId\" || ':' || m.\"projectId\")");
      expect(s).toContain("CURRENT_TIMESTAMP");
    }
    expect(b[index('INSERT INTO "CountryMapping"')]).toContain('"updatedAt"');
    for (const s of b.filter((s) => s.startsWith("INSERT INTO"))) {
      expect(s).toMatch(/ON CONFLICT .*DO NOTHING$/);
    }
  });

  it("gives a staff member no organisation from the backfill, and a learner one only when the rows agree", () => {
    const profile = b[index('INSERT INTO "ProjectProfile"')];
    expect(profile).toContain(
      "CASE WHEN bool_and(m.\"role\" = 'LEARNER') AND count(DISTINCT m.\"organisationId\") = 1 THEN min(m.\"organisationId\") END"
    );
    expect(profile).toContain("THEN 'backfill' END");
    expect(profile).toContain("WHERE m.\"projectId\" = 'seq-elevate'");
  });

  it("leaves out of the staff history exactly the audit actions a learner can cause", () => {
    const audit = b.find((s) => s.includes("'audit'"));
    const list = /"action" NOT IN \(([^)]*)\)/.exec(audit ?? "")?.[1] ?? "";
    const inMigration = new Set([...list.matchAll(/'([^']+)'/g)].map((m) => m[1]));
    const inCode = new Set([...learnerActionLiterals(), ...RELEASE_3_LEARNER_ACTIONS]);
    for (const action of Object.keys(AFTER_MIGRATION_B)) {
      expect(inMigration.has(action), `${action} is in the migration's list`).toBe(false);
      inCode.delete(action);
    }
    expect([...inMigration].sort()).toEqual([...inCode].sort());
    // The files were found and read: today's learner actions are among them.
    for (const action of ["course.opened", "stage.time", "video.cue_answered", "account.exported", "account.deleted"]) {
      expect(learnerActionLiterals().has(action), action).toBe(true);
    }
  });

  it("records the staff demo profiles, old and new addresses, but not the demo learner", () => {
    const demo = b.find((s) => s.includes("'demo-profile'")) ?? "";
    for (const email of ["stefan@senic.org", "demo-admin@seq-elevate.eu", "demo123@seq-elevate.eu", "demo321@seq-elevate.eu"]) {
      expect(demo).toContain(`'${email}'`);
    }
    expect(demo).not.toContain("demo-learner");
  });

  it("maps countries only to the organisations the seed makes", () => {
    const mapping = b[index('INSERT INTO "CountryMapping"')];
    for (const pair of [
      "('DE', 'seq-elevate-proarbeit')",
      "('CY', 'seq-elevate-synthesis')",
      "('GR', 'seq-elevate-uom')",
      "('BE', 'seq-elevate-diesis')",
      "('OTHER', 'seq-elevate-diesis')",
    ]) {
      expect(mapping).toContain(pair);
    }
    expect(mapping).toContain('JOIN "Organisation" o ON o."id" = v."organisationId"');
  });

  it("records staff history for every staff membership write, and unshares a card on any organisation change", () => {
    const staff = b[index('CREATE TRIGGER "Membership_record_staff_history"')];
    expect(staff).toBe(
      'CREATE TRIGGER "Membership_record_staff_history" AFTER INSERT OR UPDATE OF "role" ON "Membership" ' +
        "FOR EACH ROW WHEN (NEW.\"role\" <> 'LEARNER') EXECUTE FUNCTION \"record_staff_history\"()"
    );
    const unshare = b[index('CREATE TRIGGER "ProjectProfile_unshare_on_organisation_change"')];
    expect(unshare).toBe(
      'CREATE TRIGGER "ProjectProfile_unshare_on_organisation_change" AFTER UPDATE OF "organisationId" ON "ProjectProfile" ' +
        'FOR EACH ROW WHEN (OLD."organisationId" IS DISTINCT FROM NEW."organisationId") ' +
        'EXECUTE FUNCTION "unshare_comp_card_on_organisation_change"()'
    );
    expect(b[index('CREATE OR REPLACE FUNCTION "unshare_comp_card_on_organisation_change"()')]).toContain(
      'SET "privacy" = \'SELF\', "sharedAt" = NULL, "sharedWithOrganisationId" = NULL'
    );
  });

  it("C adds the two columns, each a statement and a transaction of its own, after B", () => {
    const c = statements(normalised(read(C)));
    expect(c).toEqual(EXPECTED_C);
    // No BEGIN: each statement commits on its own and locks one table.
    for (const s of c.slice(1)) expect(locksOf(s)).toHaveLength(1);
    // readyLocales as Prisma generates it, so migrate finds no drift.
    expect(c).toContain('ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "readyLocales" TEXT[] DEFAULT ARRAY[]::TEXT[]');
  });

  it("D adds the two triggers, each statement a transaction of its own that locks one table at most, after C", () => {
    const d = statements(normalised(read(D)));
    expect(d).toEqual(EXPECTED_D);
    // No BEGIN: a failure leaves at most a function or a trigger made, and
    // every statement runs again on a retry.
    for (const s of d) expect(locksOf(s).length).toBeLessThanOrEqual(1);
    expect(deadlocks(d)).toEqual([]);
  });
});

/*
 * Locks (spec 2.3, 2.7). Release 2 keeps writing while the build migrates,
 * and a transaction holds every lock it takes until it ends. A write that
 * holds one lock and waits for another that the migration holds, while the
 * migration waits for the first, is a deadlock: Postgres aborts one of the
 * two, the write or the migration (and with it the deploy). It can't happen
 * when, of the locks a write takes that the migration conflicts with, the
 * one the migration takes first is the one the write takes first: the write
 * then either finishes before the migration gets there, or waits there
 * holding nothing the migration needs.
 */

type Mode = "AS" | "RS" | "RE" | "SUE" | "S" | "SRE" | "E" | "AE";
/** Postgres's table lock modes, and which each conflicts with. */
const CONFLICTS: Record<Mode, readonly Mode[]> = {
  AS: ["AE"],
  RS: ["E", "AE"],
  RE: ["S", "SRE", "E", "AE"],
  SUE: ["SUE", "S", "SRE", "E", "AE"],
  S: ["RE", "SUE", "SRE", "E", "AE"],
  SRE: ["RE", "SUE", "S", "SRE", "E", "AE"],
  E: ["RS", "RE", "SUE", "S", "SRE", "E", "AE"],
  AE: ["AS", "RS", "RE", "SUE", "S", "SRE", "E", "AE"],
};

/**
 * Release 2's writes while the build migrates: the tables each locks, in
 * the order it locks them. An insert locks its table, then each table its
 * foreign keys refer to, in the order a database built by the migrations
 * checks them (the order they were created; production's was built so).
 */
const RELEASE_2_WRITES: Record<string, [string, Mode][]> = {
  "a membership (ensureLearnerMembership, a sign-in grant, addMember)": [
    ["Membership", "RE"], ["User", "RS"], ["Project", "RS"], ["Organisation", "RS"], ["Cohort", "RS"],
  ],
  "a note (saveObservation)": [["Observation", "RE"], ["User", "RS"], ["CompCard", "RS"]],
  "a validation (recordValidation)": [["Validation", "RE"], ["User", "RS"], ["CompCard", "RS"]],
  "a first enrolment": [["CourseEnrollment", "RE"], ["User", "RS"], ["Course", "RS"]],
  "a learner's save (saveProgress: the course row first, a missing badge, the enrolment, the badge)": [
    ["Course", "RS"], ["Badge", "RE"], ["Project", "RS"], ["Course", "RE"], ["CourseEnrollment", "RS"],
    ["CourseEnrollment", "RE"], ["User", "RS"], ["Course", "RS"], ["UserBadge", "RE"], ["User", "RS"], ["Badge", "RS"],
  ],
  "a Comp Card save (saveCompCard)": [["CompCard", "RE"], ["User", "RS"], ["Project", "RS"]],
  "an audit row (every audited action, telemetry)": [["AuditLog", "RE"], ["Project", "RS"], ["User", "RS"]],
  "an editor's change (the course row locked, its learners counted, the change audited)": [
    ["Course", "RS"], ["Lesson", "RE"], ["Project", "RS"], ["CourseEnrollment", "AS"], ["User", "AS"],
    ["Membership", "AS"], ["Course", "RE"], ["AuditLog", "RE"], ["Project", "RS"], ["User", "RS"],
  ],
  "a badge (awardBadgeAction)": [["UserBadge", "RE"], ["User", "RS"], ["Badge", "RS"]],
  "a sign-in (its session)": [["Session", "RE"], ["User", "RS"]],
  "every signed-in request (the session and its person read)": [["Session", "AS"], ["User", "AS"]],
  "a sign-up, a reading-help setting, a rename": [["User", "RE"]],
  "an account deleted, its rows with it": [
    ["User", "RE"], ["Membership", "RE"], ["Account", "RE"], ["Session", "RE"], ["CourseEnrollment", "RE"],
    ["CompCard", "RE"], ["UserBadge", "RE"], ["MissionProgress", "RE"], ["Observation", "RE"], ["Validation", "RE"],
    ["AuditLog", "RE"],
  ],
  "an organisation added or deleted (its cohorts and memberships with it)": [
    ["Organisation", "RE"], ["Project", "RS"], ["Cohort", "RE"], ["Membership", "RE"],
  ],
  "a cohort": [["Cohort", "RE"], ["Project", "RS"], ["Organisation", "RS"]],
  "a role changed or removed (setMemberRoles, removeMember)": [["Membership", "RE"]],
  "the Comp Card template (project.update)": [["Project", "RE"]],
};

/** The table a foreign key refers to, read from the migration that creates it. */
function referencedBy(constraint: string): string {
  for (const dir of readdirSync(`${root}${MIGRATIONS}`)) {
    if (!existsSync(`${root}${MIGRATIONS}/${dir}/migration.sql`)) continue;
    const text = normalised(read(`${MIGRATIONS}/${dir}/migration.sql`));
    const m = new RegExp(`CONSTRAINT "${constraint}" FOREIGN KEY \\([^)]*\\) REFERENCES "(\\w+)"`).exec(text);
    if (m) return m[1];
  }
  throw new Error(`no migration creates ${constraint}`);
}

/**
 * The table locks a statement of the Release 3 migrations takes, as
 * Postgres 16 takes them. A statement this doesn't know fails the test.
 */
function locksOf(s: string): { table: string; mode: Mode }[] {
  let m: RegExpExecArray | null;
  if (/^(BEGIN|COMMIT|SET (LOCAL )?lock_timeout|CREATE TYPE|CREATE OR REPLACE FUNCTION)\b/.test(s)) return [];
  if ((m = /^ALTER TABLE "(\w+)" ADD CONSTRAINT "\w+" FOREIGN KEY \([^)]*\) REFERENCES "(\w+)"/.exec(s))) {
    return [{ table: m[1], mode: "SRE" }, { table: m[2], mode: "SRE" }];
  }
  // Dropping a foreign key drops its triggers on the table it refers to too.
  if ((m = /^ALTER TABLE "(\w+)" DROP CONSTRAINT "(\w+_fkey)"/.exec(s))) {
    return [{ table: m[1], mode: "AE" }, { table: referencedBy(m[2]), mode: "AE" }];
  }
  if ((m = /^ALTER TABLE "(\w+)"/.exec(s))) return [{ table: m[1], mode: "AE" }];
  if ((m = /^CREATE TRIGGER .* ON "(\w+)"/.exec(s))) return [{ table: m[1], mode: "SRE" }];
  // The trigger isn't there yet (it is this file's, and a failed apply leaves
  // nothing): the table is only looked up. ACCESS EXCLUSIVE if it were.
  if ((m = /^DROP TRIGGER IF EXISTS "\w+" ON "(\w+)"/.exec(s))) return [{ table: m[1], mode: "AS" }];
  if ((m = /^UPDATE "(\w+)"/.exec(s))) return [{ table: m[1], mode: "RE" }];
  if ((m = /^INSERT INTO "(\w+)"/.exec(s))) {
    const read = [...s.matchAll(/\b(?:FROM|JOIN) "(\w+)"/g)].map((r) => ({ table: r[1], mode: "AS" as Mode }));
    return [{ table: m[1], mode: "RE" }, ...read];
  }
  if ((m = /^CREATE (?:UNIQUE )?INDEX "\w+" ON "(\w+)"/.exec(s))) return [{ table: m[1], mode: "S" }];
  if ((m = /^CREATE TABLE "(\w+)"/.exec(s))) return [{ table: m[1], mode: "AE" }];
  throw new Error(`the lock model doesn't know this statement: ${s.slice(0, 80)}`);
}

/**
 * For each of Release 2's writes, why the migration's statements could
 * deadlock with it (none: they can't): the lock the write takes first, of
 * those the migration conflicts with, must be the one the migration takes
 * first.
 */
function deadlocks(statements: string[]): string[] {
  const out: string[] = [];
  for (const [write, locks] of Object.entries(RELEASE_2_WRITES)) {
    // The first statement whose lock conflicts with each of the write's locks.
    const at = locks.map(([table, mode]) =>
      statements.findIndex((s) => locksOf(s).some((l) => l.table === table && CONFLICTS[mode].includes(l.mode)))
    );
    const conflicting = locks.map((l, i) => ({ l, at: at[i] })).filter((x) => x.at >= 0);
    if (conflicting.length === 0) continue;
    const first = conflicting[0];
    const earliest = conflicting.reduce((a, x) => (x.at < a.at ? x : a));
    if (earliest.at < first.at) {
      out.push(
        `${write}: it locks ${first.l[0]} before ${earliest.l[0]}, the migration ${earliest.l[0]} ` +
          `("${statements[earliest.at].slice(0, 60)}") before ${first.l[0]} ("${statements[first.at].slice(0, 60)}")`
      );
    }
  }
  return out;
}

describe("the Release 3 migrations' locks, against Release 2's writes", () => {
  const b = statements(normalised(read(B)));

  it("knows what each statement locks", () => {
    expect(() => b.forEach(locksOf)).not.toThrow();
    expect(locksOf('ALTER TABLE "Observation" DROP CONSTRAINT "Observation_observerId_fkey"')).toEqual([
      { table: "Observation", mode: "AE" },
      { table: "User", mode: "AE" },
    ]);
  });

  it("can't deadlock with any of them", () => {
    expect(deadlocks(b)).toEqual([]);
  });

  it("would, with the parent tables locked first", () => {
    // The check itself: a membership locks Membership, then checks User.
    const parentFirst = [
      'ALTER TABLE "Observation" DROP CONSTRAINT "Observation_observerId_fkey"',
      'CREATE TRIGGER "t" AFTER INSERT ON "Membership" FOR EACH ROW EXECUTE FUNCTION "f"()',
    ];
    expect(deadlocks(parentFirst)).toContainEqual(expect.stringMatching(/^a membership .* locks Membership before User/));
  });

  it("holds User, which every signed-in request reads, exclusively only at the very end", () => {
    const firstUser = b.findIndex((s) => locksOf(s).some((l) => l.table === "User" && l.mode === "AE"));
    expect(firstUser).toBeGreaterThan(0);
    expect(b.slice(firstUser).every((s) => /^ALTER TABLE "(Observation|Validation)" (DROP|ADD) CONSTRAINT|^COMMIT$/.test(s))).toBe(true);
  });
});

describe("the Release 3 schema", () => {
  it("adds the role, the two enums and the four tables", () => {
    expect(block("enum", "Role")).toMatch(/^\s*PARTNER_ADMIN\s*$/m);
    expect(block("enum", "Country").replace(/\/\/.*$/gm, "").split(/\s+/).filter(Boolean)).toEqual([
      "DE",
      "CY",
      "BE",
      "GR",
      "OTHER",
    ]);
    expect(block("enum", "AgeRule").split(/\s+/).filter(Boolean)).toEqual([
      "SELF_MIN_AGE",
      "INVITED_WITH_GUARDIAN_CONSENT",
    ]);
    for (const m of ["ProjectProfile", "CountryMapping", "StaffHistory", "PendingFileDeletion"]) {
      expect(() => block("model", m)).not.toThrow();
    }
  });

  it("holds the profile as spec 2.1 says", () => {
    const fields: [string, string][] = [
      ["id", "id String @id @default(cuid())"],
      ["country", "country Country?"],
      ["organisationId", "organisationId String?"],
      ["organisationSource", "organisationSource String?"],
      ["profileCompletedAt", "profileCompletedAt DateTime?"],
      ["termsVersion", "termsVersion String?"],
      ["termsAcceptedAt", "termsAcceptedAt DateTime?"],
      ["ageRule", "ageRule AgeRule?"],
      ["ageConfirmedAt", "ageConfirmedAt DateTime?"],
      ["consentVersion", "consentVersion String?"],
      ["consentAt", "consentAt DateTime?"],
      ["guardianConsentRecordedAt", "guardianConsentRecordedAt DateTime?"],
      ["guardianSharingConsentAt", "guardianSharingConsentAt DateTime?"],
      ["testAccountAt", "testAccountAt DateTime?"],
      ["updatedAt", "updatedAt DateTime @updatedAt"],
      [
        "organisation",
        "organisation Organisation? @relation(fields: [organisationId], references: [id], onDelete: Restrict)",
      ],
      ["user", "user User @relation(fields: [userId], references: [id], onDelete: Cascade)"],
    ];
    for (const [name, line] of fields) expect(field("ProjectProfile", name)).toBe(line);
    expect(block("model", "ProjectProfile")).toContain("@@unique([userId, projectId])");
    expect(block("model", "ProjectProfile")).toContain("@@index([projectId, organisationId])");
  });

  it("keeps a mapping per country and a history per person, with the delete rules of spec 2.1", () => {
    expect(field("CountryMapping", "organisation")).toBe(
      "organisation Organisation @relation(fields: [organisationId], references: [id], onDelete: Restrict)"
    );
    expect(block("model", "CountryMapping")).toContain("@@id([projectId, country])");
    expect(field("StaffHistory", "firstRole")).toBe("firstRole Role?");
    expect(field("StaffHistory", "user")).toBe(
      "user User @relation(fields: [userId], references: [id], onDelete: Cascade)"
    );
    expect(block("model", "StaffHistory")).toContain("@@id([userId, projectId])");
    expect(field("PendingFileDeletion", "url")).toBe("url String @id");
  });

  it("makes a Comp Card private by default, with the three sharing columns", () => {
    expect(field("CompCard", "privacy")).toBe("privacy PrivacyChoice @default(SELF)");
    expect(field("CompCard", "sharedAt")).toBe("sharedAt DateTime?");
    expect(field("CompCard", "sharedWithOrganisationId")).toBe("sharedWithOrganisationId String?");
    expect(field("CompCard", "sharingVersion")).toBe("sharingVersion String?");
    expect(field("CompCard", "sharedWithOrganisation")).toBe(
      "sharedWithOrganisation Organisation? @relation(fields: [sharedWithOrganisationId], references: [id], onDelete: SetNull)"
    );
  });

  it("adds readyLocales, the safeguarding setting, and notes that outlive their author", () => {
    expect(field("Course", "readyLocales")).toBe("readyLocales String[] @default([])");
    expect(field("Project", "safeguarding")).toBe("safeguarding Json?");
    expect(field("Observation", "observerId")).toBe("observerId String?");
    expect(field("Observation", "observer")).toBe(
      'observer User? @relation("ObserverUser", fields: [observerId], references: [id], onDelete: SetNull)'
    );
    expect(field("Validation", "validatorId")).toBe("validatorId String?");
    expect(field("Validation", "validator")).toBe(
      'validator User? @relation("ValidatorUser", fields: [validatorId], references: [id], onDelete: SetNull)'
    );
  });

  it("adds no column to User, so the auth adapter and the session see the same row", () => {
    const columns = block("model", "User")
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, "").trim())
      .filter((l) => /^\w+\s+(String|DateTime|Boolean|Int)\b/.test(l))
      .map((l) => l.split(/\s+/)[0]);
    expect(columns).toEqual([
      "id",
      "email",
      "emailVerified",
      "name",
      "image",
      "fontSize",
      "dyslexic",
      "contrast",
      "lastProjectId",
      "createdAt",
      "updatedAt",
    ]);
  });
});
