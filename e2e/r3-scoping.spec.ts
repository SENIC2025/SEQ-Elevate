import { test, expect, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  createPerson,
  createWorld,
  removePeople,
  removeWorld,
  runId,
  signIn,
  type Person,
  type World,
  type WorldKey,
} from "./fixtures/people";
import { callAction } from "./fixtures/server-action";

/**
 * Release 3 (spec 18.2, FD-E1 to FD-E9): what the server lets each person
 * see, read where it can't be hidden on screen — the page's HTML and its
 * React Server Components payload — and what it lets them write, called
 * directly (e2e/fixtures/server-action.ts), never through what a screen
 * offers. The people are the world of e2e/fixtures/people.ts: organisations
 * A, B and DIESIS; each person's name and email, and each learner's Comp
 * Card text, carry a marker of their own.
 *
 *   FD-E1  the session the browser can read holds only the user's id,
 *          email and name, and when it expires (D97)
 *   FD-E2  a facilitator's roster holds their own organisation's learners
 *          only (SC1)
 *   FD-E3  so do their statistics (SC4)
 *   FD-E4  a note or a validation about another organisation's learner is
 *          refused, and nothing is written (SC2, SC3)
 *   FD-E5  a facilitator without an organisation sees no one, is told why,
 *          and can't write (SC11)
 *   FD-E6  a Comp Card's text reaches only the organisation it was shared
 *          with: never another organisation, never a SENIC admin, and a
 *          DIESIS admin only DIESIS's (SC14, SC15, D81)
 *   FD-E7  a learner with no organisation is seen by an ADMIN only
 *   FD-E8  a partner admin's overview counts their organisation (guard)
 *   FD-E9  a partner admin's people list holds their organisation's
 *          people, never another organisation's or an ADMIN (SC5, guard)
 *
 * Guards can't be shown red on the old build (it has no partner admin):
 * there the partner admin holds no role, so FD-E8 and FD-E9 fail on it for
 * that reason only. FD-E10 (no partner access) is r3-switches.spec.ts.
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
// In order, in one worker, each test on its own: a failure doesn't skip the
// rest (each says what it found on the old build too).
test.describe.configure({ mode: "default" });

const RUN = runId();
const LEARNERS: WorldKey[] = ["LA1", "LA2", "LB1", "LD1", "LN"];
const CARDS: WorldKey[] = ["LA1", "LA2", "LD1"];

/**
 * Everything `path` sends `person`: the HTML (with the payload it carries
 * inline) and the React Server Components payload a client navigation
 * fetches.
 */
async function payload(request: APIRequestContext, person: Person, path: string): Promise<string> {
  const cookie = { Cookie: `authjs.session-token=${person.sessionToken}` };
  const html = await request.get(path, { headers: cookie, maxRedirects: 0 });
  expect(html.status(), `${path} as ${person.email}`).toBe(200);
  const rsc = await request.get(path, { headers: { ...cookie, RSC: "1" }, maxRedirects: 0 });
  expect(rsc.status(), `${path}'s payload as ${person.email}`).toBe(200);
  expect(rsc.headers()["content-type"]).toContain("text/x-component");
  return `${await html.text()}\n${await rsc.text()}`;
}

describe("Release 3 scoping: the session", () => {
  const LA1 = `e2e-scoping-la1-${RUN}@example.com`;
  let la1: Person;

  test.beforeAll(async () => {
    await removePeople(prisma, [LA1]);
    la1 = await createPerson(prisma, {
      email: LA1,
      name: `LA1 ${RUN}`,
      roles: ["LEARNER"],
      user: { fontSize: "lg" },
    });
  });

  test.afterAll(async () => {
    await removePeople(prisma, [LA1]);
  });

  test("FD-E1: the session response holds only id, email and name", async ({ request }) => {
    const response = await request.get("/api/auth/session", {
      headers: { Cookie: `authjs.session-token=${la1.sessionToken}` },
    });
    expect(response.status()).toBe(200);
    const raw = await response.text();
    const body = JSON.parse(raw) as { user?: Record<string, unknown>; expires?: unknown };
    expect(Object.keys(body).sort()).toEqual(["expires", "user"]);
    expect(body.user).toEqual({ id: la1.userId, email: LA1, name: `LA1 ${RUN}` });
    expect(typeof body.expires).toBe("string");
    expect(raw).not.toContain(la1.sessionToken);
    expect(raw).not.toMatch(/sessionToken|fontSize|emailVerified|createdAt/);
  });
});

describe("Release 3 scoping: who sees and writes whose data", () => {
  let world: World;
  const seen = (text: string, keys: readonly WorldKey[]) => keys.filter((k) => text.includes(world.marker(k)));
  const cardsSeen = (text: string) => CARDS.filter((k) => text.includes(world.cardMarker(k)));
  const notesAbout = (key: WorldKey) =>
    Promise.all([
      prisma.observation.count({ where: { observedId: world.people[key].userId } }),
      prisma.validation.count({ where: { validatedId: world.people[key].userId } }),
    ]);

  test.beforeAll(async () => {
    world = await createWorld(prisma, { run: RUN });
  });

  test.afterAll(async () => {
    if (world) await removeWorld(prisma, world);
  });

  test("FD-E2 (SC1): a facilitator's roster holds their own organisation's learners only", async ({ request }) => {
    const sent = await payload(request, world.people.FB, "/en/facilitator");
    expect(seen(sent, LEARNERS)).toEqual(["LB1"]);
  });

  test("FD-E3 (SC4): a facilitator's statistics count their own organisation's learners only", async ({
    request,
  }) => {
    // ?live=1: a test copy shows the real figures however few learners started.
    const sent = await payload(request, world.people.FB, "/en/analytics?live=1");
    expect(seen(sent, LEARNERS)).toEqual(["LB1"]);
  });

  test("FD-E4 (SC2, SC3): a note or a validation about another organisation's learner is refused, nothing written", async ({
    request,
  }) => {
    const as = world.people.FB;
    const target = world.people.LA1.userId;
    const note = await callAction(request, {
      as,
      page: "/en/facilitator",
      file: "src/app/actions/facilitator.ts",
      name: "saveObservation",
      args: [target, `About another organisation's learner ${RUN}`],
    });
    expect(note.result, note.raw).toEqual({ ok: false });
    const validation = await callAction(request, {
      as,
      page: "/en/facilitator",
      file: "src/app/actions/facilitator.ts",
      name: "recordValidation",
      args: [target, "communicationEi", `Seen in another organisation ${RUN}`],
    });
    expect(validation.result, validation.raw).toEqual({ ok: false });
    expect(await notesAbout("LA1")).toEqual([0, 0]);
  });

  test("FD-E5 (SC11): a facilitator without an organisation sees no one, is told why, and can't write", async ({
    page,
    context,
    request,
  }) => {
    const as = world.people.FN;
    const sent = await payload(request, as, "/en/facilitator");
    expect(seen(sent, LEARNERS)).toEqual([]);
    await signIn(context, as.sessionToken);
    await page.goto("/en/facilitator");
    await expect(page.getByRole("main")).toContainText("Your account isn't linked to an organisation yet");
    const note = await callAction(request, {
      as,
      page: "/en/facilitator",
      file: "src/app/actions/facilitator.ts",
      name: "saveObservation",
      args: [world.people.LA1.userId, `From no organisation ${RUN}`],
    });
    expect(note.result, note.raw).toEqual({ ok: false });
    expect(await notesAbout("LA1")).toEqual([0, 0]);
  });

  test("FD-E6 (SC14, SC15): Comp Card text reaches only the organisation it was shared with", async ({
    request,
  }) => {
    // LA1 shared with A, LA2 "Only me", LD1 shared with DIESIS.
    expect(cardsSeen(await payload(request, world.people.FA, "/en/facilitator"))).toEqual(["LA1"]);
    expect(cardsSeen(await payload(request, world.people.FB, "/en/facilitator"))).toEqual([]);
    // A SENIC admin (no organisation) sees every learner and no card's text;
    // a DIESIS admin only the card shared with DIESIS (D81).
    const senic = await payload(request, world.people.AS, "/en/facilitator");
    expect(seen(senic, LEARNERS)).toEqual(LEARNERS);
    expect(cardsSeen(senic)).toEqual([]);
    expect(cardsSeen(await payload(request, world.people.AD, "/en/facilitator"))).toEqual(["LD1"]);
  });

  test("FD-E7: a learner with no organisation is seen by an ADMIN only", async ({ request }) => {
    expect(seen(await payload(request, world.people.AS, "/en/facilitator"), ["LN"])).toEqual(["LN"]);
    expect(seen(await payload(request, world.people.FA, "/en/facilitator"), ["LN"])).toEqual([]);
  });

  test("FD-E8 (guard): a partner admin's overview counts their own organisation", async ({ page, context }) => {
    await signIn(context, world.people.PAA.sessionToken);
    await page.goto("/en/admin");
    // The visible figure: while the page streams in, the server's copy can
    // sit in a hidden block for a moment.
    const stat = (label: string) =>
      page
        .locator("p", { hasText: new RegExp(`^${label}$`) })
        .locator("xpath=following-sibling::p")
        .filter({ visible: true });
    // LA1 and LA2; the world's cohort of A; A itself.
    await expect(stat("Learners")).toHaveText("2");
    await expect(stat("Cohorts")).toHaveText("1");
    await expect(stat("Organisations")).toHaveText("1");
  });

  test("FD-E9 (SC5, guard): a partner admin's people list holds their organisation's people only, never an ADMIN", async ({
    request,
  }) => {
    // An ADMIN of A too: organisation scope never shows an ADMIN holder.
    const adminOfA = await createPerson(prisma, {
      email: `e2e-${world.marker("AD")}-of-a@example.com`,
      name: `AD of A ${world.marker("AD")}`,
      roles: ["ADMIN"],
      organisation: { id: world.organisations.A.id },
    });
    try {
      const sent = await payload(request, world.people.PAA, "/en/admin/people");
      expect(seen(sent, ["LA1", "LA2", "FA", "EA", "PAA2"])).toEqual(["LA1", "LA2", "FA", "EA", "PAA2"]);
      expect(seen(sent, ["LB1", "FB", "LD1", "LN", "FN", "AD", "AS"])).toEqual([]);
      expect(sent).not.toContain(adminOfA.email);
    } finally {
      await removePeople(prisma, [adminOfA.email]);
    }
  });
});
