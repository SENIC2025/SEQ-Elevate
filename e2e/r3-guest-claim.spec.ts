import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, removePeople, runId, signIn } from "./fixtures/people";
import { guestCourseCompleted } from "./fixtures/guest-work";

/**
 * Release 3 (D37, D69, D79, D80): "Add it to my account" sends the
 * browser's guest work to the server once, and the server decides each
 * part in one transaction, as the account is then:
 *
 *   - the course moves only into an account with no progress in it; an
 *     account that already holds all of it says so ("already"); any other
 *     keeps its own, and the browser keeps the guest's; a course that can't
 *     be opened any more isn't added either;
 *   - the Comp Card moves only where the account has none, or a blank one
 *     not shared, and as "Only me"; a card with answers of its own keeps
 *     them, and a shared one gets nothing (moving never shares);
 *   - badges are a union;
 *   - a text too long to add means nothing is written, and the offer shows
 *     it to be shortened; another account signed in means nothing is
 *     written and the browser keeps all of it.
 *
 * The browser then removes only the parts the server says are in the
 * account, and only as it read them, and the page says what became of each
 * part. Release 3's claim, on Release 3's build. Requires a real database:
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
const OTHER_COURSE = "receiving-feedback";
const TITLE = "Handling a small workplace conflict";
const BADGE = "voice-without-edges";
const PROMPT = "Work saved on this browser before you signed in";
const GUEST_P1 = `guest-p1-${RUN}`;
const GUEST_P2 = `guest-p2-${RUN}`;
const GUEST_W = `guest-went-${RUN}`;
const GUEST_D = `guest-difficult-${RUN}`;
const ACCOUNT_P1 = `account-p1-${RUN}`;
const NEW = `account-new-${RUN}`;
const PHONE_P2 = `phone-p2-${RUN}`;

const ADDED = "Added to your account.";
const ALREADY = "It's already in your account.";
const NOTHING = "Nothing was added: there is no work on this browser to add any more.";
const STAYS = "What wasn't added stays on this browser until you remove it.";
const COURSE_KEPT = `Your progress in ${TITLE} wasn't added: your account already has progress in this course, which it keeps.`;
const CARD_ADDED = "Your Comp Card was added to your account.";
const CARD_KEPT = "Your Comp Card wasn't added: your account already has a Comp Card with answers in it, which it keeps.";
const CARD_SHARED =
  "Your Comp Card wasn't added: your account's Comp Card is shared with your facilitators, and adding never shares it. To add it, set your Comp Card to “Only me” first.";
const BADGE_IN = "Your badge is in your account.";
const UNCONFIRMED = "We couldn't confirm that it was added: the connection failed. It's still on this browser: try again.";

const next = (page: Page) => page.getByRole("button", { name: /^continue$/i });
const region = (page: Page) => page.getByRole("region", { name: PROMPT });
const addButton = (page: Page) => region(page).getByRole("button", { name: "Add it to my account" });

/** What the prompt says once the work has been added (or not): never while it is being added. */
async function outcome(page: Page) {
  const status = region(page).getByRole("status");
  await expect(status).not.toHaveText(/^(|Saving…)$/, { timeout: 60_000 });
  return (await status.textContent())?.replace(/\s+/g, " ").trim();
}

/** A guest's walk of the built-in course up to its last Continue, with two reflection answers. */
async function walkToLastStep(page: Page, p2 = GUEST_P2) {
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
  await page.getByRole("textbox").nth(1).fill(p2);
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

/** The guest's finished course, with a Comp Card the guest filled in too. */
async function finishedWithCard(page: Page, card: { wentWell?: string; difficult?: string } = { difficult: GUEST_D }) {
  await walkToLastStep(page);
  await finish(page);
  await page.evaluate(
    ([key, c]) => {
      const s = JSON.parse(localStorage.getItem(key)!);
      s.compCard = { ...s.compCard, ...c, updatedAt: "2026-11-21T09:00:00.000Z" };
      localStorage.setItem(key, JSON.stringify(s));
    },
    [GUEST_STORE, card] as const
  );
}

/** The browser's guest store, as far as these tests look at it; null when there is none. */
const guestStore = (page: Page) =>
  page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as {
      course?: { courseSlug?: string | null; completedAt?: string | null; stagesCompleted?: string[]; reflection?: { p2?: string } };
      compCard?: { wentWell?: string; difficult?: string };
      badges?: string[];
    };
    return {
      course: s.course?.courseSlug ?? null,
      completed: !!s.course?.completedAt,
      lessons: s.course?.stagesCompleted?.length ?? 0,
      p2: s.course?.reflection?.p2 ?? "",
      wentWell: s.compCard?.wentWell ?? "",
      difficult: s.compCard?.difficult ?? "",
      badges: s.badges ?? [],
    };
  }, GUEST_STORE);

/** What the account holds of a course (the built-in one by default), and its badges. */
async function account(userId: string, slug = BUILT_IN) {
  const e = await prisma.courseEnrollment.findFirst({ where: { userId, course: { slug } } });
  const badges = await prisma.userBadge.findMany({ where: { userId }, select: { badge: { select: { slug: true } } } });
  const reflection = (e?.reflection ?? {}) as Record<string, string>;
  return {
    enrolled: !!e,
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
  await putGuestCard(page, card, badges);
}

/** The same guest store, put in from a page that writes none (a signed-in one). */
async function putGuestCard(page: Page, card: { wentWell: string; difficult: string; confidence: number }, badges: string[]) {
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

const setCookie = (context: BrowserContext, sessionToken: string) =>
  context.addCookies([
    { name: "authjs.session-token", value: sessionToken, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);

/** Holds the first server action whose body contains `marker` until released. */
async function holdAction(page: Page, marker: string) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const state = { heldOnce: false };
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (!state.heldOnce && request.method() === "POST" && (await request.headerValue("next-action")) && (request.postData() ?? "").includes(marker)) {
      state.heldOnce = true;
      await held;
    }
    await route.continue().catch(() => undefined);
  });
  return { state, release };
}

/** Polls the database for an insert into the enrolments or the Comp Cards waiting on another transaction's. */
async function insertBlocked(ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'
         AND (query ILIKE '%INSERT INTO "public"."CourseEnrollment"%' OR query ILIKE '%INSERT INTO "public"."CompCard"%')`
    );
    if ((rows[0]?.n ?? 0) > 0) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe("Release 3: guest work added to an account, part by part", () => {
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

  test("an account with nothing in it gets everything: the course, the Comp Card as Only me and the badge, and the offer says to add it first", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("empty") });
    await finishedWithCard(page, { wentWell: GUEST_W, difficult: GUEST_D });
    const walked = await guestStore(page);
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    await expect(addButton(page)).toBeVisible({ timeout: 20_000 });
    await expect.soft(region(page)).toContainText("Add it before you start anything else in your account");
    await addButton(page).click();
    const said = await outcome(page);
    expect(await account(person.userId)).toEqual({
      enrolled: true,
      completed: true,
      lessons: walked!.lessons,
      scenarioRoot: "private",
      p1: GUEST_P1,
      p2: GUEST_P2,
      badges: [BADGE],
    });
    expect(await cardOf(person.userId)).toMatchObject({ wentWell: GUEST_W, difficult: GUEST_D, privacy: "SELF", sharedAt: null });
    expect(await guestStore(page), "and no longer in this browser").toBeNull();
    expect(said).toBe(ADDED);
    await page.reload();
    await expect(region(page)).toHaveCount(0);
  });

  test("an account with its own progress in the course keeps it; the Comp Card and the badge move, and the course stays in this browser", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("own-course") });
    const course = await prisma.course.findFirstOrThrow({ where: { slug: BUILT_IN } });
    // Signed in elsewhere: the first lesson, and an answer of its own.
    await prisma.courseEnrollment.create({
      data: { userId: person.userId, courseId: course.id, stagesCompleted: ["CONTEXT"], reflection: { p1: ACCOUNT_P1 } },
    });
    await finishedWithCard(page);
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    await addButton(page).click({ timeout: 20_000 });
    const said = await outcome(page);
    expect(await account(person.userId), "the account's own progress, as it was").toEqual({
      enrolled: true,
      completed: false,
      lessons: 1,
      scenarioRoot: null,
      p1: ACCOUNT_P1,
      p2: null,
      badges: [BADGE],
    });
    expect(await cardOf(person.userId)).toMatchObject({ difficult: GUEST_D, privacy: "SELF" });
    expect(await guestStore(page), "the course alone stays in this browser").toMatchObject({
      course: BUILT_IN,
      completed: true,
      p2: GUEST_P2,
      difficult: "",
      badges: [],
    });
    expect(said).toBe(`${COURSE_KEPT} ${CARD_ADDED} ${BADGE_IN} ${STAYS}`);
    // Offered again as what it is: the course alone; removing it is the way on.
    await page.reload();
    await expect(region(page)).toContainText(`${TITLE}. Comp Card: no. Badges: 0.`, { timeout: 20_000 });
    await region(page).getByRole("button", { name: "Remove it from this browser" }).click();
    expect(await guestStore(page)).toBeNull();
  });

  test("an account that has another course gets the guest's course", async ({ page, context }) => {
    const person = await createPerson(prisma, { email: address("other-course") });
    const other = await prisma.course.findFirstOrThrow({ where: { slug: OTHER_COURSE } });
    await prisma.courseEnrollment.create({
      data: { userId: person.userId, courseId: other.id, stagesCompleted: ["CONTEXT", "CONCEPT"] },
    });
    await walkToLastStep(page);
    await finish(page);
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    await addButton(page).click({ timeout: 20_000 });
    expect(await outcome(page)).toBe(ADDED);
    expect(await account(person.userId)).toMatchObject({ completed: true, p1: GUEST_P1, p2: GUEST_P2, badges: [BADGE] });
    expect(await account(person.userId, OTHER_COURSE), "the account's other course, as it was").toMatchObject({ completed: false, lessons: 2 });
    expect(await guestStore(page)).toBeNull();
  });

  test("a blank Comp Card, made when the learner chose who sees it, gets the guest's card", async ({ page, context }) => {
    const person = await createPerson(prisma, { email: address("blank-card") });
    await prisma.compCard.create({ data: { userId: person.userId, projectId: "seq-elevate" } });
    await guestCard(page, { wentWell: GUEST_W, difficult: GUEST_D, confidence: 5 }, []);
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    await addButton(page).click({ timeout: 20_000 });
    expect(await outcome(page)).toBe(ADDED);
    expect(await cardOf(person.userId)).toMatchObject({ wentWell: GUEST_W, difficult: GUEST_D, confidence: 5, privacy: "SELF" });
    expect(await guestStore(page)).toBeNull();
  });

  test("a Comp Card with answers of the account's own keeps them, and the guest's card stays in this browser", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("own-card") });
    await prisma.compCard.create({ data: { userId: person.userId, projectId: "seq-elevate", wentWell: ACCOUNT_P1 } });
    await guestCard(page, { wentWell: "", difficult: GUEST_D, confidence: 4 }, [BADGE]);
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    await addButton(page).click({ timeout: 20_000 });
    const said = await outcome(page);
    expect(await cardOf(person.userId), "the account's card, as it was").toMatchObject({ wentWell: ACCOUNT_P1, difficult: "", confidence: 3 });
    expect((await account(person.userId)).badges).toEqual([BADGE]);
    expect(await guestStore(page)).toMatchObject({ difficult: GUEST_D, badges: [] });
    expect(said).toBe(`${CARD_KEPT} ${BADGE_IN} ${STAYS}`);
  });

  test("a shared Comp Card gets nothing from this browser; once it is Only me, the guest's card moves", async ({ page, context }) => {
    const person = await createPerson(prisma, { email: address("shared") });
    await prisma.compCard.create({
      data: {
        userId: person.userId,
        projectId: "seq-elevate",
        privacy: "FACILITATOR",
        sharedAt: new Date(),
        sharedWithOrganisationId: person.organisationId,
      },
    });
    await guestCard(page, { wentWell: "", difficult: GUEST_D, confidence: 3 }, [BADGE]);
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    await addButton(page).click({ timeout: 20_000 });
    const said = await outcome(page);
    expect((await account(person.userId)).badges).toEqual([BADGE]);
    expect(await cardOf(person.userId), "the shared card as it was").toMatchObject({ difficult: "", privacy: "FACILITATOR" });
    expect(await guestStore(page), "the guest's card is still in this browser").toMatchObject({ difficult: GUEST_D, badges: [] });
    expect.soft(said).toBe(`${CARD_SHARED} ${BADGE_IN} ${STAYS}`);

    // The learner takes the card back to Only me, then adds it.
    await page.goto("/en/learner/comp-card");
    await page.getByRole("button", { name: "Only me" }).click();
    await expect(page.getByRole("button", { name: "Only me" })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await cardOf(person.userId))?.privacy, { timeout: 15_000 }).toBe("SELF");
    await page.goto("/en/learner");
    await addButton(page).click({ timeout: 20_000 });
    expect(await outcome(page)).toBe(ADDED);
    expect(await cardOf(person.userId)).toMatchObject({ difficult: GUEST_D, privacy: "SELF", sharedAt: null });
    expect(await guestStore(page)).toBeNull();
  });

  test("a text too long to add means nothing is added; shortened on the offer, all of it is", async ({ page, context }) => {
    const person = await createPerson(prisma, { email: address("long") });
    const LONG_P2 = `long-p2-${RUN} ${"y".repeat(5100)}`;
    const LONG_D = `long-d-${RUN} ${"x".repeat(2100)}`;
    const SHORT_P2 = `short-p2-${RUN}`;
    const SHORT_D = `short-d-${RUN}`;
    await walkToLastStep(page, LONG_P2);
    await finish(page);
    await page.evaluate(
      ([key, d]) => {
        const s = JSON.parse(localStorage.getItem(key)!);
        s.compCard = { ...s.compCard, difficult: d, updatedAt: "2026-11-21T09:00:00.000Z" };
        localStorage.setItem(key, JSON.stringify(s));
      },
      [GUEST_STORE, LONG_D] as const
    );
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    const prompt = region(page);
    // Offered to be shortened before anything is sent: each with its length.
    const reflectionBox = prompt.getByRole("textbox", { name: "Reflection answer 2" });
    const cardBox = prompt.getByRole("textbox", { name: "What was difficult" });
    await expect(reflectionBox).toHaveValue(LONG_P2, { timeout: 20_000 });
    await expect(cardBox).toHaveValue(LONG_D);
    await expect(cardBox).toHaveAttribute("aria-invalid", "true");
    await expect(prompt).toContainText(`${LONG_P2.length.toLocaleString("en")} of at most 5,000 characters: ${LONG_P2.length - 5000} characters too many.`);
    await expect(prompt).toContainText(`${LONG_D.length.toLocaleString("en")} of at most 2,000 characters: ${LONG_D.length - 2000} characters too many.`);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);

    // Added as it is: nothing is written, nothing leaves this browser.
    await addButton(page).click();
    const said = await outcome(page);
    expect(await account(person.userId)).toMatchObject({ enrolled: false, badges: [] });
    expect(await cardOf(person.userId)).toBeNull();
    expect(await guestStore(page)).toMatchObject({ completed: true, p2: LONG_P2, difficult: LONG_D, badges: [BADGE] });
    expect(said).toBe(
      "Nothing was added: 2 answers are too long. Shorten them above, then add your work again, or remove it from this browser."
    );

    // Shortened: saved on this browser as it is typed, and it outlives a reload.
    await reflectionBox.fill(SHORT_P2);
    await cardBox.fill(SHORT_D);
    await expect(prompt).toContainText(`${SHORT_D.length} of 2,000 characters: short enough to add.`);
    await expect.poll(async () => (await guestStore(page))?.difficult, { timeout: 10_000 }).toBe(SHORT_D);
    await expect.poll(async () => (await guestStore(page))?.p2, { timeout: 10_000 }).toBe(SHORT_P2);
    await page.reload();
    await expect(prompt).toContainText(`${TITLE}. Comp Card: yes. Badges: 1.`, { timeout: 20_000 });
    await expect(prompt.getByRole("textbox")).toHaveCount(0);
    await addButton(page).click();
    expect(await outcome(page)).toBe(ADDED);
    expect(await account(person.userId)).toMatchObject({ completed: true, p1: GUEST_P1, p2: SHORT_P2, badges: [BADGE] });
    expect(await cardOf(person.userId)).toMatchObject({ difficult: SHORT_D });
    expect(await guestStore(page)).toBeNull();
  });

  test("another device's first save of the course and of the Comp Card, still on its way when the work is added, stays the account's", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("first-saves") });
    const course = await prisma.course.findFirstOrThrow({ where: { slug: BUILT_IN } });
    await finishedWithCard(page, { wentWell: GUEST_W, difficult: GUEST_D });
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    await expect(addButton(page)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2000);
    // Another device saves the account's first lesson and first Comp Card
    // text: written, and held open, while the guest's work is added.
    let commit!: () => void;
    const go = new Promise<void>((resolve) => (commit = resolve));
    let written!: () => void;
    const isWritten = new Promise<void>((resolve) => (written = resolve));
    const otherDevice = prisma.$transaction(
      async (tx) => {
        await tx.courseEnrollment.create({ data: { userId: person.userId, courseId: course.id, stagesCompleted: ["CONTEXT"] } });
        await tx.compCard.create({ data: { userId: person.userId, projectId: "seq-elevate", wentWell: NEW } });
        written();
        await go;
      },
      { timeout: 90_000, maxWait: 10_000 }
    );
    await isWritten;
    let blocked = false;
    try {
      await addButton(page).click();
      blocked = await insertBlocked(30_000);
    } finally {
      commit();
      await otherDevice;
    }
    const said = await outcome(page);
    await page.waitForTimeout(3000);
    expect(blocked, "the guest's work waited for the other device's save").toBe(true);
    // What the account saved stays (D37, D69): its lesson, and its card whole.
    expect(await account(person.userId)).toMatchObject({ completed: false, lessons: 1, p1: null, badges: [BADGE] });
    expect(await cardOf(person.userId)).toMatchObject({ wentWell: NEW, difficult: "" });
    expect(await guestStore(page)).toMatchObject({ completed: true, wentWell: GUEST_W, difficult: GUEST_D, badges: [] });
    expect(said).toBe(`${COURSE_KEPT} ${CARD_KEPT} ${BADGE_IN} ${STAYS}`);
  });

  test("another account signing in on this browser while the work is added: nothing goes to the first, the browser keeps it, and it is offered to whoever is signed in", async ({
    page,
    context,
  }) => {
    const a = await createPerson(prisma, { email: address("first") });
    const b = await createPerson(prisma, { email: address("second") });
    await guestCard(page, { wentWell: "", difficult: GUEST_D, confidence: 3 }, [BADGE]);
    await signIn(context, a.sessionToken);
    // The work's request waits while B signs in on this browser (another
    // tab): this tab hasn't read its session again.
    const hold = await holdAction(page, GUEST_D);
    try {
      await page.goto("/en/learner");
      await addButton(page).click({ timeout: 20_000 });
      await expect.poll(() => hold.state.heldOnce, { timeout: 30_000 }).toBe(true);
      await setCookie(context, b.sessionToken);
      hold.release();
      // The page finds B signed in, lets go of A's data and offers the work to B.
      await expect(addButton(page)).toBeVisible({ timeout: 45_000 });
      await page.waitForTimeout(3000);
      expect(await region(page).textContent()).not.toContain("Added");
      expect(await guestStore(page), "the browser still holds it").toMatchObject({ difficult: GUEST_D, badges: [BADGE] });
      expect(await cardOf(a.userId)).toBeNull();
      expect((await account(a.userId)).badges).toEqual([]);
      // Added now, it goes to the account signed in, and only there.
      await addButton(page).click();
      expect(await outcome(page)).toBe(ADDED);
      expect(await cardOf(b.userId)).toMatchObject({ difficult: GUEST_D });
      expect((await account(b.userId)).badges).toEqual([BADGE]);
      expect(await cardOf(a.userId)).toBeNull();
      expect((await account(a.userId)).badges, "the guest's one badge, in one account").toEqual([]);
      expect(await guestStore(page)).toBeNull();
    } finally {
      hold.release();
    }
  });

  test("every answer to the request lost after the server wrote it: the page doesn't say it was added, and the next Add says it is already there", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    const person = await createPerson(prisma, { email: address("lost") });
    await finishedWithCard(page);
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
    expect(await outcome(page)).toBe(UNCONFIRMED);
    losing = false;
    expect(await guestStore(page), "kept while no answer came back").not.toBeNull();
    expect(await account(person.userId)).toMatchObject({ completed: true, p1: GUEST_P1, p2: GUEST_P2, badges: [BADGE] });
    await addButton(page).click({ timeout: 20_000 });
    expect(await outcome(page)).toBe(ALREADY);
    expect(await account(person.userId)).toMatchObject({ completed: true, p1: GUEST_P1, p2: GUEST_P2, badges: [BADGE] });
    expect(await cardOf(person.userId)).toMatchObject({ difficult: GUEST_D });
    expect(await guestStore(page)).toBeNull();
  });

  test("removed from this browser in another tab: this tab's offer goes too, and an Add that finds nothing says so", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("removed") });
    await guestCard(page, { wentWell: "", difficult: GUEST_D, confidence: 3 }, [BADGE]);
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    await expect(addButton(page)).toBeVisible({ timeout: 20_000 });
    const other = await context.newPage();
    await other.goto("/en/learner");
    await region(other).getByRole("button", { name: "Remove it from this browser" }).click({ timeout: 20_000 });
    await expect(region(other).getByRole("status")).toHaveText("Removed from this browser.");
    // This tab follows the browser: nothing left to offer.
    await expect(region(page)).toHaveCount(0, { timeout: 10_000 });

    // The same in this tab's own moment, before it hears of it: Add finds nothing.
    await putGuestCard(other, { wentWell: "", difficult: GUEST_D, confidence: 3 }, [BADGE]);
    await page.reload();
    await expect(addButton(page)).toBeVisible({ timeout: 20_000 });
    await page.evaluate((key) => localStorage.removeItem(key), GUEST_STORE);
    await addButton(page).click();
    expect(await outcome(page)).toBe(NOTHING);
    expect(await cardOf(person.userId)).toBeNull();
    expect((await account(person.userId)).badges).toEqual([]);
  });

  test("Add pressed in two tabs at once: everything is in the account once, one tab says added, the other that it is already there", async ({
    page,
    context,
  }) => {
    const person = await createPerson(prisma, { email: address("two-tabs") });
    await finishedWithCard(page);
    await signIn(context, person.sessionToken);
    const other = await context.newPage();
    await page.goto("/en/learner");
    await other.goto("/en/learner");
    await expect(addButton(page)).toBeVisible({ timeout: 20_000 });
    await expect(addButton(other)).toBeVisible({ timeout: 20_000 });
    await Promise.all([addButton(page).click(), addButton(other).click()]);
    const said = [await outcome(page), await outcome(other)].sort();
    expect(said).toEqual([ADDED, ALREADY].sort());
    expect(await account(person.userId)).toMatchObject({ completed: true, p1: GUEST_P1, p2: GUEST_P2, badges: [BADGE] });
    expect(await prisma.courseEnrollment.count({ where: { userId: person.userId } })).toBe(1);
    expect(await cardOf(person.userId)).toMatchObject({ difficult: GUEST_D });
    expect(await guestStore(page)).toBeNull();
  });

  test("Add pressed in the course's own player of an account with progress in it: an answer another device saved since the page loaded stays the account's", async ({
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
    expect(await account(person.userId)).toMatchObject({ completed: false, lessons: 1, p1: ACCOUNT_P1, p2: PHONE_P2, badges: [BADGE] });
    expect(said).toBe(`${COURSE_KEPT} ${BADGE_IN} ${STAYS}`);
  });

  test("a course that can't be opened any more isn't added, and stays in this browser; the rest moves", async ({ page, context }) => {
    const person = await createPerson(prisma, { email: address("gone") });
    const GONE = `e2e-gone-${RUN}`;
    await guestCard(page, { wentWell: GUEST_W, difficult: "", confidence: 3 }, [BADGE]);
    // The guest played a course since deleted.
    await page.evaluate(
      ([key, slug]) => {
        const s = JSON.parse(localStorage.getItem(key)!);
        s.course = {
          courseSlug: slug,
          courseTitle: "A course since deleted",
          courseLocale: "en",
          stagesCompleted: ["context"],
          simulation: null,
          scenario: { root: null, followup: null, rootLabel: null, followupLabel: null },
          reflection: { p1: "", p2: "", p3: "" },
          assessment: { answers: {}, checked: false },
          sectionsCompleted: [],
          responses: {},
          completedAt: null,
        };
        localStorage.setItem(key, JSON.stringify(s));
      },
      [GUEST_STORE, GONE] as const
    );
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    await addButton(page).click({ timeout: 20_000 });
    const said = await outcome(page);
    expect(await prisma.courseEnrollment.count({ where: { userId: person.userId } })).toBe(0);
    expect(await cardOf(person.userId)).toMatchObject({ wentWell: GUEST_W });
    expect((await account(person.userId)).badges).toEqual([BADGE]);
    expect(await guestStore(page), "the course stays in this browser").toMatchObject({ course: GONE, lessons: 1, wentWell: "", badges: [] });
    expect(said).toBe(
      `Your progress in A course since deleted wasn't added: the course isn't available any more. ${CARD_ADDED} ${BADGE_IN} ${STAYS}`
    );
  });
});
