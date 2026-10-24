import { test, expect, type APIRequestContext, type BrowserContext, type Page, type Request } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PROJECT, createPerson, removePeople, runId, signIn } from "./fixtures/people";
import { callAction } from "./fixtures/server-action";

/**
 * Release 3: a learner's Comp Card save that must outlive the tab (D37 as
 * built, 24 October; the integrator's decision (b)). Next sends a page's
 * server actions one at a time: a card save handed over while another is
 * on its way waits behind it and never leaves a page that goes. On
 * `pagehide` the store sends the fields of the card the server hasn't
 * confirmed, while a card save is on its way or failed, outside that
 * queue too, to POST /api/progress/beacon with fetch(keepalive), which the
 * browser finishes after the page has gone; the route saves them through
 * the card's save action (saveCompCard).
 *
 *   CB-E1  the tab closed with the card's save on its way (written by the
 *          server, its answer reaching no page) and more typed after it
 *          left; the card opened again in a new tab: the account and the
 *          new tab hold what the learner left
 *   CB-E2  reloaded the same way, the save's answer arriving after the
 *          reloaded page is in: the reloaded page and the account hold
 *          what the learner left
 *   CB-E3  natural timing, nothing held: the card's save leaves, more is
 *          typed at once and the tab closed at once; six tries, none lost
 *   CB-E4  guard: the tab closed within the save pause, nothing on its
 *          way: the account holds the change
 *   CB-E5  the route refuses a card save as it refuses a course save, and
 *          changes nothing: no session, another account's, a profile step
 *          not done (D79), a text over 2,000 characters (D80), a body that
 *          is both or neither
 *   CB-E6  the route saves a card as the save action does: only the fields
 *          sent, sharing never changed (D80), never audited; the same save
 *          again, and through the action, writes the same values
 *
 * CB-E1 to CB-E3, CB-E5 and CB-E6 are red on the build before (77970ed):
 * the account keeps what the save on its way carried, and the route takes
 * course saves only (400 for a card's body). CB-E4 is green there.
 *
 * The verifier's K1, K2b, K4 and K3 (cs3-verify/card-pagehide.spec.ts),
 * on Release 3's own fixtures. CB-E2 holds the saves through the
 * browser's own interception of the card page's URL alone (CDP Fetch):
 * with Playwright's page.route, which handles every request the page
 * sends in the test, a request the page sends as it is replaced by the
 * reloaded one — its keepalive request too — is dropped with it, which a
 * browser doesn't do. Requires a real database: gated on E2E_DB=1.
 * Everything the run makes is removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  : (null as unknown as PrismaClient);
const describe = DB ? test.describe : test.describe.skip;

const RUN = runId();
const CARD_PAGE = "/en/learner/comp-card";
const BEACON = "/api/progress/beacon";
const ORIGIN = `http://localhost:${process.env.E2E_PORT ?? "3000"}`;
const LEARNER_FILE = "src/app/actions/learner.ts";

const emails: string[] = [];
async function learner(tag: string, profile: "complete" | "none" = "complete") {
  const email = `e2e-r3-cb-${tag}-${RUN}@example.com`;
  emails.push(email);
  await prisma.user.deleteMany({ where: { email } });
  const person = await createPerson(prisma, { email, roles: ["LEARNER"], profile });
  return { userId: person.userId, sessionToken: person.sessionToken! };
}
async function withCard(tag: string, text: string) {
  const who = await learner(tag);
  await prisma.compCard.create({ data: { userId: who.userId, projectId: PROJECT, wentWell: text }, select: { id: true } });
  return who;
}
const cardOf = (userId: string) =>
  prisma.compCard.findUnique({
    where: { userId_projectId: { userId, projectId: PROJECT } },
    select: {
      wentWell: true,
      difficult: true,
      improve: true,
      behaviour: true,
      confidence: true,
      privacy: true,
      sharedAt: true,
      sharedWithOrganisationId: true,
      updatedAt: true,
    },
  });
const wentWellOf = async (userId: string) => (await cardOf(userId))?.wentWell ?? null;

/**
 * Holds the first server action whose body holds `marker`, as on a slow
 * connection, until released: the server gets it and writes it, and the
 * page gets nothing until finish() — then a dropped connection. The
 * page's keepalive request isn't routed through the test: a request a
 * page sends as it goes, held by the test's handler, could be dropped
 * with the page, which a browser never does.
 */
async function holdAction(page: Page, marker: string) {
  let release!: () => void;
  let finish!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const finished = new Promise<void>((resolve) => (finish = resolve));
  const state: { request: Request | null; serverStatus: number | null } = { request: null, serverStatus: null };
  await page.route((url) => url.pathname !== BEACON, async (route) => {
    const request = route.request();
    if (
      !state.request &&
      request.method() === "POST" &&
      (await request.headerValue("next-action")) &&
      (request.postData() ?? "").includes(marker)
    ) {
      state.request = request;
      await held;
      state.serverStatus = (await route.fetch()).status();
      await finished;
      await route.abort("failed").catch(() => undefined);
      return;
    }
    await route.continue().catch(() => undefined);
  });
  return { state, release, finish };
}

/**
 * The reload's version of holdAction, through the browser's own request
 * interception (CDP Fetch) of the card page's URL only, so that nothing
 * else the page sends — its keepalive request above all — is touched, as
 * nothing touches it in a browser: the first server action whose body
 * holds `first` goes to the server, which writes it, and its answer waits
 * in the browser until finish() — then a dropped connection; one whose
 * body holds `behind` never leaves, as a save waiting behind another
 * doesn't leave a page that goes before that one is answered.
 */
async function holdAcrossReload(page: Page, first: string, behind: string) {
  const cdp = await page.context().newCDPSession(page);
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  const state = { held: false, serverStatus: null as number | null, kept: 0 };
  type Paused = {
    requestId: string;
    request: { method: string; headers: Record<string, string>; postData?: string };
    responseStatusCode?: number;
  };
  cdp.on("Fetch.requestPaused", async (e: Paused) => {
    const body = e.request.postData ?? "";
    const action = e.request.method === "POST" && Object.keys(e.request.headers).some((h) => h.toLowerCase() === "next-action");
    if (e.responseStatusCode !== undefined) {
      // The first save's answer: written by the server, it reaches no page.
      state.serverStatus = e.responseStatusCode;
      await finished;
      await cdp.send("Fetch.failRequest", { requestId: e.requestId, errorReason: "Failed" }).catch(() => undefined);
    } else if (action && body.includes(behind)) {
      state.kept++;
      await cdp.send("Fetch.failRequest", { requestId: e.requestId, errorReason: "Aborted" }).catch(() => undefined);
    } else if (action && !state.held && body.includes(first)) {
      state.held = true;
      await cdp.send("Fetch.continueRequest", { requestId: e.requestId, interceptResponse: true }).catch(() => undefined);
    } else {
      await cdp.send("Fetch.continueRequest", { requestId: e.requestId }).catch(() => undefined);
    }
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: `*${CARD_PAGE}*`, requestStage: "Request" }] });
  return { state, finish };
}

/** The card's first text box ("What went well"), by the placeholder it shows when empty. */
const wentWell = (page: Page) => page.getByRole("main").getByPlaceholder("Even small wins count.", { exact: true });
/** Opens the card, once the saved card has loaded and the page can change it. */
async function openCard(context: BrowserContext, expected: string) {
  const page = await context.newPage();
  await page.goto(CARD_PAGE);
  await expect(wentWell(page), "the saved card has loaded").toHaveValue(expected, { timeout: 20_000 });
  const onlyMe = page.getByRole("main").getByRole("button", { name: "Only me" });
  await expect(onlyMe).not.toHaveAttribute("aria-disabled", "true", { timeout: 15_000 });
  await page.waitForTimeout(300);
  return page;
}
const isCardSave = (r: Request, marker: string) =>
  r.method() === "POST" && !!r.headers()["next-action"] && (r.postData() ?? "").includes(marker) && (r.postData() ?? "").includes("wentWell");

/** A request to the route as the browser's own page would send it, unless told otherwise. */
function postBeacon(request: APIRequestContext, body: unknown, opts: { sessionToken?: string; raw?: string } = {}) {
  return request.fetch(BEACON, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
      ...(opts.sessionToken ? { Cookie: `authjs.session-token=${opts.sessionToken}` } : {}),
    },
    data: opts.raw ?? JSON.stringify(body),
    maxRedirects: 0,
    failOnStatusCode: false,
  });
}

describe("Release 3: a Comp Card save that outlives the tab (D37)", () => {
  test.afterAll(async () => {
    await removePeople(prisma, emails);
    await prisma.$disconnect();
  });

  test("CB-E1 the tab closed with the card's save on its way and more typed after it left; the card opened again in a new tab: the account and the new tab hold what the learner left", async ({
    context,
  }) => {
    test.setTimeout(90_000);
    const before = `Saved: before cb1 ${RUN}`;
    const first = `first cb1 ${RUN}`;
    const more = `first cb1 ${RUN} and more typed after the save left`;
    const { userId, sessionToken } = await withCard("closed", before);
    await signIn(context, sessionToken);
    const page = await openCard(context, before);
    const held = await holdAction(page, first);
    await wentWell(page).fill(first);
    await expect.poll(() => held.state.request !== null, { timeout: 15_000 }).toBe(true);
    await wentWell(page).fill(more);
    await page.waitForTimeout(1500); // past the save pause: the next save waits behind the one on its way
    held.release();
    await expect.poll(() => held.state.serverStatus, { timeout: 15_000, message: "the server wrote the first save" }).toBe(200);
    expect(await wentWellOf(userId)).toBe(first);
    await page.close({ runBeforeUnload: true });
    held.finish();
    await expect
      .poll(() => wentWellOf(userId), { timeout: 15_000, message: "the account holds what the learner left" })
      .toBe(more);
    const other = await openCard(context, more);
    await expect(wentWell(other), "a new tab shows what the learner left").toHaveValue(more);
  });

  test("CB-E2 reloaded with the card's save on its way and more typed after it left, the save's answer arriving after the reloaded page is in: the page and the account hold what the learner left", async ({
    context,
  }) => {
    test.setTimeout(90_000);
    const before = `Saved: before cb2 ${RUN}`;
    const first = `first cb2 ${RUN}`;
    const more = `first cb2 ${RUN} and more typed after the save left`;
    const { userId, sessionToken } = await withCard("reload", before);
    await signIn(context, sessionToken);
    const page = await openCard(context, before);
    const held = await holdAcrossReload(page, first, more);
    await wentWell(page).fill(first);
    await expect.poll(() => held.state.serverStatus, { timeout: 15_000, message: "the server wrote the first save" }).toBe(200);
    expect(await wentWellOf(userId)).toBe(first);
    await wentWell(page).fill(more);
    await page.waitForTimeout(1500); // past the save pause: the next save waits behind the one on its way
    await page.reload({ waitUntil: "commit" });
    held.finish();
    await expect(wentWell(page), "the reloaded page shows what the learner left").toHaveValue(more, { timeout: 20_000 });
    await page.waitForTimeout(1500);
    await expect(wentWell(page)).toHaveValue(more);
    expect(await wentWellOf(userId), "the account holds what the learner left").toBe(more);
  });

  test("CB-E3 natural timing, nothing held: the card's save leaves, more is typed at once and the tab closed at once; six tries, none lost", async ({
    context,
  }) => {
    test.setTimeout(240_000);
    const results: { account: string | null; lost: boolean }[] = [];
    for (let i = 0; i < 6; i++) {
      const before = `Saved: before cb3-${i} ${RUN}`;
      const first = `first cb3-${i} ${RUN}`;
      const more = `${first} more`;
      const { userId, sessionToken } = await withCard(`natural-${i}`, before);
      await signIn(context, sessionToken);
      const page = await openCard(context, before);
      const left = page.waitForEvent("request", { predicate: (r) => isCardSave(r, first), timeout: 15_000 });
      await wentWell(page).fill(first);
      await left;
      await wentWell(page).fill(more);
      await page.close({ runBeforeUnload: true });
      let account: string | null = null;
      // At most 5 s for the last save to land.
      for (let wait = 0; wait < 10 && account !== more; wait++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        account = await wentWellOf(userId);
      }
      results.push({ account: account === more ? "more" : account === first ? "first" : account, lost: account !== more });
    }
    expect(results.filter((r) => r.lost), "tries that lost what was typed after the save left").toEqual([]);
  });

  test("CB-E4 guard: the tab closed within the save pause, nothing on its way: the account holds the change", async ({ context }) => {
    test.setTimeout(90_000);
    const before = `Saved: before cb4 ${RUN}`;
    const typed = `typed cb4 ${RUN}`;
    const { userId, sessionToken } = await withCard("pause", before);
    await signIn(context, sessionToken);
    const page = await openCard(context, before);
    await wentWell(page).fill(typed);
    await page.waitForTimeout(150);
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => wentWellOf(userId), { timeout: 15_000 }).toBe(typed);
  });

  test("CB-E5 the route refuses a card save as it refuses a course save, and changes nothing", async ({ request }) => {
    test.setTimeout(60_000);
    const own = await learner("refusals");
    const other = await learner("refusals-other");
    const noProfile = await learner("refusals-noprofile", "none");
    const stored = `stored cb5 ${RUN}`;
    for (const who of [own, other, noProfile]) {
      await prisma.compCard.create({ data: { userId: who.userId, projectId: PROJECT, wentWell: stored }, select: { id: true } });
    }
    const card = (forUser: string, text = `refused cb5 ${RUN}`) => ({ v: 1, forUser, card: { wentWell: text } });
    const cases: [string, Promise<{ status(): number }>, number][] = [
      ["no session", postBeacon(request, card(own.userId)), 401],
      ["another account's card", postBeacon(request, card(other.userId), { sessionToken: own.sessionToken }), 403],
      ["a profile step not done (D79)", postBeacon(request, card(noProfile.userId), { sessionToken: noProfile.sessionToken }), 403],
      ["a text over 2,000 characters (D80)", postBeacon(request, card(own.userId, "x".repeat(2001)), { sessionToken: own.sessionToken }), 413],
      [
        "a body with a course and a card",
        postBeacon(request, { ...card(own.userId), slug: "workplace-conflict", patch: { v: 2, completed: ["context"] } }, { sessionToken: own.sessionToken }),
        400,
      ],
      ["a card that isn't one", postBeacon(request, { v: 1, forUser: own.userId, card: ["wentWell"] }, { sessionToken: own.sessionToken }), 400],
      ["a confidence out of range", postBeacon(request, { v: 1, forUser: own.userId, card: { confidence: 9 } }, { sessionToken: own.sessionToken }), 400],
    ];
    for (const [what, response, status] of cases) {
      expect.soft((await response).status(), what).toBe(status);
    }
    for (const who of [own, other, noProfile]) {
      expect(await wentWellOf(who.userId), "nothing was written").toBe(stored);
    }
    expect(
      await prisma.courseEnrollment.count({ where: { userId: own.userId } }),
      "a body with a course and a card saves neither"
    ).toBe(0);
    expect(await prisma.auditLog.count({ where: { actorId: { in: [own.userId, other.userId, noProfile.userId] } } }), "nothing audited").toBe(0);
  });

  test("CB-E6 the route saves a card as the save action does: only the fields sent, its sharing never changed, never audited; the same save again and through the action writes the same values", async ({
    context,
  }) => {
    test.setTimeout(60_000);
    const { userId, sessionToken } = await learner("twice");
    const sharedAt = new Date("2026-11-21T10:00:00.000Z");
    const organisation = await prisma.projectProfile.findUnique({
      where: { userId_projectId: { userId, projectId: PROJECT } },
      select: { organisationId: true },
    });
    expect(organisation?.organisationId, "the learner is in an organisation").toBeTruthy();
    await prisma.compCard.create({
      data: {
        userId,
        projectId: PROJECT,
        wentWell: `stored went well ${RUN}`,
        difficult: `stored difficult ${RUN}`,
        privacy: "FACILITATOR",
        sharedAt,
        sharedWithOrganisationId: organisation!.organisationId,
        sharingVersion: "e2e",
      },
      select: { id: true },
    });
    await signIn(context, sessionToken);
    const body = { v: 1, forUser: userId, card: { wentWell: `sent went well ${RUN}`, confidence: 5, privacy: "SELF", sharedAt: null } };
    const first = await postBeacon(context.request, body);
    expect(first.status()).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    const once = await cardOf(userId);
    expect(once, "only the fields sent are written; who sees the card stays as it was").toMatchObject({
      wentWell: `sent went well ${RUN}`,
      difficult: `stored difficult ${RUN}`,
      confidence: 5,
      privacy: "FACILITATOR",
      sharedAt,
      sharedWithOrganisationId: organisation!.organisationId,
    });

    const again = await postBeacon(context.request, body);
    expect(again.status()).toBe(200);
    const viaAction = await callAction(context.request, {
      as: { sessionToken },
      page: "/en/learner",
      file: LEARNER_FILE,
      name: "saveCompCard",
      args: [body.card, userId],
    });
    expect(viaAction.result, "the save action answers as the route did").toEqual({ ok: true });
    const { updatedAt: _a, ...twice } = (await cardOf(userId))!;
    const { updatedAt: _b, ...first1 } = once!;
    void _a;
    void _b;
    expect(twice, "the same values").toEqual(first1);
    expect(await prisma.auditLog.count({ where: { actorId: userId } }), "card saves are not audited").toBe(0);

    const page = await openCard(context, `sent went well ${RUN}`);
    await expect(page.getByRole("main").getByRole("button", { name: /^Me and the facilitators at / })).toHaveAttribute("aria-pressed", "true");
  });
});
