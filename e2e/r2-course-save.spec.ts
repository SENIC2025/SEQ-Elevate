import { test, expect, type BrowserContext, type Page, type Request } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { learnerWithSession, removeLearners, runId, signIn } from "./fixtures/r2-course";

/**
 * Release 2: a course answer changed and changed back while the change's
 * save is on its way (spec 5.4, D62). What a save sends isn't known on
 * the server until it is confirmed: the save may still be written, and
 * one whose answer is lost to a dropped connection may have been. So the
 * change back is a change, and saved; the account ends with what the page
 * shows (src/store/course-save.ts).
 *
 *   CS-E1  the reflection: the change's save is written by the server and
 *          its answer lost; the account ends with the answer on the page
 *   CS-E2  guard, a slow answer: the same with the change's save confirmed
 *   CS-E3  the practice: another option tried, then the first again, and
 *          Continue; the change's answer lost
 *   CS-E4  CS-E1, then the page reloaded: it shows what the learner left
 *   CS-E5  the page reloaded while the change's save is on its way (the
 *          server writes it; its answer reaches no page) and the change
 *          back's save waits behind it: Next sends server actions one at a
 *          time, and one waiting never leaves a page that goes. The
 *          reloaded page and the account hold what the learner left
 *   CS-E6  the same with the tab hidden, then gone with no event (a phone
 *          discarding a hidden tab) and loaded again
 *   CS-E7  guard: hidden the same way, every save answered while hidden,
 *          then gone and loaded again
 *
 * The change's save is held, as on a slow connection, until the change
 * back is made and its pause (700 ms) has passed; for a lost answer the
 * server gets it and writes it, and the page gets a dropped connection
 * instead of the answer. CS-E1, CS-E3 and CS-E4 are red on the build
 * before the rule (983be2d): the account holds the change while the page
 * shows the answer before it, and the reloaded page shows the change.
 * CS-E5 and CS-E6 are red on the build before what a page hidden or left
 * keeps (491e5a5): the reloaded page shows the change, and the account
 * holds it.
 *
 * Requires a real database — gated on E2E_DB=1, like db-backed-progress.
 * Everything it creates is unique to this run and removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  : (null as unknown as PrismaClient);
const describe = DB ? test.describe : test.describe.skip;

const RUN = runId();
const SLUG = "workplace-conflict";
const EMAILS = {
  reflection: `e2e-r2-cs-reflection-${RUN}@example.com`,
  slow: `e2e-r2-cs-slow-${RUN}@example.com`,
  practice: `e2e-r2-cs-practice-${RUN}@example.com`,
  reload: `e2e-r2-cs-reload-${RUN}@example.com`,
  onItsWay: `e2e-r2-cs-onitsway-${RUN}@example.com`,
  discarded: `e2e-r2-cs-discarded-${RUN}@example.com`,
  hiddenAnswered: `e2e-r2-cs-hidden-answered-${RUN}@example.com`,
};

const enrolment = (userId: string) =>
  prisma.courseEnrollment.findFirst({
    where: { userId, course: { slug: SLUG } },
    select: { simulationChoice: true, reflection: true, stagesCompleted: true },
  });
const p1Of = async (userId: string) => ((await enrolment(userId))?.reflection as { p1?: string } | null)?.p1 ?? null;

/**
 * Holds the first server action whose body holds `marker`, as on a slow
 * connection, until released. `lost`: the server gets it (and writes it),
 * and the page gets a dropped connection instead of the answer. `written`:
 * the server gets it and writes it once released, and the page gets
 * nothing until finish() — then a dropped connection.
 */
async function holdAction(page: Page, marker: string, answer: "slow" | "lost" | "written") {
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
      if (answer !== "slow") {
        state.serverStatus = (await route.fetch()).status();
        if (answer === "written") await finished;
        await route.abort("failed").catch(() => undefined);
        return;
      }
    }
    await route.continue().catch(() => undefined);
  });
  return { state, release, finish };
}

const isSave = (r: Request) =>
  r.method() === "POST" && !!r.headers()["next-action"] && (r.postData() ?? "").startsWith(`["${SLUG}",{`);

const cont = (page: Page) => page.getByRole("button", { name: /^continue$/i });

/** The course opened, once its saved progress has loaded. */
async function openCourse(context: BrowserContext) {
  const page = await context.newPage();
  const loaded = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.request().postData() === JSON.stringify([SLUG, "en"])
  );
  await page.goto(`/en/learner/course/${SLUG}`);
  await loaded;
  await page.waitForTimeout(300);
  return page;
}

/** The next save of the course's progress (one holding `holding`, if given) answered. */
function nextSave(page: Page, holding?: string) {
  return page.waitForResponse(async (r) => {
    const req = r.request();
    const body = req.postData() ?? "";
    return (
      req.method() === "POST" &&
      !!(await req.headerValue("next-action")) &&
      body.startsWith(`["${SLUG}",{`) &&
      (!holding || body.includes(holding))
    );
  });
}

async function toPractice(page: Page) {
  const step = page
    .getByRole("navigation", { name: /^course stages$/i })
    .filter({ visible: true })
    .getByRole("button", { name: /guided practice/i });
  if (await step.isEnabled()) await step.click();
  else for (let i = 0; i < 3; i++) await cont(page).click();
  await expect(page.getByText(/look who finally showed up/i)).toBeVisible();
}
async function practice(page: Page, option: RegExp) {
  const again = page.getByRole("button", { name: /^try another$/i });
  if (await again.isVisible()) await again.click();
  await page.getByText(option).click();
}
const BEST = /the bus was late\. when you say/i;
const SORRY = /sorry, sorry, won't happen again/i;

const reflectionBox = (page: Page) => page.getByRole("main").getByRole("textbox").nth(0);
async function toReflection(page: Page) {
  await cont(page).click();
  await page.getByText(/wait for a quiet moment, then talk to sam/i).click();
  await page.getByText(/addressed directly from now on/i).click();
  await cont(page).click();
  await expect(reflectionBox(page)).toBeVisible();
}

/**
 * At the reflection with `before` saved; then `changed` typed (its save
 * held), and `before` again. `leftSince()`: the course saves that left the
 * page since the change's.
 */
async function changeAndChangeBack(
  context: BrowserContext,
  before: string,
  changed: string,
  answer: "slow" | "lost" | "written"
) {
  const page = await openCourse(context);
  const saves: string[] = [];
  page.on("request", (r) => void (isSave(r) && saves.push(r.postData() ?? "")));
  await toPractice(page);
  await practice(page, BEST);
  await toReflection(page);
  const saved = nextSave(page, before);
  await reflectionBox(page).fill(before);
  await saved;
  const held = await holdAction(page, changed, answer);
  let at = 0;
  try {
    await reflectionBox(page).fill(changed);
    await expect.poll(() => held.state.request !== null, { timeout: 15_000 }).toBe(true);
    at = saves.length;
    await reflectionBox(page).fill(before);
    // Past the save pause (700 ms): the change back is worked out while the change's save is on its way.
    await page.waitForTimeout(2000);
  } finally {
    held.release();
  }
  return { page, held, leftSince: () => saves.length - at };
}

/** At the reflection again, once the page has loaded the course again. */
async function reflectionAfterReload(page: Page) {
  const step = page
    .getByRole("navigation", { name: /^course stages$/i })
    .filter({ visible: true })
    .getByRole("button", { name: /reflection/i });
  if (await step.isEnabled()) await step.click();
  await expect(reflectionBox(page)).toBeVisible();
}

/** The page reloaded; the held save's dropped connection reaches no page. */
async function reloadWhileHeld(page: Page, held: { finish: () => void }) {
  const loaded = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.request().postData() === JSON.stringify([SLUG, "en"])
  );
  await page.reload();
  await loaded;
  held.finish();
  await page.waitForTimeout(3000);
  await reflectionAfterReload(page);
}

/**
 * A page that can go without its pagehide and visibilitychange handlers
 * running, as a tab a phone discards: gone() from the page's side.
 */
async function discardable(context: BrowserContext) {
  await context.addInitScript(() => {
    const stop = (event: Event) => {
      if ((window as unknown as { __discarded?: boolean }).__discarded) event.stopImmediatePropagation();
    };
    window.addEventListener("pagehide", stop, true);
    document.addEventListener("visibilitychange", stop, true);
  });
}
/** The tab hidden (another app in front): the page's visibilitychange to hidden. */
async function hide(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}
/** From now on the page goes with no event, as a discarded tab. */
async function discardNext(page: Page) {
  await page.evaluate(() => void ((window as unknown as { __discarded?: boolean }).__discarded = true));
}

describe("Release 2: an answer changed back while the change's save is on its way is saved", () => {
  // Each test its own learner, removed after it: the tests may run in different workers.
  let own: string | null = null;
  const learner = async (key: keyof typeof EMAILS) => {
    own = EMAILS[key];
    return learnerWithSession(prisma, own);
  };
  test.afterEach(async () => {
    if (own) await removeLearners(prisma, [own]);
    own = null;
  });

  test("CS-E1 reflection: the change's save written by the server and its answer lost; the account ends with what the page shows", async ({
    context,
  }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = await learner("reflection");
    await signIn(context, sessionToken);
    const before = `before ${RUN}`;
    const changed = `changed ${RUN}`;
    const { page, held } = await changeAndChangeBack(context, before, changed, "lost");
    await expect.poll(() => held.state.serverStatus, { timeout: 15_000, message: "the server got the change" }).toBe(200);
    await expect(reflectionBox(page)).toHaveValue(before);
    await expect.poll(() => p1Of(userId), { timeout: 20_000, message: "the account holds what the page shows" }).toBe(before);
    await page.waitForTimeout(1500);
    expect(await p1Of(userId)).toBe(before);
    await expect(reflectionBox(page)).toHaveValue(before);
  });

  test("CS-E2 guard, a slow answer: the same with the change's save confirmed", async ({ context }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = await learner("slow");
    await signIn(context, sessionToken);
    const before = `before slow ${RUN}`;
    const changed = `changed slow ${RUN}`;
    const { page, held } = await changeAndChangeBack(context, before, changed, "slow");
    expect((await held.state.request!.response())?.status()).toBe(200);
    await expect.poll(() => p1Of(userId), { timeout: 20_000, message: "the account holds what the page shows" }).toBe(before);
    await page.waitForTimeout(1500);
    expect(await p1Of(userId)).toBe(before);
    await expect(reflectionBox(page)).toHaveValue(before);
  });

  test("CS-E3 practice: another option tried, then the first again, and Continue; the change's answer lost", async ({
    context,
  }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = await learner("practice");
    await signIn(context, sessionToken);
    const page = await openCourse(context);
    await toPractice(page);
    const answered = nextSave(page, "iStatement");
    await practice(page, BEST);
    await answered;
    expect((await enrolment(userId))?.simulationChoice).toBe("iStatement");
    const held = await holdAction(page, "shrink", "lost");
    try {
      await practice(page, SORRY);
      await expect.poll(() => held.state.request !== null, { timeout: 15_000 }).toBe(true);
      await practice(page, BEST);
      await expect(page.getByRole("button", { name: BEST })).toHaveAttribute("aria-pressed", "true");
      await cont(page).click();
      await page.waitForTimeout(2000);
    } finally {
      held.release();
    }
    await expect.poll(() => held.state.serverStatus, { timeout: 15_000, message: "the server got the change" }).toBe(200);
    await expect
      .poll(async () => (await enrolment(userId))?.stagesCompleted ?? [], {
        timeout: 20_000,
        message: "the Continue's save is in",
      })
      .toContain("SIMULATION");
    await expect
      .poll(async () => (await enrolment(userId))?.simulationChoice, {
        timeout: 20_000,
        message: "the account holds the answer the page showed when the learner went on",
      })
      .toBe("iStatement");
    await page.waitForTimeout(3000);
    expect((await enrolment(userId))?.simulationChoice).toBe("iStatement");
  });

  test("CS-E5 reload while the change's save is on its way (written by the server, its answer reaching no page) and the change back's waits behind it: the reloaded page and the account hold what the learner left", async ({
    context,
  }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = await learner("onItsWay");
    await signIn(context, sessionToken);
    const before = `before held ${RUN}`;
    const changed = `changed held ${RUN}`;
    const { page, held, leftSince } = await changeAndChangeBack(context, before, changed, "written");
    expect(leftSince(), "the change back's save waits behind the change's: Next sends server actions one at a time").toBe(0);
    await expect.poll(() => held.state.serverStatus, { timeout: 15_000, message: "the server got the change" }).toBe(200);
    expect(await p1Of(userId), "the server wrote the change").toBe(changed);
    await reloadWhileHeld(page, held);
    await expect(reflectionBox(page), "the page after the reload shows what the learner left").toHaveValue(before);
    await expect.poll(() => p1Of(userId), { timeout: 20_000, message: "the account holds it" }).toBe(before);
  });

  test("CS-E6 a phone: the tab hidden with the change's save on its way and the change back's behind it, then discarded and loaded again", async ({
    context,
  }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = await learner("discarded");
    await signIn(context, sessionToken);
    await discardable(context);
    const before = `before hidden ${RUN}`;
    const changed = `changed hidden ${RUN}`;
    const { page, held } = await changeAndChangeBack(context, before, changed, "written");
    await hide(page);
    await expect.poll(() => held.state.serverStatus, { timeout: 15_000, message: "the server got the change" }).toBe(200);
    expect(await p1Of(userId), "the server wrote the change").toBe(changed);
    await discardNext(page);
    await reloadWhileHeld(page, held);
    await expect(reflectionBox(page), "the page loaded again shows what the learner left").toHaveValue(before);
    await expect.poll(() => p1Of(userId), { timeout: 20_000, message: "the account holds it" }).toBe(before);
  });

  test("CS-E7 guard, a phone: hidden the same way, every save answered while hidden, then discarded and loaded again", async ({
    context,
  }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = await learner("hiddenAnswered");
    await signIn(context, sessionToken);
    await discardable(context);
    const before = `before answered ${RUN}`;
    const changed = `changed answered ${RUN}`;
    const { page, held } = await changeAndChangeBack(context, before, changed, "slow");
    await hide(page);
    expect((await held.state.request!.response())?.status()).toBe(200);
    await expect.poll(() => p1Of(userId), { timeout: 20_000, message: "the account holds what the page shows" }).toBe(before);
    await page.waitForTimeout(1500);
    expect(
      await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("seq-elevate-outbox-v1:"))),
      "nothing left kept"
    ).toEqual([]);
    await discardNext(page);
    await reloadWhileHeld(page, { finish: () => undefined });
    await expect(reflectionBox(page)).toHaveValue(before);
    expect(await p1Of(userId)).toBe(before);
  });

  test("CS-E4 reload: CS-E1, then the page reloaded; it shows what the learner left", async ({ context }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = await learner("reload");
    await signIn(context, sessionToken);
    const before = `before reload ${RUN}`;
    const changed = `changed reload ${RUN}`;
    const { page, held } = await changeAndChangeBack(context, before, changed, "lost");
    await expect.poll(() => held.state.serverStatus, { timeout: 15_000 }).toBe(200);
    await page.waitForTimeout(3000); // the save after the lost answer is in
    await page.unrouteAll({ behavior: "ignoreErrors" });
    const loaded = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.request().postData() === JSON.stringify([SLUG, "en"])
    );
    await page.reload();
    await loaded;
    await page.waitForTimeout(500);
    const step = page
      .getByRole("navigation", { name: /^course stages$/i })
      .filter({ visible: true })
      .getByRole("button", { name: /reflection/i });
    if (await step.isEnabled()) await step.click();
    await expect(reflectionBox(page), "the page after the reload shows what the learner left").toHaveValue(before);
    expect(await p1Of(userId)).toBe(before);
  });
});
