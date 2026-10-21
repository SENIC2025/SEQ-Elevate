import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PROJECT, createPerson, removePeople, runId, signIn } from "./fixtures/people";

/**
 * Release 3 (spec 5.9, 15, B-E11): the profile gate's kill switch,
 * R3_PROFILE_GATE=off, on the `switches` project's own server
 * (playwright.config.ts; partner access is off there too). It degrades to
 * "signed in, nothing saved, not on rosters", never to "no Terms recorded":
 *   - someone without a complete profile reaches the learner area with no
 *     redirect, is told nothing of theirs is saved, and a lesson finished
 *     makes no row (their membership still waits for the profile step);
 *   - staff scope no longer needs a complete profile: an ADMIN without one
 *     sees the learners here, and on the main server (the gate on) is sent
 *     to the profile step. (An ADMIN, not a facilitator: partner access is
 *     off on this server, so a facilitator sees no one whatever the gate.)
 *
 * Requires a real database — gated on E2E_DB=1. Everything the run makes
 * is removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;
test.describe.configure({ mode: "default" });

const RUN = runId();
const BUILT_IN = "workplace-conflict";
/** The main server, where the gate is on. */
const MAIN = `http://localhost:${process.env.E2E_PORT ?? "3000"}`;

async function playTwoLessons(page: Page) {
  await page.goto(`/en/learner/course/${BUILT_IN}`);
  const step = page.locator("[aria-current=step]");
  const next = () => page.getByRole("button", { name: /^continue$/i }).first();
  await expect(async () => {
    if ((await step.textContent())?.trim().startsWith("1")) await next().click();
    await expect(step).toContainText("2", { timeout: 3000 });
  }).toPass({ timeout: 20_000 });
  await next().click();
  await expect(step).toContainText("3");
}

describe("Release 3 switches: the profile gate off", () => {
  const made: string[] = [];
  const address = (who: string) => {
    const email = `e2e-gate-off-${who}-${RUN}@example.com`;
    made.push(email);
    return email;
  };

  test.afterAll(async () => {
    await removePeople(prisma, made);
  });

  test("B-E11: an account without a complete profile reaches the learner area, is told nothing is saved, and a lesson finished makes no row", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("browser"), profile: "none", organisation: null });
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    await expect(page).toHaveURL(/\/en\/learner$/);
    const note = page.getByRole("status").filter({ hasText: "Finish your profile to save your progress." });
    await expect(note).toBeVisible();
    await expect(note.getByRole("link", { name: "Finish it now" })).toHaveAttribute("href", "/en/welcome");

    await playTwoLessons(page);
    await expect(note).toBeVisible();
    // Longer than the save's pause: anything to send has been sent.
    await page.waitForTimeout(2_000);
    expect(await prisma.courseEnrollment.count({ where: { userId: person.userId } }), "no enrolment").toBe(0);
    expect(await prisma.membership.count({ where: { userId: person.userId, projectId: PROJECT } }), "no membership").toBe(0);
    expect(await prisma.compCard.count({ where: { userId: person.userId } }), "no Comp Card").toBe(0);
  });

  test("B-E11: staff scope no longer needs a complete profile — an ADMIN without one sees the learners only because the gate is off", async ({
    request,
  }) => {
    const marker = `gate-off-learner-${RUN}`;
    await createPerson(prisma, { email: address("learner"), name: marker, roles: ["LEARNER"], organisation: null });
    const admin = await createPerson(prisma, { email: address("admin"), roles: ["ADMIN"], profile: "none" });
    const cookie = { Cookie: `authjs.session-token=${admin.sessionToken}` };

    const here = await request.get("/en/facilitator", { headers: { ...cookie, RSC: "1" }, maxRedirects: 0 });
    expect(here.status()).toBe(200);
    expect(await here.text(), "the roster on this server holds the learner").toContain(marker);

    // The control: where the gate is on, the same ADMIN is sent to the
    // profile step, and the roster holds no one.
    const main = await request.get(`${MAIN}/en/facilitator`, { headers: { ...cookie, RSC: "1" }, maxRedirects: 0 });
    const sent = await main.text();
    expect(sent, "the main server sends them to the profile step").toContain("/en/welcome");
    expect(sent, "the main server's roster holds no one").not.toContain(marker);
  });
});
