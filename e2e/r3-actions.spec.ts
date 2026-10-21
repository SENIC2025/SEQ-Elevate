import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createWorld, removeWorld, type World } from "./fixtures/people";
import { actionId, builtActions, callAction } from "./fixtures/server-action";
import {
  TABLE,
  coverage,
  matches,
  otherOrganisationOf,
  rowKey,
  snapshot,
  targetOf,
  useServerExports,
  type CallRow,
  type Ctx,
  type Persona,
  type RouteRow,
  type Stream,
} from "./fixtures/r3-action-table";

/**
 * Release 3 (spec 18.3, FD-E11): every exported server action, called
 * directly — never through what a screen offers — by each person who must
 * be refused, aimed at someone they must not reach: the call is refused
 * (the answer the row names) and the database is unchanged (a row count
 * and checksum of the world's rows in each table the row names, before
 * and after). The rows are in e2e/fixtures/r3-action-table/, one file per
 * stream, and this spec fails when an export of a "use server" file, or an
 * action the build has, has no row.
 *
 * Personas: the world's FA, FB, FN, FI, PAA, EA and LA1 (e2e/fixtures/
 * people.ts), and someone with no session. On the old build the partner
 * admin holds no role (PARTNER_ADMIN doesn't exist there), so its rows are
 * guards.
 *
 * Requires a real database — gated on E2E_DB=1. Everything the run makes
 * is unique to it and removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;

test("every exported action is in the table, once", () => {
  const exports = useServerExports();
  expect(exports.length, "the scan finds the actions").toBeGreaterThan(40);
  const { missing, stale, twice } = coverage(exports, builtActions());
  expect(missing, "exports with no row in e2e/fixtures/r3-action-table/").toEqual([]);
  expect(stale, "rows naming no export").toEqual([]);
  expect(twice, "rows listed twice").toEqual([]);
});

describe("Every action refuses who it must, and changes nothing", () => {
  // In order, in one worker: one world, and a failure doesn't stop the rest.
  test.describe.configure({ mode: "default" });
  let world: World;

  test.beforeAll(async () => {
    world = await createWorld(prisma);
  });

  test.afterAll(async () => {
    if (world) await removeWorld(prisma, world);
  });

  const ctx = (as: Persona): Ctx => ({
    world,
    as,
    target: world.people[targetOf(as)],
    other: world.organisations[otherOrganisationOf(as)],
    run: world.run,
  });
  const caller = (as: Persona) => (as === "anonymous" ? null : world.people[as]);

  test("an export no page imports has no action id in the build", () => {
    for (const row of TABLE.filter((r) => r.kind === "unbuilt")) {
      expect(() => actionId(row.file, row.name), rowKey(row)).toThrow(/0 ids/);
    }
  });

  for (const row of TABLE.filter((r): r is CallRow & { stream: Stream } => r.kind === "call")) {
    for (const as of row.refuse) {
      test(`${row.name} (${row.file.replace("src/app/actions/", "")}) refuses ${as}`, async ({ request }) => {
        const c = ctx(as);
        const before = await snapshot(prisma, world, row.tables);
        const answer = await callAction(request, {
          as: caller(as),
          page: typeof row.page === "string" ? row.page : row.page(c),
          file: row.file,
          name: row.name,
          args: row.args(c),
        });
        const outcome = row.outcome(as);
        const { ok, got } = matches(answer, outcome);
        // Soft: a call that goes through is reported with what it changed.
        expect
          .soft(ok, `${rowKey(row)} as ${as}: answered ${JSON.stringify(got)}, wanted ${JSON.stringify(outcome)} (${row.why})`)
          .toBe(true);
        expect(await snapshot(prisma, world, row.tables), `${rowKey(row)} as ${as} changed nothing`).toEqual(before);
      });
    }
    for (const as of row.pending?.personas ?? []) {
      test.fixme(`${row.name} (${row.file.replace("src/app/actions/", "")}) refuses ${as}: ${row.pending!.by}`, () => {});
    }
  }

  for (const row of TABLE.filter((r): r is RouteRow & { stream: Stream } => r.kind === "route")) {
    for (const as of row.refuse) {
      test(`${row.route} refuses ${as}`, async ({ request }) => {
        const c = ctx(as);
        const person = caller(as);
        const before = await snapshot(prisma, world, row.tables);
        const response = await request.fetch(row.path(c), {
          method: row.method,
          headers: {
            ...(person ? { Cookie: `authjs.session-token=${person.sessionToken}` } : {}),
            ...(row.headers?.(c) ?? {}),
          },
          data: row.body ? JSON.stringify(row.body(c)) : undefined,
          maxRedirects: 0,
          failOnStatusCode: false,
        });
        expect.soft(response.status(), `${row.route} as ${as} (${row.why})`).toBe(row.status(as));
        expect(await snapshot(prisma, world, row.tables), `${row.route} as ${as} changed nothing`).toEqual(before);
      });
    }
    for (const as of row.pending?.personas ?? []) {
      test.fixme(`${row.route} refuses ${as}: ${row.pending!.by}`, () => {});
    }
  }
});
