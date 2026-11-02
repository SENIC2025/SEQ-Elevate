import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, removePeople, runId } from "./fixtures/people";

/**
 * Release 3 (D79, IL-2b): a guest's page stays the guest's when someone
 * signs in in another tab of the same browser. Nothing on it is taken away
 * (the answers pressed, the score, the place in the course), Continue goes
 * on, and what is done there is saved on this browser only: nothing moves
 * into the account unclaimed. The page says so, without moving the focus,
 * and offers a reload; reloaded, it is the account's page, which asks
 * whether to add the work.
 *
 * Red on the build before, where the page took the account up in place
 * and said nothing. Requires a real database — gated on E2E_DB=1.
 *
 * Release 3 claim (D79): the page kept the guest's takes nothing the server
 * renders for the account (going to another page loads it afresh, the
 * account's page), and writes the browser's guest work only while it holds
 * what this page last wrote: once another tab adds, removes or changes it,
 * the page stops saving and says so.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  : (null as unknown as PrismaClient);
const describe = DB ? test.describe : test.describe.skip;

const RUN = runId();
const GUEST_STORE = "seq-elevate-demo-state-v1";
const BUILT_IN = "workplace-conflict";
const PROMPT = "Work saved on this browser before you signed in";
const SIGNED_IN_ELSEWHERE = /signed in in another tab/i;

const next = (page: Page) => page.getByRole("button", { name: /^continue$/i });

/**
 * The session cookie, set while this browser's pages stay open: the sign-in
 * link opened in another tab (the fixture's signIn leaves every open page).
 */
const signedInElsewhere = (context: BrowserContext, sessionToken: string) =>
  context.addCookies([
    { name: "authjs.session-token", value: sessionToken, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);

/** A guest's walk of the built-in course to its quick check, checked. */
async function walkToQuickCheck(page: Page) {
  await page.goto(`/en/learner/course/${BUILT_IN}`);
  const step = page.locator("[aria-current=step]");
  await expect(async () => {
    if ((await step.textContent())?.trim().startsWith("1")) await next(page).click();
    await expect(step).toContainText("2", { timeout: 3000 });
  }).toPass({ timeout: 20_000 });
  await next(page).click();
  await next(page).click();
  await page.getByText(/the bus was late\. when you say/i).click();
  await next(page).click();
  await page.getByText(/wait for a quiet moment, then talk to sam/i).click();
  await page.getByText(/addressed directly from now on/i).click();
  await next(page).click();
  await page.getByRole("textbox").first().fill(`guest-${RUN}`);
  await next(page).click();
  await page.getByText("Describes what you felt and what you'd prefer").click();
  await page.getByText("Notice what you're feeling").click();
  await page.getByText("It lets both people be heard without an audience").click();
  await page.getByRole("button", { name: /check answers/i }).click();
  await expect(next(page)).toBeVisible();
}

async function enrolment(userId: string) {
  const e = await prisma.courseEnrollment.findFirst({ where: { userId, course: { slug: BUILT_IN } } });
  return e ? { completed: !!e.completedAt, stages: e.stagesCompleted.length } : null;
}

describe("Release 3: a guest's page when someone signs in in another tab (IL-2b)", () => {
  test.describe.configure({ timeout: 150_000 });
  const made: string[] = [];
  test.afterAll(async () => {
    await removePeople(prisma, made);
  });

  test("keeps the guest's page as it is, says so, goes on saving to this browser only, and offers a reload", async ({
    page,
    context,
  }) => {
    const email = `e2e-guest-tab-${RUN}@example.com`;
    made.push(email);
    const person = await createPerson(prisma, { email });
    await walkToQuickCheck(page);
    const pressed = page.locator('main button[aria-pressed="true"]');
    await expect(pressed).toHaveCount(3);
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? null);

    // The sign-in link opens in another tab of this browser.
    await signedInElsewhere(context, person.sessionToken);
    const other = await context.newPage();
    await other.goto("/en/learner");

    // Said, without moving the focus, and a way on offered.
    const notice = page.getByRole("status").filter({ hasText: SIGNED_IN_ELSEWHERE });
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText("saved on this browser only");
    const reload = page.getByRole("button", { name: "Reload this page" });
    await expect(reload).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.textContent ?? null)).toBe(focused);
    // Not offered for the account on this page: it still records the guest's work.
    await expect(page.getByRole("region", { name: PROMPT })).toHaveCount(0);

    // Nothing taken off the screen: the checked answers stay, and Continue goes on.
    await expect(pressed).toHaveCount(3);
    await next(page).click();
    await expect(page.getByRole("heading", { name: /course complete/i })).toBeVisible({ timeout: 15_000 });
    // Recorded on this browser, not in the account, until the learner adds it.
    await expect
      .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null")?.course?.completedAt ?? null, GUEST_STORE), {
        timeout: 15_000,
      })
      .not.toBeNull();
    await page.waitForTimeout(2000);
    expect(await enrolment(person.userId)).toBeNull();

    // Reloaded: the account's page offers the work, and all of it moves.
    await reload.click();
    const prompt = page.getByRole("region", { name: PROMPT });
    await prompt.getByRole("button", { name: "Add it to my account" }).click({ timeout: 30_000 });
    await expect(prompt.getByRole("status")).toHaveText("Added to your account.", { timeout: 45_000 });
    expect(await enrolment(person.userId)).toEqual({ completed: true, stages: 7 });
    await expect(page.getByRole("status").filter({ hasText: SIGNED_IN_ELSEWHERE })).toHaveCount(0);
  });

  test("a guest's page with nothing done takes up the account at once", async ({ page, context }) => {
    const email = `e2e-guest-tab-empty-${RUN}@example.com`;
    made.push(email);
    const person = await createPerson(prisma, { email });
    await page.goto("/en/learner");
    // The guest's page has read this browser's guest store (and written it back).
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key) !== null, GUEST_STORE), { timeout: 20_000 })
      .toBe(true);
    await signedInElsewhere(context, person.sessionToken);
    const other = await context.newPage();
    await other.goto("/en/learner");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2000);
    await expect(page.getByRole("status").filter({ hasText: SIGNED_IN_ELSEWHERE })).toHaveCount(0);
  });
});

/**
 * Release 3 claim (D79, IL-2b): a guest's page kept the guest's takes
 * nothing the server renders for the account signed in in the other tab.
 * Every page after a sign-in is rendered for the account, so a page opened
 * from the guest's page loads afresh, as a reload does: the account's page,
 * which offers the guest's work. Nothing of the account's is recorded in
 * the guest store (a course the account finished, its badge), and the
 * guest's Comp Card is never shown as the account's card, shared.
 */
describe("Release 3: a page opened from a guest's page kept the guest's", () => {
  test.describe.configure({ timeout: 150_000 });
  const made: string[] = [];
  const address = (who: string) => {
    const email = `e2e-guest-tab4-${who}-${RUN}@example.com`;
    made.push(email);
    return email;
  };
  const GUEST_W = `guest-went-${RUN}`;
  const OLD = `account-old-${RUN}`;
  const BADGE = "voice-without-edges";
  test.afterAll(async () => {
    await removePeople(prisma, made);
  });

  /** The guest store's course, Comp Card text and badges; null when there is none. */
  const stored = (page: Page) =>
    page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const s = JSON.parse(raw) as {
        course?: { completedAt?: string | null; stagesCompleted?: string[] };
        compCard?: { wentWell?: string };
        badges?: string[];
      };
      return {
        completed: !!s.course?.completedAt,
        lessons: s.course?.stagesCompleted?.length ?? 0,
        wentWell: s.compCard?.wentWell ?? "",
        badges: s.badges ?? [],
      };
    }, GUEST_STORE);

  /** A guest's page holding a Comp Card of the guest's, kept the guest's when `sessionToken` signs in in another tab. */
  async function pinnedGuestPage(page: Page, context: BrowserContext, sessionToken: string) {
    await page.goto("/en");
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key) !== null, GUEST_STORE), { timeout: 15_000 })
      .toBe(true);
    await page.evaluate(
      ([key, wentWell]) =>
        localStorage.setItem(
          key,
          JSON.stringify({
            projectId: "seq-elevate",
            role: null,
            badges: [],
            compCard: { wentWell, difficult: "", improve: "", behaviour: "", confidence: 3, sharing: "onlyMe", updatedAt: "2026-11-21T09:00:00.000Z" },
          })
        ),
      [GUEST_STORE, GUEST_W] as const
    );
    await page.goto("/en/learner");
    await expect.poll(async () => (await stored(page))?.wentWell, { timeout: 15_000 }).toBe(GUEST_W);
    await signedInElsewhere(context, sessionToken);
    const other = await context.newPage();
    await other.goto("/en/learner");
    await expect(page.getByRole("status").filter({ hasText: SIGNED_IN_ELSEWHERE })).toBeVisible({ timeout: 30_000 });
    return other;
  }

  test("the course the account finished, opened from the guest's page, records nothing in the guest store", async ({ page, context }) => {
    const person = await createPerson(prisma, { email: address("finished") });
    const course = await prisma.course.findFirstOrThrow({ where: { slug: BUILT_IN } });
    await prisma.courseEnrollment.create({
      data: {
        userId: person.userId,
        courseId: course.id,
        stagesCompleted: ["CONTEXT", "CONCEPT", "BEHAVIOUR", "SIMULATION", "SCENARIO", "REFLECTION", "ASSESSMENT"],
        completedAt: new Date("2026-10-01T09:00:00.000Z"),
      },
    });
    const other = await pinnedGuestPage(page, context, person.sessionToken);
    // The guest opens the course from the dashboard: loaded afresh, it is the account's page.
    await page.locator(`a[href*="/learner/course/${BUILT_IN}"]`).first().click();
    await page.waitForURL(`**/learner/course/${BUILT_IN}**`, { timeout: 20_000 });
    await expect(page.getByRole("region", { name: PROMPT }).getByRole("button", { name: "Add it to my account" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("status").filter({ hasText: SIGNED_IN_ELSEWHERE })).toHaveCount(0);
    await page.waitForTimeout(3000);
    // The guest never played this course on this browser.
    expect(await stored(page)).toEqual({ completed: false, lessons: 0, wentWell: GUEST_W, badges: [] });

    // Later another account signs in on this browser and adds the work: only the guest's card.
    const b = await createPerson(prisma, { email: address("finished-b") });
    await signedInElsewhere(context, b.sessionToken);
    await other.close();
    await page.goto("/en/learner");
    const prompt = page.getByRole("region", { name: PROMPT });
    await expect(prompt).toContainText("No course progress. Comp Card: yes. Badges: 0.", { timeout: 20_000 });
    await prompt.getByRole("button", { name: "Add it to my account" }).click();
    await expect(prompt.getByRole("status")).toHaveText("Added to your account.", { timeout: 45_000 });
    expect(await enrolment(b.userId)).toBeNull();
    const badges = await prisma.userBadge.findMany({ where: { userId: b.userId, badge: { slug: BADGE } } });
    expect(badges).toHaveLength(0);
  });

  test("the Comp Card page, opened from the guest's page, never shows the guest's card as the account's, shared", async ({ page, context }) => {
    const person = await createPerson(prisma, { email: address("shared-card") });
    await prisma.compCard.create({
      data: {
        userId: person.userId,
        projectId: "seq-elevate",
        wentWell: OLD,
        privacy: "FACILITATOR",
        sharedAt: new Date("2026-10-01T09:00:00.000Z"),
        sharedWithOrganisationId: person.organisationId,
      },
    });
    await pinnedGuestPage(page, context, person.sessionToken);
    await page.locator('a[href*="/learner/comp-card"]').first().click();
    await page.waitForURL("**/learner/comp-card**", { timeout: 20_000 });
    // Loaded afresh: the account's card, shared as it is, and the guest's offered to be added.
    await expect(page.getByRole("textbox").first()).toHaveValue(OLD, { timeout: 30_000 });
    await expect(page.getByRole("status").filter({ hasText: SIGNED_IN_ELSEWHERE })).toHaveCount(0);
    await expect(page.getByRole("region", { name: PROMPT })).toBeVisible();
    await page.waitForTimeout(2000);
    const boxes = await page.locator("main textarea, main input[type=text]").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(boxes, "the guest's text is nowhere on the account's card").not.toContain(GUEST_W);
    expect((await stored(page))?.wentWell).toBe(GUEST_W);
  });
});

/**
 * Release 3 claim (D79): the work on this browser can be added to the
 * account in another tab while a guest's page kept the guest's is still
 * open. That page writes the browser's copy only while it holds what the
 * page last wrote: a claim that removed it, or changed it, stops the page's
 * saving (it says so, and offers a reload), so nothing comes back into the
 * browser behind the claim; what the page saved before the claim read it
 * moves, and what it saved after stays in the browser, offered again.
 */
describe("Release 3: a guest's page kept the guest's while the work is added in another tab", () => {
  test.describe.configure({ timeout: 180_000 });
  const made: string[] = [];
  const address = (who: string) => {
    const email = `e2e-guest-tab5-${who}-${RUN}@example.com`;
    made.push(email);
    return email;
  };
  const CHANGED_ELSEWHERE = /changed in another tab/i;
  const BADGE = "voice-without-edges";
  test.afterAll(async () => {
    await removePeople(prisma, made);
  });

  const storedCourse = (page: Page) =>
    page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const s = JSON.parse(raw) as { course?: { completedAt?: string | null; stagesCompleted?: string[] }; badges?: string[] };
      return { completed: !!s.course?.completedAt, lessons: s.course?.stagesCompleted?.length ?? 0, badges: s.badges ?? [] };
    }, GUEST_STORE);

  /** The guest's page at the quick check, kept the guest's when `sessionToken` signs in in another tab (`other`, on the dashboard). */
  async function pinnedAtQuickCheck(page: Page, context: BrowserContext, sessionToken: string) {
    await walkToQuickCheck(page);
    await signedInElsewhere(context, sessionToken);
    const other = await context.newPage();
    await other.goto("/en/learner");
    await expect(page.getByRole("status").filter({ hasText: SIGNED_IN_ELSEWHERE })).toBeVisible({ timeout: 30_000 });
    return other;
  }

  test("the work added in the other tab: the guest's page stops saving to this browser, says so and offers a reload", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("stops") });
    const other = await pinnedAtQuickCheck(page, context, person.sessionToken);
    const prompt = other.getByRole("region", { name: PROMPT });
    await prompt.getByRole("button", { name: "Add it to my account" }).click({ timeout: 30_000 });
    await expect(prompt.getByRole("status")).toHaveText("Added to your account.", { timeout: 45_000 });
    expect(await storedCourse(page)).toBeNull();
    expect(await enrolment(person.userId)).toEqual({ completed: false, stages: 6 });

    // The guest's page says it no longer saves, and offers a reload.
    const notice = page.getByRole("status").filter({ hasText: CHANGED_ELSEWHERE });
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Reload this page" })).toBeVisible();
    // Finishing the course there brings nothing back into the browser, or into the account.
    await next(page).click();
    await expect(page.getByRole("heading", { name: /course complete/i })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(3000);
    expect(await storedCourse(page)).toBeNull();
    expect(await enrolment(person.userId)).toEqual({ completed: false, stages: 6 });
    // Nothing is offered again in the tab that added it.
    await expect(prompt.getByRole("button", { name: "Add it to my account" })).toHaveCount(0);
  });

  test("the guest's page saves more while the work is added: what was read moves, the rest stays in the browser and is said to", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("during") });
    const other = await pinnedAtQuickCheck(page, context, person.sessionToken);
    // The other tab's request to add the work waits while the guest's page finishes the course.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let heldOnce = false;
    await other.route("**/*", async (route) => {
      const request = route.request();
      const body = request.postData() ?? "";
      if (!heldOnce && request.method() === "POST" && (await request.headerValue("next-action")) && /"fill":true|"claim":1/.test(body)) {
        heldOnce = true;
        await held;
      }
      await route.continue().catch(() => undefined);
    });
    try {
      const prompt = other.getByRole("region", { name: PROMPT });
      await prompt.getByRole("button", { name: "Add it to my account" }).click({ timeout: 30_000 });
      await expect.poll(() => heldOnce, { timeout: 30_000 }).toBe(true);
      await next(page).click();
      await expect(page.getByRole("heading", { name: /course complete/i })).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => storedCourse(page), { timeout: 15_000 }).toEqual({ completed: true, lessons: 7, badges: [BADGE] });
      release();
      await expect(prompt.getByRole("status")).not.toHaveText(/^(|Saving…)$/, { timeout: 45_000 });
      expect.soft((await prompt.getByRole("status").textContent())?.trim()).toBe(
        "Added to your account. More was saved on this browser while this was being added: that wasn't added, and stays on this browser."
      );
      // In the account as it was read; the course finished since stays in the browser.
      expect(await enrolment(person.userId)).toEqual({ completed: false, stages: 6 });
      expect(await storedCourse(page)).toEqual({ completed: true, lessons: 7, badges: [BADGE] });
      await expect(prompt).toContainText("Handling a small workplace conflict. Comp Card: no. Badges: 1.");

      // Offered again: the account now has its own progress in the course, which it keeps. It
      // hasn't completed the course, so the course's badge isn't added either (D118): both stay
      // in the browser, as they were.
      await prompt.getByRole("button", { name: "Add it to my account" }).click();
      await expect(prompt.getByRole("status")).not.toHaveText(/^(|Saving…)$/, { timeout: 45_000 });
      expect((await prompt.getByRole("status").textContent())?.replace(/\s+/g, " ").trim()).toBe(
        "Your progress in Handling a small workplace conflict wasn't added: your account already has progress in this course, which it keeps. One badge couldn't be added to your account. What wasn't added stays on this browser until you remove it."
      );
      expect(await enrolment(person.userId)).toEqual({ completed: false, stages: 6 });
      const badges = await prisma.userBadge.findMany({ where: { userId: person.userId, badge: { slug: BADGE } } });
      expect(badges).toHaveLength(0);
      expect(await storedCourse(page)).toEqual({ completed: true, lessons: 7, badges: [BADGE] });
    } finally {
      release();
    }
  });
});
