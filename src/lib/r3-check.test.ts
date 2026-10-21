import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

/*
 * scripts/r3-check.ts (spec 2.8), run as the owner runs it, against a
 * database migrated by the real migrations. Release 2 keeps writing while
 * migration B applies: a membership it writes then waits for B's lock on
 * Membership and commits after B, with its own earlier time (the app sets
 * createdAt), and B's backfill can't have given it a profile. The check
 * judges only memberships made before B started (a minute's allowance for
 * the app's clock and a queued write); the rest it reports.
 *
 * Needs a database: R3_CHECK_DATABASE_URL=<an EMPTY throwaway database>.
 * Without it the test is skipped (the unit suite never touches a database).
 */

const url = process.env.R3_CHECK_DATABASE_URL;
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function r3Check(): { code: number; output: string } {
  const run = spawnSync(`${ROOT}node_modules/.bin/tsx`, ["scripts/r3-check.ts"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });
  return { code: run.status ?? -1, output: `${run.stdout}${run.stderr}` };
}

describe.skipIf(!url)("r3-check against a migrated database", () => {
  const db = new pg.Client({ connectionString: url });
  let started: Date;
  let finished: Date;

  /** A person with a learner membership made at `at` (stored in UTC, as Prisma stores it), and no profile. */
  const learnerAt = async (id: string, at: Date) => {
    await db.query(`INSERT INTO "User" ("id", "email", "updatedAt") VALUES ($1, $2, now())`, [id, `${id}@invalid.example`]);
    await db.query(
      `INSERT INTO "Membership" ("id", "userId", "projectId", "role", "createdAt", "updatedAt")
       VALUES ($1, $1, 'seq-elevate', 'LEARNER', $2::timestamptz AT TIME ZONE 'UTC', now())`,
      [id, at.toISOString()]
    );
  };

  beforeAll(async () => {
    await db.connect();
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`);
    if (rows[0].n > 0) throw new Error("R3_CHECK_DATABASE_URL must be an empty throwaway database");
    execFileSync(`${ROOT}node_modules/.bin/prisma`, ["migrate", "deploy"], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: url },
      stdio: "ignore",
    });
    await db.query(`INSERT INTO "Project" ("id", "name", "shortName", "primaryColor", "primaryHover", "accentColor", "programme", "updatedAt")
      VALUES ('seq-elevate', 'SEQ', 'SEQ', '#000', '#000', '#000', 'x', now())`);
    const b = await db.query(
      `SELECT started_at, finished_at FROM "_prisma_migrations" WHERE migration_name = '20261120090100_r3_people_privacy_content'`
    );
    started = b.rows[0].started_at;
    finished = b.rows[0].finished_at;
  }, 120_000);

  afterAll(async () => {
    await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`).catch(() => {});
    await db.end();
  });

  it("holds on a freshly migrated database", () => {
    const { code, output } = r3Check();
    expect(output).toContain("all checks hold");
    expect(code).toBe(0);
  }, 60_000);

  it("reports, and doesn't fail on, a membership written while migration B ran", async () => {
    // Its time is between B's start and finish: a write that waited for B.
    await learnerAt("r3-check-during", new Date((started.getTime() + finished.getTime()) / 2));
    const { code, output } = r3Check();
    expect(output).toMatch(/people with a membership made while the migration ran and no profile yet: 1/);
    expect(output).not.toContain("FAIL");
    expect(code).toBe(0);
  }, 60_000);

  it("fails on a membership made before migration B started that has no profile", async () => {
    await learnerAt("r3-check-before", new Date(started.getTime() - 60 * 60 * 1000));
    const { code, output } = r3Check();
    expect(output).toMatch(/FAIL people with a membership from before the migration and no profile: 1/);
    expect(code).toBe(1);
  }, 60_000);
});
