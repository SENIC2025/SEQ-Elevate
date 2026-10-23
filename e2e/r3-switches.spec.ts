import { test, expect, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, createWorld, removeWorld, runId, type Person, type World, type WorldKey } from "./fixtures/people";
import { DEFAULT_STATS_FROM } from "../src/lib/stats-from";

/**
 * Release 3 (spec 15, 18.2): the server as production starts, on the
 * `switches` project's own server (playwright.config.ts): R3_PARTNER_ACCESS
 * and STATS_FROM unset, R3_PROFILE_GATE=off, and demo sign-in off (D98).
 *
 *   FD-E10 (SC12, guard)  until partner access is switched on, a
 *          facilitator and a partner admin see no learner and no person;
 *          an ADMIN sees everyone (D77)
 *   C-E1   the statistics count from STATS_FROM's default, 1 December
 *          2026 (spec 7.3): a learner who started before it isn't counted
 *   SS6 (guard)  a session whose token starts with "demo-" resolves to no
 *          one where demo sign-in is off; the same session signs in on the
 *          main server, which allows demo sign-in
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

describe("Release 3 switches: demo sign-in off (SS6)", () => {
  const RUN = runId();
  const emails = { demo: `e2e-ss6-demo-${RUN}@example.com`, control: `e2e-ss6-control-${RUN}@example.com` };
  let demo: Person;
  let control: Person;
  /** The main server, which allows demo sign-in (playwright.config.ts SERVER_ENV). */
  const MAIN = `http://localhost:${process.env.E2E_PORT ?? "3000"}`;
  const as = (person: Person) => ({ Cookie: `authjs.session-token=${person.sessionToken}` });

  test.beforeAll(async () => {
    // Two ADMINs with complete profiles: one signed in as a demo sign-in
    // signs in (its token starts with "demo-"), one as any other sign-in.
    demo = await createPerson(prisma, { email: emails.demo, roles: ["ADMIN"], session: { sessionToken: `demo-e2e-ss6-${RUN}` } });
    control = await createPerson(prisma, { email: emails.control, roles: ["ADMIN"] });
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
  });

  test("SS6 (guard): a session whose token starts with demo- resolves to no one where demo sign-in is off", async ({
    request,
  }) => {
    const sessionOf = async (base: string, person: Person) => {
      const res = await request.get(`${base}/api/auth/session`, { headers: as(person) });
      expect(res.status()).toBe(200);
      return ((await res.json()) as { user?: { email?: string } } | null)?.user?.email ?? null;
    };
    // This server: the demo session finds no one, on the session endpoint,
    // a page and a route handler; the other session finds its ADMIN.
    expect(await sessionOf("", demo), "the demo session").toBeNull();
    expect(await sessionOf("", control), "the other session").toBe(emails.control);
    const dataPage = async (person: Person) => {
      const res = await request.get("/en/admin/data", { headers: as(person), maxRedirects: 0 });
      return { status: res.status(), html: await res.text() };
    };
    const asDemo = await dataPage(demo);
    expect(asDemo.html, "Data, with the demo session").toContain("Admins only");
    expect(asDemo.html).not.toContain(emails.demo);
    const asControl = await dataPage(control);
    expect(asControl.status).toBe(200);
    expect(asControl.html, "Data, with the other session").not.toContain("Admins only");
    expect((await request.get("/api/me/export", { headers: as(demo) })).status(), "the data download, demo").toBe(401);
    expect((await request.get("/api/me/export", { headers: as(control) })).status(), "the data download, other").toBe(200);

    // The control: the same session row signs in on the main server, where
    // demo sign-in is allowed, so "no one" above comes from the setting.
    expect(await sessionOf(MAIN, demo), "the demo session where demo sign-in is allowed").toBe(emails.demo);
    // The row is still there: it resolves to no one, nothing deletes it.
    expect(await prisma.session.count({ where: { sessionToken: demo.sessionToken } })).toBe(1);
  });
});
