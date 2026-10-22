import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { ORGANISATIONS, PROJECT, createPerson, hasProfiles, removePeople, runId, signIn } from "./fixtures/people";
import { completeProfileStep, fillProfileStep } from "./fixtures/profile-step";
import { slowActions } from "./fixtures/slow-actions";
import { currentTermsVersion } from "../src/lib/profile";

/**
 * Release 3 (spec 5, 18.2, B-E1 to B-E5, B-E10, B-E12): the profile step.
 * Every signed-in account without a complete profile meets one screen,
 * /welcome, before the hub and the workspaces — and never a loop: what a
 * person needs to sign out, download their data or delete their account
 * stays open. Learner membership and the browser's guest work wait for it,
 * and guest work then moves only when the person says it is theirs.
 *
 * The country mapping is the seed's (DE → Pro Arbeit, CY → Synthesis, BE
 * and Other → Diesis); Greece is left alone (e2e/r3-people.spec.ts's A-E7
 * moves it for a moment). B-E11, the profile gate switched off, runs on
 * the switches server (e2e/r3-profile-gate-off.spec.ts).
 *
 * The same spec runs on the old build (no ProjectProfile table): there,
 * steps that only Release 3 has (the profile step, the guest-work prompt)
 * are passed over where a test's point lies after them, so each test fails
 * for its own reason. B-E5 is a guard.
 *
 * Requires a real database — gated on E2E_DB=1. B-E2 mints a sign-in link
 * the way Auth.js stores it, so it needs AUTH_SECRET in the test process.
 * Everything the run makes is removed afterwards.
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
const GUEST_STORE = "seq-elevate-demo-state-v1";
const BUILT_IN = "workplace-conflict";

/** No serious or critical axe violation on the page (WCAG 2.2 AA). */
async function noSeriousViolations(page: Page, what: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, `${what}: ${JSON.stringify(serious.map((v) => v.id))}`).toEqual([]);
}

/** Two lessons of the built-in course as a guest: the browser's guest store holds them. */
async function playAsGuest(page: Page) {
  await page.goto(`/en/learner/course/${BUILT_IN}`);
  const step = page.locator("[aria-current=step]");
  const next = () => page.getByRole("button", { name: /^continue$/i }).first();
  // Retried until hydration has caught up.
  await expect(async () => {
    if ((await step.textContent())?.trim().startsWith("1")) await next().click();
    await expect(step).toContainText("2", { timeout: 3000 });
  }).toPass({ timeout: 20_000 });
  await next().click();
  await expect(step).toContainText("3");
  await expect.poll(() => guestLessons(page), { timeout: 10_000 }).toEqual(["context", "concept"]);
}

/** The lessons the browser's guest store holds, or null when there is none. */
const guestLessons = (page: Page) =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? ((JSON.parse(raw) as { course?: { stagesCompleted?: string[] } }).course?.stagesCompleted ?? []) : null;
  }, GUEST_STORE);

/** The person's enrolment in the built-in course: its lessons, or null. */
const builtInLessons = async (userId: string) =>
  (
    await prisma.courseEnrollment.findFirst({
      where: { userId, course: { slug: BUILT_IN } },
      select: { stagesCompleted: true },
    })
  )?.stagesCompleted ?? null;

const learnerRoles = (userId: string) =>
  prisma.membership.count({ where: { userId, projectId: PROJECT, role: "LEARNER" } });

describe("Release 3 profile step", () => {
  /** Every address the run made, removed at the end. */
  const made: string[] = [];
  let profiles = true;
  const address = (who: string) => {
    const email = `e2e-profile-${who}-${RUN}@example.com`;
    made.push(email);
    return email;
  };
  const profileOf = (userId: string) =>
    prisma.projectProfile.findUnique({ where: { userId_projectId: { userId, projectId: PROJECT } } });

  /** On Release 3 the profile step comes first; the old build has none. */
  async function throughProfileStep(page: Page, path: string) {
    await page.goto(path);
    if (profiles) await completeProfileStep(page);
  }

  test.beforeAll(async () => {
    profiles = await hasProfiles(prisma);
  });

  test.afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { in: made } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const profileIds = (await prisma.projectProfile.findMany({ where: { userId: { in: ids } }, select: { id: true } }).catch(() => [])).map(
      (p) => p.id
    );
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: [...ids, ...profileIds] } }] } });
    await removePeople(prisma, made);
    await prisma.verificationToken.deleteMany({ where: { identifier: { in: made } } });
  });

  test("B-E1: an existing account goes to the profile step from the learner area, a workspace or the hub; once done, to the hub; a complete account on /welcome goes to the hub", async ({
    page,
    context,
  }) => {
    // As the migration leaves an existing account: roles, no answers.
    const learner = await createPerson(prisma, { email: address("existing"), roles: ["LEARNER"], profile: "none", organisation: null });
    const staff = await createPerson(prisma, {
      email: address("existing-staff"),
      roles: ["FACILITATOR", "CONTENT_EDITOR"],
      profile: "none",
    });

    await signIn(context, learner.sessionToken);
    for (const path of ["/en/learner", "/en/learner/comp-card", "/en"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/en\/welcome$/);
    }
    await signIn(context, staff.sessionToken);
    for (const path of ["/en/facilitator", "/en/content", "/en/analytics", "/en"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/en\/welcome$/);
    }
    await completeProfileStep(page, { name: "Staff E2E", country: "Belgium" });
    // The hub (two workspaces and more).
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
    // Once: the workspaces open now, and /welcome sends a complete account on.
    await page.goto("/en/facilitator");
    await expect(page).toHaveURL(/\/en\/facilitator$/);
    await page.goto("/en/welcome");
    await expect(page).toHaveURL(/\/en$/);

    // The learner: done, to their courses (the hub forwards one workspace).
    await signIn(context, learner.sessionToken);
    await page.goto("/en");
    await completeProfileStep(page);
    await expect(page).toHaveURL(/\/en\/learner$/);
    await page.goto("/en/welcome");
    await expect(page).toHaveURL(/\/en\/learner$/);
  });

  test("B-E2: someone who signs up with a sign-in link meets the profile step; the age statement and the Terms are required, the errors listed and focused; no consent box", async ({
    page,
  }) => {
    const secret = process.env.AUTH_SECRET;
    test.skip(!secret, "needs AUTH_SECRET to mint a sign-in link the way Auth.js stores it");
    const email = address("self-registered");
    const raw = randomBytes(32).toString("hex");
    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token: createHash("sha256").update(`${raw}${secret}`).digest("hex"),
        expires: new Date(Date.now() + 86_400_000),
      },
    });
    await page.goto(`/api/auth/callback/resend?${new URLSearchParams({ callbackUrl: "/en", token: raw, email })}`);
    await expect(page).toHaveURL(/\/en\/welcome$/);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1, name: "Before you start" })).toBeVisible();
    // Name, country, age, Terms; the privacy notice a link; no consent box.
    await expect(main.getByRole("checkbox")).toHaveCount(2);
    await expect(main.getByText(/I agree that SEQ Elevate may use my data/)).toHaveCount(0);
    await expect(main.getByRole("link", { name: "privacy notice" })).toHaveAttribute("href", "/en/legal/privacy");
    await expect(main.getByRole("link", { name: "Terms of use" })).toHaveAttribute("href", "/en/legal/terms");

    // Sent with a name and a country, but neither box ticked.
    const summary = main.getByRole("heading", { name: "Please check:" });
    await expect(async () => {
      await fillProfileStep(page, { name: "Sam" });
      await main.getByRole("checkbox", { name: /or older/ }).uncheck();
      await main.getByRole("checkbox", { name: /I accept the Terms of use/ }).uncheck();
      await main.getByRole("button", { name: "Continue" }).click();
      await expect(summary).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });
    // The list has the focus, and links each message to its field.
    await expect(page.locator(":focus")).toContainText("Please check:");
    const list = page.locator(":focus").getByRole("listitem");
    await expect(list).toHaveText(["You can continue only if this is true.", "Accept the Terms of use to continue."]);
    const age = main.getByRole("checkbox", { name: /or older/ });
    await expect(age).toHaveAttribute("aria-invalid", "true");
    await expect(age).toHaveAccessibleDescription(/You can continue only if this is true\./);
    await expect(age).toHaveAccessibleDescription(/Younger than 16\? You can join if a partner organisation invites you\./);
    await expect(main.getByRole("checkbox", { name: /I accept the Terms of use/ })).toHaveAttribute("aria-invalid", "true");
    await expect(main.getByRole("link", { name: "delete this account" })).toHaveAttribute("href", "/en/account");
    await list.first().getByRole("link").click();
    await expect(age).toBeFocused();

    // Nothing stored, no place in the project yet.
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(await learnerRoles(user.id)).toBe(0);
    expect((await profileOf(user.id))?.profileCompletedAt ?? null).toBeNull();

    await completeProfileStep(page, { name: "Sam" });
    await expect(page).toHaveURL(/\/en\/learner$/);
    expect(await learnerRoles(user.id)).toBe(1);
    expect(await profileOf(user.id)).toMatchObject({
      country: "DE",
      organisationId: ORGANISATIONS.A,
      organisationSource: "country",
      termsVersion: currentTermsVersion(),
      ageRule: "SELF_MIN_AGE",
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).name).toBe("Sam");
  });

  test("B-E3: before the profile step the legal pages, the account page, help, sign-out and the data download stay open; no learner membership is made and the guest store stays", async ({
    page,
    context,
    request,
  }) => {
    await playAsGuest(page);
    const person = await createPerson(prisma, { email: address("before"), profile: "none", organisation: null });
    const cookie = { Cookie: `authjs.session-token=${person.sessionToken}` };
    // The guest store stays: signing in leaves the browser's storage alone.
    await signIn(context, person.sessionToken);

    await page.goto("/en/legal/privacy");
    await expect(page).toHaveURL(/\/en\/legal\/privacy$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto("/en/account");
    await expect(page).toHaveURL(/\/en\/account$/);
    await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download my data" })).toBeVisible();
    await page.goto("/en/help");
    await expect(page).toHaveURL(/\/en\/help$/);
    const exported = await request.get("/api/me/export", { headers: cookie, maxRedirects: 0 });
    expect(exported.status()).toBe(200);
    expect(await exported.text()).toContain(person.email);
    const signOut = await request.get("/api/auth/signout", { headers: cookie, maxRedirects: 0 });
    expect(signOut.status()).toBe(200);

    // Nothing of theirs moved or was made while they looked around.
    await page.goto("/en/account");
    await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await learnerRoles(person.userId), "no learner membership before the profile step").toBe(0);
    expect(await guestLessons(page), "the guest store is still in the browser").toEqual(["context", "concept"]);
    expect(await builtInLessons(person.userId), "nothing of the guest's reached the account").toBeNull();
    // And a learner page sends them to the profile step.
    await page.goto("/en/learner");
    await expect(page).toHaveURL(/\/en\/welcome$/);

    // Deleting an account works before the profile step too.
    const leaving = await createPerson(prisma, { email: address("leaving"), profile: "none", organisation: null });
    await signIn(context, leaving.sessionToken);
    await page.goto("/en/account");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await page.getByLabel("Type your email to confirm").fill(leaving.email);
    await page.getByRole("button", { name: "Permanently delete" }).click();
    await expect.poll(() => prisma.user.count({ where: { id: leaving.userId } }), { timeout: 15_000 }).toBe(0);
  });

  test("B-E3: after the profile step the guest work is offered; nothing moves until 'Add it to my account', and the offer comes back on reload", async ({
    page,
    context,
  }) => {
    await playAsGuest(page);
    const person = await createPerson(prisma, { email: address("claims"), profile: "none", organisation: null });
    // The guest store stays: signing in leaves the browser's storage alone.
    await signIn(context, person.sessionToken);
    await throughProfileStep(page, "/en/learner");
    await expect(page).toHaveURL(/\/en\/learner$/);
    await page.waitForLoadState("networkidle");
    expect(await builtInLessons(person.userId), "nothing moved before the choice").toBeNull();
    expect(await learnerRoles(person.userId)).toBe(1);

    const prompt = page.getByRole("region", { name: "Work saved on this browser before you signed in" });
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText(/workplace conflict\. Comp Card: no\./i);
    // No choice made: nothing moves, nothing is removed, it is offered again.
    await page.reload();
    await expect(prompt).toBeVisible();
    expect(await builtInLessons(person.userId)).toBeNull();
    expect(await guestLessons(page)).toEqual(["context", "concept"]);

    await prompt.getByRole("button", { name: "Add it to my account" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Added to your account." })).toBeFocused();
    await expect.poll(() => builtInLessons(person.userId), { timeout: 15_000 }).toEqual(["CONTEXT", "CONCEPT"]);
    expect(await guestLessons(page), "the guest store is gone").toBeNull();
    await page.reload();
    await expect(prompt).toHaveCount(0);
  });

  test("B-E3: 'Added to your account.' is said only once the guest work is in the account, however slowly it gets there", async ({
    page,
    context,
  }) => {
    await playAsGuest(page);
    const person = await createPerson(prisma, { email: address("slow-claim"), profile: "none", organisation: null });
    // The guest store stays: signing in leaves the browser's storage alone.
    await signIn(context, person.sessionToken);
    await throughProfileStep(page, "/en/learner");
    const prompt = page.getByRole("region", { name: "Work saved on this browser before you signed in" });
    await expect(prompt).toBeVisible();

    // A slow connection: every write is on its way for seconds. Someone
    // told "Added" may sign out at once, so the work must be in the
    // account by then, and the browser's copy gone.
    await slowActions(page, 4_000);
    await prompt.getByRole("button", { name: "Add it to my account" }).click();
    await expect(prompt.getByRole("status")).toHaveText("Saving…");
    const added = page.getByRole("status").filter({ hasText: "Added to your account." });
    await expect(added).toBeVisible({ timeout: 30_000 });
    expect(await builtInLessons(person.userId), "in the account when the page says so").toEqual(["CONTEXT", "CONCEPT"]);
    expect(await guestLessons(page), "and no longer in this browser").toBeNull();
    await expect(added).toBeFocused();
  });

  test("B-E3: 'Remove it from this browser' removes the guest work, and nothing of it reaches the account", async ({
    page,
    context,
  }) => {
    await playAsGuest(page);
    const person = await createPerson(prisma, { email: address("removes"), profile: "none", organisation: null });
    // The guest store stays: signing in leaves the browser's storage alone.
    await signIn(context, person.sessionToken);
    await throughProfileStep(page, "/en/learner");
    await page.waitForLoadState("networkidle");
    expect(await builtInLessons(person.userId), "nothing moved before the choice").toBeNull();
    const prompt = page.getByRole("region", { name: "Work saved on this browser before you signed in" });
    await prompt.getByRole("button", { name: "Remove it from this browser" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Removed from this browser." })).toBeFocused();
    expect(await guestLessons(page)).toBeNull();
    await page.reload();
    await expect(prompt).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(await builtInLessons(person.userId)).toBeNull();
  });

  test("B-E4: a new Terms version asks for the Terms alone, and keeps every other answer", async ({ page, context }) => {
    const person = await createPerson(prisma, { email: address("terms"), roles: ["LEARNER"], organisation: "A", country: "DE" });
    // (Release 2's schema has no profiles: there the step never comes.)
    if (profiles) {
      await prisma.projectProfile.update({
        where: { userId_projectId: { userId: person.userId, projectId: PROJECT } },
        data: { termsVersion: "2020-01-01" },
      });
    }
    const before = profiles ? await profileOf(person.userId) : null;
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    await expect(page).toHaveURL(/\/en\/welcome$/);
    const main = page.getByRole("main");
    await expect(main.getByText("Our Terms of use have changed. Please read them and accept them again.")).toBeVisible();
    await expect(main.getByRole("checkbox")).toHaveCount(1);
    await expect(main.getByRole("radio")).toHaveCount(0);
    await expect(main.getByLabel("First name or nickname")).toHaveCount(0);
    await completeProfileStep(page);
    const after = await profileOf(person.userId);
    expect(after).toMatchObject({
      termsVersion: currentTermsVersion(),
      country: before?.country,
      organisationId: before?.organisationId,
      ageRule: before?.ageRule,
      ageConfirmedAt: before?.ageConfirmedAt,
      profileCompletedAt: before?.profileCompletedAt,
    });
    expect(after?.termsAcceptedAt?.getTime()).toBeGreaterThan(before!.termsAcceptedAt!.getTime());
  });

  test("B-E5 (guard): a staff member's organisation doesn't change with the country they pick, nor whose learners they see", async ({
    page,
    context,
    request,
  }) => {
    const inA = await createPerson(prisma, { email: address("staff-a"), roles: ["FACILITATOR"], profile: "none", organisation: "A" });
    const none = await createPerson(prisma, { email: address("staff-none"), roles: ["FACILITATOR"], profile: "none", organisation: null });
    // A learner of each organisation the two countries map to.
    const learnerA = await createPerson(prisma, { email: address("staff-learner-a"), name: `B-E5 learner A ${RUN}`, roles: ["LEARNER"], organisation: "A" });
    const learnerB = await createPerson(prisma, { email: address("staff-learner-b"), name: `B-E5 learner B ${RUN}`, roles: ["LEARNER"], organisation: "B" });
    for (const [person, country] of [
      [inA, "Cyprus"],
      [none, "Germany"],
    ] as const) {
      await signIn(context, person.sessionToken);
      await page.goto("/en");
      await expect(page).toHaveURL(/\/en\/welcome$/);
      // What learners are told about who sees their data isn't for staff.
      await expect(page.getByRole("main")).not.toContainText(/DIESIS and SENIC staff|set up by/);
      await completeProfileStep(page, { country });
    }
    expect(await profileOf(inA.userId)).toMatchObject({ country: "CY", organisationId: ORGANISATIONS.A });
    expect(await profileOf(none.userId)).toMatchObject({ country: "DE", organisationId: null });
    expect(await learnerRoles(none.userId)).toBe(0);

    // Whose learners each sees follows the organisation, not the country:
    // A's facilitator who picked Cyprus still sees A's learner and not B's;
    // the facilitator with no organisation who picked Germany sees neither.
    const roster = async (person: { sessionToken: string; email: string }) => {
      const response = await request.get("/en/facilitator", {
        headers: { Cookie: `authjs.session-token=${person.sessionToken}` },
        maxRedirects: 0,
      });
      expect(response.status(), `/en/facilitator as ${person.email}`).toBe(200);
      return response.text();
    };
    const ofA = await roster(inA);
    expect(ofA, "A's facilitator sees A's learner").toContain(learnerA.name);
    expect(ofA, "and not B's, whatever country it picked").not.toContain(learnerB.name);
    const ofNone = await roster(none);
    expect(ofNone, "no organisation: not A's learner, though it picked Germany").not.toContain(learnerA.name);
    expect(ofNone, "nor B's").not.toContain(learnerB.name);
  });

  test("B-E10: the profile step has its own title, passes axe and fits a 320px screen, in English, German and Greek", async ({ page, context }) => {
    const person = await createPerson(prisma, { email: address("axe"), profile: "none", organisation: null });
    await signIn(context, person.sessionToken);
    for (const [locale, title] of [
      ["en", "Before you start"],
      ["de", "Bevor es losgeht"],
      ["el", "Πριν ξεκινήσεις"],
    ] as const) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/${locale}/welcome`);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      // The page's own title, in its language (WCAG 2.4.2).
      await expect(page).toHaveTitle(`${title} · SEQ Elevate`);
      await noSeriousViolations(page, `/${locale}/welcome`);
      await page.setViewportSize({ width: 320, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `/${locale}/welcome: no horizontal scrolling at 320px`).toBeLessThanOrEqual(0);
    }
    // With its errors listed, too.
    await page.goto("/en/welcome");
    const summary = page.getByRole("heading", { name: "Please check:" });
    await expect(async () => {
      await page.getByRole("main").getByRole("button", { name: "Continue" }).click();
      await expect(summary).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });
    await noSeriousViolations(page, "/en/welcome with errors");
    // The list that takes the focus has a role its name is allowed on (an
    // alert): a name on a role-less element is one axe can only flag for
    // review, and a screen reader may not read.
    await expect(page.locator(":focus")).toHaveAttribute("role", "alert");
    const review = await new AxeBuilder({ page }).withRules(["aria-prohibited-attr", "aria-allowed-attr"]).analyze();
    expect(
      [...review.violations, ...review.incomplete].map((r) => `${r.id}: ${r.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      "no name where ARIA allows none"
    ).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("B-E12: a complete account with a blank name is asked for the name alone, saves it and reaches the hub (no loop)", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, {
      email: address("nameless"),
      roles: ["FACILITATOR", "CONTENT_EDITOR"],
      name: null,
    });
    await signIn(context, person.sessionToken);
    await page.goto("/en");
    await expect(page).toHaveURL(/\/en\/welcome$/);
    const main = page.getByRole("main");
    await expect(main.getByLabel("First name or nickname")).toBeVisible();
    await expect(main.getByRole("radio")).toHaveCount(0);
    await expect(main.getByRole("checkbox")).toHaveCount(0);
    await completeProfileStep(page, { name: "Robin" });
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back" })).toBeVisible();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.userId } })).name).toBe("Robin");
    await page.goto("/en");
    await expect(page).toHaveURL(/\/en$/);
  });
});

