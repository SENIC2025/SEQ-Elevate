import { Prisma, type PrismaClient } from "@prisma/client";
import { PROJECT, outlineOf, removeR2Course, type R2LessonSeed } from "./r2-course";
import type { LocalizedText } from "@/lib/cms/structure";

/**
 * Release 3, Stream E: a course created in the CMS for the language and
 * media specs (e2e/r3-language.spec.ts, e2e/r3-media.spec.ts), seeded so the
 * old build's database takes it too: the Course row by raw SQL (its
 * readyLocales column is Release 3's, and seedR2Course names it), then the
 * lessons and documents as seedR2Course makes them. On the old build the
 * languages switched on are left out; every language counts as live there.
 *
 * The standard text lessons not listed are removed, so learners get exactly
 * the lessons given, in order.
 */

/** The standard text lessons, listed unless removed. */
const STANDARD_TEXT = ["context", "concept", "behaviour", "reflection"];

export interface ECourseSeed {
  slug: string;
  /** The course's title per language; tagline and cluster label are made up, in the same languages. */
  title: LocalizedText;
  lessons: R2LessonSeed[];
  /** German and Greek switched on for learners (D90). Default: none. */
  ready?: ("de" | "el")[];
  status?: "draft" | "published";
}

const json = (v: unknown) =>
  v === undefined ? undefined : v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue);

/** Does this database have Release 3's Course.readyLocales? */
export async function hasReadyLocales(prisma: PrismaClient): Promise<boolean> {
  const [row] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM information_schema.columns
     WHERE table_name = 'Course' AND column_name = 'readyLocales'`;
  return row.n > 0;
}

/** Does this database have Release 3's file queue (PendingFileDeletion)? */
export async function hasFileQueue(prisma: PrismaClient): Promise<boolean> {
  const [table] = await prisma.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('"PendingFileDeletion"')::text AS t`;
  return table.t !== null;
}

/** Seeds the course (any earlier one with the slug is removed first); answers its id. */
export async function seedECourse(prisma: PrismaClient, seed: ECourseSeed): Promise<string> {
  await removeR2Course(prisma, seed.slug);
  const id = `e2e-course-${seed.slug}`;
  const status = seed.status ?? "published";
  const outline = JSON.stringify({ ...outlineOf(seed.lessons), removed: STANDARD_TEXT });
  const meta = JSON.stringify(
    Object.fromEntries(
      Object.entries(seed.title).map(([l, t]) => [l, { title: t, tagline: `E2E tagline ${l}`, clusterLabel: "Communication" }])
    )
  );
  await prisma.$executeRaw`
    INSERT INTO "Course" ("id","projectId","strapiId","slug","cluster","durationMinutes","status","publishedAt","outline","meta","updatedAt")
    VALUES (${id}, ${PROJECT}, ${`cms-${seed.slug}`}, ${seed.slug}, 'communication', 15, ${status},
            ${status === "published" ? new Date() : null}, ${outline}::jsonb, ${meta}::jsonb, now())`;
  await setReady(prisma, seed.slug, seed.ready ?? []);
  for (const l of seed.lessons) {
    const lesson = await prisma.lesson.create({
      data: {
        projectId: PROJECT,
        courseSlug: seed.slug,
        stageKey: l.id,
        narrative: json(l.narrative),
        structure: json(l.structure),
        parts: l.parts ? json({ v: 1, items: [{ id: "main", type: "main" }, ...l.parts] }) : undefined,
        video: json(l.video),
      },
      select: { id: true },
    });
    for (const [i, d] of (l.documents ?? []).entries()) {
      await prisma.lessonDocument.create({
        data: {
          lessonId: lesson.id,
          name: d.name,
          url: d.url,
          mimeType: "application/pdf",
          sizeBytes: 1024,
          order: i,
          published: d.published ?? true,
        },
        select: { id: true },
      });
    }
  }
  return id;
}

/** Sets the languages switched on for learners, where the database has them. */
export async function setReady(prisma: PrismaClient, slug: string, ready: readonly ("de" | "el")[]) {
  if (!(await hasReadyLocales(prisma))) return;
  await prisma.$executeRaw`
    UPDATE "Course" SET "readyLocales" = ${[...ready]}::text[] WHERE "projectId" = ${PROJECT} AND "slug" = ${slug}`;
}

/** The languages switched on for learners; null where the database has none. */
export async function readyOf(prisma: PrismaClient, slug: string): Promise<string[] | null> {
  if (!(await hasReadyLocales(prisma))) return null;
  const [row] = await prisma.$queryRaw<{ r: string[] | null }[]>`
    SELECT "readyLocales" AS r FROM "Course" WHERE "projectId" = ${PROJECT} AND "slug" = ${slug}`;
  return row?.r ?? [];
}

/** Removes a seeded course: its lessons and documents, enrolments, badge and audit rows. */
export async function removeECourse(prisma: PrismaClient, slug: string) {
  await prisma.courseEnrollment.deleteMany({ where: { course: { projectId: PROJECT, slug } } });
  await removeR2Course(prisma, slug);
}
