import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A course the OLD createCourse makes while a deploy builds gets no badge
// from the one-shot migration (C9). The deploy runs the migration's steps
// again on every build, after the migrations, so such a course is given its
// badge by the next deploy at the latest. No database here: the client is a
// stand-in that records what it was asked to run.
const { backfillCourseBadges, main, BACKFILL_SQL_FILE } = await import(
  "../../../prisma/backfill-course-badges.mjs"
);

const root = fileURLToPath(new URL("../../../", import.meta.url));
const migrationSql = readFileSync(
  `${root}prisma/migrations/20261013120000_created_course_badges/migration.sql`,
  "utf8"
);

/** A pg client stand-in: one result per statement of a multi-statement query. */
function fakeClient(counts = [2, 2, 5], fail?: Error) {
  const queries: string[] = [];
  return {
    queries,
    connect: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql === migrationSql) {
        if (fail) throw fail;
        return counts.map((rowCount) => ({ rowCount }));
      }
      return { rowCount: null };
    }),
  };
}

const quietLog = () => ({ log: vi.fn(), error: vi.fn() });

describe("vercel-build", () => {
  it("fills in created-course badges after every migration run, before the build goes on", () => {
    const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
    const steps = (pkg.scripts["vercel-build"] as string).split("&&").map((s) => s.trim());
    const migrate = steps.indexOf("node prisma/migrate-deploy.mjs");
    expect(migrate).toBeGreaterThanOrEqual(0);
    expect(steps[migrate + 1]).toBe("node prisma/backfill-course-badges.mjs");
  });
});

describe("backfillCourseBadges", () => {
  it("runs the migration's own SQL, unchanged, in one transaction", async () => {
    expect(BACKFILL_SQL_FILE).toBe(
      `${root}prisma/migrations/20261013120000_created_course_badges/migration.sql`
    );
    const client = fakeClient();
    await backfillCourseBadges(client);
    expect(client.queries).toEqual(["BEGIN", migrationSql, "COMMIT"]);
  });

  it("answers how many badges, links and learner badges it added", async () => {
    await expect(backfillCourseBadges(fakeClient([1, 1, 3]))).resolves.toEqual({
      badges: 1,
      linked: 1,
      awards: 3,
    });
  });

  it("rolls back and passes the error on when a step fails", async () => {
    const client = fakeClient(undefined, new Error("boom"));
    await expect(backfillCourseBadges(client)).rejects.toThrow("boom");
    expect(client.queries).toEqual(["BEGIN", migrationSql, "ROLLBACK"]);
  });

  it("refuses an SQL file that no longer has its three steps", async () => {
    const client = fakeClient([1, 1]);
    await expect(backfillCourseBadges(client)).rejects.toThrow(/three/);
    expect(client.queries.at(-1)).toBe("ROLLBACK");
  });
});

describe("main", () => {
  it("skips without a real database, like the migrations do", async () => {
    for (const DATABASE_URL of [undefined, "", "postgresql://placeholder/db"]) {
      const createClient = vi.fn();
      const log = quietLog();
      await expect(main({ DATABASE_URL }, { createClient, log })).resolves.toBe(0);
      expect(createClient).not.toHaveBeenCalled();
    }
  });

  it("runs on a deploy with the demo turned off, and logs only counts", async () => {
    const client = fakeClient([1, 1, 3]);
    const log = quietLog();
    const code = await main(
      { DATABASE_URL: "postgresql://u:secret@db.example/app", DEMO_LOGIN_DISABLED: "true" },
      { createClient: () => client, log }
    );
    expect(code).toBe(0);
    expect(client.end).toHaveBeenCalled();
    const printed = log.log.mock.calls.flat().join(" ");
    expect(printed).toMatch(/1 badge/);
    expect(printed).toMatch(/3 learner/);
    expect(printed).not.toContain("secret");
  });

  it("fails the build when the backfill fails", async () => {
    const client = fakeClient(undefined, new Error("relation does not exist"));
    const log = quietLog();
    const code = await main(
      { DATABASE_URL: "postgresql://u:secret@db.example/app" },
      { createClient: () => client, log }
    );
    expect(code).toBe(1);
    expect(client.end).toHaveBeenCalled();
    expect(log.error.mock.calls.flat().join(" ")).not.toContain("secret");
  });
});
