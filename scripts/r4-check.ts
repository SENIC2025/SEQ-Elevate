/**
 * Release 4 rehearsal and post-deploy check (spec 2.6). Counts only: it never
 * prints a title, an address, a description or any other content or personal
 * data.
 *
 *   DATABASE_URL=<the rehearsal branch, or production right after the deploy> npx tsx scripts/r4-check.ts
 *
 * Run after migrate-deploy.mjs. It checks, and fails on:
 *   - the LessonLink and CourseBibliography tables exist;
 *   - LessonDocument.languages exists, with its default (every language).
 * And prints, without judging: whether the migration is recorded as applied;
 * documents by languages (every language, one, several); further-reading
 * links published and draft; bibliography rows; stored link addresses the
 * address check refuses (learners never get them; any at all is for the
 * owner to look at, by id, in the database); lessons whose text is stored as
 * version 2 (it holds a named link), in their main text and in their extra
 * content.
 *
 * Exit code 0 when every check holds, 1 when one fails, 2 when it couldn't
 * run. Imports nothing from the app but the pure address check.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { checkLinkHref } from "../src/lib/rich-text/link-url";

const MIGRATION = "20261126090000_r4_further_reading";
const TAG = "[r4-check]";
/** As Prisma writes the default of String[] @default([]). */
const EMPTY_ARRAY_DEFAULT = "ARRAY[]::text[]";

type Count = { n: number };

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(`${TAG} DATABASE_URL is not set — nothing checked.`);
    return 2;
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const failures: string[] = [];
  const check = (ok: boolean, line: string) => {
    console.log(`${TAG} ${ok ? "ok  " : "FAIL"} ${line}`);
    if (!ok) failures.push(line);
  };
  const info = (line: string) => console.log(`${TAG}      ${line}`);
  try {
    const [applied] = await prisma.$queryRaw<Count[]>`
      SELECT count(*)::int AS n FROM "_prisma_migrations"
      WHERE migration_name = ${MIGRATION} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    info(`migration ${MIGRATION} recorded as applied: ${applied.n === 1 ? "yes" : "no"}`);

    // The tables and the column.
    const [tables] = await prisma.$queryRaw<{ links: string | null; bibliography: string | null }[]>`
      SELECT to_regclass('"LessonLink"')::text AS links, to_regclass('"CourseBibliography"')::text AS bibliography`;
    check(tables.links !== null, "table LessonLink exists");
    check(tables.bibliography !== null, "table CourseBibliography exists");
    const columns = await prisma.$queryRaw<{ column_default: string | null }[]>`
      SELECT column_default FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'LessonDocument' AND column_name = 'languages'`;
    check(columns.length === 1, "column LessonDocument.languages exists");
    if (columns.length === 1) {
      check(columns[0].column_default === EMPTY_ARRAY_DEFAULT, `LessonDocument.languages defaults to ${EMPTY_ARRAY_DEFAULT} (every language)`);
      const [documents] = await prisma.$queryRaw<{ every: number; one: number; several: number }[]>`
        SELECT count(*) FILTER (WHERE coalesce(cardinality("languages"), 0) = 0)::int AS every,
               count(*) FILTER (WHERE cardinality("languages") = 1)::int AS one,
               count(*) FILTER (WHERE cardinality("languages") > 1)::int AS several
        FROM "LessonDocument"`;
      info(`documents for every language: ${documents.every}; for one language: ${documents.one}; for several: ${documents.several}`);
    }

    if (tables.links !== null) {
      const [links] = await prisma.$queryRaw<{ published: number; draft: number }[]>`
        SELECT count(*) FILTER (WHERE "published")::int AS published,
               count(*) FILTER (WHERE NOT "published")::int AS draft
        FROM "LessonLink"`;
      info(`further-reading links published: ${links.published}; draft: ${links.draft}`);
      // Read in pages: only whether each address passes is kept.
      let refused = 0;
      let after = "";
      for (;;) {
        const page = await prisma.$queryRaw<{ id: string; url: string }[]>`
          SELECT "id", "url" FROM "LessonLink" WHERE "id" > ${after} ORDER BY "id" LIMIT 500`;
        for (const row of page) if (!checkLinkHref(row.url).ok) refused++;
        if (page.length < 500) break;
        after = page[page.length - 1].id;
      }
      info(`stored further-reading addresses the address check refuses: ${refused} (learners never get them; must be 0 on 30 Nov)`);
    }
    if (tables.bibliography !== null) {
      const [rows] = await prisma.$queryRaw<Count[]>`SELECT count(*)::int AS n FROM "CourseBibliography"`;
      info(`courses with a references row: ${rows.n}`);
    }

    // Lesson text stored as version 2 (it holds a named link, D104).
    const [v2] = await prisma.$queryRaw<{ narrative: number; parts: number }[]>`
      SELECT count(*) FILTER (WHERE "narrative" IS NOT NULL AND jsonb_path_exists("narrative", '$.**.rich ? (@.v == 2)'))::int AS narrative,
             count(*) FILTER (WHERE "parts" IS NOT NULL AND jsonb_path_exists("parts", '$.**.rich ? (@.v == 2)'))::int AS parts
      FROM "Lesson"`;
    info(`lessons with text stored as version 2: in their main text ${v2.narrative}; in their extra content ${v2.parts}`);

    console.log(`${TAG} ${failures.length === 0 ? "all checks hold" : `${failures.length} check(s) failed`}`);
    return failures.length === 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // The error's name and code only: a message can quote a row.
    const e = error as { name?: string; code?: string };
    console.error(`${TAG} couldn't run: ${e?.name ?? "error"}${e?.code ? ` ${e.code}` : ""}`);
    process.exit(2);
  }
);
