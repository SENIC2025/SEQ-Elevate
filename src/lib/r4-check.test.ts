import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

/*
 * scripts/r4-check.ts (spec 2.6), run as the deputy runs it, against a
 * database migrated by the real migrations: it fails only when a table, the
 * column or its default is missing, and reports the rest as counts, never
 * an address or a title.
 *
 * Needs a database: R4_CHECK_DATABASE_URL=<an EMPTY throwaway database>.
 * A database that isn't empty is refused and left exactly as it was
 * (src/app/actions/lesson-reading.db-guard.test.ts). Without the variable
 * the test is skipped (the unit suite never touches a database).
 */

const url = process.env.R4_CHECK_DATABASE_URL;
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function r4Check(): { code: number; output: string } {
  const run = spawnSync(`${ROOT}node_modules/.bin/tsx`, ["scripts/r4-check.ts"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });
  return { code: run.status ?? -1, output: `${run.stdout}${run.stderr}` };
}

describe.skipIf(!url)("r4-check against a migrated database", () => {
  const db = new pg.Client({ connectionString: url });
  const SECRET_TITLE = "r4-check title that must not be printed";
  const SECRET_URL = "javascript:alert('r4-check-address')";

  /** Set once the database was found empty; nothing is dropped from a database the test refused. */
  let claimed = false;

  beforeAll(async () => {
    await db.connect();
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`);
    if (rows[0].n > 0) throw new Error("R4_CHECK_DATABASE_URL must be an empty throwaway database");
    // Found empty: from here on the database is this test's, and only then is its schema dropped afterwards.
    claimed = true;
    execFileSync(`${ROOT}node_modules/.bin/prisma`, ["migrate", "deploy"], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: url },
      stdio: "ignore",
    });
    await db.query(`INSERT INTO "Project" ("id", "name", "shortName", "primaryColor", "primaryHover", "accentColor", "programme", "updatedAt")
      VALUES ('seq-elevate', 'SEQ', 'SEQ', '#000', '#000', '#000', 'x', now())`);
    await db.query(`INSERT INTO "Lesson" ("id", "projectId", "courseSlug", "stageKey", "updatedAt")
      VALUES ('r4-check-lesson', 'seq-elevate', 'r4-check', 'context', now())`);
  }, 120_000);

  afterAll(async () => {
    // A database the test refused is left exactly as it was.
    if (claimed) await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`).catch(() => {});
    await db.end();
  });

  it("holds on a freshly migrated database", () => {
    const { code, output } = r4Check();
    expect(output).toContain("migration 20261126090000_r4_further_reading recorded as applied: yes");
    expect(output).toContain("all checks hold");
    expect(code).toBe(0);
  }, 60_000);

  it("counts documents by languages, links, refused addresses and version-2 text, printing none of them", async () => {
    await db.query(`INSERT INTO "LessonDocument" ("id", "lessonId", "name", "url", "mimeType", "sizeBytes", "languages")
      VALUES ('d1', 'r4-check-lesson', 'a', 'https://x.example/a', 'application/pdf', 1, ARRAY[]::text[]),
             ('d2', 'r4-check-lesson', 'b', 'https://x.example/b', 'application/pdf', 1, ARRAY['de']),
             ('d3', 'r4-check-lesson', 'c', 'https://x.example/c', 'application/pdf', 1, ARRAY['de','el'])`);
    await db.query(`INSERT INTO "LessonDocument" ("id", "lessonId", "name", "url", "mimeType", "sizeBytes")
      VALUES ('d4', 'r4-check-lesson', 'd', 'https://x.example/d', 'application/pdf', 1)`);
    await db.query(
      `INSERT INTO "LessonLink" ("id", "lessonId", "title", "url", "published", "updatedAt")
       VALUES ('l1', 'r4-check-lesson', $1, 'https://example.org/', true, now()),
              ('l2', 'r4-check-lesson', $1, $2, true, now()),
              ('l3', 'r4-check-lesson', $1, 'not an address', false, now())`,
      [SECRET_TITLE, SECRET_URL]
    );
    await db.query(`INSERT INTO "Course" ("id", "projectId", "strapiId", "slug", "cluster", "updatedAt")
      VALUES ('r4-check-course', 'seq-elevate', 'cms-r4-check', 'r4-check', 'communication', now())`);
    await db.query(
      `INSERT INTO "CourseBibliography" ("courseId", "content", "updatedAt") VALUES ('r4-check-course', $1::jsonb, now())`,
      [JSON.stringify({ v: 1, locales: { en: { text: SECRET_TITLE } } })]
    );
    const v2 = { v: 2, doc: { type: "doc", content: [] } };
    await db.query(`UPDATE "Lesson" SET "narrative" = $1::jsonb, "parts" = $2::jsonb WHERE "id" = 'r4-check-lesson'`, [
      JSON.stringify({ en: { title: "t", blocks: [{ kind: "paragraph", text: "x", rich: v2 }] } }),
      JSON.stringify({ v: 1, items: [{ id: "main", type: "main" }] }),
    ]);
    const { code, output } = r4Check();
    expect(output).toContain("documents for every language: 2; for one language: 1; for several: 1");
    expect(output).toContain("further-reading links published: 2; draft: 1");
    expect(output).toContain("stored further-reading addresses the address check refuses: 2");
    expect(output).toContain("courses with a references row: 1");
    expect(output).toContain("lessons with text stored as version 2: in their main text 1; in their extra content 0");
    expect(output).not.toContain(SECRET_TITLE);
    expect(output).not.toContain("r4-check-address");
    expect(output).not.toContain("not an address");
    expect(code).toBe(0);
  }, 60_000);

  it("fails when the column's default is missing", async () => {
    await db.query(`ALTER TABLE "LessonDocument" ALTER COLUMN "languages" DROP DEFAULT`);
    const { code, output } = r4Check();
    expect(output).toMatch(/FAIL LessonDocument\.languages defaults to/);
    expect(code).toBe(1);
    await db.query(`ALTER TABLE "LessonDocument" ALTER COLUMN "languages" SET DEFAULT ARRAY[]::TEXT[]`);
  }, 60_000);

  it("fails when a table is missing", async () => {
    await db.query(`DROP TABLE "CourseBibliography"`);
    const { code, output } = r4Check();
    expect(output).toContain("FAIL table CourseBibliography exists");
    expect(code).toBe(1);
  }, 60_000);
});
