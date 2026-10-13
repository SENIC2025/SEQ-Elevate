/**
 * Gives every course created in the CMS its badge, on every deploy (C9).
 * Wired into the `vercel-build` npm script, right after migrate-deploy.mjs.
 *
 * The migration 20261013120000_created_course_badges did this once. But the
 * migration runs at the start of the build, and the old deployment keeps
 * serving until the new one is promoted (longer if `next build` fails), so
 * a course the old code creates in that window got no badge, and Prisma
 * never runs an applied migration again. This runs the same three steps on
 * every deploy, so such a course has its badge by the next deploy at the
 * latest; in between, publishing it or finishing it heals it on the spot
 * (src/lib/cms/ensure-course-badge.ts).
 *
 * The SQL is the migration file itself, read as it is, so the rules live in
 * one place, and Prisma's checksum keeps that file from changing once
 * applied. Every step is idempotent (only courses without a badge, ids
 * derived from the course and enrollment ids, ON CONFLICT DO NOTHING), so a
 * deploy with nothing to fill in changes nothing.
 *
 * It uses `pg` directly rather than Prisma: running the file as it is needs
 * the simple query protocol, which accepts several statements in one query,
 * while Prisma's raw queries take one statement at a time. The pooled
 * endpoint is fine for that (no advisory locks or prepared statements, unlike
 * `migrate deploy`), as it is for seed-demo.mjs.
 *
 * Unlike seed-demo.mjs it runs on every deploy, the real production one
 * included (it ignores DEMO_LOGIN_DISABLED), and a failure fails the build.
 * It skips without a real database, like migrate-deploy.mjs. It logs counts
 * only, never a learner, a course or the connection string.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync, realpathSync } from "node:fs";
import pg from "pg";

const TAG = "[backfill-course-badges]";

/** The migration whose steps 1–3 this runs again. */
export const BACKFILL_SQL_FILE = fileURLToPath(
  new URL(
    "./migrations/20261013120000_created_course_badges/migration.sql",
    import.meta.url
  )
);

/**
 * Runs the migration's three steps in one transaction and answers how many
 * rows each added: badges created, courses linked, learner badges saved.
 * `client` is a connected pg client.
 */
export async function backfillCourseBadges(
  client,
  sql = readFileSync(BACKFILL_SQL_FILE, "utf8")
) {
  await client.query("BEGIN");
  try {
    // With no parameters pg sends the simple query protocol, and answers a
    // result per statement.
    const results = [await client.query(sql)].flat();
    // A file that no longer has exactly its three steps would have the
    // counts below say something untrue, so it isn't run at all.
    if (results.length !== 3) {
      throw new Error(`expected the three steps of the migration, got ${results.length}`);
    }
    await client.query("COMMIT");
    const [badges, linked, awards] = results.map((r) => r.rowCount ?? 0);
    return { badges, linked, awards };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

/**
 * Runs the backfill and answers the exit code: 0 done or skipped, 1 failed.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {{
 *   createClient?: (connectionString: string) => any,
 *   log?: Pick<Console, "log" | "error">,
 * }} [options]
 */
export async function main(
  env = process.env,
  {
    createClient = (connectionString) => new pg.Client({ connectionString }),
    log = console,
  } = {}
) {
  const url = env.DATABASE_URL;
  if (!url || url.includes("placeholder")) {
    log.log(`${TAG} no real DATABASE_URL — skipping`);
    return 0;
  }

  const client = createClient(url);
  try {
    await client.connect();
    const { badges, linked, awards } = await backfillCourseBadges(client);
    log.log(
      `${TAG} ${badges} badge(s) created, ${linked} course(s) linked, ${awards} learner badge(s) saved`
    );
    return 0;
  } catch (e) {
    // The message only: a database error's message names the table or
    // constraint, never row values (those are in its detail).
    log.error(`${TAG} FAILED — failing the build: ${e?.message ?? e}`);
    return 1;
  } finally {
    await client.end().catch(() => {});
  }
}

// Run only as a script, not when a test imports it. Both paths are
// resolved, as import.meta.url is, so a symlinked checkout still runs it
// rather than skipping the backfill without a word.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exitCode = await main();
}
