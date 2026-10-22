import type { PrismaClient } from "@prisma/client";
import { ownLessonId, para, type Locale } from "./r2-course";
import { removeECourse, seedECourse } from "./r3-e-course";

/**
 * Release 4 (spec 9.1, 10.2): a course created in the CMS for the links,
 * further-reading, language and references specs, seeded so the old
 * build's database takes it too. The course, its lessons and its documents
 * are seeded as Release 3's Stream E seeds them (seedECourse); what only
 * Release 4's database has is added where it exists: the documents'
 * languages, the further-reading links (LessonLink) and the references list
 * (CourseBibliography). So the same spec runs on both builds and fails on
 * the old one for its own reason.
 *
 * Seeded straight into the database, past every save rule, as an editor
 * could have left it:
 * - lesson one: a paragraph with a named link (version 2, D104: its `text`
 *   names the address); documents for every language, German only and
 *   English only; further-reading links shown, hidden (a draft), German
 *   only and English only;
 * - lesson two: plain text, no documents and no links;
 * - the references list in English, with italics and a named link.
 */

/** Where the named links go: example.org, which no test ever opens. */
export const R4_LINKS = {
  guide: "https://example.org/guide",
  reference: "https://doi.org/10.1000/r4-e2e",
} as const;

/** A paragraph whose words "the guide" link to R4_LINKS.guide (version 2, with its plain text). */
export function namedLinkParagraph(href: string = R4_LINKS.guide, label = "the guide") {
  return {
    kind: "paragraph" as const,
    text: `Read ${label} (${href}) before the next lesson.`,
    rich: {
      v: 2,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Read " },
              { type: "text", text: label, marks: [{ type: "link", attrs: { href } }] },
              { type: "text", text: " before the next lesson." },
            ],
          },
        ],
      },
    },
  };
}

/** The references list as stored (CourseBibliography.content), English only. */
export function referencesContent() {
  const text = `Author, A. A. (2020). Title of the work. Publisher. ${R4_LINKS.reference}`;
  return {
    v: 1,
    locales: {
      en: {
        text,
        rich: {
          v: 2,
          doc: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Author, A. A. (2020). " },
                  { type: "text", text: "Title of the work", marks: [{ type: "italic" }] },
                  { type: "text", text: ". Publisher. " },
                  { type: "text", text: R4_LINKS.reference, marks: [{ type: "link", attrs: { href: R4_LINKS.reference } }] },
                ],
              },
            ],
          },
        },
      },
    },
  };
}

/** What this database has of Release 4. */
export interface R4Tables {
  /** LessonDocument.languages */
  documentLanguages: boolean;
  /** The LessonLink table. */
  links: boolean;
  /** The CourseBibliography table. */
  bibliography: boolean;
}

export async function r4Tables(prisma: PrismaClient): Promise<R4Tables> {
  const [row] = await prisma.$queryRaw<{ links: string | null; bibliography: string | null; languages: number }[]>`
    SELECT to_regclass('"LessonLink"')::text AS links,
           to_regclass('"CourseBibliography"')::text AS bibliography,
           (SELECT count(*)::int FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'LessonDocument' AND column_name = 'languages') AS languages`;
  return { documentLanguages: row.languages > 0, links: row.links !== null, bibliography: row.bibliography !== null };
}

export interface R4CourseSeed {
  slug: string;
  status?: "draft" | "published";
  /** German and Greek switched on for learners (Release 3, D90). Default: none. */
  ready?: ("de" | "el")[];
}

type DocumentKey = "all" | "de" | "en";
type LinkKey = "shown" | "hidden" | "de" | "en";

export interface R4Course {
  courseId: string;
  slug: string;
  /** Lesson one (named link, documents, further reading) and lesson two (plain text). */
  lessons: { one: string; two: string };
  /** Lesson one's documents, by the languages they are for (all published). */
  documents: Record<DocumentKey, { id: string; name: string }>;
  /** Lesson one's further-reading links; null where the database has no LessonLink table. */
  links: Record<LinkKey, { id: string; title: string; url: string }> | null;
  /** Whether the references list was stored (the database has CourseBibliography). */
  references: boolean;
  tables: R4Tables;
}

/** The documents of lesson one: name, and the languages each is for. */
const DOCUMENTS: Record<DocumentKey, { name: string; languages: Locale[] }> = {
  all: { name: "R4 handout (every language).pdf", languages: [] },
  de: { name: "R4 Arbeitsblatt (nur Deutsch).pdf", languages: ["de"] },
  en: { name: "R4 worksheet (English only).pdf", languages: ["en"] },
};

/** The further-reading links of lesson one. */
const LINKS: Record<LinkKey, { title: string; url: string; description: string; languages: Locale[]; published: boolean }> = {
  shown: { title: "R4 shown reading", url: "https://example.org/r4-shown", description: "Shown to learners.", languages: [], published: true },
  hidden: { title: "R4 hidden reading", url: "https://example.org/r4-hidden", description: "A draft.", languages: [], published: false },
  de: { title: "R4 Lektüre auf Deutsch", url: "https://example.org/r4-de", description: "Nur für Deutsch.", languages: ["de"], published: true },
  en: { title: "R4 English reading", url: "https://example.org/r4-en", description: "English only.", languages: ["en"], published: true },
};

/** Seeds the course (any earlier one with the slug is removed first). */
export async function seedR4Course(prisma: PrismaClient, seed: R4CourseSeed): Promise<R4Course> {
  const one = ownLessonId();
  const two = ownLessonId();
  const tables = await r4Tables(prisma);
  const courseId = await seedECourse(prisma, {
    slug: seed.slug,
    title: { en: `E2E R4 ${seed.slug}`, de: `E2E R4 ${seed.slug} (de)` },
    status: seed.status,
    ready: seed.ready,
    lessons: [
      {
        id: one,
        narrative: {
          en: { title: "Lesson with links", blocks: [namedLinkParagraph()] },
          de: { title: "Lektion mit Links", blocks: [para("E2E: eine Lektion mit Links.")] },
        },
        documents: (Object.keys(DOCUMENTS) as DocumentKey[]).map((k) => ({
          name: DOCUMENTS[k].name,
          url: `https://e2e-store.public.blob.vercel-storage.com/r4-${seed.slug}-${k}.pdf`,
        })),
      },
      {
        id: two,
        narrative: {
          en: { title: "Lesson without links", blocks: [para("E2E: a lesson with plain text only.")] },
          de: { title: "Lektion ohne Links", blocks: [para("E2E: nur Text.")] },
        },
      },
    ],
  });

  const lesson = await prisma.lesson.findFirstOrThrow({
    where: { projectId: "seq-elevate", courseSlug: seed.slug, stageKey: one },
    select: { id: true },
  });
  const stored = await prisma.$queryRaw<{ id: string; name: string }[]>`
    SELECT "id", "name" FROM "LessonDocument" WHERE "lessonId" = ${lesson.id}`;
  const documents = Object.fromEntries(
    (Object.keys(DOCUMENTS) as DocumentKey[]).map((k) => [k, stored.find((d) => d.name === DOCUMENTS[k].name)!])
  ) as R4Course["documents"];
  if (tables.documentLanguages) {
    for (const k of Object.keys(DOCUMENTS) as DocumentKey[]) {
      await prisma.$executeRaw`
        UPDATE "LessonDocument" SET "languages" = ${DOCUMENTS[k].languages}::text[] WHERE "id" = ${documents[k].id}`;
    }
  }

  let links: R4Course["links"] = null;
  if (tables.links) {
    const made = {} as NonNullable<R4Course["links"]>;
    for (const [order, k] of (Object.keys(LINKS) as LinkKey[]).entries()) {
      const l = LINKS[k];
      const id = `e2e-r4-link-${seed.slug}-${k}`;
      await prisma.$executeRaw`
        INSERT INTO "LessonLink" ("id", "lessonId", "title", "url", "description", "languages", "order", "published", "updatedAt")
        VALUES (${id}, ${lesson.id}, ${l.title}, ${l.url}, ${l.description}, ${l.languages}::text[], ${order}, ${l.published}, now())`;
      made[k] = { id, title: l.title, url: l.url };
    }
    links = made;
  }

  if (tables.bibliography) {
    await prisma.$executeRaw`
      INSERT INTO "CourseBibliography" ("courseId", "content", "updatedAt")
      VALUES (${courseId}, ${JSON.stringify(referencesContent())}::jsonb, now())`;
  }

  return {
    courseId,
    slug: seed.slug,
    lessons: { one, two },
    documents,
    links,
    references: tables.bibliography,
    tables,
  };
}

/** Removes a seeded course: its lessons (their documents and links with them), references, enrolments, badge and audit rows. */
export async function removeR4Course(prisma: PrismaClient, slug: string) {
  await removeECourse(prisma, slug);
}
