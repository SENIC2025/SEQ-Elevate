import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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

describe("GDPR self-service (export + erasure)", () => {
  const exportEmail = "e2e-gdpr-export@example.com";
  const deleteEmail = "e2e-gdpr-delete@example.com";
  let exportUserId: string;
  let deleteUserId: string;
  let exportSession: string;
  let deleteSession: string;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [exportEmail, deleteEmail] } },
    });

    // Export subject — give them data so the export has content.
    const ex = await prisma.user.create({
      data: { email: exportEmail, emailVerified: new Date() },
    });
    exportUserId = ex.id;
    await prisma.membership.create({
      data: { userId: ex.id, projectId: "seq-elevate", role: "LEARNER" },
    });
    const course = await prisma.course.findFirst({
      where: { slug: "workplace-conflict" },
    });
    await prisma.courseEnrollment.create({
      data: {
        userId: ex.id,
        courseId: course!.id,
        stagesCompleted: ["CONTEXT", "CONCEPT"],
        scenarioRoot: "private",
      },
    });
    exportSession = `e2e-gdpr-ex-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken: exportSession,
        userId: ex.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });

    // Erasure subject.
    const del = await prisma.user.create({
      data: { email: deleteEmail, emailVerified: new Date() },
    });
    deleteUserId = del.id;
    await prisma.membership.create({
      data: { userId: del.id, projectId: "seq-elevate", role: "LEARNER" },
    });
    deleteSession = `e2e-gdpr-del-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken: deleteSession,
        userId: del.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [exportEmail, deleteEmail] } },
    });
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [exportUserId, deleteUserId] } },
    });
  });

  test("export returns the signed-in user's own data as a JSON download", async ({
    context,
  }) => {
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: exportSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const res = await context.request.get("/api/me/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("attachment");
    const body = await res.json();
    expect(body.account.email).toBe(exportEmail);
    expect(body.courses.length).toBeGreaterThan(0);
    expect(body.courses[0].course).toBe("workplace-conflict");

    // The export was recorded in the audit trail.
    const log = await prisma.auditLog.findFirst({
      where: { entityId: exportUserId, action: "account.exported" },
    });
    expect(log, "export audited").toBeTruthy();
  });

  test("export refuses a guest (401)", async ({ context }) => {
    const res = await context.request.get("/api/me/export");
    expect(res.status()).toBe(401);
  });

  test("account page (incl. delete-confirm form) has no serious a11y violations", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: exportSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/en/account");
    await expect(page.getByText(exportEmail).first()).toBeVisible();
    // Expand the danger zone so the confirmation form is scanned too.
    await page.getByRole("button", { name: /delete my account/i }).click();
    await expect(page.getByLabel(/type your email to confirm/i)).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious, JSON.stringify(serious.map((x) => x.id), null, 2)).toEqual(
      []
    );
  });

  test("deleting the account erases the user and anonymises the audit log", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: deleteSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/en/account");
    await expect(page.getByText(deleteEmail).first()).toBeVisible();

    // Danger zone → type the email → confirm.
    await page.getByRole("button", { name: /delete my account/i }).click();
    await page.getByLabel(/type your email to confirm/i).fill(deleteEmail);
    await page.getByRole("button", { name: /permanently delete/i }).click();

    // The server action deletes before signing out; give it time to flush.
    await page.waitForTimeout(2000);

    const user = await prisma.user.findUnique({ where: { id: deleteUserId } });
    expect(user, "user row erased").toBeNull();

    const log = await prisma.auditLog.findFirst({
      where: { entityId: deleteUserId, action: "account.deleted" },
    });
    expect(log, "deletion audit record kept").toBeTruthy();
    expect(log?.actorId, "audit actor anonymised on erasure").toBeNull();
  });
});

describe("in-video quiz answers persist for signed-in learners", () => {
  const email = "e2e-video@example.com";
  let userId: string;
  let sessionToken: string;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    const u = await prisma.user.create({
      data: { email, emailVerified: new Date() },
    });
    userId = u.id;
    sessionToken = `e2e-video-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken,
        userId,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: userId } });
    await prisma.user.deleteMany({ where: { email } });
  });

  test("answering an in-video question records a video.cue_answered event", async ({
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
    await page.goto("/en/learner/course/workplace-conflict");

    // context → concept
    const concept = page.getByText(/watch: speaking up without blame/i);
    await expect(async () => {
      await page.getByRole("button", { name: /^continue$/i }).first().click();
      await expect(concept).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });

    // Trigger the in-video cue.
    const video = page.getByTestId("lesson-video");
    const dialog = page.getByRole("dialog");
    await expect(async () => {
      await video.evaluate((v: HTMLVideoElement) => {
        v.currentTime = 6;
      });
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10000 });

    // Answer correctly and resume.
    await dialog.getByText("What you felt and what you'd prefer").click();
    await dialog.getByRole("button", { name: /^submit$/i }).click();
    await dialog.getByRole("button", { name: /continue watching/i }).click();

    await page.waitForTimeout(1500);

    const ev = await prisma.auditLog.findFirst({
      where: {
        actorId: userId,
        action: "video.cue_answered",
        entityId: "concept-check",
      },
    });
    expect(ev, "video answer recorded").toBeTruthy();
    expect(
      (ev?.metadata as { correct?: boolean } | null)?.correct,
      "correctness recorded"
    ).toBe(true);
  });
});

describe("time-on-task is recorded for signed-in learners", () => {
  const email = "e2e-time@example.com";
  let userId: string;
  let sessionToken: string;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    const u = await prisma.user.create({
      data: { email, emailVerified: new Date() },
    });
    userId = u.id;
    sessionToken = `e2e-time-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken,
        userId,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: userId } });
    await prisma.user.deleteMany({ where: { email } });
  });

  test("leaving a stage flushes a stage.time event", async ({
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
    await page.goto("/en/learner/course/workplace-conflict");
    await expect(
      page.getByRole("heading", { name: /three weeks into the new job/i })
    ).toBeVisible();

    // Spend a moment on the context stage, then advance (flushes its time).
    await page.waitForTimeout(1600);
    const concept = page.getByText(/watch: speaking up without blame/i);
    await expect(async () => {
      await page.getByRole("button", { name: /^continue$/i }).first().click();
      await expect(concept).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });

    await page.waitForTimeout(1500);

    const ev = await prisma.auditLog.findFirst({
      where: {
        actorId: userId,
        action: "stage.time",
        entityId: "workplace-conflict:context",
      },
    });
    expect(ev, "stage time recorded").toBeTruthy();
    expect(
      (ev?.metadata as { seconds?: number } | null)?.seconds ?? 0,
      "at least a second on task"
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("authored lesson media (CMS) renders in the player", () => {
  let lessonId: string;

  test.beforeAll(async () => {
    await prisma.lesson.deleteMany({
      where: {
        projectId: "seq-elevate",
        courseSlug: "receiving-feedback",
        stageKey: "context",
      },
    });
    const lesson = await prisma.lesson.create({
      data: {
        projectId: "seq-elevate",
        courseSlug: "receiving-feedback",
        stageKey: "context",
        video: {
          provider: "file",
          src: "/demo/sample-lesson.webm",
          title: "Attached lesson video",
          cues: [],
        },
      },
    });
    lessonId = lesson.id;
    await prisma.lessonDocument.create({
      data: {
        lessonId,
        name: "Feedback-worksheet.pdf",
        url: "https://example.com/worksheet.pdf",
        mimeType: "application/pdf",
        sizeBytes: 23456,
      },
    });
  });

  test.afterAll(async () => {
    await prisma.lesson.deleteMany({ where: { id: lessonId } });
  });

  test("a video + document attached to a lesson appear on its stage", async ({
    page,
  }) => {
    // The context stage is first; the overlay merges the DB media onto it.
    await page.goto("/en/learner/course/receiving-feedback");
    await expect(page.getByText("Attached lesson video")).toBeVisible();
    await expect(page.getByTestId("lesson-video")).toBeVisible();
    await expect(page.getByText("Feedback-worksheet.pdf")).toBeVisible();
  });
});
