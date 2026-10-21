/**
 * G7 (Release 1): may the build's demo seed rewrite its course?
 *
 * seed-demo.mjs republishes "demo-speaking-up" and upserts its lessons on
 * every deploy. Once an editor has changed that course in the flexible
 * editor — a stored lesson list (Course.outline), extra content in a lesson
 * (Lesson.parts) or a lesson of the course's own ("s-…") — doing so would
 * publish it past the publish guard and undo their work. The seed then
 * leaves the course entirely as it is.
 *
 * A module of its own so the rule can be unit-tested without running the
 * seed (src/lib/seed-demo-guard.test.ts). Takes the Prisma client.
 */

/** Has an editor made the course into something the seed must not overwrite? */
export async function hasEditorLessons(prisma, projectId, slug) {
  const course = await prisma.course.findFirst({
    where: { projectId, slug },
    select: { outline: true },
  });
  if (course?.outline != null) return true;
  const lessons = await prisma.lesson.findMany({
    where: { projectId, courseSlug: slug },
    select: { stageKey: true, parts: true },
  });
  return lessons.some((l) => l.parts != null || l.stageKey.startsWith("s-"));
}

/**
 * Release 3 (D98, spec 13.8): may the build seed the demo course? Exactly
 * where demo sign-in may run (src/lib/demo-gate.ts, demoLoginAllowed; the
 * same conditions here because the build runs this file with plain node,
 * and demo-gate.test.ts checks that both agree): DEMO_LOGIN_ENABLED=true,
 * not Vercel's production environment, and an access code of at least 12
 * characters. DEMO_LOGIN_DISABLED is not read.
 */
export function demoSeedAllowed(env) {
  const code = (env.DEMO_ACCESS_CODE ?? "").trim();
  return (
    (env.DEMO_LOGIN_ENABLED ?? "").trim() === "true" &&
    (env.VERCEL_ENV ?? "").trim() !== "production" &&
    code.length >= 12
  );
}
