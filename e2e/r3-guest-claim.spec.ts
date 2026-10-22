import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, removePeople, runId, signIn } from "./fixtures/people";
import { guestCourseCompleted } from "./fixtures/guest-work";

/**
 * Release 3 (D79, spec 5.5): "Add it to my account" says "Added" only once
 * the guest work is in the account, and only then removes the browser's
 * copy. Where the account has saved something of its own, it fills only
 * what the account lacks (D37, D69: the account wins, answer by answer and
 * field by field), and says so:
 *
 *   - an account that started the course on another device gets the
 *     guest's finished course: its lessons, answers and completion, the
 *     account's own answers kept;
 *   - a Comp Card of the account's own gets the guest's text in the fields
 *     it has left empty; a shared one gets nothing (moving never shares,
 *     D80), the guest's card stays in the browser, and the page says how to
 *     add it;
 *   - the browser's copy is removed only as it was read: a tab still a
 *     guest that saves more while the work is being added keeps it, and
 *     the rest is offered again.
 *
 * Release 3's claim, on Release 3's build. Requires a real database —
 * gated on E2E_DB=1. Everything the run makes is removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  : (null as unknown as PrismaClient);
const describe = DB ? test.describe : test.describe.skip;

const RUN = runId();
const GUEST_STORE = "seq-elevate-demo-state-v1";
const BUILT_IN = "workplace-conflict";
const BADGE = "voice-without-edges";
const PROMPT = "Work saved on this browser before you signed in";
const GUEST_P1 = `guest-p1-${RUN}`;
const GUEST_P2 = `guest-p2-${RUN}`;
const ACCOUNT_P1 = `account-p1-${RUN}`;
const ADDED_ACCOUNT_FIRST = "Added to your account. Where your account already had an answer of its own, it keeps it.";
const ADDED_MORE = "Added to your account. More was saved on this browser meanwhile: add it too, or remove it.";

const next = (page: Page) => page.getByRole("button", { name: /^continue$/i });

/** What the prompt says once the work has been added (or not): never while it is being added. */
async function outcome(page: Page) {
  const status = page.getByRole("region", { name: PROMPT }).getByRole("status");
  await expect(status).not.toHaveText(/^(|Saving…)$/, { timeout: 45_000 });
  return (await status.textContent())?.trim();
}

/** A guest's walk of the built-in course up to its last Continue, with two reflection answers. */
async function walkToLastStep(page: Page) {
  await page.goto(`/en/learner/course/${BUILT_IN}`);
  // Retried until hydration has caught up.
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
  await page.getByRole("textbox").nth(0).fill(GUEST_P1);
  await page.getByRole("textbox").nth(1).fill(GUEST_P2);
  await next(page).click();
  await page.getByText("Describes what you felt and what you'd prefer").click();
  await page.getByText("Notice what you're feeling").click();
  await page.getByText("It lets both people be heard without an audience").click();
  await page.getByRole("button", { name: /check answers/i }).click();
  await expect(next(page)).toBeVisible();
}

async function finish(page: Page) {
  await next(page).click();
  await expect(page.getByRole("heading", { name: /course complete/i })).toBeVisible();
  await guestCourseCompleted(page, BUILT_IN, BADGE);
}

/** The browser's guest store, as far as these tests look at it; null when there is none. */
const guestStore = (page: Page) =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as {
      course?: { completedAt?: string | null; stagesCompleted?: string[] };
      compCard?: { difficult?: string };
      badges?: string[];
    };
    return {
      completed: !!s.course?.completedAt,
      lessons: s.course?.stagesCompleted?.length ?? 0,
      difficult: s.compCard?.difficult ?? "",
      badges: s.badges ?? [],
    };
  }, GUEST_STORE);

/** What the account holds of the built-in course, and its badges. */
async function account(userId: string) {
  const e = await prisma.courseEnrollment.findFirst({ where: { userId, course: { slug: BUILT_IN } } });
  const badges = await prisma.userBadge.findMany({ where: { userId }, select: { badge: { select: { slug: true } } } });
  const reflection = (e?.reflection ?? {}) as Record<string, string>;
  return {
    completed: !!e?.completedAt,
    lessons: e?.stagesCompleted.length ?? 0,
    scenarioRoot: e?.scenarioRoot ?? null,
    p1: reflection.p1 ?? null,
    p2: reflection.p2 ?? null,
    badges: badges.map((b) => b.badge.slug),
  };
}

const cardOf = (userId: string) =>
  prisma.compCard.findFirst({
    where: { userId },
    select: { wentWell: true, difficult: true, confidence: true, privacy: true, sharedAt: true },
  });

/** A guest store holding a Comp Card (and these badges) and no course, put in once the page has written its own. */
async function guestCard(page: Page, card: { wentWell: string; difficult: string; confidence: number }, badges: string[]) {
  await page.goto("/en");
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key) !== null, GUEST_STORE), { timeout: 15_000 })
    .toBe(true);
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [
      GUEST_STORE,
      JSON.stringify({
        projectId: "seq-elevate",
        role: null,
        badges,
        compCard: { ...card, improve: "", behaviour: "", sharing: "onlyMe", updatedAt: "2026-11-21T09:00:00.000Z" },
      }),
    ] as const
  );
}

describe("Release 3: adding a guest's work to an account that has its own", () => {
  test.describe.configure({ timeout: 180_000 });
  const made: string[] = [];
  const address = (who: string) => {
    const email = `e2e-claim-${who}-${RUN}@example.com`;
    made.push(email);
    return email;
  };

  test.afterAll(async () => {
    await removePeople(prisma, made);
  });

  test("an account that started the course on another device gets the guest's finished course; its own answers stay", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("started") });
    const course = await prisma.course.findFirstOrThrow({ where: { slug: BUILT_IN } });
    // Signed in elsewhere: the first lesson, and an answer of its own to the first reflection question.
    await prisma.courseEnrollment.create({
      data: { userId: person.userId, courseId: course.id, stagesCompleted: ["CONTEXT"], reflection: { p1: ACCOUNT_P1 } },
    });
    await walkToLastStep(page);
    await finish(page);
    const walked = await guestStore(page);

    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    const prompt = page.getByRole("region", { name: PROMPT });
    await prompt.getByRole("button", { name: "Add it to my account" }).click({ timeout: 20_000 });
    const said = await outcome(page);
    // In the account when the page says so: the guest's lessons, scenario,
    // second answer, completion and badge; the account's own first answer.
    expect(await account(person.userId)).toEqual({
      completed: true,
      lessons: walked!.lessons,
      scenarioRoot: "private",
      p1: ACCOUNT_P1,
      p2: GUEST_P2,
      badges: [BADGE],
    });
    expect(await guestStore(page), "and no longer in this browser").toBeNull();
    expect(said).toBe(ADDED_ACCOUNT_FIRST);
    await page.reload();
    await expect(prompt).toHaveCount(0);
  });

  test("a tab still a guest saves more while another tab adds the work: it stays in the browser, is offered again, and moves", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("two-tabs") });
    const a = page;
    await walkToLastStep(a);
    // Tab A's session read is slow: it stays a guest while tab B signs in.
    let releaseSession!: () => void;
    const sessionHeld = new Promise<void>((resolve) => (releaseSession = resolve));
    await a.route("**/api/auth/session", async (route) => {
      await sessionHeld;
      await route.continue().catch(() => undefined);
    });
    await context.addCookies([
      { name: "authjs.session-token", value: person.sessionToken, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);
    const b = await context.newPage();
    // Tab B's write of the course is on its way until tab A has finished it.
    let releaseClaim!: () => void;
    const claimHeld = new Promise<void>((resolve) => (releaseClaim = resolve));
    let courseWrites = 0;
    await b.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && (await request.headerValue("next-action")) && (request.postData() ?? "").includes('"fill":true')) {
        courseWrites++;
        if (courseWrites === 1) await claimHeld;
      }
      await route.continue();
    });
    try {
      await b.goto("/en/learner");
      const prompt = b.getByRole("region", { name: PROMPT });
      await prompt.getByRole("button", { name: "Add it to my account" }).click({ timeout: 20_000 });
      await expect.poll(() => courseWrites, { timeout: 30_000 }).toBeGreaterThan(0);
      // Meanwhile tab A, still a guest, finishes the course.
      await finish(a);
      releaseClaim();
      const said = await outcome(b);
      expect(await guestStore(b), "what tab A saved is still in this browser").toMatchObject({ completed: true, badges: [BADGE] });
      expect(await account(person.userId)).toMatchObject({ completed: false, scenarioRoot: "private" });
      expect(said).toBe(ADDED_MORE);

      // Offered again: it moves, and the browser's copy goes.
      await prompt.getByRole("button", { name: "Add it to my account" }).click();
      await expect(prompt.getByRole("status")).toHaveText(ADDED_ACCOUNT_FIRST, { timeout: 45_000 });
      expect(await account(person.userId)).toMatchObject({ completed: true, scenarioRoot: "private", p1: GUEST_P1, badges: [BADGE] });
      expect(await guestStore(b)).toBeNull();
    } finally {
      releaseClaim();
      releaseSession();
    }
  });

  test("a Comp Card of the account's own gets the guest's text in the fields it left empty, and keeps its own", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("card") });
    await prisma.compCard.create({
      data: { userId: person.userId, projectId: "seq-elevate", wentWell: ACCOUNT_P1 },
    });
    await guestCard(page, { wentWell: `guest-went-${RUN}`, difficult: GUEST_P2, confidence: 5 }, []);
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    const prompt = page.getByRole("region", { name: PROMPT });
    await expect(prompt).toContainText("No course progress. Comp Card: yes.");
    await prompt.getByRole("button", { name: "Add it to my account" }).click({ timeout: 20_000 });
    const said = await outcome(page);
    expect(await cardOf(person.userId)).toMatchObject({ wentWell: ACCOUNT_P1, difficult: GUEST_P2, confidence: 3, privacy: "SELF" });
    expect(await guestStore(page)).toBeNull();
    expect(said).toBe(ADDED_ACCOUNT_FIRST);
  });

  test("a shared Comp Card gets nothing from the browser: the guest's card stays there, the rest moves, and once Only me it moves too", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("shared") });
    await prisma.compCard.create({
      data: {
        userId: person.userId,
        projectId: "seq-elevate",
        wentWell: ACCOUNT_P1,
        privacy: "FACILITATOR",
        sharedAt: new Date(),
        sharedWithOrganisationId: person.organisationId,
      },
    });
    await guestCard(page, { wentWell: "", difficult: GUEST_P2, confidence: 3 }, [BADGE]);
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    const prompt = page.getByRole("region", { name: PROMPT });
    await prompt.getByRole("button", { name: "Add it to my account" }).click({ timeout: 20_000 });
    const said = await outcome(page);
    expect((await account(person.userId)).badges).toEqual([BADGE]);
    expect(await cardOf(person.userId), "the shared card as it was").toMatchObject({ wentWell: ACCOUNT_P1, difficult: "", privacy: "FACILITATOR" });
    expect(await guestStore(page), "the guest's card is still in this browser").toMatchObject({ difficult: GUEST_P2 });
    expect(said).toBe(
      "Everything else was added to your account. Your Comp Card is shared with your facilitators, so the Comp Card from this browser wasn't added to it: it stays here. To add it, set your Comp Card to “Only me” first, or remove it from this browser."
    );
    await expect(prompt.getByRole("button", { name: "Remove it from this browser" })).toBeVisible();

    // The learner takes the card back to Only me, then adds it.
    await page.goto("/en/learner/comp-card");
    await page.getByRole("button", { name: "Only me" }).click();
    await expect(page.getByRole("button", { name: "Only me" })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await cardOf(person.userId))?.privacy, { timeout: 15_000 }).toBe("SELF");
    await page.goto("/en/learner");
    await prompt.getByRole("button", { name: "Add it to my account" }).click({ timeout: 20_000 });
    const saidThen = await outcome(page);
    expect(await cardOf(person.userId)).toMatchObject({ wentWell: ACCOUNT_P1, difficult: GUEST_P2, privacy: "SELF" });
    expect(await guestStore(page)).toBeNull();
    // The account had no answer of its own where the guest had one.
    expect(saidThen).toBe("Added to your account.");
  });
});
