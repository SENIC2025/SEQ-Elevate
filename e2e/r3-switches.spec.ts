import { test, expect, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createWorld, removeWorld, type Person, type World, type WorldKey } from "./fixtures/people";
import { DEFAULT_STATS_FROM } from "../src/lib/stats-from";

/**
 * Release 3 (spec 15, 18.2): the server as production starts, on the
 * `switches` project's own server (playwright.config.ts): R3_PARTNER_ACCESS
 * and STATS_FROM unset, and R3_PROFILE_GATE=off.
 *
 *   FD-E10 (SC12, guard)  until partner access is switched on, a
 *          facilitator and a partner admin see no learner and no person;
 *          an ADMIN sees everyone (D77)
 *   C-E1   the statistics count from STATS_FROM's default, 1 December
 *          2026 (spec 7.3): a learner who started before it isn't counted
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
  /** Every learner of the world started the world's course at `at`. */
  const startedAt = (at: Date) =>
    prisma.courseEnrollment.updateMany({ where: { courseId: world.course.id }, data: { enrolledAt: at } });

  test.beforeAll(async () => {
    world = await createWorld(prisma);
  });

  test.afterAll(async () => {
    if (world) await removeWorld(prisma, world);
  });

  test("FD-E10 (SC12, guard): a facilitator and a partner admin see no one; an ADMIN sees everyone", async ({
    request,
  }) => {
    // The statistics count from STATS_FROM, unset here: 1 December 2026
    // (spec 7.3). The world's learners started then, so the statistics
    // count them, and "no one" below comes from the switch, not the date.
    await startedAt(new Date(DEFAULT_STATS_FROM));
    for (const key of ["FA", "PAA"] as const) {
      const person = world.people[key];
      expect(seen(await payload(request, person, "/en/facilitator"), LEARNERS), `${key}'s roster`).toEqual([]);
      expect(seen(await payload(request, person, "/en/analytics?live=1"), LEARNERS), `${key}'s statistics`).toEqual([]);
    }
    const people = await payload(request, world.people.PAA, "/en/admin/people");
    expect(seen(people, ["LA1", "LA2", "FA", "EA", "PAA2"]), "PAA's people").toEqual([]);
    // The controls: the same pages show an ADMIN every learner, so "no one"
    // above comes from the switch, not from pages that show no one.
    expect(seen(await payload(request, world.people.AS, "/en/facilitator"), LEARNERS), "AS's roster").toEqual(LEARNERS);
    expect(seen(await payload(request, world.people.AS, "/en/analytics?live=1"), LEARNERS), "AS's statistics").toEqual(
      LEARNERS
    );
  });

  test("C-E1: the statistics count from 1 December 2026 when STATS_FROM is unset", async ({ request }) => {
    const statistics = async () => seen(await payload(request, world.people.AS, "/en/analytics?live=1"), LEARNERS);
    // Started a moment before it: none of them is counted (an ADMIN's
    // roster still lists them all).
    await startedAt(new Date(Date.parse(DEFAULT_STATS_FROM) - 1));
    expect(await statistics(), "started before 1 December 2026").toEqual([]);
    expect(seen(await payload(request, world.people.AS, "/en/facilitator"), LEARNERS), "AS's roster").toEqual(LEARNERS);
    // Started at that moment: each is.
    await startedAt(new Date(DEFAULT_STATS_FROM));
    expect(await statistics(), "started on 1 December 2026").toEqual(LEARNERS);
  });
});
