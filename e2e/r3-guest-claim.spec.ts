import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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
const ADDED = "Added to your account.";
const NOTHING = "Nothing was added: there is no work on this browser to add any more.";
const FAILED = "That didn't save. Please try again.";

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

      // Offered again: it moves, and the browser's copy goes. Everything in
      // the account is the guest's own (the first Add put it there): the
      // account kept nothing of its own over it.
      await prompt.getByRole("button", { name: "Add it to my account" }).click();
      await expect(prompt.getByRole("status")).toHaveText(ADDED, { timeout: 45_000 });
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

  test("a Comp Card text too long to add stays in the browser, alone, the rest moves, and once shortened on the offer it moves too", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("long") });
    await prisma.compCard.create({ data: { userId: person.userId, projectId: "seq-elevate", improve: ACCOUNT_P1 } });
    const LONG = `long-${RUN} ${"x".repeat(2100)}`;
    const SHORT = `shortened-${RUN}`;
    await guestCard(page, { wentWell: `guest-went-${RUN}`, difficult: LONG, confidence: 3 }, [BADGE]);
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    const prompt = page.getByRole("region", { name: PROMPT });
    await prompt.getByRole("button", { name: "Add it to my account" }).click({ timeout: 20_000 });
    const said = await outcome(page);
    // The long text is neither cut nor dropped: it alone stays in this
    // browser; the rest of the card and the badge are in the account.
    expect(await guestStore(page), "the long text stays in this browser, alone").toEqual({
      completed: false,
      lessons: 0,
      difficult: LONG,
      badges: [],
    });
    expect(await cardOf(person.userId)).toMatchObject({ wentWell: `guest-went-${RUN}`, difficult: "" });
    expect((await prisma.compCard.findFirst({ where: { userId: person.userId } }))?.improve).toBe(ACCOUNT_P1);
    expect((await account(person.userId)).badges).toEqual([BADGE]);
    expect(said).toBe(
      "Everything else was added to your account. Your Comp Card answer to “What was difficult” wasn't added: it is longer than 2,000 characters. It stays on this browser: shorten it above, then add it, or remove it from this browser."
    );

    // The offer shows it to be shortened, with its length.
    const box = prompt.getByRole("textbox", { name: "What was difficult" });
    await expect(box).toHaveValue(LONG);
    await expect(box).toHaveAttribute("aria-invalid", "true");
    await expect(prompt).toContainText(`${LONG.length.toLocaleString("en")} characters: ${LONG.length - 2000} characters too many.`);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
    await box.fill(SHORT);
    await expect(prompt).toContainText(`${SHORT.length} of 2,000 characters: short enough to add.`);
    // Saved on this browser as it is typed: it outlives a reload.
    await expect.poll(async () => (await guestStore(page))?.difficult, { timeout: 10_000 }).toBe(SHORT);
    await page.reload();
    await expect(prompt).toContainText("No course progress. Comp Card: yes. Badges: 0.", { timeout: 20_000 });
    await expect(prompt.getByRole("textbox")).toHaveCount(0);
    await prompt.getByRole("button", { name: "Add it to my account" }).click({ timeout: 20_000 });
    const saidThen = await outcome(page);
    expect(await cardOf(person.userId)).toMatchObject({ wentWell: `guest-went-${RUN}`, difficult: SHORT });
    expect(await guestStore(page)).toBeNull();
    expect(saidThen).toBe(ADDED);
  });
});

/** What the account holds of the built-in course's answers besides the summary above. */
async function answers(userId: string) {
  const e = await prisma.courseEnrollment.findFirst({ where: { userId, course: { slug: BUILT_IN } } });
  return { reflection: (e?.reflection ?? {}) as Record<string, string>, assessment: e?.assessment ?? null };
}

describe("Release 3: adding a guest's work never puts this page's older copy, or the guest's, over the account's own", () => {
  test.describe.configure({ timeout: 180_000 });
  const made: string[] = [];
  const address = (who: string) => {
    const email = `e2e-claim2-${who}-${RUN}@example.com`;
    made.push(email);
    return email;
  };
  const GUEST_D = `guest-difficult-${RUN}`;
  const OLD = `account-old-${RUN}`;
  const NEW = `account-new-${RUN}`;
  const PHONE_P2 = `phone-p2-${RUN}`;
  const addButton = (page: Page) =>
    page.getByRole("region", { name: PROMPT }).getByRole("button", { name: "Add it to my account" });

  test.afterAll(async () => {
    await removePeople(prisma, made);
  });

  test("a Comp Card another device changed after this page loaded keeps that change when the guest's card is added", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("card-later") });
    await prisma.compCard.create({ data: { userId: person.userId, projectId: "seq-elevate", wentWell: OLD } });
    await guestCard(page, { wentWell: "", difficult: GUEST_D, confidence: 3 }, []);
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    await expect(addButton(page)).toBeVisible({ timeout: 20_000 });
    // The page's own saves after loading have gone out.
    await page.waitForTimeout(3000);
    // On another device the learner rewrites the answer this page shows.
    await prisma.compCard.update({
      where: { userId_projectId: { userId: person.userId, projectId: "seq-elevate" } },
      data: { wentWell: NEW },
    });
    await addButton(page).click();
    const said = await outcome(page);
    // Past the page's save debounce: nothing of this page's older copy follows.
    await page.waitForTimeout(4000);
    expect(await cardOf(person.userId)).toMatchObject({ wentWell: NEW, difficult: GUEST_D });
    expect(said).toBe(ADDED);
  });

  test("a Comp Card text another device writes while the guest's card is being added stays, and the page says the account kept its own", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("card-during") });
    await prisma.compCard.create({ data: { userId: person.userId, projectId: "seq-elevate", improve: OLD } });
    await guestCard(page, { wentWell: `guest-went-${RUN}`, difficult: GUEST_D, confidence: 3 }, []);
    await signIn(context, person.sessionToken);
    // The card's write waits while another device writes wentWell.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let heldOnce = false;
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (!heldOnce && request.method() === "POST" && (await request.headerValue("next-action")) && (request.postData() ?? "").includes('"fill":true')) {
        heldOnce = true;
        await held;
      }
      await route.continue().catch(() => undefined);
    });
    try {
      await page.goto("/en/learner");
      await addButton(page).click({ timeout: 20_000 });
      await expect.poll(() => heldOnce, { timeout: 30_000 }).toBe(true);
      await prisma.compCard.update({
        where: { userId_projectId: { userId: person.userId, projectId: "seq-elevate" } },
        data: { wentWell: NEW },
      });
      release();
      const said = await outcome(page);
      await page.waitForTimeout(4000);
      expect(await cardOf(person.userId)).toMatchObject({ wentWell: NEW, difficult: GUEST_D });
      expect(said).toBe(ADDED_ACCOUNT_FIRST);
    } finally {
      release();
    }
  });

  test("another account signing in on this browser while the work is added: nothing goes to either, the browser keeps it, and it is offered to whoever is signed in", async ({
    page,
    context,
  }) => {
    const a = await createPerson(prisma, { email: address("first") });
    const b = await createPerson(prisma, { email: address("second") });
    await guestCard(page, { wentWell: "", difficult: GUEST_D, confidence: 3 }, [BADGE]);
    await signIn(context, a.sessionToken);
    // The badge award, the move's first write, waits while B signs in on
    // this browser (another tab): this tab hasn't read its session again.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let heldOnce = false;
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (!heldOnce && request.method() === "POST" && (await request.headerValue("next-action")) && (request.postData() ?? "").includes(BADGE)) {
        heldOnce = true;
        await held;
      }
      await route.continue().catch(() => undefined);
    });
    try {
      await page.goto("/en/learner");
      await addButton(page).click({ timeout: 20_000 });
      await expect.poll(() => heldOnce, { timeout: 30_000 }).toBe(true);
      // The cookie only: this page stays open (the fixture's signIn leaves it).
      await context.addCookies([
        { name: "authjs.session-token", value: b.sessionToken, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
      ]);
      release();
      // The page finds B signed in, lets go of A's data and offers the work to B.
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
      await expect(addButton(page)).toBeVisible({ timeout: 45_000 });
      await page.waitForTimeout(3000);
      expect(await page.getByRole("region", { name: PROMPT }).textContent()).not.toContain("Added");
      expect(await guestStore(page), "the browser still holds it").toMatchObject({ difficult: GUEST_D, badges: [BADGE] });
      expect(await cardOf(a.userId)).toBeNull();
      expect((await account(a.userId)).badges).toEqual([]);
      expect(await cardOf(b.userId)).toBeNull();
      // Added now, it goes to the account signed in.
      await addButton(page).click();
      expect(await outcome(page)).toBe(ADDED);
      expect(await cardOf(b.userId)).toMatchObject({ difficult: GUEST_D });
      expect((await account(b.userId)).badges).toEqual([BADGE]);
      expect(await cardOf(a.userId)).toBeNull();
      expect(await guestStore(page)).toBeNull();
    } finally {
      release();
    }
  });

  test("removed from this browser in another tab, then Add in this one: the page says nothing was added", async ({ page, context }) => {
    const person = await createPerson(prisma, { email: address("removed") });
    await guestCard(page, { wentWell: "", difficult: GUEST_D, confidence: 3 }, [BADGE]);
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    await expect(addButton(page)).toBeVisible({ timeout: 20_000 });
    const other = await context.newPage();
    await other.goto("/en/learner");
    const otherPrompt = other.getByRole("region", { name: PROMPT });
    await otherPrompt.getByRole("button", { name: "Remove it from this browser" }).click({ timeout: 20_000 });
    await expect(otherPrompt.getByRole("status")).toHaveText("Removed from this browser.");
    await addButton(page).click();
    expect(await outcome(page)).toBe(NOTHING);
    expect(await cardOf(person.userId)).toBeNull();
    expect((await account(person.userId)).badges).toEqual([]);
  });

  test("a Comp Card held back from a shared card: the browser keeps the card alone, and adding it later changes nothing else", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("held-back") });
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
    await walkToLastStep(page);
    await finish(page);
    // The guest filled in their Comp Card too.
    await page.evaluate(
      ([key, d]) => {
        const s = JSON.parse(localStorage.getItem(key)!);
        s.compCard = { ...s.compCard, difficult: d, updatedAt: "2026-11-21T09:00:00.000Z" };
        localStorage.setItem(key, JSON.stringify(s));
      },
      [GUEST_STORE, GUEST_D] as const
    );
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    await addButton(page).click({ timeout: 20_000 });
    await outcome(page);
    expect(await account(person.userId)).toMatchObject({ completed: true, p2: GUEST_P2, badges: [BADGE] });
    expect(await guestStore(page), "the Comp Card alone").toEqual({ completed: false, lessons: 0, difficult: GUEST_D, badges: [] });
    await page.waitForTimeout(3000);
    // Later, in the account, the learner empties their second reflection
    // answer, presses "Try again" on the quick check, and takes the Comp
    // Card back to Only me.
    const course = await prisma.course.findFirstOrThrow({ where: { slug: BUILT_IN } });
    await prisma.courseEnrollment.update({
      where: { userId_courseId: { userId: person.userId, courseId: course.id } },
      data: { reflection: { p1: GUEST_P1, p2: "" }, assessment: { answers: {}, checked: false } },
    });
    await prisma.compCard.update({
      where: { userId_projectId: { userId: person.userId, projectId: "seq-elevate" } },
      data: { privacy: "SELF", sharedAt: null, sharedWithOrganisationId: null },
    });
    await page.goto("/en/learner");
    const prompt = page.getByRole("region", { name: PROMPT });
    await expect(prompt).toContainText("No course progress. Comp Card: yes. Badges: 0.", { timeout: 20_000 });
    await addButton(page).click();
    expect(await outcome(page)).toBe(ADDED);
    await page.waitForTimeout(3000);
    expect(await answers(person.userId)).toEqual({
      reflection: { p1: GUEST_P1, p2: "" },
      assessment: { answers: {}, checked: false },
    });
    expect(await cardOf(person.userId)).toMatchObject({ wentWell: ACCOUNT_P1, difficult: GUEST_D, privacy: "SELF" });
    expect(await guestStore(page)).toBeNull();
  });

  test("Add pressed in the course's own player: an answer another device saved since the page loaded stays the account's", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("player") });
    const course = await prisma.course.findFirstOrThrow({ where: { slug: BUILT_IN } });
    await prisma.courseEnrollment.create({
      data: { userId: person.userId, courseId: course.id, stagesCompleted: ["CONTEXT"], reflection: { p1: ACCOUNT_P1 } },
    });
    await walkToLastStep(page);
    await finish(page);
    await signIn(context, person.sessionToken);
    await page.goto(`/en/learner/course/${BUILT_IN}`);
    await expect(addButton(page)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3000); // the course's saved progress has loaded
    // On another device the learner answers the second reflection question.
    await prisma.courseEnrollment.update({
      where: { userId_courseId: { userId: person.userId, courseId: course.id } },
      data: { reflection: { p1: ACCOUNT_P1, p2: PHONE_P2 } },
    });
    await addButton(page).click();
    const said = await outcome(page);
    // Past the page's save debounce.
    await page.waitForTimeout(4000);
    expect(await account(person.userId)).toMatchObject({ completed: true, scenarioRoot: "private", p1: ACCOUNT_P1, p2: PHONE_P2, badges: [BADGE] });
    expect(said).toBe(ADDED_ACCOUNT_FIRST);
  });

  test("every answer to the move lost after the server wrote it: the page says it didn't save, and the next Add says plainly that it was added", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("lost") });
    await walkToLastStep(page);
    await finish(page);
    await signIn(context, person.sessionToken);
    let losing = false;
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (losing && request.method() === "POST" && (await request.headerValue("next-action")) && /"fill":true|voice-without-edges/.test(request.postData() ?? "")) {
        await route.fetch().catch(() => undefined); // the server gets it and writes it
        await route.abort("connectionreset");
        return;
      }
      await route.continue().catch(() => undefined);
    });
    await page.goto("/en/learner");
    await expect(addButton(page)).toBeVisible({ timeout: 20_000 });
    losing = true;
    await addButton(page).click();
    expect(await outcome(page)).toBe(FAILED);
    losing = false;
    expect(await guestStore(page), "kept while no answer came back").not.toBeNull();
    await addButton(page).click({ timeout: 20_000 });
    // Everything in the account is the guest's own: nothing of the account's was kept over it.
    await expect(page.getByRole("region", { name: PROMPT }).getByRole("status")).toHaveText(ADDED, { timeout: 45_000 });
    expect(await account(person.userId)).toMatchObject({ completed: true, p1: GUEST_P1, p2: GUEST_P2, badges: [BADGE] });
    expect(await guestStore(page)).toBeNull();
  });
});
