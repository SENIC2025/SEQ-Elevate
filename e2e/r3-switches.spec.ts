import { test, expect, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createWorld, removeWorld, type Person, type World, type WorldKey } from "./fixtures/people";

/**
 * Release 3 (spec 15, 18.2): the server as production starts, on the
 * `switches` project's own server (playwright.config.ts): R3_PARTNER_ACCESS
 * and STATS_FROM unset, and R3_PROFILE_GATE=off.
 *
 *   FD-E10 (SC12, guard)  until partner access is switched on, a
 *          facilitator and a partner admin see no learner and no person;
 *          an ADMIN sees everyone (D77)
 *
 * The people are the world of e2e/fixtures/people.ts. Requires a real
 * database — gated on E2E_DB=1. Everything the run makes is removed
 * afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;
test.describe.configure({ mode: "default" });

const LEARNERS: WorldKey[] = ["LA1", "LA2", "LB1", "LD1", "LN"];

/** The page's HTML and its React Server Components payload, as `person`. */
async function payload(request: APIRequestContext, person: Person, path: string): Promise<string> {
  const cookie = { Cookie: `authjs.session-token=${person.sessionToken}` };
  const html = await request.get(path, { headers: cookie, maxRedirects: 0 });
  expect(html.status(), `${path} as ${person.email}`).toBe(200);
  const rsc = await request.get(path, { headers: { ...cookie, RSC: "1" }, maxRedirects: 0 });
  expect(rsc.status(), `${path}'s payload as ${person.email}`).toBe(200);
  return `${await html.text()}\n${await rsc.text()}`;
}

describe("Release 3 switches: partner access off", () => {
  let world: World;
  const seen = (text: string, keys: readonly WorldKey[]) => keys.filter((k) => text.includes(world.marker(k)));

  test.beforeAll(async () => {
    world = await createWorld(prisma);
  });

  test.afterAll(async () => {
    if (world) await removeWorld(prisma, world);
  });

  test("FD-E10 (SC12, guard): a facilitator and a partner admin see no one; an ADMIN sees everyone", async ({
    request,
  }) => {
    for (const key of ["FA", "PAA"] as const) {
      const person = world.people[key];
      expect(seen(await payload(request, person, "/en/facilitator"), LEARNERS), `${key}'s roster`).toEqual([]);
      expect(seen(await payload(request, person, "/en/analytics?live=1"), LEARNERS), `${key}'s statistics`).toEqual([]);
    }
    const people = await payload(request, world.people.PAA, "/en/admin/people");
    expect(seen(people, ["LA1", "LA2", "FA", "EA", "PAA2"]), "PAA's people").toEqual([]);
    expect(seen(await payload(request, world.people.AS, "/en/facilitator"), LEARNERS)).toEqual(LEARNERS);
  });
});
