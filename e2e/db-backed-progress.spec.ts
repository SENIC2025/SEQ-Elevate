import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Verifies that an AUTHENTICATED learner's progress persists to Postgres:
 * walking a course in the browser creates a CourseEnrollment (completed),
 * a UserBadge, and an auto-provisioned LEARNER Membership.
 *
 * Requires a real database — gated on E2E_DB=1 (set locally; CI runs the
 * guest suite without a DB). Run: E2E_DB=1 pnpm test:e2e
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;

// These tests mutate a shared database — run them one at a time so they
// don't see each other's learners or race on cleanup.
test.describe.configure({ mode: "serial" });

/**
 * Walks the workplace-conflict course from the course page to the completion
 * screen, making the canonical "best" choices (scenarioRoot = "private",
 * badge = voice-without-edges). Shared by the authed-walk and guest-migration
 * tests so they exercise the exact same journey.
 */
async function walkWorkplaceConflict(page: import("@playwright/test").Page) {
  await page.goto("/en/learner/course/workplace-conflict");
  const cont = () => page.getByRole("button", { name: /^continue$/i });

  await cont().click(); // context → concept
  await cont().click(); // concept → behaviour
  await cont().click(); // behaviour → simulation

  // simulation: pick the I-statement option
  await page.getByText(/the bus was late\. when you say/i).click();
  await cont().click();

  // scenario: root + followup
  await page.getByText(/wait for a quiet moment, then talk to sam/i).click();
  await page.getByText(/addressed directly from now on/i).click();
  await cont().click();

  await cont().click(); // reflection → assessment

  // assessment: pick the correct answer for each, check, continue
  await page.getByText("Describes what you felt and what you'd prefer").click();
  await page.getByText("Notice what you're feeling").click();
  await page
    .getByText("It lets both people be heard without an audience")
    .click();
  await page.getByRole("button", { name: /check answers/i }).click();
  await cont().click();

  // completion
  await expect(
    page.getByRole("heading", { name: /course complete/i })
  ).toBeVisible();
}

describe("DB-backed learner progress", () => {
  const email = "e2e-learner@example.com";
  let userId: string;
  let sessionToken: string;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    const user = await prisma.user.create({
      data: { email, emailVerified: new Date() },
    });
    userId = user.id;
    sessionToken = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await prisma.session.create({
      data: {
        sessionToken,
        userId,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  test("walking a course persists enrollment, badge and membership", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: sessionToken,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    // Dashboard — session active client-side + membership auto-provisioned
    await page.goto("/en/learner");
    await expect(page.getByText(email)).toBeVisible();

    // Walk the workplace-conflict course end to end
    await walkWorkplaceConflict(page);

    // let the debounced DB writes flush
    await page.waitForTimeout(2000);

    // ---- assertions against the database ----
    const course = await prisma.course.findFirst({
      where: { slug: "workplace-conflict" },
    });
    const enrollment = await prisma.courseEnrollment.findFirst({
      where: { userId, courseId: course!.id },
    });
    expect(enrollment, "enrollment created").toBeTruthy();
    expect(enrollment?.completedAt, "course marked complete").toBeTruthy();
    expect(enrollment?.stagesCompleted.length, "stages recorded").toBeGreaterThan(
      5
    );
    expect(enrollment?.scenarioRoot, "scenario choice saved").toBe("private");

    const membership = await prisma.membership.findFirst({
      where: { userId, role: "LEARNER" },
    });
    expect(membership, "LEARNER membership auto-provisioned").toBeTruthy();

    const userBadge = await prisma.userBadge.findFirst({
      where: { userId },
      include: { badge: true },
    });
    expect(userBadge?.badge.slug, "badge awarded").toBe("voice-without-edges");
  });
});

describe("facilitator sees real learners", () => {
  const staffEmail = "e2e-staff@example.com";
  const learnerEmail = "e2e-cohort-learner@example.com";
  let staffSession: string;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [staffEmail, learnerEmail] } },
    });

    // A learner with progress + a Comp Card the facilitator may see
    const learner = await prisma.user.create({
      data: { email: learnerEmail, emailVerified: new Date() },
    });
    await prisma.membership.create({
      data: { userId: learner.id, projectId: "seq-elevate", role: "LEARNER" },
    });
    const course = await prisma.course.findFirst({
      where: { slug: "workplace-conflict" },
    });
    await prisma.courseEnrollment.create({
      data: {
        userId: learner.id,
        courseId: course!.id,
        stagesCompleted: [
          "CONTEXT",
          "CONCEPT",
          "BEHAVIOUR",
          "SIMULATION",
          "SCENARIO",
          "REFLECTION",
          "ASSESSMENT",
        ],
        scenarioRoot: "private",
        scenarioFollowup: "privateBoundary",
        completedAt: new Date(),
      },
    });
    await prisma.compCard.create({
      data: {
        userId: learner.id,
        projectId: "seq-elevate",
        wentWell: "I stayed calm",
        difficult: "Speaking up",
        privacy: "FACILITATOR",
      },
    });

    // Staff member (FACILITATOR) with a session
    const staff = await prisma.user.create({
      data: { email: staffEmail, emailVerified: new Date() },
    });
    await prisma.membership.create({
      data: { userId: staff.id, projectId: "seq-elevate", role: "FACILITATOR" },
    });
    staffSession = `e2e-staff-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken: staffSession,
        userId: staff.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [staffEmail, learnerEmail] } },
    });
  });

  test("facilitator workspace lists the real learner + their progress", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: staffSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/en/facilitator");
    // Real learner appears in the cohort list (scope to their row — other
    // parallel tests may add learners to the shared DB)
    const row = page.locator("li", { hasText: learnerEmail }).first();
    await expect(row).toBeVisible();
    // Open their record → Comp Card with the consented field visible
    await row.getByRole("button", { name: /open learner/i }).click();
    await expect(page.getByText("I stayed calm")).toBeVisible();
    // The "difficult" field is FACILITATOR-visible (not redacted)
    await expect(page.getByText("Speaking up")).toBeVisible();
  });
});

describe("guest progress migrates to the DB on sign-in", () => {
  const email = "e2e-migrate@example.com";
  let userId: string;
  let sessionToken: string;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    const user = await prisma.user.create({
      data: { email, emailVerified: new Date() },
    });
    userId = user.id;
    sessionToken = `e2e-migrate-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken,
        userId,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
  });

  test("a guest who builds progress then signs in keeps it server-side", async ({
    page,
    context,
  }) => {
    // 1) As a GUEST (no session cookie), walk the course end to end. Progress
    //    accrues in localStorage only — nothing in the DB for this user yet.
    await walkWorkplaceConflict(page);

    // Sanity: the DB has no enrollment for this user before sign-in.
    const course = await prisma.course.findFirst({
      where: { slug: "workplace-conflict" },
    });
    expect(
      await prisma.courseEnrollment.findFirst({
        where: { userId, courseId: course!.id },
      }),
      "no DB enrollment while still a guest"
    ).toBeNull();

    // 2) Sign in: inject the session cookie (same origin keeps localStorage),
    //    then land on the dashboard so the provider hydrates as authenticated.
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: sessionToken,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/en/learner");
    await expect(page.getByText(email)).toBeVisible();

    // 3) The one-time migration runs client-side — let its writes flush.
    await page.waitForTimeout(2500);

    // ---- the guest's progress is now persisted to Postgres ----
    const enrollment = await prisma.courseEnrollment.findFirst({
      where: { userId, courseId: course!.id },
    });
    expect(enrollment, "guest enrollment migrated").toBeTruthy();
    expect(enrollment?.completedAt, "completion migrated").toBeTruthy();
    expect(enrollment?.scenarioRoot, "scenario choice migrated").toBe("private");

    const badge = await prisma.userBadge.findFirst({
      where: { userId },
      include: { badge: true },
    });
    expect(badge?.badge.slug, "guest badge migrated").toBe("voice-without-edges");
  });
});

describe("accessibility preferences persist to the account", () => {
  const email = "e2e-a11y@example.com";
  let userId: string;
  let sessionToken: string;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    const user = await prisma.user.create({
      data: { email, emailVerified: new Date() },
    });
    userId = user.id;
    sessionToken = `e2e-a11y-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken,
        userId,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
  });

  test("reading-help settings save to the User and survive a reload", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: sessionToken,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/en/learner");
    await expect(page.getByText(email)).toBeVisible();

    // Open the reading-help toolbar and change two settings.
    await page.getByRole("button", { name: /open reading help/i }).click();
    await page.getByRole("button", { name: "Extra large" }).click();
    await page.getByText("Easy-read font").click();

    // Let the debounced DB save flush.
    await page.waitForTimeout(1500);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.fontSize, "font size saved").toBe("xl");
    expect(user?.dyslexic, "easy-read font saved").toBe(true);

    // They load back from the DB on a fresh page (not just localStorage).
    await page.reload();
    await page.getByRole("button", { name: /open reading help/i }).click();
    await expect(
      page.getByRole("button", { name: "Extra large" })
    ).toHaveAttribute("aria-pressed", "true");
  });
});
