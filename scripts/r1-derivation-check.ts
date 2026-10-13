/**
 * Release 1 pre-deploy check (spec 12, addendum 4). READ-ONLY.
 *
 *   DATABASE_URL=<a Neon BRANCH, never production> npx tsx scripts/r1-derivation-check.ts
 *
 * For every course created on the platform it compares the lesson list
 * Release 1's editor derives with the lessons learners get today, and lists
 * anything that would block publishing; stray Lesson rows are reported for
 * information. Exit code 1 on any difference, 0 when there is none (the
 * golden tests promise none for data Release 0 wrote), 2 when it couldn't
 * run.
 *
 * Imports only the pure rules (outline, guard, course-derive through
 * derivation-check.ts) and makes its own queries, so it runs under plain
 * Node with no Next.js or "server-only" in the way.
 *
 * Runs on a branch of the live Release 0 database as it is: where Release
 * 1's columns (Course.outline, Lesson.parts) aren't there yet, they are
 * read as empty, which is all Release 0 ever had.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { checkCourses, formatReport } from "../src/lib/cms/sections/derivation-check";

const PROJECT = "seq-elevate";

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[r1-derivation-check] DATABASE_URL is not set — nothing checked.");
    return 2;
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND ((table_name = 'Course' AND column_name = 'outline')
          OR (table_name = 'Lesson' AND column_name = 'parts'))`;
    const has = (table: string, column: string) =>
      columns.some((c) => c.table_name === table && c.column_name === column);
    const hasOutline = has("Course", "outline");
    const hasParts = has("Lesson", "parts");
    if (!hasOutline || !hasParts) {
      console.log("[r1-derivation-check] Release 0 schema: outline and parts read as empty.");
    }

    const found = await prisma.course.findMany({
      where: { projectId: PROJECT, NOT: { meta: { equals: Prisma.DbNull } } },
      select: { slug: true, ...(hasOutline ? { outline: true } : {}) },
      orderBy: { createdAt: "asc" },
    });
    const courses = found.map((c) => ({ slug: c.slug, outline: "outline" in c ? c.outline : null }));
    const rows = await prisma.lesson.findMany({
      where: { projectId: PROJECT, courseSlug: { in: courses.map((c) => c.slug) } },
      select: {
        courseSlug: true,
        stageKey: true,
        narrative: true,
        structure: true,
        structureDraft: true,
        ...(hasParts ? { parts: true } : {}),
        video: true,
        _count: { select: { documents: true } },
      },
    });
    const lessons = rows.map(({ _count, ...l }) => ({
      ...l,
      parts: "parts" in l ? l.parts : null,
      documentCount: _count.documents,
    }));
    const result = checkCourses(courses, lessons);
    console.log(formatReport(result));
    return result.differences === 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("[r1-derivation-check] failed:", (error as Error).message);
    process.exit(2);
  });
