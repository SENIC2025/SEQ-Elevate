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
