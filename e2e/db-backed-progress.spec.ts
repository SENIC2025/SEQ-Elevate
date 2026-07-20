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
    // Two PUBLISHED documents, inserted out of sequence but with explicit
    // order, to prove author-defined ordering is honoured…
    await prisma.lessonDocument.create({
      data: {
        lessonId,
        name: "Second-worksheet.pdf",
        url: "https://example.com/second.pdf",
        mimeType: "application/pdf",
        sizeBytes: 23456,
        order: 1,
        published: true,
      },
    });
    await prisma.lessonDocument.create({
      data: {
        lessonId,
        name: "First-photo.png",
        url: "https://example.com/first.png",
        mimeType: "image/png",
        sizeBytes: 9876,
        order: 0,
        published: true,
      },
    });
    // …and one DRAFT (unpublished) the learner must NOT see.
    await prisma.lessonDocument.create({
      data: {
        lessonId,
        name: "Hidden-draft.pdf",
        url: "https://example.com/hidden.pdf",
        mimeType: "application/pdf",
        sizeBytes: 111,
        order: 2,
        published: false,
      },
    });
  });

  test.afterAll(async () => {
    await prisma.lesson.deleteMany({ where: { id: lessonId } });
  });

  test("published docs render ordered (1.1, 1.2); drafts hidden; viewer steps", async ({
    page,
  }) => {
    // The context stage is first; the overlay merges the DB media onto it.
    await page.goto("/en/learner/course/receiving-feedback");
    await expect(page.getByText("Attached lesson video").first()).toBeVisible();
    await expect(page.getByTestId("lesson-video").first()).toBeVisible();

    // Only the two PUBLISHED documents show, in author order (1.1, 1.2).
    const resources = page.getByRole("region", { name: /resources/i }).first();
    const items = resources.locator("ol > li");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("1.1");
    await expect(items.nth(0)).toContainText("First-photo.png");
    await expect(items.nth(1)).toContainText("1.2");
    await expect(items.nth(1)).toContainText("Second-worksheet.pdf");
    // The draft is not visible to the learner.
    await expect(page.getByText("Hidden-draft.pdf")).toHaveCount(0);

    // Step-through viewer advances 1.1 → 1.2 like slides.
    await resources.getByRole("button", { name: /step through/i }).click();
    const viewer = page.getByRole("dialog", { name: /document viewer/i });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByText("First-photo.png")).toBeVisible();
    await expect(viewer.getByText("1 of 2")).toBeVisible();
    await viewer.getByRole("button", { name: /next/i }).click();
    await expect(viewer.getByText("Second-worksheet.pdf")).toBeVisible();
    await expect(viewer.getByText("2 of 2")).toBeVisible();
    await viewer.getByRole("button", { name: /close/i }).click();
    await expect(
      page.getByRole("dialog", { name: /document viewer/i })
    ).toHaveCount(0);
  });
});

describe("authored lesson narrative (CMS) overrides bundled copy", () => {
  let lessonId: string;

  test.beforeAll(async () => {
    await prisma.lesson.deleteMany({
      where: {
        projectId: "seq-elevate",
        courseSlug: "receiving-feedback",
        stageKey: "concept",
      },
    });
    const lesson = await prisma.lesson.create({
      data: {
        projectId: "seq-elevate",
        courseSlug: "receiving-feedback",
        stageKey: "concept",
        narrative: {
          en: {
            title: "Edited concept title",
            subtitle: "EDITED IN CMS",
            blocks: [
              {
                kind: "paragraph",
                text: "This concept text was edited in the CMS.",
              },
            ],
          },
        },
      },
    });
    lessonId = lesson.id;
  });

  test.afterAll(async () => {
    await prisma.lesson.deleteMany({ where: { id: lessonId } });
  });

  test("the EN override replaces the bundled concept narrative", async ({
    page,
  }) => {
    await page.goto("/en/learner/course/receiving-feedback");
    // context → concept (retry against the hydration race)
    const heading = page.getByRole("heading", { name: "Edited concept title" });
    await expect(async () => {
      await page.getByRole("button", { name: /^continue$/i }).first().click();
      await expect(heading).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await expect(
      page.getByText("This concept text was edited in the CMS.")
    ).toBeVisible();
  });
});

describe("demo access — one-click profile sign-in", () => {
  const email = "demo321@seq-elevate.eu";

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
  });
  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
  });

  test("wrong code is rejected; correct code signs in with the role", async ({
    page,
  }) => {
    await page.goto("/en/demo");

    // Wrong code → error, no sign-in.
    await page.getByPlaceholder(/code you were given/i).fill("nope");
    await page
      .getByRole("button", { name: /enter as demo teacher/i })
      .click();
    await expect(page.getByText(/access code isn.t right/i)).toBeVisible();

    // Correct code → provisioned + signed in as a facilitator.
    await page.getByPlaceholder(/code you were given/i).fill("elevate-demo");
    await page
      .getByRole("button", { name: /enter as demo teacher/i })
      .click();
    await page.waitForURL(/\/en\/facilitator/, { timeout: 10000 });

    const user = await prisma.user.findUnique({
      where: { email },
      include: { memberships: true, sessions: true },
    });
    expect(user, "demo user provisioned").toBeTruthy();
    expect(
      user?.memberships.some((m) => m.role === "FACILITATOR"),
      "facilitator role granted"
    ).toBe(true);
    expect(user?.sessions.length ?? 0, "session created").toBeGreaterThan(0);
  });
});

describe("statistics showcase (staff)", () => {
  const email = "e2e-analytics-staff@example.com";
  let userId: string;
  let sessionToken: string;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    const u = await prisma.user.create({
      data: { email, emailVerified: new Date() },
    });
    userId = u.id;
    await prisma.membership.create({
      data: { userId, projectId: "seq-elevate", role: "FACILITATOR" },
    });
    sessionToken = `e2e-analytics-${Date.now()}`;
    await prisma.session.create({
      data: { sessionToken, userId, expires: new Date(Date.now() + 86_400_000) },
    });
  });
  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
  });

  test("staff opens the statistics dashboard; no serious a11y violations", async ({
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
    await page.goto("/en/analytics");
    await expect(
      page.getByRole("heading", { name: /learner statistics/i }).first()
    ).toBeVisible();
    await expect(
      page.getByText(/course progress funnel/i).first()
    ).toBeVisible();
    await expect(page.getByText(/where they get stuck/i).first()).toBeVisible();
    await expect(page.getByText(/when they open/i).first()).toBeVisible();

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
});

describe("admin manages organisations, cohorts and people", () => {
  const adminEmail = "e2e-admin@example.com";
  const learnerEmail = "e2e-admin-learner@example.com";
  // The admin adds this person through the UI — it must not pre-exist.
  const addedEmail = "e2e-added-person@example.com";
  const allEmails = [adminEmail, learnerEmail, addedEmail];
  let adminId: string;
  let adminSession: string;
  let learnerSession: string;
  const orgName = `E2E Partner ${Date.now()}`;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: allEmails } } });

    const admin = await prisma.user.create({
      data: { email: adminEmail, emailVerified: new Date() },
    });
    adminId = admin.id;
    await prisma.membership.create({
      data: { userId: admin.id, projectId: "seq-elevate", role: "ADMIN" },
    });
    adminSession = `e2e-admin-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken: adminSession,
        userId: admin.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });

    // A plain learner — used to prove the RBAC gate actually blocks.
    const learner = await prisma.user.create({
      data: { email: learnerEmail, emailVerified: new Date() },
    });
    await prisma.membership.create({
      data: { userId: learner.id, projectId: "seq-elevate", role: "LEARNER" },
    });
    learnerSession = `e2e-admin-learner-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken: learnerSession,
        userId: learner.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    // Sweep every "E2E Partner …" org, not just this run's — a failed run
    // leaves one behind and the next run then sees ambiguous UI.
    // Cohorts go first: the org refuses to delete while it still has them.
    const orgs = await prisma.organisation.findMany({
      where: { name: { startsWith: "E2E Partner " } },
      select: { id: true },
    });
    const orgIds = orgs.map((o) => o.id);
    if (orgIds.length) {
      await prisma.cohort.deleteMany({
        where: { organisationId: { in: orgIds } },
      });
      await prisma.organisation.deleteMany({ where: { id: { in: orgIds } } });
    }
    await prisma.user.deleteMany({ where: { email: { in: allEmails } } });
  });

  test("creates an organisation + cohort, adds a person, assigns them", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: adminSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    // --- Organisations & cohorts ---
    await page.goto("/en/admin/cohorts");
    await expect(
      page.getByRole("heading", { name: /organisations & cohorts/i }).first()
    ).toBeVisible();

    await page.getByLabel(/^name$/i).first().fill(orgName);
    await page.getByRole("button", { name: /add organisation/i }).first().click();

    await expect(page.getByText(orgName).first()).toBeVisible({
      timeout: 10000,
    });

    const org = await prisma.organisation.findFirst({ where: { name: orgName } });
    expect(org, "organisation created in the DB").toBeTruthy();

    // Add a cohort inside it — scope to this organisation's own region so
    // other organisations' identical controls don't match.
    const orgRegion = page.getByRole("region", { name: orgName }).first();
    await orgRegion.getByLabel(/new cohort/i).first().fill("E2E Autumn Cohort");
    await orgRegion.getByRole("button", { name: /add cohort/i }).first().click();
    await expect(orgRegion.getByText("E2E Autumn Cohort").first()).toBeVisible({
      timeout: 10000,
    });

    const cohort = await prisma.cohort.findFirst({
      where: { organisationId: org!.id, name: "E2E Autumn Cohort" },
    });
    expect(cohort, "cohort created in the DB").toBeTruthy();

    // --- People ---
    await page.goto("/en/admin/people");
    await expect(
      page.getByRole("heading", { name: /^people$/i }).first()
    ).toBeVisible();

    await page.getByLabel(/^email$/i).first().fill(addedEmail);
    await page.getByLabel(/^role$/i).first().selectOption("FACILITATOR");
    await page.getByRole("button", { name: /^add$/i }).first().click();

    const row = page.locator("tr", { hasText: addedEmail }).first();
    await expect(row).toBeVisible({ timeout: 10000 });

    const added = await prisma.user.findUnique({
      where: { email: addedEmail },
      include: { memberships: true },
    });
    expect(added, "person provisioned").toBeTruthy();
    expect(
      added?.memberships.some((m) => m.role === "FACILITATOR"),
      "role granted"
    ).toBe(true);
    // Passwordless: no credential is stored for the new person.
    expect(added?.emailVerified, "not verified until they sign in").toBeNull();

    // Assign them to the cohort we just created.
    await row
      .getByLabel(new RegExp(`cohort for ${addedEmail}`, "i"))
      .first()
      .selectOption(cohort!.id);
    await page.waitForTimeout(1500);

    const assigned = await prisma.membership.findFirst({
      where: { userId: added!.id, projectId: "seq-elevate" },
    });
    expect(assigned?.cohortId, "cohort assigned").toBe(cohort!.id);
    expect(assigned?.organisationId, "org carried from the cohort").toBe(org!.id);

    // Grant a second role via the chips — the cohort must survive.
    await row.getByRole("button", { name: "Editor" }).first().click();
    await page.waitForTimeout(1500);
    const roles = await prisma.membership.findMany({
      where: { userId: added!.id, projectId: "seq-elevate" },
    });
    expect(roles.map((r) => r.role).sort(), "both roles held").toEqual([
      "CONTENT_EDITOR",
      "FACILITATOR",
    ]);
    expect(
      roles.every((r) => r.cohortId === cohort!.id),
      "cohort carried onto the new role row"
    ).toBe(true);

    // Every change left an audit trail.
    const actions = (
      await prisma.auditLog.findMany({ where: { actorId: adminId } })
    ).map((a) => a.action);
    expect(actions).toContain("org.created");
    expect(actions).toContain("cohort.created");
    expect(actions).toContain("member.added");
    expect(actions).toContain("member.cohort_changed");
  });

  test("management screens have no serious a11y violations", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: adminSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    for (const [path, heading] of [
      ["/en/admin/cohorts", /organisations & cohorts/i],
      ["/en/admin/people", /^people$/i],
    ] as const) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: heading }).first()
      ).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical"
      );
      expect(
        serious,
        `${path}: ${JSON.stringify(serious.map((x) => x.id), null, 2)}`
      ).toEqual([]);
    }
  });

  test("a non-admin cannot reach the management screens", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: learnerSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    for (const path of ["/en/admin/people", "/en/admin/cohorts"]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: /admins only/i }).first()
      ).toBeVisible();
      // No management controls are rendered at all.
      await expect(page.getByRole("button", { name: /^add$/i })).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /add organisation/i })
      ).toHaveCount(0);
    }

    // …and the entry points are hidden on the admin overview.
    await page.goto("/en/admin");
    await expect(page.getByRole("link", { name: /people & roles/i })).toHaveCount(
      0
    );
  });
});

describe("course lifecycle — publish / unpublish from the CMS", () => {
  const editorEmail = "e2e-course-editor@example.com";
  const learnerEmail = "e2e-course-learner@example.com";
  const allEmails = [editorEmail, learnerEmail];
  // receiving-feedback is the second bundled course — unpublishing it leaves
  // workplace-conflict live, so the dashboard is never empty mid-test.
  const SLUG = "receiving-feedback";
  let editorId: string;
  let editorSession: string;
  let learnerSession: string;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: allEmails } } });

    const editor = await prisma.user.create({
      data: { email: editorEmail, emailVerified: new Date() },
    });
    editorId = editor.id;
    await prisma.membership.create({
      data: {
        userId: editor.id,
        projectId: "seq-elevate",
        role: "CONTENT_EDITOR",
      },
    });
    editorSession = `e2e-course-editor-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken: editorSession,
        userId: editor.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });

    const learner = await prisma.user.create({
      data: { email: learnerEmail, emailVerified: new Date() },
    });
    await prisma.membership.create({
      data: { userId: learner.id, projectId: "seq-elevate", role: "LEARNER" },
    });
    learnerSession = `e2e-course-learner-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken: learnerSession,
        userId: learner.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
  });

  test.afterAll(async () => {
    // Always put the course back on the shelf, even if the test failed.
    await prisma.course.updateMany({
      where: { projectId: "seq-elevate", slug: SLUG },
      data: { status: "published" },
    });
    await prisma.auditLog.deleteMany({ where: { actorId: editorId } });
    await prisma.user.deleteMany({ where: { email: { in: allEmails } } });
  });

  async function setStatus(status: string) {
    await prisma.course.updateMany({
      where: { projectId: "seq-elevate", slug: SLUG },
      data: { status },
    });
  }

  test("an editor unpublishes a course and learners stop seeing it", async ({
    page,
    context,
  }) => {
    await setStatus("published");
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: editorSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.goto("/en/content");
    const catalogue = page
      .locator("li", { hasText: /receiving feedback without flinching/i })
      .first();
    await expect(catalogue).toBeVisible({ timeout: 15000 });

    await catalogue.getByRole("button", { name: /unpublish/i }).first().click();
    await expect(catalogue.getByText(/^draft$/i).first()).toBeVisible({
      timeout: 15000,
    });

    const row = await prisma.course.findFirst({
      where: { projectId: "seq-elevate", slug: SLUG },
    });
    expect(row?.status, "status persisted to the DB").toBe("draft");

    const log = await prisma.auditLog.findFirst({
      where: { actorId: editorId, action: "course.draft", entityId: SLUG },
    });
    expect(log, "unpublish audited").toBeTruthy();
  });

  test("a draft course is hidden from the learner dashboard and 404s", async ({
    page,
    context,
  }) => {
    await setStatus("draft");
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: learnerSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.goto("/en/learner");
    await expect(page.getByText(learnerEmail).first()).toBeVisible();
    // The published course is still there; the draft one is gone entirely.
    await expect(
      page.getByText(/handling a small workplace conflict/i).first()
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /receiving feedback without flinching/i })
    ).toHaveCount(0);

    // Deep-linking straight to it is a 404, not a back door.
    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(page.getByText(/couldn.t find|not found/i).first()).toBeVisible(
      { timeout: 15000 }
    );
  });

  test("an editor can still preview the draft, clearly marked", async ({
    page,
    context,
  }) => {
    await setStatus("draft");
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: editorSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(page.getByText(/draft preview/i).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("republishing puts it back on the learner dashboard", async ({
    page,
    context,
  }) => {
    await setStatus("draft");
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: editorSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/en/content");
    const catalogue = page
      .locator("li", { hasText: /receiving feedback without flinching/i })
      .first();
    await catalogue.getByRole("button", { name: /^publish$/i }).first().click();
    await expect(catalogue.getByText(/^published$/i).first()).toBeVisible({
      timeout: 15000,
    });

    const row = await prisma.course.findFirst({
      where: { projectId: "seq-elevate", slug: SLUG },
    });
    expect(row?.status).toBe("published");
    expect(row?.publishedAt, "publication stamped").toBeTruthy();

    // The learner sees it again.
    await context.clearCookies();
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: learnerSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/en/learner");
    await expect(
      page.getByText(/receiving feedback without flinching/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("a learner cannot change course status (RBAC)", async ({ context }) => {
    await setStatus("published");
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: learnerSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    // No catalogue panel is rendered for a non-editor on /content.
    const page = await context.newPage();
    await page.goto("/en/content");
    await expect(
      page.getByRole("button", { name: /unpublish/i })
    ).toHaveCount(0);
    await page.close();

    // And the course stayed published — nothing slipped through.
    const row = await prisma.course.findFirst({
      where: { projectId: "seq-elevate", slug: SLUG },
    });
    expect(row?.status).toBe("published");
  });
});

describe("creating a course in the CMS (no code)", () => {
  const editorEmail = "e2e-create-editor@example.com";
  const learnerEmail = "e2e-create-learner@example.com";
  const allEmails = [editorEmail, learnerEmail];
  const TITLE = "E2E Asking for what you need";
  const SLUG = "e2e-asking-for-what-you-need";
  let editorId: string;
  let editorSession: string;
  let learnerSession: string;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: allEmails } } });
    await prisma.lesson.deleteMany({ where: { courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { slug: SLUG } });

    const editor = await prisma.user.create({
      data: { email: editorEmail, emailVerified: new Date() },
    });
    editorId = editor.id;
    await prisma.membership.create({
      data: {
        userId: editor.id,
        projectId: "seq-elevate",
        role: "CONTENT_EDITOR",
      },
    });
    editorSession = `e2e-create-editor-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken: editorSession,
        userId: editor.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });

    const learner = await prisma.user.create({
      data: { email: learnerEmail, emailVerified: new Date() },
    });
    await prisma.membership.create({
      data: { userId: learner.id, projectId: "seq-elevate", role: "LEARNER" },
    });
    learnerSession = `e2e-create-learner-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken: learnerSession,
        userId: learner.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
  });

  test.afterAll(async () => {
    await prisma.lesson.deleteMany({ where: { courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { slug: SLUG } });
    await prisma.auditLog.deleteMany({ where: { actorId: editorId } });
    await prisma.user.deleteMany({ where: { email: { in: allEmails } } });
  });

  async function asEditor(context: import("@playwright/test").BrowserContext) {
    await context.clearCookies();
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: editorSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }

  test("an editor creates a course; it starts as an invisible draft", async ({
    page,
    context,
  }) => {
    await asEditor(context);
    await page.goto("/en/content");

    await page.getByLabel(/^title$/i).first().fill(TITLE);
    await page.getByLabel(/^tagline$/i).first().fill("Say the thing, kindly");
    await page.getByLabel(/skill area/i).first().fill("Communication");
    await page.getByRole("button", { name: /create draft/i }).first().click();

    // It appears in the catalogue as a draft.
    const row = page.locator("li", { hasText: TITLE }).first();
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.getByText(/^draft$/i).first()).toBeVisible();

    const course = await prisma.course.findFirst({ where: { slug: SLUG } });
    expect(course, "course row created").toBeTruthy();
    expect(course?.status, "starts as a draft").toBe("draft");
    expect(
      (course?.meta as Record<string, { title?: string }> | null)?.en?.title,
      "per-locale title stored"
    ).toBe(TITLE);

    const log = await prisma.auditLog.findFirst({
      where: { actorId: editorId, action: "course.created", entityId: SLUG },
    });
    expect(log, "creation audited").toBeTruthy();

    // A learner cannot see it yet.
    await context.clearCookies();
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: learnerSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/en/learner");
    await expect(page.getByText(TITLE)).toHaveCount(0);
  });

  test("the same title twice is refused rather than shadowing", async ({
    page,
    context,
  }) => {
    await asEditor(context);
    await page.goto("/en/content");
    await page.getByLabel(/^title$/i).first().fill(TITLE);
    await page.getByRole("button", { name: /create draft/i }).first().click();
    await expect(page.getByText(/already exists/i).first()).toBeVisible({
      timeout: 15000,
    });
    expect(
      await prisma.course.count({ where: { slug: SLUG } }),
      "still exactly one course with that slug"
    ).toBe(1);
  });

  test("authored narrative renders, and publishing shows it to learners", async ({
    page,
    context,
  }) => {
    // Author the first stage directly (the narrative editor is covered by its
    // own test) — this test is about a CMS-created course actually playing.
    await prisma.lesson.create({
      data: {
        projectId: "seq-elevate",
        courseSlug: SLUG,
        stageKey: "context",
        narrative: {
          en: {
            title: "Why asking is hard",
            subtitle: "Stage one",
            blocks: [
              { kind: "paragraph", text: "Authored entirely in the CMS." },
            ],
          },
        },
      },
    });
    await prisma.course.updateMany({
      where: { slug: SLUG },
      data: { status: "published", publishedAt: new Date() },
    });

    await context.clearCookies();
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: learnerSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    // On the dashboard…
    await page.goto("/en/learner");
    await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 15000 });

    // …and it plays, with the authored copy.
    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(
      page.getByRole("heading", { name: /why asking is hard/i })
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText("Authored entirely in the CMS.").first()
    ).toBeVisible();
    // No draft banner — it is genuinely published.
    await expect(page.getByText(/draft preview/i)).toHaveCount(0);
  });
});

describe("Comp Card template — editable wording (CMS)", () => {
  const editorEmail = "e2e-cc-editor@example.com";
  let editorId: string;
  let editorSession: string;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: editorEmail } });
    // Start clean: no Comp Card override for the project.
    await prisma.$executeRawUnsafe(
      `UPDATE "Project" SET "compCardTemplate" = NULL WHERE id = 'seq-elevate'`
    );

    const editor = await prisma.user.create({
      data: { email: editorEmail, emailVerified: new Date() },
    });
    editorId = editor.id;
    await prisma.membership.create({
      data: {
        userId: editor.id,
        projectId: "seq-elevate",
        role: "CONTENT_EDITOR",
      },
    });
    editorSession = `e2e-cc-editor-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken: editorSession,
        userId: editor.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
  });

  test.afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `UPDATE "Project" SET "compCardTemplate" = NULL WHERE id = 'seq-elevate'`
    );
    await prisma.auditLog.deleteMany({ where: { actorId: editorId } });
    await prisma.user.deleteMany({ where: { email: editorEmail } });
  });

  test("an editor rewords a field and learners see the new wording", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: editorSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.goto("/en/content");
    // The Comp Card editor is a labelled region; edit its first "Question".
    const panel = page.getByRole("region", { name: /comp card wording/i });
    await expect(panel).toBeVisible({ timeout: 15000 });
    const firstQuestion = panel.getByLabel(/^question$/i).first();
    await firstQuestion.fill("E2E — your biggest win this week");
    await page.getByRole("button", { name: /save wording/i }).first().click();
    await expect(page.getByText(/^saved$/i).first()).toBeVisible({
      timeout: 15000,
    });

    // Persisted to the Project row.
    const project = await prisma.project.findUnique({
      where: { id: "seq-elevate" },
      select: { compCardTemplate: true },
    });
    const override = project?.compCardTemplate as Record<
      string,
      { fields?: Record<string, { label?: string }> }
    > | null;
    const enFields = override?.en?.fields ?? {};
    expect(
      Object.values(enFields).some(
        (f) => f.label === "E2E — your biggest win this week"
      ),
      "reworded label saved"
    ).toBe(true);

    const log = await prisma.auditLog.findFirst({
      where: { actorId: editorId, action: "compcard.template_saved" },
    });
    expect(log, "save audited").toBeTruthy();

    // A learner opening their Comp Card sees the new wording.
    await page.goto("/en/learner/comp-card");
    await expect(
      page.getByText("E2E — your biggest win this week").first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("reverting restores the bundled wording", async ({ page, context }) => {
    // Seed an override directly, then revert through the UI.
    await prisma.project.update({
      where: { id: "seq-elevate" },
      data: {
        compCardTemplate: {
          en: { fields: { wentWell: { label: "TEMP override label" } } },
        },
      },
    });
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: editorSession,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/en/learner/comp-card");
    await expect(page.getByText("TEMP override label").first()).toBeVisible({
      timeout: 15000,
    });

    await page.goto("/en/content");
    await page
      .getByRole("button", { name: /revert to default/i })
      .first()
      .click();
    await page.waitForTimeout(1500);

    const project = await prisma.project.findUnique({
      where: { id: "seq-elevate" },
      select: { compCardTemplate: true },
    });
    const override = project?.compCardTemplate as Record<string, unknown> | null;
    expect(override?.en, "en override cleared").toBeUndefined();

    // The learner is back to bundled copy.
    await page.goto("/en/learner/comp-card");
    await expect(page.getByText("TEMP override label")).toHaveCount(0);
  });

  test("a learner cannot reach the template editor (RBAC)", async ({
    page,
  }) => {
    // No session = guest. The content page is staff-only; the panel returns
    // null for a non-editor even if the page renders.
    await page.goto("/en/content");
    await expect(
      page.getByRole("button", { name: /save wording/i })
    ).toHaveCount(0);
  });
});

describe("statistics dashboard — live data from real events", () => {
  const staffEmail = "e2e-live-staff@example.com";
  const learnerEmails = Array.from(
    { length: 5 },
    (_, i) => `e2e-live-learner-${i}@example.com`
  );
  const allEmails = [staffEmail, ...learnerEmails];
  let staffSession: string;
  const learnerIds: string[] = [];

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: allEmails } } });
    const course = await prisma.course.findFirst({
      where: { slug: "workplace-conflict" },
    });
    const STAGE_KEYS = [
      "CONTEXT",
      "CONCEPT",
      "BEHAVIOUR",
      "SIMULATION",
      "SCENARIO",
      "REFLECTION",
      "ASSESSMENT",
    ] as const;

    for (let i = 0; i < learnerEmails.length; i++) {
      const u = await prisma.user.create({
        data: {
          email: learnerEmails[i],
          name: `Live Learner ${i}`,
          emailVerified: new Date(),
        },
      });
      learnerIds.push(u.id);
      await prisma.membership.create({
        data: { userId: u.id, projectId: "seq-elevate", role: "LEARNER" },
      });
      const completed = i === 4;
      await prisma.courseEnrollment.create({
        data: {
          userId: u.id,
          courseId: course!.id,
          stagesCompleted: completed
            ? [...STAGE_KEYS]
            : STAGE_KEYS.slice(0, i + 1),
          assessment: i >= 3 ? { q1: "a", q2: "b", q3: "c" } : {},
          completedAt: completed ? new Date() : null,
        },
      });
      // Captured events: time on context + a course open.
      await prisma.auditLog.create({
        data: {
          projectId: "seq-elevate",
          actorId: u.id,
          action: "stage.time",
          entity: "Stage",
          entityId: "workplace-conflict:context",
          metadata: { courseSlug: "workplace-conflict", stage: "context", seconds: 120 + i * 30 },
        },
      });
      await prisma.auditLog.create({
        data: {
          projectId: "seq-elevate",
          actorId: u.id,
          action: "course.opened",
          entity: "Course",
          entityId: "workplace-conflict",
          metadata: { courseSlug: "workplace-conflict" },
        },
      });
    }

    const staff = await prisma.user.create({
      data: { email: staffEmail, emailVerified: new Date() },
    });
    await prisma.membership.create({
      data: { userId: staff.id, projectId: "seq-elevate", role: "FACILITATOR" },
    });
    staffSession = `e2e-live-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken: staffSession,
        userId: staff.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: learnerIds } } });
    await prisma.user.deleteMany({ where: { email: { in: allEmails } } });
  });

  test("the dashboard computes live stats from the real cohort", async ({
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
    // Force the live view (?live=1) to verify the real computation.
    await page.goto("/en/analytics?live=1");
    await expect(
      page.getByRole("heading", { name: /learner statistics/i }).first()
    ).toBeVisible();
    // The "live data" indicator and our real learners are shown.
    await expect(page.getByText(/live data/i).first()).toBeVisible();
    await expect(page.getByText("Live Learner 0").first()).toBeVisible();
    await expect(page.getByText("Live Learner 4").first()).toBeVisible();
    // Funnel renders for the real cohort.
    await expect(
      page.getByText(/course progress funnel/i).first()
    ).toBeVisible();
  });
});
