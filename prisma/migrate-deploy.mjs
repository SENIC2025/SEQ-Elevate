/**
 * Applies pending Prisma migrations during the Vercel build, before `next
 * build`. Wired via the `vercel-build` npm script.
 *
 * Neon's POOLED endpoint (what DATABASE_URL points at for the running app)
 * can't run Prisma migrations — they need session-level advisory locks that
 * PgBouncer transaction pooling doesn't support. So we derive the DIRECT
 * endpoint (Neon's pooled host is the direct host with `-pooler` inserted)
 * and run `migrate deploy` against that. An explicit DIRECT_URL overrides.
 *
 * Safe no-op when there are no pending migrations, and skips entirely without
 * a real database (so CI/preview builds without Neon don't fail here).
 *
 * A migration that is one transaction (BEGIN … COMMIT, as Release 3's
 * 20261120090100 is) applies all or nothing. But when one of its statements
 * fails, Prisma reports only "current transaction is aborted" (it writes its
 * log row inside the transaction that failed), never why. So on that answer
 * this runs the failed migration's file once more, in a transaction that is
 * always rolled back, and prints the database's own error (its code and
 * message, never its detail, which can hold row values), or that it went
 * through this time (a lock wait or a deadlock at that moment), and what to
 * do before the next deploy. It prints no connection string.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const TAG = "[migrate-deploy]";
const MIGRATIONS = fileURLToPath(new URL("./migrations/", import.meta.url));

/** `prisma migrate deploy` against `url`, its output passed on: its exit code and that output. */
function prismaMigrateDeploy(url) {
  const run = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });
  process.stdout.write(run.stdout ?? "");
  process.stderr.write(run.stderr ?? "");
  return { status: run.status ?? 1, output: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

/** The SQL with comments left out (statements are then split on `;`, a function body kept whole). */
function statementsOf(sql) {
  const text = sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  const out = [];
  let current = "";
  let inBody = false;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("$$", i)) {
      inBody = !inBody;
      current += "$$";
      i++;
    } else if (text[i] === ";" && !inBody) {
      if (current.trim()) out.push(current.trim());
      current = "";
    } else current += text[i];
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * The failed migration `name` run again in a transaction that is rolled
 * back whatever happens: the database's own error, or null when it went
 * through. Only a file that is one transaction (BEGIN first, COMMIT last,
 * no other) is run: its COMMIT is left out, so nothing can commit.
 */
export async function rerunRolledBack(client, sql) {
  const statements = statementsOf(sql);
  const control = statements.filter((s) => /^(BEGIN|COMMIT|ROLLBACK|END|START TRANSACTION)\b/i.test(s));
  if (statements[0] !== "BEGIN" || statements.at(-1) !== "COMMIT" || control.length !== 2) {
    throw new Error("not a migration that is one transaction");
  }
  try {
    // With no parameters pg sends the simple query protocol, which runs the
    // statements in order and stops at the first that fails.
    await client.query(statements.slice(0, -1).join(";\n"));
    return null;
  } catch (e) {
    return { code: e?.code ?? "unknown", message: e?.message ?? String(e) };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
  }
}

/** A migration's file, by its folder name, or null. */
function readMigrationFile(name) {
  const file = `${MIGRATIONS}${name}/migration.sql`;
  return /^\d{14}_\w+$/.test(name) && existsSync(file) ? readFileSync(file, "utf8") : null;
}

/** What to tell the owner after Prisma's "current transaction is aborted". */
async function explainAbortedTransaction(url, { createClient, log, readMigration }) {
  const client = createClient(url);
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT migration_name FROM "_prisma_migrations"
       WHERE finished_at IS NULL AND rolled_back_at IS NULL ORDER BY started_at DESC LIMIT 1`
    );
    const name = rows[0]?.migration_name;
    const sql = name ? readMigration(name) : null;
    if (!name || !sql) {
      log.error(`${TAG} Prisma says "current transaction is aborted": a statement of a migration failed; Prisma doesn't say which.`);
      return;
    }
    log.error(
      `${TAG} ${name} failed. It is one transaction, so nothing of it was applied; Prisma's "current transaction is aborted" hides why. Running it again, rolled back, to show the database's own error…`
    );
    const error = await rerunRolledBack(client, sql);
    log.error(
      error
        ? `${TAG} the database's own error: ${error.code} ${error.message}`
        : `${TAG} it went through this time (rolled back): the failure was a lock wait or a deadlock at that moment; deploy again at a quieter moment.`
    );
    log.error(
      `${TAG} before the next deploy, against the DIRECT endpoint: npx prisma migrate resolve --rolled-back ${name}`
    );
  } catch (e) {
    // The kind and code only: a message here could name what failed to connect.
    log.error(`${TAG} couldn't look into the failure: ${e?.name ?? "error"}${e?.code ? ` ${e.code}` : ""}`);
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Applies the migrations and answers the exit code: 0 done or skipped, 1
 * failed.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {{
 *   deploy?: (url: string) => { status: number, output: string },
 *   createClient?: (connectionString: string) => any,
 *   log?: Pick<Console, "log" | "error">,
 *   readMigration?: (name: string) => string | null,
 * }} [options]
 */
export async function main(
  env = process.env,
  {
    deploy = prismaMigrateDeploy,
    createClient = (connectionString) => new pg.Client({ connectionString }),
    log = console,
    readMigration = readMigrationFile,
  } = {}
) {
  const url = env.DATABASE_URL;
  if (!url || url.includes("placeholder")) {
    log.log(`${TAG} no real DATABASE_URL — skipping migrations`);
    return 0;
  }
  const direct = env.DIRECT_URL ?? url.replace("-pooler", "");

  log.log(`${TAG} applying pending migrations to the direct endpoint…`);
  const { status, output } = deploy(direct);
  if (status === 0) {
    log.log(`${TAG} migrations up to date`);
    return 0;
  }
  if (/current transaction is aborted/i.test(output)) {
    await explainAbortedTransaction(direct, { createClient, log, readMigration });
  } else if (/\bP3009\b/.test(output)) {
    log.error(
      `${TAG} a migration failed in an earlier deploy (Prisma names it above): once nothing of it is applied, run npx prisma migrate resolve --rolled-back <its folder name> against the DIRECT endpoint`
    );
  }
  log.error(`${TAG} migrate deploy FAILED — failing the build`);
  return 1;
}

// Run only as a script, not when a test imports it (as backfill-course-badges.mjs).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main();
}
