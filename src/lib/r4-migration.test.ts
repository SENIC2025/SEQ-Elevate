import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Release 4's migration (spec 2.3) runs while the Release 3 deployment is
// still serving (vercel-build migrates before it builds). It stays safe only
// while it is what it was reviewed as: one transaction (BEGIN to COMMIT:
// Prisma applies a file's statements one by one, each committing on its own
// otherwise) that sets its lock timeout first, creates the two new tables and
// their index before it locks anything Release 3 uses, then adds their
// foreign keys, and last the one defaulted column on a table Release 3 reads.
//
// The file's normalised text is pinned (a hash, and its statements' first
// words in order, so a change shows where it is). A deliberate change
// updates both here, after the same review; so is the schema of spec 2.2.

const root = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS = "prisma/migrations";
const R4 = "20261126090000_r4_further_reading";
const FILE = `${MIGRATIONS}/${R4}/migration.sql`;
const read = (file: string) => readFileSync(`${root}${file}`, "utf8");

/** The SQL with comments left out and every run of whitespace one space. */
const normalised = (sql: string) =>
  sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();

/** The statements of a normalised file, in order (this file has no function bodies). */
const statements = (sql: string) =>
  sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** The body of one Prisma model. */
function block(name: string): string {
  const match = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`).exec(read("prisma/schema.prisma"));
  if (!match) throw new Error(`model ${name} not found`);
  return match[1];
}

/** The field lines of `model`, comments left out, whitespace collapsed. */
function fields(model: string): string[] {
  return block(model)
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim().replace(/\s+/g, " "))
    .filter((l) => l && !l.startsWith("@@"));
}

/** The field line of `name` in `model`. */
function field(model: string, name: string): string {
  const line = fields(model).find((l) => l.startsWith(`${name} `));
  if (!line) throw new Error(`${model}.${name} not found`);
  return line;
}

/** The first words of each statement, in order. */
const SHAPE = [
  "BEGIN",
  "SET LOCAL lock_timeout = '5s'",
  'CREATE TABLE "LessonLink"',
  'CREATE INDEX "LessonLink_lessonId_idx"',
  'CREATE TABLE "CourseBibliography"',
  'ALTER TABLE "LessonLink" ADD CONSTRAINT "LessonLink_lessonId_fkey"',
  'ALTER TABLE "CourseBibliography" ADD CONSTRAINT "CourseBibliography_courseId_fkey"',
  'ALTER TABLE "LessonDocument" ADD COLUMN IF NOT EXISTS "languages"',
  "COMMIT",
];
const SHA256 = "1d0ea3f9fb7a097fe9a44b02085423f88cd44f39e5d3671a6df61cbc426f25ce";

describe("the Release 4 migration", () => {
  const s = statements(normalised(read(FILE)));
  const index = (start: string) => s.findIndex((x) => x.startsWith(start));

  it("sorts after every other migration, Release 3's included", () => {
    const dirs = readdirSync(`${root}${MIGRATIONS}`).filter((d) => /^\d{14}_/.test(d)).sort();
    expect(dirs.at(-1)).toBe(R4);
    expect(dirs.slice(-5, -1)).toEqual([
      "20261120090000_r3_role_partner_admin",
      "20261120090100_r3_people_privacy_content",
      "20261120090200_r3_course_project_columns",
      "20261120090300_r3_sharing_and_guardian_triggers",
    ]);
  });

  it("is pinned: its statements, in order, and its whole text", () => {
    expect(s.map((x) => SHAPE.find((start) => x.startsWith(start)) ?? x.slice(0, 80))).toEqual(SHAPE);
    expect(sha256(normalised(read(FILE)))).toBe(SHA256);
  });

  it("is one transaction that sets its lock timeout first and commits last", () => {
    expect(s[0]).toBe("BEGIN");
    expect(s[1]).toBe("SET LOCAL lock_timeout = '5s'");
    expect(s.at(-1)).toBe("COMMIT");
    expect(s.filter((x) => /^(BEGIN|COMMIT|ROLLBACK|END|START TRANSACTION)\b/.test(x))).toEqual(["BEGIN", "COMMIT"]);
  });

  it("creates every new table and index before it alters any table", () => {
    const lastCreate = Math.max(...s.map((x, i) => (/^CREATE (TABLE|INDEX)\b/.test(x) ? i : -1)));
    const firstAlter = s.findIndex((x) => x.startsWith("ALTER TABLE"));
    expect(lastCreate).toBeGreaterThan(1);
    expect(firstAlter).toBeGreaterThan(lastCreate);
  });

  it("changes LessonDocument, the one table Release 3 reads that it alters, last", () => {
    expect(index('ALTER TABLE "LessonDocument"')).toBe(s.length - 2);
    // Nothing else alters, updates or locks a table Release 3 has, but the
    // two foreign keys' references.
    const existing = s.filter((x) => /^(ALTER TABLE|UPDATE|INSERT|DELETE|LOCK)\b/.test(x) && !/^ALTER TABLE "(LessonLink|CourseBibliography)"/.test(x));
    expect(existing).toEqual([s[index('ALTER TABLE "LessonDocument"')]]);
  });

  it("adds the column as Prisma generates String[] @default([]), so migrate finds no drift; nothing is backfilled", () => {
    expect(s[index('ALTER TABLE "LessonDocument"')]).toBe(
      'ALTER TABLE "LessonDocument" ADD COLUMN IF NOT EXISTS "languages" TEXT[] DEFAULT ARRAY[]::TEXT[]'
    );
    expect(s.find((x) => x.startsWith('CREATE TABLE "LessonLink"'))).toContain('"languages" TEXT[] DEFAULT ARRAY[]::TEXT[],');
    expect(s.some((x) => /^UPDATE\b/.test(x))).toBe(false);
  });

  it("deletes each new row with its lesson or course", () => {
    expect(s[index('ALTER TABLE "LessonLink" ADD CONSTRAINT')]).toBe(
      'ALTER TABLE "LessonLink" ADD CONSTRAINT "LessonLink_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE'
    );
    expect(s[index('ALTER TABLE "CourseBibliography" ADD CONSTRAINT')]).toBe(
      'ALTER TABLE "CourseBibliography" ADD CONSTRAINT "CourseBibliography_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE'
    );
  });
});

describe("the Release 4 schema (spec 2.2)", () => {
  it("holds a further-reading link as spec 2.2 says", () => {
    expect(fields("LessonLink")).toEqual([
      "id String @id @default(cuid())",
      "lessonId String",
      "title String",
      "url String",
      'description String @default("")',
      "languages String[] @default([])",
      "order Int @default(0)",
      "published Boolean @default(false)",
      "createdAt DateTime @default(now())",
      "updatedAt DateTime @updatedAt",
      "lesson Lesson @relation(fields: [lessonId], references: [id], onDelete: Cascade)",
    ]);
    expect(block("LessonLink")).toContain("@@index([lessonId])");
  });

  it("holds a course's references in a table of its own, one row per course", () => {
    expect(fields("CourseBibliography")).toEqual([
      "courseId String @id",
      "content Json",
      "updatedAt DateTime @updatedAt",
      "course Course @relation(fields: [courseId], references: [id], onDelete: Cascade)",
    ]);
  });

  it("adds languages to documents, and only relations to Lesson and Course", () => {
    expect(field("LessonDocument", "languages")).toBe("languages String[] @default([])");
    expect(field("Lesson", "links")).toBe("links LessonLink[]");
    expect(field("Course", "bibliography")).toBe("bibliography CourseBibliography?");
    // No column on Course: the migration never locks it exclusively.
    expect(fields("Course").filter((l) => /^\w+ (String|Int|Boolean|DateTime|Json)\b/.test(l)).map((l) => l.split(" ")[0])).not.toContain(
      "bibliography"
    );
  });

  it("gives neither new table a relation to User, so they hold no person", () => {
    for (const model of ["LessonLink", "CourseBibliography"]) {
      expect(fields(model).some((l) => /^\w+ User\b/.test(l)), model).toBe(false);
    }
    const user = fields("User").map((l) => l.split(" ")[1]);
    expect(user.some((type) => /^(LessonLink|CourseBibliography)\b/.test(type))).toBe(false);
  });

  it("names nothing references, a reserved word in SQL and an argument of @relation", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).not.toMatch(/^model References\b/im);
    expect(schema).not.toMatch(/^\s+references\s/m);
  });
});
