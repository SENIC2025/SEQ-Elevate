import { test, expect, type APIRequestContext, type BrowserContext, type Page, type Request } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, removePeople, runId, signIn } from "./fixtures/people";
import { callAction } from "./fixtures/server-action";

/**
 * Release 3: a learner's course save that must outlive the tab (D37 as
 * built, 24 October). Next sends a page's server actions one at a time: a
 * course save handed over while another is on its way waits behind it and
 * never leaves a page that goes. On `pagehide` the store sends what the
 * server hasn't confirmed of each course with a save on its way or failed
 * outside that queue too, to POST /api/progress/beacon with
 * fetch(keepalive), which the browser finishes after the page has gone.
 *
 *   PB-E1  the tab closed with the change's save on its way (written by
 *          the server, its answer reaching no page) and the change back's
 *          waiting behind it; the course opened again in a new tab: the
 *          account and the new tab hold what the learner left
 *   PB-E2  the tab closed with one question's save on its way and another
 *          question answered after it left: the account holds both
 *   PB-E3  guard: the tab closed within the save pause, nothing on its
 *          way: the account holds the change
 *   PB-E4  the route refuses what it must, and changes nothing: another
 *          method, another site (Origin, Sec-Fetch-Site, neither sent),
 *          a body that isn't JSON or is too big, no session, another
 *          account's save, a profile step not done (D79), a course not in
 *          the project
 *   PB-E5  the route saves as the save action does, and a save that
 *          arrives both ways writes the same values: the answer, the
 *          finished lessons, the completion once (its first date), one
 *          badge
 *
 * PB-E1, PB-E2, PB-E4 and PB-E5 are red on the build before the route
 * (b97963c): the account holds the change (PB-E1) or only the first
 * question (PB-E2), and the route isn't there (404). PB-E3 is green there.
 *
 * Requires a real database: gated on E2E_DB=1. Everything the run makes
 * is removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  : (null as unknown as PrismaClient);
const describe = DB ? test.describe : test.describe.skip;

const RUN = runId();
const SLUG = "workplace-conflict";
const BADGE = "voice-without-edges";
const BEACON = "/api/progress/beacon";
const ORIGIN = `http://localhost:${process.env.E2E_PORT ?? "3000"}`;
const SEVEN = ["context", "concept", "behaviour", "simulation", "scenario", "reflection", "assessment"];

const emails: string[] = [];
async function learner(tag: string, profile: "complete" | "none" = "complete") {
  const email = `e2e-r3-pb-${tag}-${RUN}@example.com`;
  emails.push(email);
  await prisma.user.deleteMany({ where: { email } });
  const person = await createPerson(prisma, { email, roles: ["LEARNER"], profile });
  return { userId: person.userId, sessionToken: person.sessionToken! };
}

const enrolment = (userId: string) =>
  prisma.courseEnrollment.findFirst({
    where: { userId, course: { slug: SLUG } },
    select: { reflection: true, stagesCompleted: true, completedAt: true, updatedAt: true },
  });
const reflectionOf = async (userId: string) =>
  ((await enrolment(userId))?.reflection as Record<string, string> | null) ?? null;
const badges = (userId: string) => prisma.userBadge.count({ where: { userId, badge: { slug: BADGE } } });

/**
 * Holds the first server action whose body holds `marker`, as on a slow
 * connection, until released: the server gets it and writes it, and the
 * page gets nothing until finish() — then a dropped connection.
 */
async function holdAction(page: Page, marker: string) {
  let release!: () => void;
  let finish!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const finished = new Promise<void>((resolve) => (finish = resolve));
  const state: { request: Request | null; serverStatus: number | null } = { request: null, serverStatus: null };
  await page.route("**/*", async (route) => {
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

const cont = (page: Page) => page.getByRole("button", { name: /^continue$/i });
const box = (page: Page, n = 0) => page.getByRole("main").getByRole("textbox").nth(n);
const loadOf = (r: { request(): Request }) =>
  r.request().method() === "POST" && r.request().postData() === JSON.stringify([SLUG, "en"]);
async function openCourse(context: BrowserContext) {
  const page = await context.newPage();
  const loaded = page.waitForResponse(loadOf);
  await page.goto(`/en/learner/course/${SLUG}`);
  await loaded;
  await page.waitForTimeout(300);
  return page;
}
function nextSave(page: Page, holding: string) {
  return page.waitForResponse(async (r) => {
    const req = r.request();
    const body = req.postData() ?? "";
    return (
      req.method() === "POST" && !!(await req.headerValue("next-action")) && body.startsWith(`["${SLUG}",{`) && body.includes(holding)
    );
  });
}
async function atReflection(context: BrowserContext, before: string) {
  const page = await openCourse(context);
  const step = page
    .getByRole("navigation", { name: /^course stages$/i })
    .filter({ visible: true })
    .getByRole("button", { name: /guided practice/i });
  if (await step.isEnabled()) await step.click();
  else for (let i = 0; i < 3; i++) await cont(page).click();
  await page.getByText(/the bus was late\. when you say/i).click();
  await cont(page).click();
  await page.getByText(/wait for a quiet moment, then talk to sam/i).click();
  await page.getByText(/addressed directly from now on/i).click();
  await cont(page).click();
  await expect(box(page)).toBeVisible();
  const saved = nextSave(page, before);
  await box(page).fill(before);
  await saved;
  return page;
}
async function reflectionIn(page: Page) {
  const step = page
    .getByRole("navigation", { name: /^course stages$/i })
    .filter({ visible: true })
    .getByRole("button", { name: /reflection/i });
  if (await step.isEnabled()) await step.click();
  await expect(box(page)).toBeVisible();
}
/** A request to the route as the browser's own page would send it, unless told otherwise. */
function postBeacon(
  request: APIRequestContext,
  body: unknown,
  opts: { sessionToken?: string; headers?: Record<string, string>; method?: string; raw?: string } = {}
) {
  return request.fetch(BEACON, {
    method: opts.method ?? "POST",
    headers: {
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
      ...(opts.sessionToken ? { Cookie: `authjs.session-token=${opts.sessionToken}` } : {}),
      ...opts.headers,
    },
    data: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    maxRedirects: 0,
    failOnStatusCode: false,
  });
}
const reflectionPatch = (p1: string) => ({ v: 2, answers: { "reflection/main": { type: "reflection", text: { p1 } } } });

describe("Release 3: a course save that outlives the tab (D37)", () => {
  test.afterAll(async () => {
    await removePeople(prisma, emails);
    await prisma.$disconnect();
  });

  test("PB-E1 the tab closed with the change's save on its way and the change back's waiting behind it; the course opened again in a new tab: the account and the new tab hold what the learner left", async ({
    context,
  }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = await learner("closed");
    await signIn(context, sessionToken);
    const before = `before pb1 ${RUN}`;
    const changed = `changed pb1 ${RUN}`;
    const page = await atReflection(context, before);
    const held = await holdAction(page, changed);
    await box(page).fill(changed);
    await expect.poll(() => held.state.request !== null, { timeout: 15_000 }).toBe(true);
    await box(page).fill(before);
    await page.waitForTimeout(2000); // past the save pause: the change back's save waits behind the change's
    held.release();
    await expect.poll(() => held.state.serverStatus, { timeout: 15_000, message: "the server wrote the change" }).toBe(200);
    expect((await reflectionOf(userId))?.p1).toBe(changed);
    await page.close({ runBeforeUnload: true });
    held.finish();
    await expect
      .poll(async () => (await reflectionOf(userId))?.p1, { timeout: 15_000, message: "the account holds what the learner left" })
      .toBe(before);
    const other = await openCourse(context);
    await reflectionIn(other);
    await expect(box(other), "a new tab shows what the learner left").toHaveValue(before);
  });

  test("PB-E2 the tab closed with one question's save on its way and another question answered after it left: the account holds both", async ({
    context,
  }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = await learner("second");
    await signIn(context, sessionToken);
    const before = `before pb2 ${RUN}`;
    const first = `first pb2 ${RUN}`;
    const second = `second pb2 ${RUN}`;
    const page = await atReflection(context, before);
    const held = await holdAction(page, first);
    await box(page).fill(first);
    await expect.poll(() => held.state.request !== null, { timeout: 15_000 }).toBe(true);
    await box(page, 1).fill(second);
    await page.waitForTimeout(200);
    held.release();
    await expect.poll(() => held.state.serverStatus, { timeout: 15_000 }).toBe(200);
    await page.close({ runBeforeUnload: true });
    held.finish();
    await expect
      .poll(async () => (await reflectionOf(userId))?.p2, { timeout: 15_000, message: "the account holds the second answer" })
      .toBe(second);
    expect((await reflectionOf(userId))?.p1).toBe(first);
    const other = await openCourse(context);
    await reflectionIn(other);
    await expect(box(other, 1)).toHaveValue(second);
  });

  test("PB-E3 guard: the tab closed within the save pause, nothing on its way: the account holds the change", async ({
    context,
  }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = await learner("pause");
    await signIn(context, sessionToken);
    const before = `before pb3 ${RUN}`;
    const typed = `typed pb3 ${RUN}`;
    const page = await atReflection(context, before);
    await box(page).fill(typed);
    await page.waitForTimeout(150);
    await page.close({ runBeforeUnload: true });
    await expect.poll(async () => (await reflectionOf(userId))?.p1, { timeout: 15_000 }).toBe(typed);
  });

  test("PB-E4 the route refuses what it must, and changes nothing", async ({ request }) => {
    test.setTimeout(60_000);
    const own = await learner("refusals");
    const other = await learner("refusals-other");
    const noProfile = await learner("refusals-noprofile", "none");
    const save = (forUser: string, slug = SLUG) => ({ v: 1, slug, forUser, patch: reflectionPatch(`refused ${RUN}`) });
    const big = { v: 1, slug: SLUG, forUser: own.userId, patch: reflectionPatch("x".repeat(70 * 1024)) };
    const cases: [string, Promise<{ status(): number }>, number][] = [
      ["a GET", postBeacon(request, undefined, { sessionToken: own.sessionToken, method: "GET" }), 405],
      [
        "another site's Origin",
        postBeacon(request, save(own.userId), { sessionToken: own.sessionToken, headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" } }),
        403,
      ],
      [
        "a look-alike Origin",
        postBeacon(request, save(own.userId), { sessionToken: own.sessionToken, headers: { Origin: `${ORIGIN}.evil.example` } }),
        403,
      ],
      [
        "Sec-Fetch-Site: cross-site",
        postBeacon(request, save(own.userId), { sessionToken: own.sessionToken, headers: { "Sec-Fetch-Site": "cross-site" } }),
        403,
      ],
      [
        "Sec-Fetch-Site: same-site",
        postBeacon(request, save(own.userId), { sessionToken: own.sessionToken, headers: { "Sec-Fetch-Site": "same-site" } }),
        403,
      ],
      ["a form's content type", postBeacon(request, save(own.userId), { sessionToken: own.sessionToken, headers: { "Content-Type": "text/plain" } }), 415],
      ["a body that isn't JSON", postBeacon(request, undefined, { sessionToken: own.sessionToken, raw: "{not json" }), 400],
      ["a body over 64 KiB", postBeacon(request, big, { sessionToken: own.sessionToken }), 413],
      ["no session", postBeacon(request, save(own.userId)), 401],
      ["another account's save", postBeacon(request, save(other.userId), { sessionToken: own.sessionToken }), 403],
      ["a profile step not done (D79)", postBeacon(request, save(noProfile.userId), { sessionToken: noProfile.sessionToken }), 403],
      ["a course not in the project", postBeacon(request, save(own.userId, `e2e-no-such-course-${RUN}`), { sessionToken: own.sessionToken }), 404],
    ];
    for (const [what, response, status] of cases) {
      expect.soft((await response).status(), what).toBe(status);
    }
    // The requests without Origin and Sec-Fetch-Site: a page of this site sends at least one.
    const bare = await request.fetch(BEACON, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `authjs.session-token=${own.sessionToken}` },
      data: JSON.stringify(save(own.userId)),
      failOnStatusCode: false,
    });
    expect.soft(bare.status(), "neither Origin nor Sec-Fetch-Site").toBe(403);
    for (const who of [own, other, noProfile]) {
      expect(await enrolment(who.userId), "nothing was written").toBeNull();
      expect(await badges(who.userId)).toBe(0);
    }
    expect(await prisma.auditLog.count({ where: { actorId: { in: [own.userId, other.userId, noProfile.userId] } } }), "nothing audited").toBe(0);
  });

  test("PB-E5 the route saves as the save action does, and a save that arrives both ways writes the same values: the completion once, one badge", async ({
    context,
  }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = await learner("twice");
    await signIn(context, sessionToken);
    const answer = `twice pb5 ${RUN}`;
    const finished = new Date(Date.now() - 60_000).toISOString();
    const patch = {
      v: 2,
      completed: SEVEN,
      completedAt: finished,
      answers: { "reflection/main": { type: "reflection", text: { p1: answer } } },
    };
    const first = await postBeacon(context.request, { v: 1, slug: SLUG, forUser: userId, patch });
    expect(first.status()).toBe(200);
    expect(await first.json()).toEqual({ ok: true, refused: [] });
    const once = await enrolment(userId);
    expect(once?.reflection).toMatchObject({ p1: answer });
    expect([...(once?.stagesCompleted ?? [])].sort()).toEqual(SEVEN.map((s) => s.toUpperCase()).sort());
    expect(once?.completedAt).not.toBeNull();
    expect(await badges(userId), "the course's badge, once").toBe(1);

    // The same save again, as a beacon would after the action's: nothing changes.
    const again = await postBeacon(context.request, { v: 1, slug: SLUG, forUser: userId, patch: { ...patch, completedAt: new Date().toISOString() } });
    expect(again.status()).toBe(200);
    const twice = await enrolment(userId);
    expect(twice?.completedAt?.toISOString(), "the first completion date stays").toBe(once?.completedAt?.toISOString());
    expect(twice?.updatedAt.toISOString(), "a save that changes nothing writes nothing").toBe(once?.updatedAt.toISOString());
    expect(twice?.reflection).toEqual(once?.reflection);
    expect(await badges(userId)).toBe(1);

    // The same save through the page's save action, as Next's queue would deliver it after the beacon.
    const viaAction = await callAction(context.request, {
      as: { sessionToken },
      page: "/en/learner",
      file: "src/app/actions/learner.ts",
      name: "saveCourseProgressPatch",
      args: [SLUG, patch, userId],
    });
    expect(viaAction.result, "the save action answers as the route did").toEqual({ ok: true, refused: [] });
    expect(await enrolment(userId), "the same values: nothing written").toEqual(twice);
    expect(await badges(userId)).toBe(1);
    expect(await prisma.auditLog.count({ where: { actorId: userId } }), "learner saves are not audited").toBe(0);

    // The course opened as the learner shows it.
    const page = await openCourse(context);
    await reflectionIn(page);
    await expect(box(page)).toHaveValue(answer);
    await page.waitForTimeout(1500);
    expect((await enrolment(userId))?.completedAt?.toISOString()).toBe(once?.completedAt?.toISOString());
    expect(await badges(userId)).toBe(1);
  });
});
