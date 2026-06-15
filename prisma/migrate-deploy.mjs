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
 */

import { execSync } from "node:child_process";

const url = process.env.DATABASE_URL;

if (!url || url.includes("placeholder")) {
  console.log("[migrate-deploy] no real DATABASE_URL — skipping migrations");
  process.exit(0);
}

const direct = process.env.DIRECT_URL ?? url.replace("-pooler", "");

console.log("[migrate-deploy] applying pending migrations to the direct endpoint…");
try {
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: direct },
  });
  console.log("[migrate-deploy] migrations up to date");
} catch {
  console.error("[migrate-deploy] migrate deploy FAILED — failing the build");
  process.exit(1);
}
