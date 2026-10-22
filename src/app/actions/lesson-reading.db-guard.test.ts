import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

/*
 * Release 4's real-database tests work only on an EMPTY throwaway database,
 * and a database they refuse stays exactly as it was: they drop only the
 * schema of a database they found empty and filled themselves. This runs
 * each of them, as a developer would, against a database that already
 * holds a table, and checks the table and its row are still there.
 *
 * Needs a database: R4_GUARD_DATABASE_URL=<a throwaway database>. The test
 * adds one table of its own to it and drops that table again. Without the
 * variable the test is skipped (the unit suite never touches a database).
 */

const url = process.env.R4_GUARD_DATABASE_URL;
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Each real-database test of Release 4's Part B, and the variable that names its database. */
const DATABASE_TESTS = [
  { file: "src/app/actions/lesson-reading.db.test.ts", variable: "R4_READING_DATABASE_URL" },
  { file: "src/lib/r4-check.test.ts", variable: "R4_CHECK_DATABASE_URL" },
];

describe.skipIf(!url)("a real-database test leaves a database it refuses as it was", () => {
  for (const { file, variable } of DATABASE_TESTS) {
    it(file, async () => {
      const db = new pg.Client({ connectionString: url });
      const table = `r4_guard_${process.pid}_${Date.now()}`;
      await db.connect();
      try {
        await db.query(`CREATE TABLE "${table}" ("n" int)`);
        await db.query(`INSERT INTO "${table}" VALUES (1)`);
        const run = spawnSync(`${ROOT}node_modules/.bin/vitest`, ["run", file], {
          cwd: ROOT,
          env: { ...process.env, [variable]: url },
          encoding: "utf8",
        });
        // Refused, by name.
        expect(`${run.stdout}${run.stderr}`).toContain("must be an empty throwaway database");
        expect(run.status).not.toBe(0);
        // And left as it was.
        const kept = await db.query(`SELECT to_regclass($1) IS NOT NULL AS kept`, [`public."${table}"`]);
        expect(kept.rows[0].kept, "the database's own table is still there").toBe(true);
        expect((await db.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n).toBe(1);
      } finally {
        await db.query(`DROP TABLE IF EXISTS "${table}"`).catch(() => {});
        await db.end();
      }
    }, 120_000);
  }
});
