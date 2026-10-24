import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { HOSTILE_ADDRESSES } from "../../../e2e/fixtures/r4-hostile-links";

/*
 * U9 against a real Postgres (Release 4, spec 4.3): the further-reading
 * actions as they run on the server, with the real Prisma client, the real
 * locks and the real cascade. Only the signed-in person is stood in for.
 * What the in-memory test can't show: the queries name the right rows (a
 * course of this project, never another project's lesson of the same
 * course and key), two adds at once never make a 31st link, a lesson's
 * delete takes its links with it, and a refused call leaves every table as
 * it was.
 *
 * Needs a database: R4_READING_DATABASE_URL=<an EMPTY throwaway database>.
 * A database that isn't empty is refused and left exactly as it was
 * (lesson-reading.db-guard.test.ts). Without the variable the test is
 * skipped (the unit suite never touches a database).
 */

const url = process.env.R4_READING_DATABASE_URL;
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

vi.mock("server-only", () => ({}));
const who = vi.hoisted(() => ({ roles: ["CONTENT_EDITOR"] as string[] }));
vi.mock("@/lib/auth-helpers", () => ({
  getCurrentUser: async () => ({ id: "r4-reading-editor" }),
  getProjectMemberships: async () => who.roles.map((role) => ({ role })),
}));

describe.skipIf(!url)("the further-reading actions on a real database", () => {
  const db = new pg.Client({ connectionString: url });
  let actions: typeof import("./lesson-reading");
  const OWN = "s-r4dbtest";

  /** Every row of the tables a call may change, in a fixed order. */
  const checksum = async () => {
    const tables = ["LessonLink", "Lesson", "LessonDocument"];
    const out: Record<string, unknown> = {};
    for (const t of tables) out[t] = (await db.query(`SELECT * FROM "${t}" ORDER BY "id"`)).rows;
    out.audit = (await db.query(`SELECT count(*)::int AS n FROM "AuditLog"`)).rows[0].n;
    return JSON.stringify(out);
  };

  /** Set once the database was found empty; nothing is dropped from a database the test refused. */
  let claimed = false;

  beforeAll(async () => {
    await db.connect();
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`);
    if (rows[0].n > 0) throw new Error("R4_READING_DATABASE_URL must be an empty throwaway database");
    // Found empty: from here on the database is this test's, and only then is its schema dropped afterwards.
    claimed = true;
    execFileSync(`${ROOT}node_modules/.bin/prisma`, ["migrate", "deploy"], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: url },
      stdio: "ignore",
    });
    // The editor the audit rows name.
    await db.query(`INSERT INTO "User" ("id", "email", "updatedAt") VALUES ('r4-reading-editor', 'r4-reading-editor@example.com', now())`);
    for (const project of ["seq-elevate", "e2e-other"]) {
      await db.query(
        `INSERT INTO "Project" ("id", "name", "shortName", "primaryColor", "primaryHover", "accentColor", "programme", "updatedAt")
         VALUES ($1, $1, $1, '#000', '#000', '#000', 'x', now())`,
        [project]
      );
      // The same course slug in both projects: an action must find this project's.
      await db.query(
        `INSERT INTO "Course" ("id", "projectId", "strapiId", "slug", "cluster", "status", "meta", "outline", "updatedAt")
         VALUES ($1, $2, $1, 'r4-db', 'communication', 'published', $3::jsonb, $4::jsonb, now())`,
        [
          `course-${project}`,
          project,
          JSON.stringify({ en: { title: "R4", tagline: "t", clusterLabel: "c" } }),
          JSON.stringify({ v: 1, sections: [{ id: "context", template: "context" }, { id: OWN, template: "text" }] }),
        ]
      );
    }
    await db.query(
      `INSERT INTO "Lesson" ("id", "projectId", "courseSlug", "stageKey", "updatedAt") VALUES ('their-lesson', 'e2e-other', 'r4-db', 'context', now())`
    );
    await db.query(
      `INSERT INTO "LessonLink" ("id", "lessonId", "title", "url", "published", "updatedAt")
       VALUES ('their-link', 'their-lesson', 'Theirs', 'https://example.org/theirs', true, now())`
    );
    await db.query(
      `INSERT INTO "LessonDocument" ("id", "lessonId", "name", "url", "mimeType", "sizeBytes") VALUES ('their-doc', 'their-lesson', 'd', 'https://x.example/d', 'application/pdf', 1)`
    );
    process.env.DATABASE_URL = url;
    actions = await import("./lesson-reading");
  }, 120_000);

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma").catch(() => ({ prisma: null }));
    await prisma?.$disconnect();
    // A database the test refused is left exactly as it was.
    if (claimed) await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`).catch(() => {});
    await db.end();
  });

  it("adds drafts in order to this project's lesson only, its address normalised, audited without it", async () => {
    const before = (await db.query(`SELECT * FROM "LessonLink" WHERE "id" = 'their-link'`)).rows;
    const one = await actions.addLessonLink("r4-db", "context", { title: "Guide", url: "HTTPS://Example.ORG/Guide" });
    const two = await actions.addLessonLink("r4-db", "context", { title: "Mail", url: "mailto:help@example.org", languages: ["de"] });
    expect(one).toMatchObject({ ok: true });
    expect(two).toMatchObject({ ok: true });
    const { rows } = await db.query(
      `SELECT k."title", k."url", k."order", k."published", k."languages", l."projectId"
         FROM "LessonLink" k JOIN "Lesson" l ON l."id" = k."lessonId" WHERE l."projectId" = 'seq-elevate' ORDER BY k."order"`
    );
    expect(rows).toEqual([
      { title: "Guide", url: "https://example.org/Guide", order: 0, published: false, languages: [], projectId: "seq-elevate" },
      { title: "Mail", url: "mailto:help@example.org", order: 1, published: false, languages: ["de"], projectId: "seq-elevate" },
    ]);
    expect((await db.query(`SELECT * FROM "LessonLink" WHERE "id" = 'their-link'`)).rows).toEqual(before);
    const audit = (await db.query(`SELECT "action", "entity", "metadata" FROM "AuditLog" ORDER BY "createdAt"`)).rows;
    expect(audit.map((a) => a.action)).toEqual(["link.added", "link.added"]);
    expect(JSON.stringify(audit)).not.toMatch(/Guide|example\.org|help@/);
  });

  it("refuses another project's link and document, every hostile address and a lesson not listed, changing nothing", async () => {
    // A link left on a lesson of the course's own that its list no longer holds.
    await db.query(
      `INSERT INTO "Lesson" ("id", "projectId", "courseSlug", "stageKey", "updatedAt") VALUES ('unlisted-lesson', 'seq-elevate', 'r4-db', 's-zzzzzzzz', now())`
    );
    await db.query(
      `INSERT INTO "LessonLink" ("id", "lessonId", "title", "url", "updatedAt") VALUES ('unlisted-link', 'unlisted-lesson', 'x', 'https://example.org/unlisted', now())`
    );
    const before = await checksum();
    const notFound = { ok: false, error: "not-found" };
    const notListed = { ok: false, error: "not-a-section" };
    expect(await actions.setLessonLinkPublished("unlisted-link", true)).toEqual(notListed);
    expect(await actions.updateLessonLink("unlisted-link", { title: "x", url: "https://example.org/", description: "", languages: [] })).toEqual(notListed);
    expect(await actions.removeLessonLink("unlisted-link")).toEqual(notListed);
    expect(await actions.updateLessonLink("their-link", { title: "x", url: "https://example.org/", description: "", languages: [] })).toEqual(notFound);
    expect(await actions.removeLessonLink("their-link")).toEqual(notFound);
    expect(await actions.setLessonLinkPublished("their-link", false)).toEqual(notFound);
    expect(await actions.setLessonDocumentLanguages("their-doc", ["de"])).toEqual(notFound);
    expect(await actions.addLessonLink("r4-db", "s-zzzzzzzz", { title: "x", url: "https://example.org/" })).toEqual({ ok: false, error: "not-a-section" });
    expect(await actions.addLessonLink("no-such-course", "context", { title: "x", url: "https://example.org/" })).toEqual(notFound);
    for (const row of HOSTILE_ADDRESSES) {
      expect((await actions.addLessonLink("r4-db", "context", { title: "x", url: row.href as string })).ok, row.name).toBe(false);
    }
    expect(await checksum()).toBe(before);
  }, 60_000);

  it("never makes a 31st link, even when two editors add at once", async () => {
    await db.query(
      `INSERT INTO "Lesson" ("id", "projectId", "courseSlug", "stageKey", "updatedAt") VALUES ('own-lesson', 'seq-elevate', 'r4-db', $1, now())`,
      [OWN]
    );
    for (let i = 0; i < 29; i++) {
      await db.query(
        `INSERT INTO "LessonLink" ("id", "lessonId", "title", "url", "order", "updatedAt") VALUES ($1, 'own-lesson', 'x', 'https://example.org/', $2, now())`,
        [`own-${i}`, i]
      );
    }
    const both = await Promise.all([
      actions.addLessonLink("r4-db", OWN, { title: "A", url: "https://example.org/a" }),
      actions.addLessonLink("r4-db", OWN, { title: "B", url: "https://example.org/b" }),
    ]);
    expect(both.map((r) => r.ok).sort()).toEqual([false, true]);
    expect(both.find((r) => !r.ok)).toEqual({ ok: false, error: "too-many" });
    expect((await db.query(`SELECT count(*)::int AS n FROM "LessonLink" WHERE "lessonId" = 'own-lesson'`)).rows[0].n).toBe(30);
  }, 60_000);

  it("orders, shows, changes the languages of a document, and lists a stored refused address as unusable", async () => {
    const ids = (await db.query(`SELECT k."id" FROM "LessonLink" k JOIN "Lesson" l ON l."id" = k."lessonId" WHERE l."stageKey" = 'context' AND l."projectId" = 'seq-elevate' ORDER BY k."order"`)).rows.map((r) => r.id as string);
    expect(await actions.setLessonLinkOrder("r4-db", "context", [...ids].reverse())).toEqual({ ok: true });
    expect(await actions.setLessonLinkPublished(ids[0], true)).toEqual({ ok: true });
    await db.query(
      `INSERT INTO "LessonDocument" ("id", "lessonId", "name", "url", "mimeType", "sizeBytes")
       SELECT 'my-doc', "id", 'd', 'https://x.example/d', 'application/pdf', 1 FROM "Lesson" WHERE "projectId" = 'seq-elevate' AND "stageKey" = 'context'`
    );
    expect(await actions.setLessonDocumentLanguages("my-doc", ["el", "de"])).toEqual({ ok: true });
    expect((await db.query(`SELECT "languages" FROM "LessonDocument" WHERE "id" = 'my-doc'`)).rows[0].languages).toEqual(["de", "el"]);
    await db.query(
      `INSERT INTO "LessonLink" ("id", "lessonId", "title", "url", "order", "updatedAt")
       SELECT 'hostile', "id", 'Hostile', 'javascript:alert(1)', 9, now() FROM "Lesson" WHERE "projectId" = 'seq-elevate' AND "stageKey" = 'context'`
    );
    const { links } = await actions.getLessonLinks("r4-db", "context");
    expect(links.map((l) => [l.id, l.published, l.kind])).toEqual([
      [ids[1], false, "email"],
      [ids[0], true, "web"],
      ["hostile", false, null],
    ]);
    expect(links.at(-1)).toMatchObject({ unusable: true, url: "javascript:alert(1)" });
    who.roles = ["FACILITATOR"];
    expect(await actions.getLessonLinks("r4-db", "context")).toEqual({ links: [] });
    expect(await actions.setLessonLinkPublished(ids[1], true)).toEqual({ ok: false, error: "forbidden" });
    who.roles = ["CONTENT_EDITOR"];
  });

  it("loses a lesson's links with the lesson, whatever deletes it", async () => {
    await db.query(`DELETE FROM "Lesson" WHERE "id" = 'own-lesson'`);
    expect((await db.query(`SELECT count(*)::int AS n FROM "LessonLink" WHERE "lessonId" = 'own-lesson'`)).rows[0].n).toBe(0);
  });
});
