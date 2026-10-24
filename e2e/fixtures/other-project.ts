import type { PrismaClient } from "@prisma/client";
import { r4Tables } from "./r4-course";

/**
 * Release 4 (spec 10.5): another project, "e2e-other", with a created course,
 * one lesson, a document and a further-reading link: the out-of-scope target
 * of the action table. Content has no organisation scope, so every write
 * aimed at a row of this project must be refused for everyone, editors and
 * ADMINs included, and the row left as it was.
 *
 * Its course and lesson have the slug and key the caller gives, so a spec
 * can give them those of a seq-elevate course: an action must find
 * seq-elevate's lesson, never this one. Seeded by raw SQL where a column is
 * newer than the old build's database, so the same spec runs on both; the
 * link only where the LessonLink table exists.
 */

export const OTHER_PROJECT = "e2e-other";

export interface OtherProject {
  projectId: typeof OTHER_PROJECT;
  courseId: string;
  slug: string;
  stageKey: string;
  lessonId: string;
  documentId: string;
  /** Null where the database has no LessonLink table. */
  linkId: string | null;
}

/** Seeds the project (kept if it exists) and its course, lesson, document and link (made anew). */
export async function seedOtherProject(
  prisma: PrismaClient,
  { slug, stageKey = "context" }: { slug: string; stageKey?: string }
): Promise<OtherProject> {
  await prisma.$executeRaw`
    INSERT INTO "Project" ("id", "name", "shortName", "primaryColor", "primaryHover", "accentColor", "programme",
                           "locales", "clusters", "partners", "updatedAt")
    VALUES (${OTHER_PROJECT}, 'E2E other project', 'E2E other', '#000000', '#000000', '#000000', 'Other',
            ARRAY['en']::text[], ARRAY[]::text[], ARRAY[]::text[], now())
    ON CONFLICT ("id") DO NOTHING`;
  await removeOtherCourse(prisma, slug);

  const courseId = `e2e-other-course-${slug}`;
  const meta = JSON.stringify({ en: { title: `E2E other ${slug}`, tagline: "E2E other", clusterLabel: "Communication" } });
  await prisma.$executeRaw`
    INSERT INTO "Course" ("id", "projectId", "strapiId", "slug", "cluster", "status", "publishedAt", "meta", "updatedAt")
    VALUES (${courseId}, ${OTHER_PROJECT}, ${`cms-other-${slug}`}, ${slug}, 'communication', 'published', now(), ${meta}::jsonb, now())`;

  const lessonId = `e2e-other-lesson-${slug}`;
  const narrative = JSON.stringify({ en: { title: "Other project's lesson", blocks: [{ kind: "paragraph", text: "E2E other." }] } });
  await prisma.$executeRaw`
    INSERT INTO "Lesson" ("id", "projectId", "courseSlug", "stageKey", "narrative", "updatedAt")
    VALUES (${lessonId}, ${OTHER_PROJECT}, ${slug}, ${stageKey}, ${narrative}::jsonb, now())`;

  const documentId = `e2e-other-document-${slug}`;
  await prisma.$executeRaw`
    INSERT INTO "LessonDocument" ("id", "lessonId", "name", "url", "mimeType", "sizeBytes", "published")
    VALUES (${documentId}, ${lessonId}, 'Other project handout.pdf',
            'https://e2e-store.public.blob.vercel-storage.com/e2e-other-handout.pdf', 'application/pdf', 1024, true)`;

  let linkId: string | null = null;
  if ((await r4Tables(prisma)).links) {
    linkId = `e2e-other-link-${slug}`;
    await prisma.$executeRaw`
      INSERT INTO "LessonLink" ("id", "lessonId", "title", "url", "published", "updatedAt")
      VALUES (${linkId}, ${lessonId}, 'Other project reading', 'https://example.org/e2e-other', true, now())`;
  }

  return { projectId: OTHER_PROJECT, courseId, slug, stageKey, lessonId, documentId, linkId };
}

/** Removes the other project's course of `slug` and its lessons (their documents and links with them). */
export async function removeOtherCourse(prisma: PrismaClient, slug: string) {
  await prisma.$executeRaw`DELETE FROM "Lesson" WHERE "projectId" = ${OTHER_PROJECT} AND "courseSlug" = ${slug}`;
  await prisma.$executeRaw`DELETE FROM "Course" WHERE "projectId" = ${OTHER_PROJECT} AND "slug" = ${slug}`;
}

/** Removes the other project and everything in it. */
export async function removeOtherProject(prisma: PrismaClient) {
  await prisma.$executeRaw`DELETE FROM "Project" WHERE "id" = ${OTHER_PROJECT}`;
}
