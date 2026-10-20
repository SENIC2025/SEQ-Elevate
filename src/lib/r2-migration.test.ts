import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Release 2's migration (spec 2.2) runs while the Release 1 deployment is
// still serving (vercel-build migrates before it builds), and a rollback
// redeploys Release 1 on top of it. Both stay safe only while it is what it
// was reviewed as: two nullable columns old code never names, and one
// trigger that stops only what no build should do — clear a saved
// completion or drop a completed standard lesson. No backfill, no default,
// no index, nothing renamed or dropped.
//
// The text is pinned whole, not split into statements: the trigger
// function's body has semicolons of its own.

const root = fileURLToPath(new URL("../../", import.meta.url));
const FILE = "prisma/migrations/20261021120000_enrollment_sections_responses/migration.sql";
const read = (file: string) => readFileSync(`${root}${file}`, "utf8");

/** The SQL with comment lines left out and every run of whitespace one space. */
const normalised = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();

/** The body of one Prisma model. */
function model(name: string): string {
  const match = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`).exec(read("prisma/schema.prisma"));
  if (!match) throw new Error(`model ${name} not found`);
  return match[1];
}

const EXPECTED = [
  'ALTER TABLE "CourseEnrollment" ADD COLUMN IF NOT EXISTS "sectionsCompleted" JSONB;',
  'ALTER TABLE "CourseEnrollment" ADD COLUMN IF NOT EXISTS "responses" JSONB;',
  'CREATE OR REPLACE FUNCTION "course_enrollment_keep_progress"() RETURNS trigger',
  "LANGUAGE plpgsql AS $$",
  "BEGIN",
  'NEW."completedAt" := COALESCE(OLD."completedAt", NEW."completedAt");',
  'NEW."stagesCompleted" := ARRAY(',
  "SELECT t.s",
  'FROM unnest(COALESCE(OLD."stagesCompleted", \'{}\'::"StageKey"[])',
  '|| COALESCE(NEW."stagesCompleted", \'{}\'::"StageKey"[]))',
  "WITH ORDINALITY AS t(s, i)",
  "GROUP BY t.s",
  "ORDER BY min(t.i));",
  "RETURN NEW;",
  "END;",
  "$$;",
  'DROP TRIGGER IF EXISTS "CourseEnrollment_keep_progress" ON "CourseEnrollment";',
  'CREATE TRIGGER "CourseEnrollment_keep_progress"',
  'BEFORE UPDATE ON "CourseEnrollment"',
  'FOR EACH ROW EXECUTE FUNCTION "course_enrollment_keep_progress"();',
].join(" ");

describe("the Release 2 migration", () => {
  it("is two nullable JSON columns and the trigger that keeps progress, nothing else", () => {
    expect(existsSync(`${root}${FILE}`)).toBe(true);
    expect(normalised(read(FILE))).toBe(EXPECTED);
  });

  it("matches the schema: optional Json, no default", () => {
    const enrollment = model("CourseEnrollment");
    expect(enrollment).toMatch(/^\s*sectionsCompleted\s+Json\?\s*$/m);
    expect(enrollment).toMatch(/^\s*responses\s+Json\?\s*$/m);
  });

  it("leaves Release 1's migration as it was", () => {
    expect(
      normalised(read("prisma/migrations/20261014120000_course_outline_lesson_parts/migration.sql"))
    ).toBe(
      'ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "outline" JSONB; ' +
        'ALTER TABLE "Lesson" ADD COLUMN IF NOT EXISTS "parts" JSONB;'
    );
  });
});
