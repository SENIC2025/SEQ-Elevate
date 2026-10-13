import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Release 1's migration runs while the Release 0 deployment is still serving
// (vercel-build migrates before it builds), and a rollback redeploys Release
// 0 on top of it. Both only stay safe while the change is two nullable
// columns that old code never reads: no backfill, no default, no index, and
// nothing renamed or dropped. These checks keep it that way.

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const migration = readFileSync(
  `${root}prisma/migrations/20261014120000_course_outline_lesson_parts/migration.sql`,
  "utf8"
);
const schema = readFileSync(`${root}prisma/schema.prisma`, "utf8");

/** The SQL statements, comments left out. */
const statements = migration
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.replace(/\s+/g, " ").trim())
  .filter(Boolean);

/** The body of one Prisma model. */
function model(name: string): string {
  const match = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`).exec(schema);
  if (!match) throw new Error(`model ${name} not found`);
  return match[1];
}

describe("the Release 1 migration", () => {
  it("only adds the two nullable JSON columns", () => {
    expect(statements).toEqual([
      'ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "outline" JSONB',
      'ALTER TABLE "Lesson" ADD COLUMN IF NOT EXISTS "parts" JSONB',
    ]);
  });

  it("matches the schema: optional Json, no default", () => {
    expect(model("Course")).toMatch(/^\s*outline\s+Json\?\s*$/m);
    expect(model("Lesson")).toMatch(/^\s*parts\s+Json\?\s*$/m);
  });
});
