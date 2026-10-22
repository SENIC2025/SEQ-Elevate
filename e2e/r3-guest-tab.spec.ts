import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { BrowserContext } from "@playwright/test";
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
 * Red on the build before: the page took up the account in place and
 * dropped the guest's copy from the screen (3 answers pressed, then 0).
 * Requires a real database — gated on E2E_DB=1.
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
