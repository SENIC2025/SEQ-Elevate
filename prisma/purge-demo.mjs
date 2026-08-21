/**
 * purge-demo.mjs — remove demo/showcase data so the shared database starts
 * clean for real production (D23 cutover hygiene, GO-LIVE.md §2a).
 *
 * SAFE BY DEFAULT: this is a DRY RUN unless you pass --confirm. A dry run only
 * counts and prints what it *would* delete; it changes nothing.
 *
 *   node prisma/purge-demo.mjs                 # dry run (default) — see the plan
 *   node prisma/purge-demo.mjs --confirm       # actually delete the demo data
 *   node prisma/purge-demo.mjs --all-users --confirm
 *                                              # ALSO delete every non-kept user
 *
 * What it removes:
 *   • The demo course `demo-speaking-up` — its Lesson rows (by courseSlug, which
 *     is a string key, not an FK, so a Course delete does NOT cascade to them)
 *     and the Course row itself.
 *   • The four one-click demo profile accounts (below). Deleting a User cascades
 *     to Membership / Session / Account / CourseEnrollment / CompCard / UserBadge
 *     etc.; AuditLog.actorId is SetNull, so the audit trail is anonymised, not lost.
 *
 * What it NEVER touches:
 *   • The scaffold — Project, Organisations, Cohorts, the bundled Courses and
 *     Badges, and any real course content authored in the CMS.
 *
 * --all-users (opt-in): additionally deletes ALL User rows whose email is not in
 * KEEP_EMAILS (comma-separated env). Use only for a full clean slate, and set
 * KEEP_EMAILS to the real admin/facilitator addresses you want to survive.
 * There are no real learners yet at cutover, so this is safe then — but it is a
 * blunt instrument, so it stays opt-in.
 *
 * Run against the production DATABASE_URL you want to clean (e.g. via
 * `vercel env pull` locally, or from a one-off Vercel shell). Idempotent.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL;
if (!url || url.includes("placeholder")) {
  console.error("[purge-demo] no real DATABASE_URL — refusing to run.");
  process.exit(1);
}

const CONFIRM = process.argv.includes("--confirm");
const ALL_USERS = process.argv.includes("--all-users");

const PROJECT = "seq-elevate";
const DEMO_COURSE_SLUG = "demo-speaking-up";
// The one-click demo profiles (src/lib/demo-profiles.ts). Enumerated here on
// purpose so this destructive tool can only hit known, intended targets.
const DEMO_EMAILS = [
  "stefan@senic.org",
  "demo123@seq-elevate.eu",
  "demo321@seq-elevate.eu",
  "demo-learner@seq-elevate.eu",
];
const KEEP_EMAILS = (process.env.KEEP_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});

async function main() {
  console.log(
    `\n[purge-demo] mode: ${CONFIRM ? "EXECUTE (deletes data)" : "DRY RUN (no changes)"}` +
      `${ALL_USERS ? " · --all-users" : ""}\n`
  );

  // 1) Demo course: lessons (string-keyed) + the course row.
  const demoLessons = await prisma.lesson.count({
    where: { projectId: PROJECT, courseSlug: DEMO_COURSE_SLUG },
  });
  const demoCourse = await prisma.course.count({
    where: { projectId: PROJECT, slug: DEMO_COURSE_SLUG },
  });
  console.log(`  demo course '${DEMO_COURSE_SLUG}': ${demoCourse} course row, ${demoLessons} lesson rows`);

  // 2) Demo profile users (cascade removes their data; audit anonymised).
  const demoUsers = await prisma.user.findMany({
    where: { email: { in: DEMO_EMAILS } },
    select: { id: true, email: true },
  });
  console.log(`  demo profile users: ${demoUsers.length} (${demoUsers.map((u) => u.email).join(", ") || "none"})`);

  // 3) Optional: every other user, except KEEP_EMAILS.
  let otherUsers = [];
  if (ALL_USERS) {
    otherUsers = await prisma.user.findMany({
      where: {
        email: { notIn: [...DEMO_EMAILS, ...KEEP_EMAILS] },
      },
      select: { id: true, email: true },
    });
    console.log(
      `  --all-users: ${otherUsers.length} further user(s) would be deleted` +
        (KEEP_EMAILS.length ? ` (keeping: ${KEEP_EMAILS.join(", ")})` : " (KEEP_EMAILS is empty!)")
    );
  }

  if (!CONFIRM) {
    console.log("\n[purge-demo] dry run complete — nothing changed. Re-run with --confirm to delete.\n");
    return;
  }

  // Execute, wrapped so a failure part-way leaves the DB consistent.
  await prisma.$transaction(async (tx) => {
    await tx.lesson.deleteMany({
      where: { projectId: PROJECT, courseSlug: DEMO_COURSE_SLUG },
    });
    await tx.course.deleteMany({
      where: { projectId: PROJECT, slug: DEMO_COURSE_SLUG },
    });
    const ids = [...demoUsers, ...otherUsers].map((u) => u.id);
    if (ids.length) {
      await tx.user.deleteMany({ where: { id: { in: ids } } });
    }
  });

  console.log(
    `\n[purge-demo] done. Removed: demo course + ${demoLessons} lessons, ` +
      `${demoUsers.length + otherUsers.length} user(s).\n` +
      `Reminder: re-establish a real admin by signing in with your real email, then\n` +
      `granting ADMIN via the People admin UI (or SEED_STAFF_EMAIL + pnpm seed).\n`
  );
}

main()
  .catch((e) => {
    console.error("[purge-demo] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
