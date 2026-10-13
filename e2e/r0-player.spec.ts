import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Release 0, the course player (fact-check C7, C8):
 *
 * - quick-check answers, and whether they were checked, are kept: a
 *   learner who comes back to a checked quick check finds their answers
 *   locked, their score and Continue — a guest in this browser, a learner
 *   in their account, for built-in quizzes (q1–q3) and for quizzes made in
 *   the course editor (their own ids, any number of questions), which the
 *   facilitator view then scores;
 * - while Continue is hidden, the practice steps say what it waits for;
 * - every step opens at its top, focused.
 *
 * The guest tests need no database. The rest require a real one — gated
 * on E2E_DB=1, like db-backed-progress. Run: E2E_DB=1 pnpm test:e2e
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const dbDescribe = DB ? test.describe : test.describe.skip;

// The database tests share rows (the built-in course); one at a time.
test.describe.configure({ mode: "serial" });

const PROJECT = "seq-elevate";
const BUILT_IN = "workplace-conflict";
// Unique per run, so a run never meets another's leftovers.
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const HINT = {
  simulation: "Choose an answer to continue.",
  scenario: "To continue, choose what you would do.",
  scenarioFollowup: "Answer the follow-up question to continue.",
  assessment: "Answer every question, then select “Check answers” to continue.",
};

/** The built-in quick check's right answers (q1–q3 are all "b"). */
const BUILT_IN_ANSWERS = [
  "Describes what you felt and what you'd prefer",
  "Notice what you're feeling",
  "It lets both people be heard without an audience",
];

const cont = (page: Page) =>
  page.getByRole("button", { name: /^continue$/i }).first();

/** Continue, retried until the next step shows (hydration may lag). */
async function next(page: Page, heading: RegExp) {
  await expect(async () => {
    await cont(page).click();
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({
      timeout: 2000,
    });
  }).toPass({ timeout: 15_000 });
}

/** An option button of the quick check, by its text. */
const option = (page: Page, text: string) =>
  page.getByRole("button", { name: new RegExp(escapeRe(text)) });

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * From the built-in course's first step to its quick check, checking the
 * hint on each practice step on the way: it shows while Continue is
 * hidden, goes once the step is answered, and comes back after "Try
 * another" / "Try different choices".
 */
async function walkToQuickCheck(page: Page) {
  await page.goto(`/en/learner/course/${BUILT_IN}`);
  await expect(
    page.getByRole("heading", { name: /three weeks into the new job/i })
  ).toBeVisible();
  await next(page, /speaking up without making it worse/i);
  await cont(page).click(); // concept → behaviour
  await cont(page).click(); // behaviour → simulation

  // Guided practice.
  const simHint = page.getByText(HINT.simulation);
  await expect(simHint).toBeVisible();
  await expect(page.getByRole("button", { name: /^continue$/i })).toHaveCount(0);
  await page.getByText(/the bus was late\. when you say/i).click();
  await expect(simHint).toHaveCount(0);
  await expect(cont(page)).toBeVisible();
  await page.getByRole("button", { name: /try another/i }).click();
  await expect(simHint).toBeVisible();
  await expect(page.getByRole("button", { name: /^continue$/i })).toHaveCount(0);
  await page.getByText(/the bus was late\. when you say/i).click();
  await cont(page).click();

  // Applied scenario: a first choice, then its follow-up.
  const rootHint = page.getByText(HINT.scenario);
  await expect(rootHint).toBeVisible();
  await expect(page.getByRole("button", { name: /^continue$/i })).toHaveCount(0);
  await page.getByText(/wait for a quiet moment, then talk to sam/i).click();
  await expect(rootHint).toHaveCount(0);
  await expect(page.getByText(HINT.scenarioFollowup)).toBeVisible();
  await page.getByText(/addressed directly from now on/i).click();
  await expect(page.getByText(HINT.scenarioFollowup)).toHaveCount(0);
  await expect(cont(page)).toBeVisible();
  await page.getByRole("button", { name: /try different choices/i }).click();
  await expect(rootHint).toBeVisible();
  await expect(page.getByRole("button", { name: /^continue$/i })).toHaveCount(0);
  await page.getByText(/wait for a quiet moment, then talk to sam/i).click();
  await page.getByText(/addressed directly from now on/i).click();
  await cont(page).click();

  await cont(page).click(); // reflection → quick check
}

/** Answer the built-in quick check right and check it. */
async function answerQuickCheck(page: Page) {
  const hint = page.getByText(HINT.assessment);
  await expect(hint).toBeVisible();
  const check = page.getByRole("button", { name: /check answers/i });
  await expect(check).toBeDisabled();
  for (const text of BUILT_IN_ANSWERS) await option(page, text).click();
  await expect(check).toBeEnabled();
  await check.click();
  await expect(hint).toHaveCount(0);
  await expect(page.getByText("You got 3 out of 3 right.")).toBeVisible();
}

/**
 * Back on the course page after leaving it: open the quick check from the
 * step bar, once the saved progress has arrived, and find it as it was
 * left — the answers chosen and locked, the score, and Continue.
 */
async function expectCheckedOnReturn(page: Page, url: string, answers: string[], score: string) {
  await page.goto(url);
  const step = page.getByRole("button", { name: /quick check/i });
  await expect(step).toBeEnabled({ timeout: 15_000 });
  await step.click();
  for (const text of answers) {
    const b = option(page, text);
    await expect(b).toHaveAttribute("aria-pressed", "true");
    await expect(b).toBeDisabled();
  }
  await expect(page.getByText(score)).toBeVisible();
  await expect(cont(page)).toBeVisible();
  await expect(page.getByRole("button", { name: /check answers/i })).toHaveCount(0);
}

async function signIn(page: Page, sessionToken: string) {
  await page.context().addCookies([
    {
      name: "authjs.session-token",
      value: sessionToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

// Everyone this file creates, for the clean-up.
const createdUserIds: string[] = [];

/** A learner with a live session (the LEARNER membership comes on first use). */
async function newLearner(email: string) {
  await prisma.user.deleteMany({ where: { email } });
  const user = await prisma.user.create({
    data: { email, emailVerified: new Date() },
  });
  createdUserIds.push(user.id);
  const sessionToken = `e2e-r0p-${RUN}-${Math.random().toString(36).slice(2)}`;
  await prisma.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 86_400_000),
    },
  });
  return { userId: user.id, sessionToken };
}

/** The learner's saved quick check in `slug`, once a save has arrived. */
async function savedAssessment(userId: string, slug: string) {
  const course = await prisma.course.findFirst({
    where: { projectId: PROJECT, slug },
  });
  const e = await prisma.courseEnrollment.findFirst({
    where: { userId, courseId: course!.id },
  });
  return e?.assessment ?? null;
}

test.describe("R0 player — as a guest", () => {
  test("practice steps say what Continue waits for; a checked quick check comes back locked", async ({
    page,
  }) => {
    await walkToQuickCheck(page);
    await answerQuickCheck(page);
    await cont(page).click();
    await expect(
      page.getByRole("heading", { name: /course complete/i })
    ).toBeVisible();

    // A fresh page: this browser's guest store holds the answers.
    await expectCheckedOnReturn(
      page,
      `/en/learner/course/${BUILT_IN}`,
      BUILT_IN_ANSWERS,
      "You got 3 out of 3 right."
    );
  });

  test("the hints are there, in German too, and pass axe with every reading-help setting on", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        "seq-elevate-a11y-v1",
        JSON.stringify({ fontSize: "xl", dyslexia: true, contrast: true })
      )
    );
    await page.goto(`/de/learner/course/${BUILT_IN}`);
    await expect(page.locator("html")).toHaveAttribute("data-contrast", "true");
    await expect(page.locator("html")).toHaveAttribute("data-font-size", "xl");
    const weiter = () => page.getByRole("button", { name: /^weiter$/i }).first();
    await expect(async () => {
      await weiter().click();
      await expect(page.locator("[aria-current=step]")).toContainText("2", {
        timeout: 2000,
      });
    }).toPass({ timeout: 15_000 });
    await weiter().click();
    await weiter().click();

    const hint = page.getByText("Wähle eine Antwort, um weiterzumachen.");
    await expect(hint).toBeVisible();
    // Plain text in page order: not announced as it appears.
    await expect(hint).not.toHaveAttribute("aria-live", /.+/);
    // The step itself: the rest of the page is scanned in accessibility.spec.
    const results = await new AxeBuilder({ page })
      .include("[tabindex='-1']")
      .withTags(TAGS)
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
  });
});

test.describe("R0 player — each step opens at its top, on a phone", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  /** What the page asked window.scrollTo for: the `behavior` of each call. */
  type ScrollSpy = Window & { __scrollBehaviors: string[] };

  test.beforeEach(async ({ page }) => {
    // Records how the player scrolls to the top, so a test can tell an
    // instant jump from a smooth scroll: both end at scrollY 0, and a
    // smooth scroll ends well inside a poll's timeout.
    await page.addInitScript(() => {
      const w = window as unknown as ScrollSpy;
      w.__scrollBehaviors = [];
      const scrollTo = window.scrollTo.bind(window);
      window.scrollTo = ((...args: unknown[]) => {
        const opts = args[0];
        w.__scrollBehaviors.push(
          typeof opts === "object" && opts !== null
            ? ((opts as ScrollToOptions).behavior ?? "auto")
            : "auto"
        );
        (scrollTo as (...a: unknown[]) => void)(...args);
      }) as typeof window.scrollTo;
    });
  });

  const scrollBehaviors = (page: Page) =>
    page.evaluate(() => (window as unknown as ScrollSpy).__scrollBehaviors);

  async function continueFromTheBottom(page: Page) {
    await page.goto(`/en/learner/course/${BUILT_IN}`);
    await expect(
      page.getByRole("heading", { name: /three weeks into the new job/i })
    ).toBeVisible();
    // The first step is taller than the screen: Continue is at its bottom.
    await cont(page).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    // Only the scroll that opens the next step counts.
    await page.evaluate(() => {
      (window as unknown as ScrollSpy).__scrollBehaviors = [];
    });
    await next(page, /speaking up without making it worse/i);
    await expect.poll(async () => (await scrollBehaviors(page)).length).toBeGreaterThan(0);
  }

  async function expectNewStepAtTop(page: Page) {
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(
      page.getByRole("heading", { name: /speaking up without making it worse/i })
    ).toBeInViewport();
    // Focus is on the new step, for screen readers.
    expect(
      await page.evaluate(() => {
        const el = document.activeElement;
        return (
          el?.getAttribute("tabindex") === "-1" &&
          !!el.textContent?.match(/speaking up without making it worse/i)
        );
      })
    ).toBe(true);
  }

  test("after Continue at the bottom of a long step, the next one starts at its top", async ({
    page,
  }) => {
    await continueFromTheBottom(page);
    expect(await scrollBehaviors(page)).toEqual(["smooth"]);
    await expectNewStepAtTop(page);
  });

  test("with reduced motion it jumps there at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await continueFromTheBottom(page);
    expect(await scrollBehaviors(page)).toEqual(["auto"]);
    // An instant jump is done by the time the step has opened: no waiting.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expectNewStepAtTop(page);
  });
});

dbDescribe("R0 player — quick-check answers are saved to the account", () => {
  const emails: string[] = [];
  const SLUG = `e2e-r0-player-${RUN}`;
  const STAFF = `e2e-r0-player-staff-${RUN}@example.com`;

  test.afterAll(async () => {
    // The player's telemetry outlives a deleted user (actorId set to null).
    await prisma.auditLog.deleteMany({
      where: { actorId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [...emails, STAFF] } },
    });
    await prisma.lesson.deleteMany({ where: { courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { slug: SLUG } });
  });

  test("a learner's checked built-in quick check is saved and comes back locked", async ({
    page,
  }) => {
    const email = `e2e-r0-player-learner-${RUN}@example.com`;
    emails.push(email);
    const { userId, sessionToken } = await newLearner(email);
    await signIn(page, sessionToken);

    await walkToQuickCheck(page);
    await answerQuickCheck(page);
    await expect
      .poll(() => savedAssessment(userId, BUILT_IN), { timeout: 15_000 })
      .toEqual({ answers: { q1: "b", q2: "b", q3: "b" }, checked: true });

    await cont(page).click();
    await expect(
      page.getByRole("heading", { name: /course complete/i })
    ).toBeVisible();

    await expectCheckedOnReturn(
      page,
      `/en/learner/course/${BUILT_IN}`,
      BUILT_IN_ANSWERS,
      "You got 3 out of 3 right."
    );
  });

  test("a guest's checked quick check moves to the account they sign in to", async ({
    page,
  }) => {
    const email = `e2e-r0-player-migrate-${RUN}@example.com`;
    emails.push(email);
    const { userId, sessionToken } = await newLearner(email);

    await walkToQuickCheck(page);
    await answerQuickCheck(page);
    await cont(page).click();
    await expect(
      page.getByRole("heading", { name: /course complete/i })
    ).toBeVisible();

    await signIn(page, sessionToken);
    await page.goto("/en/learner");
    await expect
      .poll(() => savedAssessment(userId, BUILT_IN), { timeout: 15_000 })
      .toEqual({ answers: { q1: "b", q2: "b", q3: "b" }, checked: true });
  });

  test("a quiz made in the editor keeps its own ids, any number of questions, and the facilitator sees the score", async ({
    page,
    context,
  }) => {
    // Four questions with the editor's kind of ids; three answered right.
    const questions = [
      { id: "qk3fa1", right: "ax1", wrong: "ax2", text: "First" },
      { id: "q9zzb2", right: "ax3", wrong: "ax4", text: "Second" },
      { id: "qm4tc3", right: "ax5", wrong: "ax6", text: "Third" },
      { id: "qp7wd4", right: "ax7", wrong: "ax8", text: "Fourth" },
    ];
    await prisma.course.create({
      data: {
        projectId: PROJECT,
        strapiId: `cms-${SLUG}`,
        slug: SLUG,
        cluster: "communication",
        durationMinutes: 15,
        status: "published",
        publishedAt: new Date(),
        meta: {
          en: {
            title: `E2E R0 Player ${RUN}`,
            tagline: "a quiz of its own",
            clusterLabel: "Communication",
          },
        },
      },
    });
    await prisma.lesson.create({
      data: {
        projectId: PROJECT,
        courseSlug: SLUG,
        stageKey: "assessment",
        structure: {
          kind: "assessment",
          title: { en: "Quick check" },
          intro: { en: "Four questions." },
          questions: questions.map((q) => ({
            id: q.id,
            correctOptionId: q.right,
            question: { en: `${q.text} question?` },
            options: [
              { id: q.right, text: { en: `${q.text}: right` } },
              { id: q.wrong, text: { en: `${q.text}: wrong` } },
            ],
          })),
        },
      },
    });

    const email = `e2e-r0-player-cms-${RUN}@example.com`;
    emails.push(email);
    const { userId, sessionToken } = await newLearner(email);
    await signIn(page, sessionToken);

    // The narrative steps are always there: four of them to the quick check.
    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(async () => {
      await cont(page).click();
      await expect(page.locator("[aria-current=step]")).toContainText("2", {
        timeout: 2000,
      });
    }).toPass({ timeout: 15_000 });
    await cont(page).click();
    await cont(page).click();
    await cont(page).click();

    const chosen = [
      "First: right",
      "Second: right",
      "Third: wrong",
      "Fourth: right",
    ];
    await expect(page.getByText(HINT.assessment)).toBeVisible();
    for (const text of chosen) await option(page, text).click();
    await page.getByRole("button", { name: /check answers/i }).click();
    await expect(page.getByText("You got 3 out of 4 right.")).toBeVisible();

    await expect
      .poll(() => savedAssessment(userId, SLUG), { timeout: 15_000 })
      .toEqual({
        answers: { qk3fa1: "ax1", q9zzb2: "ax3", qm4tc3: "ax6", qp7wd4: "ax7" },
        checked: true,
      });

    await cont(page).click();
    await expect(
      page.getByRole("heading", { name: /course complete/i })
    ).toBeVisible();
    await expectCheckedOnReturn(
      page,
      `/en/learner/course/${SLUG}`,
      chosen,
      "You got 3 out of 4 right."
    );

    // The facilitator view scores it by question id.
    const staff = await prisma.user.create({
      data: { email: STAFF, emailVerified: new Date() },
    });
    createdUserIds.push(staff.id);
    await prisma.membership.create({
      data: { userId: staff.id, projectId: PROJECT, role: "FACILITATOR" },
    });
    const staffSession = `e2e-r0p-staff-${RUN}`;
    await prisma.session.create({
      data: {
        sessionToken: staffSession,
        userId: staff.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
    await page.goto("about:blank");
    await context.clearCookies();
    await signIn(page, staffSession);
    await page.goto("/en/facilitator");
    const row = page.locator("li", { hasText: email }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /open learner/i }).click();
    await expect(page.getByText("Assessment: 3/4")).toBeVisible();
  });
});
