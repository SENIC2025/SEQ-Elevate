/**
 * Release 3's migrations applied while Release 2 keeps writing (spec 2.7,
 * 17.6): the build migrates while the old deployment still serves, so
 * `prisma migrate deploy` must finish, and every Release 2 write must
 * either go through or wait, never be aborted as a deadlock (40P01).
 *
 *   DATABASE_URL=<an EMPTY throwaway database> node scripts/r3-migration-race.mjs [--rounds 3]
 *
 * Each round, on the empty database:
 *   1. applies every migration before Release 3 with `prisma migrate deploy`
 *      (the database is built by migrations, as production's was: that
 *      decides the order in which a row's foreign keys are checked, and
 *      with it the order in which an insert locks the tables it refers to);
 *   2. adds a small world (a project, an organisation, a course, a badge,
 *      a facilitator, a learner with a card, people and sessions);
 *   3. starts Release 2's writers, each on its own connection, in a loop,
 *      with the statements Release 2's code sends: a membership, a note, a
 *      validation, a first enrolment, a learner's save (the course row
 *      locked first, then the enrolment), a Comp Card save, an audit row,
 *      an editor's change (the course locked, learners counted, an audit
 *      row), a badge, a sign-in session, and a session lookup;
 *   4. runs `prisma migrate deploy` for Release 3's migrations meanwhile;
 *   5. stops the writers, and empties the database for the next round.
 *
 * It exits 0 only when every deploy exited 0 and no writer met a deadlock
 * or any other error; it prints what each writer did and how long each
 * deploy took. RACE_MIGRATIONS=<a migrations folder> deploys that folder
 * instead of prisma/migrations (to try a change before it is made).
 *
 * Refuses a database with any table in it: it is for throwaway databases
 * only. Prints no connection string.
 */

import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MIGRATIONS = process.env.RACE_MIGRATIONS ?? join(ROOT, "prisma/migrations");
const FIRST_RELEASE_3 = "20261120090000";
const url = process.env.DATABASE_URL;
const roundsArg = process.argv.indexOf("--rounds");
const ROUNDS = roundsArg > 0 ? Number(process.argv[roundsArg + 1]) : 3;

if (!url) {
  console.error("[race] DATABASE_URL is not set");
  process.exit(2);
}

/** A config for `prisma migrate deploy` over a copy of the migrations (those before Release 3, or all). */
function deployConfig(dir, onlyBefore) {
  const migrations = join(dir, "migrations");
  for (const name of readdirSync(MIGRATIONS)) {
    if (/^\d{14}_/.test(name) && (!onlyBefore || name < onlyBefore)) cpSync(join(MIGRATIONS, name), join(migrations, name), { recursive: true });
  }
  cpSync(join(MIGRATIONS, "migration_lock.toml"), join(migrations, "migration_lock.toml"));
  cpSync(join(ROOT, "prisma/schema.prisma"), join(dir, "schema.prisma"));
  const config = join(dir, "prisma.config.mjs");
  writeFileSync(
    config,
    `export default { schema: ${JSON.stringify(join(dir, "schema.prisma"))}, migrations: { path: ${JSON.stringify(migrations)} }, datasource: { url: process.env.DATABASE_URL } };\n`
  );
  return config;
}

/** `prisma migrate deploy` with `config`: its exit code, output and time. */
function deploy(config) {
  const started = Date.now();
  return new Promise((resolve) => {
    execFile(
      join(ROOT, "node_modules/.bin/prisma"),
      ["migrate", "deploy", "--config", config],
      { cwd: ROOT, env: { ...process.env, DATABASE_URL: url } },
      (error, stdout, stderr) =>
        resolve({ code: error ? (error.code ?? 1) : 0, output: `${stdout}${stderr}`, ms: Date.now() - started })
    );
  });
}

const PEOPLE = 20000;

async function seed(db) {
  await db.query(`
    INSERT INTO "Project" ("id", "name", "shortName", "primaryColor", "primaryHover", "accentColor", "programme", "updatedAt")
      VALUES ('seq-elevate', 'SEQ', 'SEQ', '#000', '#000', '#000', 'x', now());
    INSERT INTO "Organisation" ("id", "projectId", "name", "shortName", "updatedAt")
      VALUES ('seq-elevate-proarbeit', 'seq-elevate', 'PA', 'PA', now());
    INSERT INTO "Badge" ("id", "projectId", "slug", "name", "meaning", "updatedAt")
      VALUES ('race-badge', 'seq-elevate', 'race', 'Race', 'x', now());
    INSERT INTO "Course" ("id", "projectId", "strapiId", "slug", "cluster", "updatedAt", "badgeId")
      VALUES ('race-course', 'seq-elevate', 'race', 'race', 'x', now(), 'race-badge');
    INSERT INTO "User" ("id", "email", "updatedAt")
      SELECT 'race-' || g, 'race-' || g || '@invalid.example', now() FROM generate_series(1, ${PEOPLE}) g;
    INSERT INTO "User" ("id", "email", "updatedAt") VALUES ('race-staff', 'race-staff@invalid.example', now());
    INSERT INTO "Membership" ("id", "userId", "projectId", "role", "updatedAt")
      VALUES ('race-staff', 'race-staff', 'seq-elevate', 'FACILITATOR', now()),
             ('race-learner', 'race-1', 'seq-elevate', 'LEARNER', now());
    INSERT INTO "CompCard" ("id", "userId", "projectId", "updatedAt") VALUES ('race-card', 'race-1', 'seq-elevate', now());
    INSERT INTO "Session" ("id", "sessionToken", "userId", "expires")
      SELECT 'race-' || g, 'race-' || g, 'race-' || g, now() + interval '1 day' FROM generate_series(1, 1000) g;
  `);
}

const someone = () => `race-${2 + Math.floor(Math.random() * (PEOPLE - 1))}`;
const unique = () => `race-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Release 2's writes, each as its code sends it (one statement, or a transaction of several). */
const WRITERS = {
  // ensureLearnerMembership, a sign-in grant, addMember (role-grants.ts, admin.ts).
  membership: (db) =>
    db.query(
      `INSERT INTO "Membership" ("id", "userId", "projectId", "role", "updatedAt") VALUES ($1, $2, 'seq-elevate', 'LEARNER', now())
       ON CONFLICT DO NOTHING`,
      [unique(), someone()]
    ),
  // saveObservation, recordValidation (facilitator.ts).
  note: (db) =>
    db.query(
      `INSERT INTO "Observation" ("id", "observerId", "observedId", "compCardId", "note", "updatedAt")
       VALUES ($1, 'race-staff', 'race-1', 'race-card', 'n', now())`,
      [unique()]
    ),
  validation: (db) =>
    db.query(
      `INSERT INTO "Validation" ("id", "validatorId", "validatedId", "compCardId", "cluster") VALUES ($1, 'race-staff', 'race-1', 'race-card', 'x')`,
      [unique()]
    ),
  // A learner's first enrolment, on its own.
  enrolment: (db) =>
    db.query(
      `INSERT INTO "CourseEnrollment" ("id", "userId", "courseId", "updatedAt") VALUES ($1, $2, 'race-course', now()) ON CONFLICT DO NOTHING`,
      [unique(), someone()]
    ),
  // A learner's save (learner.ts saveProgress): the course row first, then the enrolment, then the badge.
  save: async (db) => {
    const who = someone();
    await db.query("BEGIN");
    try {
      await db.query(`SELECT "id" FROM "Course" WHERE "id" = 'race-course' FOR KEY SHARE`);
      await db.query(`SELECT "id" FROM "CourseEnrollment" WHERE "userId" = $1 AND "courseId" = 'race-course' FOR UPDATE`, [who]);
      await db.query(
        `INSERT INTO "CourseEnrollment" ("id", "userId", "courseId", "updatedAt") VALUES ($1, $2, 'race-course', now()) ON CONFLICT DO NOTHING`,
        [unique(), who]
      );
      await db.query(`INSERT INTO "UserBadge" ("id", "userId", "badgeId") VALUES ($1, $2, 'race-badge') ON CONFLICT DO NOTHING`, [unique(), who]);
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK").catch(() => {});
      throw e;
    }
  },
  // saveCompCard (learner.ts): an upsert of the learner's card.
  card: (db) =>
    db.query(
      `INSERT INTO "CompCard" ("id", "userId", "projectId", "updatedAt", "privacy") VALUES ($1, $2, 'seq-elevate', now(), 'FACILITATOR')
       ON CONFLICT ("userId", "projectId") DO UPDATE SET "wentWell" = 'x', "updatedAt" = now()`,
      [unique(), someone()]
    ),
  // Telemetry and every audited action.
  audit: (db) =>
    db.query(`INSERT INTO "AuditLog" ("id", "projectId", "actorId", "action") VALUES ($1, 'seq-elevate', $2, 'stage.time')`, [unique(), someone()]),
  // An editor's change (course.ts, structure.ts, sections.ts): the course locked,
  // its learners counted by D53's rule, the change audited.
  editor: async (db) => {
    await db.query("BEGIN");
    try {
      await db.query(`SELECT "id" FROM "Course" WHERE "id" = 'race-course' FOR UPDATE`);
      await db.query(
        `SELECT count(*) FROM "CourseEnrollment" e JOIN "User" u ON u."id" = e."userId"
         WHERE e."courseId" = 'race-course' AND NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = u."id" AND m."role" <> 'LEARNER')`
      );
      await db.query(`UPDATE "Course" SET "updatedAt" = now() WHERE "id" = 'race-course'`);
      await db.query(`INSERT INTO "AuditLog" ("id", "projectId", "actorId", "action") VALUES ($1, 'seq-elevate', 'race-staff', 'course.updated')`, [
        unique(),
      ]);
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK").catch(() => {});
      throw e;
    }
  },
  // awardBadgeAction.
  badge: (db) =>
    db.query(`INSERT INTO "UserBadge" ("id", "userId", "badgeId") VALUES ($1, $2, 'race-badge') ON CONFLICT DO NOTHING`, [unique(), someone()]),
  // A sign-in (Auth.js createSession).
  signIn: (db) =>
    db.query(`INSERT INTO "Session" ("id", "sessionToken", "userId", "expires") VALUES ($1, $1, $2, now() + interval '1 day')`, [
      unique(),
      someone(),
    ]),
  // Every signed-in request (Auth.js getSessionAndUser).
  lookup: (db) =>
    db.query(
      `SELECT s."id", u."email" FROM "Session" s JOIN "User" u ON u."id" = s."userId" WHERE s."sessionToken" = $1`,
      [`race-${1 + Math.floor(Math.random() * 1000)}`]
    ),
};

async function round(n) {
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`);
  if (rows[0].n > 0) {
    await db.end();
    throw new Error("the database isn't empty: this runs on an empty throwaway database only");
  }
  const work = mkdtempSync(join(process.env.RACE_TMP ?? tmpdir(), "r3-race-"));
  try {
    const before = await deploy(deployConfig(join(work, "before"), FIRST_RELEASE_3));
    if (before.code !== 0) throw new Error(`the migrations before Release 3 didn't apply:\n${before.output}`);
    await seed(db);

    let stop = false;
    const tally = {};
    const loops = Object.entries(WRITERS).map(async ([name, write]) => {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      const t = (tally[name] = { ok: 0, deadlock: 0, other: {} });
      while (!stop) {
        try {
          await write(c);
          t.ok++;
        } catch (e) {
          if (e.code === "40P01") t.deadlock++;
          else t.other[e.code ?? e.message] = (t.other[e.code ?? e.message] ?? 0) + 1;
        }
      }
      await c.end();
    });
    await new Promise((r) => setTimeout(r, 1500));
    const release3 = await deploy(deployConfig(join(work, "all"), null));
    await new Promise((r) => setTimeout(r, 1000));
    stop = true;
    await Promise.all(loops);

    const deadlocks = Object.values(tally).reduce((s, t) => s + t.deadlock, 0);
    const others = Object.values(tally).reduce((s, t) => s + Object.values(t.other).reduce((a, b) => a + b, 0), 0);
    console.log(`[race] round ${n}: deploy exit ${release3.code} in ${release3.ms} ms; writer deadlocks ${deadlocks}, other errors ${others}`);
    for (const [name, t] of Object.entries(tally)) {
      const other = Object.entries(t.other).map(([k, v]) => `${k}×${v}`).join(" ");
      console.log(`[race]   ${name.padEnd(10)} ok ${String(t.ok).padStart(6)}  deadlock ${t.deadlock}${other ? `  other ${other}` : ""}`);
    }
    if (release3.code !== 0) console.log(release3.output.split("\n").filter((l) => /error|deadlock|P30|aborted/i.test(l)).map((l) => `[race]   | ${l}`).join("\n"));
    return release3.code === 0 && deadlocks === 0 && others === 0;
  } finally {
    // Empty the database for the next round.
    await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`).catch(() => {});
    await db.end();
    rmSync(work, { recursive: true, force: true });
  }
}

let passed = 0;
for (let n = 1; n <= ROUNDS; n++) if (await round(n)) passed++;
console.log(`[race] ${passed} of ${ROUNDS} rounds clean`);
process.exit(passed === ROUNDS ? 0 : 1);
