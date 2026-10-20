/**
 * Release 2 pre-deploy check (spec 6, 10.6). READ-ONLY, counts only.
 *
 *   DATABASE_URL=<a Neon BRANCH, never production> npx tsx scripts/r2-progress-check.ts [--list]
 *
 * Run on a branch of the live database after migrate-deploy.mjs. It
 * checks, and prints only counts:
 *   1. the enrolment columns Release 2 adds (sectionsCompleted, responses)
 *      can be read;
 *   2. the trigger that keeps completions and finished lessons
 *      (CourseEnrollment_keep_progress) is there;
 *   3. for every created course Release 1 could publish, and every
 *      published course, Release 2's lesson plan is exactly what its
 *      learners get today, every lesson by its stage screen (checkPlans).
 * --list adds the slugs of courses that differ (course names, no learner
 * data). Exit code 0 when all hold, 1 on any difference, 2 when it couldn't
 * run (stop the deploy on anything but 0).
 *
 * Imports only the pure rules and makes its own queries, so it runs under
 * plain Node with no Next.js or "server-only" in the way.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { checkPlans, formatPlanReport } from "../src/lib/cms/sections/derivation-check";

const PROJECT = "seq-elevate";
const TAG = "[r2-progress-check]";

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(`${TAG} DATABASE_URL is not set — nothing checked.`);
    return 2;
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    // 1. The new columns: reading them fails if the migration hasn't run.
    const [counts] = await prisma.$queryRaw<{ enrolments: number; own: number; answers: number }[]>`
      SELECT count(*)::int AS enrolments,
             count("sectionsCompleted")::int AS own,
             count("responses")::int AS answers
      FROM "CourseEnrollment"`;
    console.log(
      `${TAG} enrolments: ${counts.enrolments}; with lessons of their course's own: ${counts.own}; with Release 2 answers: ${counts.answers}`
    );

    // 2. The trigger, enabled, on the function the migration made.
    const triggers = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = '"CourseEnrollment"'::regclass
        AND t.tgname = 'CourseEnrollment_keep_progress'
        AND p.proname = 'course_enrollment_keep_progress'
        AND t.tgenabled <> 'D'`;
    const triggerOk = triggers[0]?.n === 1;
    console.log(`${TAG} progress trigger: ${triggerOk ? "present" : "MISSING"}`);

    // 3. The lesson plans of every created course.
    const courses = await prisma.course.findMany({
      where: { projectId: PROJECT, NOT: { meta: { equals: Prisma.DbNull } } },
      select: { slug: true, outline: true, status: true },
      orderBy: { createdAt: "asc" },
    });
    const rows = await prisma.lesson.findMany({
      where: { projectId: PROJECT, courseSlug: { in: courses.map((c) => c.slug) } },
      select: {
        courseSlug: true,
        stageKey: true,
        narrative: true,
        structure: true,
        parts: true,
        video: true,
        _count: { select: { documents: { where: { published: true } } } },
      },
    });
    const lessons = rows.map(({ _count, ...l }) => ({ ...l, documentCount: _count.documents }));
    const result = checkPlans(courses, lessons);
    console.log(formatPlanReport(result, { list: process.argv.includes("--list") }));

    return triggerOk && result.differences === 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`${TAG} failed:`, (error as Error).message);
    process.exit(2);
  });
