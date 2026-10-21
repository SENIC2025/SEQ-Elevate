import { describe, it, expect, vi } from "vitest";

// prisma/migrate-deploy.mjs (vercel-build). A migration that is one
// transaction (BEGIN … COMMIT) applies all or nothing, but when one of its
// statements fails, Prisma prints only "current transaction is aborted". The
// wrapper then runs the failed migration again in a transaction that is
// rolled back, and prints the database's own error and what to do next. No
// database here: Prisma and the client are stand-ins that record what they
// were asked.
const { main, rerunRolledBack } = await import("../../prisma/migrate-deploy.mjs");

const NAME = "20261120090100_r3_people_privacy_content";
const ONE_TRANSACTION = `-- a comment; with a semicolon
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE FUNCTION "f"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END;
$$;
SELECT 1/0;
COMMIT;
`;
const ABORTED = `Applying migration \`${NAME}\`\nError: ERROR: current transaction is aborted, commands ignored until end of transaction block\n`;

/** The migrations folder, holding only `NAME` with `sql`. */
const migrationsWith = (sql: string) => (name: string) => (name === NAME ? sql : null);

/** A pg client stand-in: the failed migration's name, and `rerun` for the file run again. */
function fakeClient(rerun: () => unknown = () => ({ rowCount: 0 })) {
  const queries: string[] = [];
  return {
    queries,
    connect: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes(`FROM "_prisma_migrations"`)) return { rows: [{ migration_name: NAME }] };
      if (sql.startsWith("BEGIN")) return rerun();
      return { rows: [] };
    }),
  };
}

const quietLog = () => ({ log: vi.fn(), error: vi.fn() });
const printed = (log: ReturnType<typeof quietLog>) =>
  [...log.log.mock.calls, ...log.error.mock.calls].map((c) => String(c[0])).join("\n");
const ENV = { DATABASE_URL: "postgresql://u:p@host-pooler.example/db" };

describe("migrate-deploy", () => {
  it("skips without a real database, and passes the direct endpoint to Prisma", async () => {
    const deploy = vi.fn(() => ({ status: 0, output: "" }));
    expect(await main({}, { deploy, log: quietLog() })).toBe(0);
    expect(deploy).not.toHaveBeenCalled();
    expect(await main(ENV, { deploy, log: quietLog() })).toBe(0);
    expect(deploy).toHaveBeenCalledWith("postgresql://u:p@host.example/db");
  });

  it("after Prisma's 'current transaction is aborted', prints the database's own error and the next step", async () => {
    const client = fakeClient(() => {
      throw Object.assign(new Error("division by zero"), { code: "22012", detail: "a row's values" });
    });
    const log = quietLog();
    const code = await main(ENV, {
      deploy: () => ({ status: 1, output: ABORTED }),
      createClient: () => client,
      log,
      readMigration: migrationsWith(ONE_TRANSACTION),
    });
    expect(code).toBe(1);
    expect(printed(log)).toContain("the database's own error: 22012 division by zero");
    expect(printed(log)).toContain(`nothing of it was applied`);
    expect(printed(log)).toContain(`npx prisma migrate resolve --rolled-back ${NAME}`);
    expect(printed(log)).not.toContain("a row's values");
    expect(printed(log)).not.toContain("u:p@");
    // Run again without its COMMIT, then rolled back: nothing can commit.
    const rerun = client.queries.find((q) => q.startsWith("BEGIN"))!;
    expect(rerun).toContain("SELECT 1/0");
    expect(rerun).not.toMatch(/\bCOMMIT\b/);
    expect(client.queries.at(-1)).toBe("ROLLBACK");
  });

  it("says when the file went through the second time (a lock wait or a deadlock then)", async () => {
    const client = fakeClient();
    const log = quietLog();
    await main(ENV, {
      deploy: () => ({ status: 1, output: ABORTED }),
      createClient: () => client,
      log,
      readMigration: migrationsWith(ONE_TRANSACTION),
    });
    expect(printed(log)).toContain("it went through this time (rolled back)");
    expect(client.queries.at(-1)).toBe("ROLLBACK");
  });

  it("runs nothing again for any other failure", async () => {
    const createClient = vi.fn();
    const log = quietLog();
    expect(
      await main(ENV, { deploy: () => ({ status: 1, output: "Error: P3018 …" }), createClient, log })
    ).toBe(1);
    expect(createClient).not.toHaveBeenCalled();
    expect(printed(log)).toContain("FAILED");
  });

  it("never runs again a file that isn't one transaction", async () => {
    const client = fakeClient();
    await expect(rerunRolledBack(client, "CREATE TABLE x (); COMMIT; BEGIN; SELECT 1; COMMIT;")).rejects.toThrow(
      /one transaction/
    );
    await expect(rerunRolledBack(client, "ALTER TABLE x ADD COLUMN y int;")).rejects.toThrow(/one transaction/);
    expect(client.queries).toEqual([]);
  });
});
