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
    // No $disconnect() here: describes share this module-level client and may
    // run later on the same worker. Prisma releases the pool on worker exit.
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

/**
 * Holds every Next.js server-action POST (they carry a `next-action` header)
 * until `release()`. Nothing the learner store asks the server — membership,
 * saved badges and progress, saves — can answer while it's held, so the test
 * can act before the learner's data has loaded: the window a cold server
 * opens by accident, deterministically.
 */
async function holdServerActions(page: import("@playwright/test").Page) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let held = 0;
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.method() === "POST" && (await req.headerValue("next-action"))) {
      held++;
      await released;
    }
    await route.continue();
  });
  return { held: () => held, release };
}

/**
 * Fails the first `times` server-action POSTs called with `args` the way a
 * dropped connection does; every other request, and every later call, goes
 * through. Next sends a server action's arguments as its JSON body: `[]`
 * for ensureLearnerMembership / loadLearnerGlobal, `[slug, locale]` for
 * loadCourseProgress. `args` may also be a test of the request body, for a
 * call whose arguments aren't known in full (a save's payload).
 */
async function failServerActions(
  page: import("@playwright/test").Page,
  args: unknown[] | ((body: string) => boolean),
  times: number
) {
  const isCall =
    typeof args === "function"
      ? args
      : (body: string) => body === JSON.stringify(args);
  let failed = 0;
  await page.route("**/*", async (route) => {
    const req = route.request();
    const matches =
      req.method() === "POST" &&
      !!(await req.headerValue("next-action")) &&
      isCall(req.postData() ?? "");
    if (matches && failed < times) {
      failed++;
      return route.abort("failed");
    }
    await route.continue();
  });
  return { failed: () => failed };
}

/**
 * Runs the first `times` server-action POSTs called with `args` without the
 * learner's session, the way a server whose session lookup failed runs
 * them: Auth.js's database session lookup logs a database error and
 * answers "no session" instead of failing, so the action sees no one
 * signed in. The Session row is taken away while each of those requests
 * runs and put back before the page gets the answer; they run one at a
 * time (Next sends server actions one at a time anyway). `args` may also
 * be a test of the request body, for a call whose arguments aren't known
 * in full (a save's payload). The page's own session reads (next-auth's
 * GET of /api/auth/session) never see the row away — to Auth.js that's a
 * sign-out, and it drops the cookie: it's only taken away once none is on
 * its way, and one that starts meanwhile waits until it's back.
 */
async function sessionLostDuring(
  page: import("@playwright/test").Page,
  sessionToken: string,
  args: unknown[] | ((body: string) => boolean),
  times: number
) {
  const isCall =
    typeof args === "function"
      ? args
      : (body: string) => body === JSON.stringify(args);
  let taken = 0;
  let answered = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let away = false;
  let rowBack: Promise<void> = Promise.resolve();
  let reads = 0;
  let noReads: (() => void) | null = null;
  await page.route("**/*", async (route) => {
    const req = route.request();
    const matches =
      req.method() === "POST" &&
      !!(await req.headerValue("next-action")) &&
      isCall(req.postData() ?? "");
    if (!matches || taken >= times) return route.continue();
    taken++;
    const turn = queue.then(async () => {
      let back!: () => void;
      away = true;
      rowBack = new Promise<void>((resolve) => (back = resolve));
      while (reads > 0) await new Promise<void>((resolve) => (noReads = resolve));
      noReads = null;
      const session = await prisma.session.findUniqueOrThrow({
        where: { sessionToken },
      });
      await prisma.session.delete({ where: { sessionToken } });
      try {
        return await route.fetch();
      } finally {
        await prisma.session.create({ data: session });
        away = false;
        back();
      }
    });
    queue = turn.catch(() => undefined);
    await route.fulfill({ response: await turn });
    answered++;
  });
  // Routed last, so it comes first for the session reads.
  await page.route("**/api/auth/session", async (route) => {
    while (away) await rowBack;
    reads++;
    try {
      await route.fulfill({ response: await route.fetch() });
    } finally {
      if (--reads === 0) noReads?.();
    }
  });
  return { answered: () => answered };
}

/**
 * Answers the page's next `times` session reads (next-auth's GET of
 * /api/auth/session) with no session, the way Auth.js answers one whose
 * database lookup failed: it logs the error, answers null and leaves the
 * session cookie as it is. The learner is still signed in; the next read
 * finds them. Every other request goes on to the handlers routed before.
 */
async function sessionReadFails(
  page: import("@playwright/test").Page,
  times: number
) {
  let failed = 0;
  await page.route("**/api/auth/session", async (route) => {
    if (route.request().method() !== "GET" || failed >= times) {
      return route.fallback();
    }
    failed++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "null",
    });
  });
  return { failed: () => failed };
}

/** What this browser's guest store holds for the learner store, or null. */
function guestStore(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("seq-elevate-demo-state-v1");
    return raw
      ? (JSON.parse(raw) as {
          badges: string[];
          course: {
            courseSlug: string | null;
            stagesCompleted: string[];
            completedAt: string | null;
          };
        })
      : null;
  });
}

/**
 * Makes the page read its session again now, as it does when another tab
 * signs in or out (next-auth tells the other tabs on this channel).
 */
function recheckSession(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    new BroadcastChannel("next-auth").postMessage({
      event: "session",
      data: { trigger: "getSession" },
    })
  );
}

/**
 * A Comp Card field, by its placeholder. Just after the page loads, React
 * may still hold a hidden streamed copy of it (a Suspense boundary not yet
 * revealed), so only the one shown counts.
 */
function compCardField(
  page: import("@playwright/test").Page,
  placeholder: string
) {
  return page.getByPlaceholder(placeholder).filter({ visible: true });
}

/** Clicks the player's Continue `times` times, one lesson each. */
async function continueTimes(
  page: import("@playwright/test").Page,
  times: number
) {
  for (let i = 0; i < times; i++) {
    await page.getByRole("button", { name: /^continue$/i }).click();
  }
}

const ALL_STAGES = [
  "CONTEXT",
  "CONCEPT",
  "BEHAVIOUR",
  "SIMULATION",
  "SCENARIO",
  "REFLECTION",
  "ASSESSMENT",
];

describe("progress made before the learner's data has loaded", () => {
  const firstEmail = "e2e-early-first@example.com";
  const resumeEmail = "e2e-early-resume@example.com";
  const users: Record<string, { id: string; session: string }> = {};

  test.beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [firstEmail, resumeEmail] } },
    });
    for (const email of [firstEmail, resumeEmail]) {
      const user = await prisma.user.create({
        data: { email, emailVerified: new Date() },
      });
      const session = `e2e-early-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await prisma.session.create({
        data: {
          sessionToken: session,
          userId: user.id,
          expires: new Date(Date.now() + 86_400_000),
        },
      });
      users[email] = { id: user.id, session };
    }
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [firstEmail, resumeEmail] } },
    });
  });

  const signIn = (
    context: import("@playwright/test").BrowserContext,
    email: string
  ) =>
    context.addCookies([
      {
        name: "authjs.session-token",
        value: users[email].session,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

  /** Everything the walk should leave in the database, in one snapshot. */
  const savedFor = async (userId: string) => {
    const course = await prisma.course.findFirst({
      where: { slug: "workplace-conflict" },
    });
    const [e, badges, memberships] = await Promise.all([
      prisma.courseEnrollment.findFirst({
        where: { userId, courseId: course!.id },
      }),
      prisma.userBadge.findMany({ where: { userId }, include: { badge: true } }),
      prisma.membership.count({ where: { userId, role: "LEARNER" } }),
    ]);
    return {
      enrollment: e
        ? {
            completed: !!e.completedAt,
            stages: e.stagesCompleted,
            scenarioRoot: e.scenarioRoot,
            reflection: e.reflection,
          }
        : null,
      badges: badges.map((b) => b.badge.slug).sort(),
      memberships,
    };
  };

  test("a first visit walked to completion is saved: enrollment, badge, membership", async ({
    page,
    context,
  }) => {
    const { id: userId } = users[firstEmail];
    await signIn(context, firstEmail);
    const actions = await holdServerActions(page);

    await walkWorkplaceConflict(page);
    // …and looks back at the first lesson, leaving the completion screen
    // (which would otherwise hand out the badge again).
    await page
      .getByRole("navigation", { name: "Course stages" })
      .getByRole("button", { name: "Context", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: /course complete/i })
    ).toBeHidden();

    // The provider had started loading the learner's data — and it's still
    // waiting: all of that happened before it arrived.
    await expect.poll(actions.held).toBeGreaterThan(0);
    actions.release();

    await expect
      .poll(() => savedFor(userId), { timeout: 15_000 })
      .toMatchObject({
        enrollment: {
          completed: true,
          stages: ALL_STAGES,
          scenarioRoot: "private",
        },
        badges: ["voice-without-edges"],
        memberships: 1,
      });
  });

  test("saved progress is merged with the steps taken while it loaded, not swapped in", async ({
    page,
    context,
  }) => {
    const { id: userId } = users[resumeEmail];
    // Earlier visit: two lessons done and a reflection answer, plus another
    // course's badge.
    const course = await prisma.course.findFirst({
      where: { slug: "workplace-conflict" },
    });
    await prisma.courseEnrollment.create({
      data: {
        userId,
        courseId: course!.id,
        stagesCompleted: ["CONTEXT", "CONCEPT"],
        reflection: { p1: "Saved on an earlier visit", p2: "", p3: "" },
      },
    });
    const otherBadge = await prisma.badge.findFirst({
      where: { slug: { not: "voice-without-edges" } },
    });
    await prisma.userBadge.create({
      data: { userId, badgeId: otherBadge!.id },
    });

    await signIn(context, resumeEmail);
    const actions = await holdServerActions(page);

    await walkWorkplaceConflict(page);
    await expect.poll(actions.held).toBeGreaterThan(0);
    actions.release();

    await expect
      .poll(() => savedFor(userId), { timeout: 15_000 })
      .toMatchObject({
        enrollment: {
          completed: true,
          stages: ALL_STAGES,
          scenarioRoot: "private",
          // Untouched on this visit, so the saved answer stays.
          reflection: { p1: "Saved on an earlier visit" },
        },
        badges: [otherBadge!.slug, "voice-without-edges"].sort(),
      });
  });
});

describe("progress kept when the learner's data loads late, fails or overlaps", () => {
  const emails = {
    back: "e2e-overlap-back@example.com",
    hydration: "e2e-retry-hydration@example.com",
    courseLoad: "e2e-retry-course@example.com",
    compCard: "e2e-early-compcard@example.com",
    guestOther: "e2e-migrate-other-course@example.com",
    guestSame: "e2e-migrate-same-course@example.com",
  };
  const all = Object.values(emails);
  const users: Record<string, { id: string; session: string }> = {};

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: all } } });
    for (const email of all) {
      const user = await prisma.user.create({
        data: { email, emailVerified: new Date() },
      });
      const session = `e2e-late-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await prisma.session.create({
        data: {
          sessionToken: session,
          userId: user.id,
          expires: new Date(Date.now() + 86_400_000),
        },
      });
      users[email] = { id: user.id, session };
    }
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: all } } });
  });

  const signIn = (
    context: import("@playwright/test").BrowserContext,
    email: string
  ) =>
    context.addCookies([
      {
        name: "authjs.session-token",
        value: users[email].session,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

  /** One course's saved progress for a learner, or null if not enrolled. */
  const enrollmentFor = async (userId: string, slug: string) => {
    const e = await prisma.courseEnrollment.findFirst({
      where: { userId, course: { slug } },
    });
    return e ? { stages: e.stagesCompleted, reflection: e.reflection } : null;
  };

  test("going back to a course whose progress had loaded, before another course's has, doesn't overwrite it", async ({
    page,
    context,
  }) => {
    const { id: userId } = users[emails.back];
    const course = await prisma.course.findFirst({
      where: { slug: "workplace-conflict" },
    });
    await prisma.courseEnrollment.create({
      data: {
        userId,
        courseId: course!.id,
        stagesCompleted: ["CONTEXT", "CONCEPT"],
        reflection: { p1: "Saved on an earlier visit", p2: "", p3: "" },
      },
    });
    await signIn(context, emails.back);

    // The course's progress loads, and a lesson done on this visit is saved.
    await page.goto("/en/learner/course/workplace-conflict");
    await continueTimes(page, 3);
    await expect
      .poll(() => enrollmentFor(userId, "workplace-conflict"), {
        timeout: 15_000,
      })
      .toMatchObject({ stages: ["CONTEXT", "CONCEPT", "BEHAVIOUR"] });

    // Then the server slows down. The learner opens the other course and
    // comes back before its progress has loaded…
    const actions = await holdServerActions(page);
    const main = page.getByRole("main");
    const toDashboard = () =>
      main.getByRole("link", { name: "Dashboard", exact: true }).click();
    await toDashboard();
    await main
      .locator('a[href="/en/learner/course/receiving-feedback"]')
      .first()
      .click();
    await expect(page).toHaveURL(/\/learner\/course\/receiving-feedback$/);
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(
      /receiving feedback/i
    );
    await expect.poll(actions.held).toBeGreaterThan(0);
    await toDashboard();
    await main
      .locator('a[href="/en/learner/course/workplace-conflict"]')
      .first()
      .click();
    await expect(page).toHaveURL(/\/learner\/course\/workplace-conflict$/);

    // …and walks on to a lesson not done before.
    await continueTimes(page, 3);
    await page.getByText(/the bus was late\. when you say/i).click();
    await continueTimes(page, 1);
    await page.waitForTimeout(1000); // past the save debounce
    actions.release();

    await expect
      .poll(() => enrollmentFor(userId, "workplace-conflict"), {
        timeout: 15_000,
      })
      .toMatchObject({
        stages: ["CONTEXT", "CONCEPT", "BEHAVIOUR", "SIMULATION"],
        reflection: { p1: "Saved on an earlier visit" },
      });
  });

  test("the learner's data is loaded again when the first try fails, and what they did meanwhile is saved", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const { id: userId } = users[emails.hydration];
    await signIn(context, emails.hydration);
    // Membership and the saved badges / Comp Card: the first two calls fail.
    const failing = await failServerActions(page, [], 2);

    await page.goto("/en/learner/course/workplace-conflict");
    await continueTimes(page, 3);

    await expect
      .poll(() => enrollmentFor(userId, "workplace-conflict"), {
        timeout: 30_000,
      })
      .toMatchObject({ stages: ["CONTEXT", "CONCEPT", "BEHAVIOUR"] });
    expect(failing.failed()).toBeGreaterThan(0);
    expect(
      await prisma.membership.count({ where: { userId, role: "LEARNER" } })
    ).toBe(1);
  });

  test("a course's progress is loaded again when the first try fails, and what they did meanwhile is saved", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const { id: userId } = users[emails.courseLoad];
    await signIn(context, emails.courseLoad);
    const failing = await failServerActions(
      page,
      ["workplace-conflict", "en"],
      2
    );

    await page.goto("/en/learner/course/workplace-conflict");
    await continueTimes(page, 3);

    await expect
      .poll(() => enrollmentFor(userId, "workplace-conflict"), {
        timeout: 30_000,
      })
      .toMatchObject({ stages: ["CONTEXT", "CONCEPT", "BEHAVIOUR"] });
    expect(failing.failed()).toBeGreaterThan(0);
  });

  test("Comp Card text typed before the saved card loaded is kept, and saved with it", async ({
    page,
    context,
  }) => {
    const { id: userId } = users[emails.compCard];
    await prisma.compCard.create({
      data: {
        userId,
        projectId: "seq-elevate",
        wentWell: "Saved: I stayed calm",
        difficult: "Saved: speaking up",
        privacy: "FACILITATOR",
      },
    });
    await signIn(context, emails.compCard);
    const actions = await holdServerActions(page);

    await page.goto("/en/learner/comp-card");
    const improve = compCardField(page, "One thing.");
    await improve.fill("Typed before it loaded");
    await expect.poll(actions.held).toBeGreaterThan(0);
    actions.release();

    await expect
      .poll(
        () =>
          prisma.compCard.findFirst({
            where: { userId },
            select: { wentWell: true, difficult: true, improve: true },
          }),
        { timeout: 15_000 }
      )
      .toEqual({
        wentWell: "Saved: I stayed calm",
        difficult: "Saved: speaking up",
        improve: "Typed before it loaded",
      });
    await expect(improve).toHaveValue("Typed before it loaded");
    await expect(compCardField(page, "Even small wins count.")).toHaveValue(
      "Saved: I stayed calm"
    );
  });

  test("a guest's course migrated on sign-in doesn't take over the other course being played", async ({
    page,
    context,
  }) => {
    const { id: userId } = users[emails.guestOther];
    // As a guest: two lessons of workplace conflict, kept in this browser.
    await page.goto("/en/learner/course/workplace-conflict");
    await continueTimes(page, 2);

    // Signed in, straight into the other course. The guest progress moves
    // to the account…
    await signIn(context, emails.guestOther);
    await page.goto("/en/learner/course/receiving-feedback");
    await expect
      .poll(() => enrollmentFor(userId, "workplace-conflict"), {
        timeout: 15_000,
      })
      .toMatchObject({ stages: ["CONTEXT", "CONCEPT"] });

    // …and the lessons played now are this course's.
    await continueTimes(page, 3);
    await expect
      .poll(() => enrollmentFor(userId, "receiving-feedback"), {
        timeout: 15_000,
      })
      .toMatchObject({ stages: ["CONTEXT", "CONCEPT", "BEHAVIOUR"] });
    expect(await enrollmentFor(userId, "workplace-conflict")).toMatchObject({
      stages: ["CONTEXT", "CONCEPT"],
    });
  });

  test("lessons played while a guest's course migrates on sign-in are kept", async ({
    page,
    context,
  }) => {
    const { id: userId } = users[emails.guestSame];
    // As a guest: two lessons, kept in this browser.
    await page.goto("/en/learner/course/workplace-conflict");
    await continueTimes(page, 2);

    // Signed in, back in the same course, and on to the simulation while
    // the account (and the migration) loads.
    await signIn(context, emails.guestSame);
    const actions = await holdServerActions(page);
    await page.goto("/en/learner/course/workplace-conflict");
    await continueTimes(page, 3);
    await page.getByText(/the bus was late\. when you say/i).click();
    await continueTimes(page, 1);
    await expect.poll(actions.held).toBeGreaterThan(0);
    actions.release();

    await expect
      .poll(() => enrollmentFor(userId, "workplace-conflict"), {
        timeout: 15_000,
      })
      .toMatchObject({
        stages: ["CONTEXT", "CONCEPT", "BEHAVIOUR", "SIMULATION"],
      });
  });
});

describe("progress kept when the session is lost, changes hands or the course changes", () => {
  const emails = {
    courseNoSession: "e2e-nosession-course@example.com",
    globalNoSession: "e2e-nosession-global@example.com",
    sessionBack: "e2e-session-back@example.com",
    signOutFirst: "e2e-signout-first@example.com",
    signOutNext: "e2e-signout-next@example.com",
    afterCompleted: "e2e-after-completed@example.com",
    reopen: "e2e-reopen-course@example.com",
    completedFirst: "e2e-signout-completed-first@example.com",
    completedNext: "e2e-signout-completed-next@example.com",
    readFailsLoading: "e2e-read-fails-loading@example.com",
    readFailsSaving: "e2e-read-fails-saving@example.com",
    saveNoSession: "e2e-nosession-save@example.com",
    badgeNoSession: "e2e-nosession-badge@example.com",
    dashboardSignOut: "e2e-signout-dashboard@example.com",
    migrateNoSession: "e2e-nosession-migrate@example.com",
    readFailsStale: "e2e-read-fails-stale@example.com",
    saveFailsReturn: "e2e-save-fails-return@example.com",
  };
  const all = Object.values(emails);
  const users: Record<string, { id: string; session: string }> = {};

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: all } } });
    for (const email of all) {
      const user = await prisma.user.create({
        data: { email, emailVerified: new Date() },
      });
      const session = `e2e-lost-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await prisma.session.create({
        data: {
          sessionToken: session,
          userId: user.id,
          expires: new Date(Date.now() + 86_400_000),
        },
      });
      users[email] = { id: user.id, session };
    }
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: all } } });
  });

  const signIn = (
    context: import("@playwright/test").BrowserContext,
    email: string
  ) =>
    context.addCookies([
      {
        name: "authjs.session-token",
        value: users[email].session,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

  /** One course's saved progress for a learner, or null if not enrolled. */
  const enrollmentFor = async (userId: string, slug: string) => {
    const e = await prisma.courseEnrollment.findFirst({
      where: { userId, course: { slug } },
    });
    return e ? { stages: e.stagesCompleted, reflection: e.reflection } : null;
  };

  /** An earlier visit to workplace conflict: two lessons, one answer. */
  const savedEarlier = async (userId: string) => {
    const course = await prisma.course.findFirst({
      where: { slug: "workplace-conflict" },
    });
    await prisma.courseEnrollment.create({
      data: {
        userId,
        courseId: course!.id,
        stagesCompleted: ["CONTEXT", "CONCEPT"],
        reflection: { p1: "Saved on an earlier visit", p2: "", p3: "" },
      },
    });
  };
  /** …and what it should hold after three lessons on this visit. */
  const savedEarlierAndNow = {
    stages: ["CONTEXT", "CONCEPT", "BEHAVIOUR"],
    reflection: { p1: "Saved on an earlier visit" },
  };

  /** The page's answer to loading `slug`'s saved progress. */
  const courseLoaded = (page: import("@playwright/test").Page, slug: string) =>
    page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.request().postData() === JSON.stringify([slug, "en"])
    );

  const openFromDashboard = async (
    page: import("@playwright/test").Page,
    slug: string,
    title: RegExp
  ) => {
    const main = page.getByRole("main");
    await main.getByRole("link", { name: "Dashboard", exact: true }).click();
    await main.locator(`a[href="/en/learner/course/${slug}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/learner/course/${slug}$`));
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(title);
  };

  test("a course load that finds no session is tried again, not taken for nothing saved", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const { id: userId, session } = users[emails.courseNoSession];
    await savedEarlier(userId);
    await signIn(context, emails.courseNoSession);
    const lost = await sessionLostDuring(
      page,
      session,
      ["workplace-conflict", "en"],
      1
    );

    await page.goto("/en/learner/course/workplace-conflict");
    await expect.poll(lost.answered).toBe(1);
    await continueTimes(page, 3);

    await expect
      .poll(() => enrollmentFor(userId, "workplace-conflict"), {
        timeout: 30_000,
      })
      .toMatchObject(savedEarlierAndNow);
  });

  test("the learner's data is loaded again when no session is found, and the saved Comp Card isn't blanked", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const { id: userId, session } = users[emails.globalNoSession];
    await prisma.compCard.create({
      data: {
        userId,
        projectId: "seq-elevate",
        wentWell: "Saved: I stayed calm",
        difficult: "Saved: speaking up",
        privacy: "FACILITATOR",
      },
    });
    await signIn(context, emails.globalNoSession);
    // Membership, the saved badges and Comp Card, and the reading-help
    // settings are all called without arguments: the first three calls
    // find no session.
    const lost = await sessionLostDuring(page, session, [], 3);

    await page.goto("/en/learner/comp-card");
    await expect.poll(lost.answered, { timeout: 15_000 }).toBe(3);
    const improve = compCardField(page, "One thing.");
    await improve.fill("Typed after a failed load");

    await expect
      .poll(
        () =>
          prisma.compCard.findFirst({
            where: { userId },
            select: { wentWell: true, difficult: true, improve: true },
          }),
        { timeout: 30_000 }
      )
      .toEqual({
        wentWell: "Saved: I stayed calm",
        difficult: "Saved: speaking up",
        improve: "Typed after a failed load",
      });
    await expect(compCardField(page, "Even small wins count.")).toHaveValue(
      "Saved: I stayed calm"
    );
  });

  test("a course opened again while the session was lost isn't saved empty when it's back", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const { id: userId, session } = users[emails.sessionBack];
    await savedEarlier(userId);
    await signIn(context, emails.sessionBack);
    const loaded = courseLoaded(page, "workplace-conflict");
    await page.goto("/en/learner/course/workplace-conflict");
    await loaded;
    const signOut = page.getByRole("button", { name: "Sign out" });
    await expect(signOut).toBeVisible();

    // The session is lost for a while…
    const row = await prisma.session.findUniqueOrThrow({
      where: { sessionToken: session },
    });
    await prisma.session.delete({ where: { sessionToken: session } });
    await recheckSession(page);
    await expect(signOut).toBeHidden();

    // …while the learner opens the other course and comes back…
    await openFromDashboard(page, "receiving-feedback", /receiving feedback/i);
    await openFromDashboard(page, "workplace-conflict", /workplace conflict/i);

    // …then it's back (Auth.js dropped the cookie of the session it
    // couldn't find, so it's set again), and they walk on.
    await prisma.session.create({ data: row });
    await signIn(context, emails.sessionBack);
    await recheckSession(page);
    await expect(signOut).toBeVisible();
    await continueTimes(page, 3);

    await expect
      .poll(() => enrollmentFor(userId, "workplace-conflict"), {
        timeout: 15_000,
      })
      .toMatchObject(savedEarlierAndNow);
  });

  test("signing out in another tab clears this one: nothing of the learner's goes to the guest store or the next account", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const first = users[emails.signOutFirst];
    const next = users[emails.signOutNext];
    await prisma.compCard.create({
      data: {
        userId: first.id,
        projectId: "seq-elevate",
        wentWell: "Private: only mine",
        privacy: "SELF",
      },
    });
    const badge = await prisma.badge.findFirstOrThrow({
      where: { slug: "voice-without-edges" },
    });
    await prisma.userBadge.create({
      data: { userId: first.id, badgeId: badge.id },
    });
    await signIn(context, emails.signOutFirst);

    // This tab shows the learner's Comp Card…
    await page.goto("/en/learner/comp-card");
    const signOut = page.getByRole("button", { name: "Sign out" });
    const wentWell = compCardField(page, "Even small wins count.");
    await expect(wentWell).toHaveValue("Private: only mine");

    // …and they sign out in another one. This tab reads its session again
    // to tell that from a lookup that failed for a moment (about 3 s), and
    // then lets go of the learner's data.
    const other = await context.newPage();
    await other.goto("/en/learner");
    await other.getByRole("button", { name: "Sign out" }).click();
    await expect(signOut).toBeHidden();
    await expect(wentWell).toHaveValue("", { timeout: 15_000 });
    await page.waitForTimeout(500);
    const guestStore = await page.evaluate(
      () => localStorage.getItem("seq-elevate-demo-state-v1") ?? ""
    );
    expect(guestStore).not.toContain("Private: only mine");
    expect(guestStore).not.toContain("voice-without-edges");

    // Someone else signs in on this browser, and this tab picks it up.
    await signIn(context, emails.signOutNext);
    await recheckSession(page);
    await expect(signOut).toBeVisible();
    await expect
      .poll(() =>
        prisma.membership.count({ where: { userId: next.id, role: "LEARNER" } })
      )
      .toBe(1);
    await page.waitForTimeout(2000); // past a migration and the save debounce
    expect(await prisma.compCard.findFirst({ where: { userId: next.id } })).toBeNull();
    expect(await prisma.userBadge.count({ where: { userId: next.id } })).toBe(0);
    await expect(wentWell).toHaveValue("");
  });

  test("signing out in another tab on the completion screen doesn't complete the course again for the guest store or the next account", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const first = users[emails.completedFirst];
    const next = users[emails.completedNext];
    await signIn(context, emails.completedFirst);

    // The learner finishes the course, and this tab stays on the
    // completion screen once it's all saved…
    await walkWorkplaceConflict(page);
    await expect
      .poll(async () => ({
        completed: !!(
          await prisma.courseEnrollment.findFirst({
            where: { userId: first.id, course: { slug: "workplace-conflict" } },
          })
        )?.completedAt,
        badges: await prisma.userBadge.count({ where: { userId: first.id } }),
      }))
      .toEqual({ completed: true, badges: 1 });
    const signOut = page.getByRole("button", { name: "Sign out" });

    // …while they sign out in another one.
    const other = await context.newPage();
    await other.goto("/en/learner");
    await other.getByRole("button", { name: "Sign out" }).click();
    await expect(signOut).toBeHidden();

    // Nothing of theirs is written to the guest store, completion and
    // badge included.
    await expect.poll(() => guestStore(page), { timeout: 15_000 }).not.toBeNull();
    await page.waitForTimeout(1000);
    const stored = await guestStore(page);
    expect(stored?.badges).toEqual([]);
    expect(stored?.course.completedAt).toBeNull();
    expect(stored?.course.stagesCompleted).toEqual([]);

    // Someone else signs in on this browser, and this tab picks it up:
    // the course isn't theirs, completed or not, nor is the badge.
    await signIn(context, emails.completedNext);
    await recheckSession(page);
    await expect(signOut).toBeVisible();
    await expect
      .poll(() =>
        prisma.membership.count({ where: { userId: next.id, role: "LEARNER" } })
      )
      .toBe(1);
    await page.waitForTimeout(2000); // past a migration and the save debounce
    expect(await prisma.userBadge.count({ where: { userId: next.id } })).toBe(0);
    expect(await enrollmentFor(next.id, "workplace-conflict")).toBeNull();
  });

  test("progress made while the learner's data loads survives a session read that fails for a moment", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const { id: userId } = users[emails.readFailsLoading];
    await signIn(context, emails.readFailsLoading);
    const actions = await holdServerActions(page);

    // A cold server: the learner walks three lessons before their data
    // has loaded.
    await page.goto("/en/learner/course/workplace-conflict");
    const signOut = page.getByRole("button", { name: "Sign out" });
    await expect(signOut).toBeVisible();
    await continueTimes(page, 3);
    await expect.poll(actions.held).toBeGreaterThan(0);

    // Another tab opens, and this tab's read of its session meets the same
    // cold database: "no session" for a moment…
    await sessionReadFails(page, 1);
    await recheckSession(page);
    await expect(signOut).toBeHidden();
    // …and the next read finds the learner again.
    await page.waitForTimeout(300);
    await recheckSession(page);
    await expect(signOut).toBeVisible();
    actions.release();

    await expect
      .poll(() => enrollmentFor(userId, "workplace-conflict"), {
        timeout: 30_000,
      })
      .toMatchObject({ stages: ["CONTEXT", "CONCEPT", "BEHAVIOUR"] });
  });

  test("a session read that fails for a moment doesn't lose the change still waiting to be saved, and the tab takes the session back up", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const { id: userId } = users[emails.readFailsSaving];
    await signIn(context, emails.readFailsSaving);
    const loaded = courseLoaded(page, "workplace-conflict");
    await page.goto("/en/learner/course/workplace-conflict");
    await loaded;
    const signOut = page.getByRole("button", { name: "Sign out" });
    await expect(signOut).toBeVisible();
    await page.waitForTimeout(300); // the loaded progress is merged in

    // A lesson done, and within the save debounce another tab opens and
    // this tab's session read fails.
    await sessionReadFails(page, 1);
    await continueTimes(page, 1);
    await recheckSession(page);
    await expect(signOut).toBeHidden();

    await expect
      .poll(() => enrollmentFor(userId, "workplace-conflict"), {
        timeout: 15_000,
      })
      .toMatchObject({ stages: ["CONTEXT"] });
    // Nothing else reads the session in this tab: it reads it again itself.
    await expect(signOut).toBeVisible({ timeout: 15_000 });
  });

  test("a save that finds no session is sent again, not taken as saved", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const { id: userId, session } = users[emails.saveNoSession];
    await signIn(context, emails.saveNoSession);
    const lost = await sessionLostDuring(
      page,
      session,
      (body) => body.startsWith('["workplace-conflict",{"stagesCompleted"'),
      1
    );
    const loaded = courseLoaded(page, "workplace-conflict");
    await page.goto("/en/learner/course/workplace-conflict");
    await loaded;
    await page.waitForTimeout(300); // the loaded progress is merged in

    // The only change of this visit, and its save finds no session.
    await continueTimes(page, 1);
    await expect.poll(lost.answered, { timeout: 15_000 }).toBe(1);

    await expect
      .poll(() => enrollmentFor(userId, "workplace-conflict"), {
        timeout: 20_000,
      })
      .toMatchObject({ stages: ["CONTEXT"] });
  });

  test("a badge award that finds no session is sent again", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const { id: userId, session } = users[emails.badgeNoSession];
    await signIn(context, emails.badgeNoSession);
    const lost = await sessionLostDuring(
      page,
      session,
      (body) => body.startsWith('["voice-without-edges"'),
      1
    );
    // The completed course's save awards the badge too (in its own
    // transaction), so the badge in the database alone doesn't show the
    // award was sent again: the award requests are counted.
    const awards: Promise<number>[] = [];
    page.on("request", (req) => {
      if (
        req.method() === "POST" &&
        (req.postData() ?? "").startsWith('["voice-without-edges"')
      ) {
        awards.push(req.response().then((res) => res?.status() ?? 0));
      }
    });

    await walkWorkplaceConflict(page);
    await expect.poll(lost.answered, { timeout: 15_000 }).toBe(1);
    await expect
      .poll(() => awards.length, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2);
    expect(await awards[awards.length - 1]).toBe(200);

    await expect
      .poll(
        async () =>
          (
            await prisma.userBadge.findMany({
              where: { userId },
              include: { badge: true },
            })
          ).map((b) => b.badge.slug),
        { timeout: 20_000 }
      )
      .toEqual(["voice-without-edges"]);
  });

  test("signing out in another tab takes the learner's progress off this tab's dashboard", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const { id: userId } = users[emails.dashboardSignOut];
    await savedEarlier(userId);
    await signIn(context, emails.dashboardSignOut);

    // The dashboard shows the learner's course in progress (the server
    // rendered it from their saved progress)…
    await page.goto("/en/learner");
    const main = page.getByRole("main");
    const hero = main.getByRole("link", { name: /^resume/i });
    const heroForAGuest = main.getByRole("link", { name: /^open course/i });
    await expect(hero).toBeVisible();
    const signOut = page.getByRole("button", { name: "Sign out" });

    // …and they sign out in another tab: this one shows it no more.
    const other = await context.newPage();
    await other.goto("/en/learner");
    await other.getByRole("button", { name: "Sign out" }).click();
    await expect(signOut).toBeHidden();

    await expect(heroForAGuest).toBeVisible({ timeout: 15_000 });
    await expect(hero).toBeHidden();
  });

  test("a course opened after finishing another starts at its first lesson, and isn't completed", async ({
    page,
    context,
  }) => {
    const { id: userId } = users[emails.afterCompleted];
    await signIn(context, emails.afterCompleted);
    await walkWorkplaceConflict(page);

    await openFromDashboard(page, "receiving-feedback", /receiving feedback/i);
    await expect(
      page.getByRole("button", { name: /^continue$/i })
    ).toBeVisible();
    await page.waitForTimeout(1500); // past the save debounce
    await expect(
      page.getByRole("heading", { name: /course complete/i })
    ).toBeHidden();
    expect(await enrollmentFor(userId, "receiving-feedback")).toBeNull();
    await expect
      .poll(async () =>
        (
          await prisma.userBadge.findMany({
            where: { userId },
            include: { badge: true },
          })
        ).map((b) => b.badge.slug)
      )
      .toEqual(["voice-without-edges"]);
  });

  test("a guest's progress whose move to the account finds no session on sign-in isn't lost", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const { id: userId, session } = users[emails.migrateNoSession];
    // As a guest: two lessons of workplace conflict and a Comp Card, kept
    // in this browser.
    await page.goto("/en/learner/course/workplace-conflict");
    await continueTimes(page, 2);
    await expect
      .poll(async () => (await guestStore(page))?.course.stagesCompleted)
      .toEqual(["context", "concept"]);
    await page.goto("/en/learner/comp-card");
    await compCardField(page, "Even small wins count.").fill(
      "Guest: I listened"
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("seq-elevate-demo-state-v1") ?? "null")
              ?.compCard?.wentWell
        )
      )
      .toBe("Guest: I listened");

    // Signed in: a fresh page, so the guest store holds the only copy. The
    // first save of the Comp Card and the first of the course — the move's
    // — find no session.
    await signIn(context, emails.migrateNoSession);
    const first = new Set<string>();
    const lost = await sessionLostDuring(
      page,
      session,
      (body) => {
        const call = body.startsWith('[{"wentWell"')
          ? "card"
          : body.startsWith('["workplace-conflict",{"stagesCompleted"')
            ? "course"
            : null;
        if (!call || first.has(call)) return false;
        first.add(call);
        return true;
      },
      2
    );
    await page.goto("/en/learner");
    await expect.poll(lost.answered, { timeout: 30_000 }).toBe(2);

    await expect
      .poll(
        () =>
          prisma.compCard.findFirst({
            where: { userId },
            select: { wentWell: true },
          }),
        { timeout: 30_000 }
      )
      .toEqual({ wentWell: "Guest: I listened" });
    await expect
      .poll(() => enrollmentFor(userId, "workplace-conflict"), {
        timeout: 30_000,
      })
      .toMatchObject({ stages: ["CONTEXT", "CONCEPT"] });
  });

  test("the learner found again after a session read that failed doesn't save this tab's older copy over what they saved since", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const { id: userId } = users[emails.readFailsStale];
    await prisma.compCard.create({
      data: {
        userId,
        projectId: "seq-elevate",
        wentWell: "Draft from Monday",
        privacy: "FACILITATOR",
      },
    });
    await signIn(context, emails.readFailsStale);
    // Once loaded, the Comp Card is saved back as it came; once that's in…
    const savedBack = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        (r.request().postData() ?? "").startsWith(
          '[{"wentWell":"Draft from Monday"'
        )
    );
    await page.goto("/en/learner/comp-card");
    await expect(compCardField(page, "Even small wins count.")).toHaveValue(
      "Draft from Monday"
    );
    await savedBack;
    const signOut = page.getByRole("button", { name: "Sign out" });
    await expect(signOut).toBeVisible();

    // …the learner finishes it on their phone, and doesn't touch this tab.
    await prisma.compCard.update({
      where: { userId_projectId: { userId, projectId: "seq-elevate" } },
      data: { wentWell: "Final, from the phone" },
    });

    // Another tab opens, and this tab's session read fails for a moment;
    // the next read finds the learner again.
    await sessionReadFails(page, 1);
    await recheckSession(page);
    await expect(signOut).toBeHidden();
    await expect(signOut).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2000); // past the save debounce

    expect(
      await prisma.compCard.findFirst({
        where: { userId },
        select: { wentWell: true },
      })
    ).toEqual({ wentWell: "Final, from the phone" });
  });

  test("a save still failing when the learner leaves the course and comes back isn't replaced by the save of the course loaded again", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const { id: userId } = users[emails.saveFailsReturn];
    await savedEarlier(userId);
    await signIn(context, emails.saveFailsReturn);
    // The first three tries of the save holding the new lesson (behaviour)
    // drop — it's tried again after 1 s and 3 s, and gets through after
    // 7 s, unless a newer save of the course has taken its place. (The
    // player opens at the first lesson, so the Continues below also
    // re-complete saved lessons; those saves carry nothing new.)
    const saves = await failServerActions(
      page,
      (body) =>
        body.startsWith('["workplace-conflict",{"stagesCompleted"') &&
        body.includes('"behaviour"'),
      3
    );
    const loaded = courseLoaded(page, "workplace-conflict");
    await page.goto("/en/learner/course/workplace-conflict");
    await loaded;
    await page.waitForTimeout(300); // the loaded progress is merged in

    // A new lesson done (the third); its save fails…
    await continueTimes(page, 3);
    await expect.poll(saves.failed, { timeout: 15_000 }).toBeGreaterThan(0);
    // …while the learner opens the other course and comes back: the
    // course starts over empty and loads again.
    await openFromDashboard(page, "receiving-feedback", /receiving feedback/i);
    await openFromDashboard(page, "workplace-conflict", /workplace conflict/i);

    await expect
      .poll(() => enrollmentFor(userId, "workplace-conflict"), {
        timeout: 30_000,
      })
      .toMatchObject({ stages: ["CONTEXT", "CONCEPT", "BEHAVIOUR"] });
    await expect.poll(saves.failed, { timeout: 15_000 }).toBe(3);
    await page.waitForTimeout(2000); // past a later save
    expect(await enrollmentFor(userId, "workplace-conflict")).toMatchObject({
      stages: ["CONTEXT", "CONCEPT", "BEHAVIOUR"],
    });
  });

  test("opening a course again without doing anything in it doesn't enroll the learner", async ({
    page,
    context,
  }) => {
    const { id: userId } = users[emails.reopen];
    await signIn(context, emails.reopen);
    const loaded = courseLoaded(page, "receiving-feedback");
    await page.goto("/en/learner/course/receiving-feedback");
    await loaded;

    await openFromDashboard(page, "receiving-feedback", /receiving feedback/i);
    await page.waitForTimeout(1500); // past the save debounce
    expect(await enrollmentFor(userId, "receiving-feedback")).toBeNull();
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

    // Publishing lives on the course's own page (D33), and unpublishing
    // always asks first.
    await page.goto(`/en/content/courses/${SLUG}`);
    const publishing = page.getByRole("region", { name: /^publishing$/i });
    await expect(publishing).toBeVisible({ timeout: 15000 });

    await publishing.getByRole("button", { name: /^unpublish$/i }).click();
    await publishing
      .getByRole("button", { name: /^yes, unpublish$/i })
      .click();
    await expect(publishing.getByText(/^draft$/i)).toBeVisible({
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
    await page.goto(`/en/content/courses/${SLUG}`);
    const publishing = page.getByRole("region", { name: /^publishing$/i });
    await publishing.getByRole("button", { name: /^publish$/i }).click();
    await expect(publishing.getByText(/^published$/i)).toBeVisible({
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
    // No publishing controls are rendered for a non-editor on /content…
    const page = await context.newPage();
    await page.goto("/en/content");
    await expect(
      page.getByRole("button", { name: /unpublish/i })
    ).toHaveCount(0);

    // …nor on the course's own page, which says who it is for instead.
    await page.goto(`/en/content/courses/${SLUG}`);
    await expect(
      page.getByRole("heading", { name: /editors only/i })
    ).toBeVisible({ timeout: 15000 });
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

    // It opens on its own course page, as a draft.
    await expect(page).toHaveURL(new RegExp(`/en/content/courses/${SLUG}`), {
      timeout: 15000,
    });
    await expect(
      page
        .getByRole("region", { name: /^publishing$/i })
        .getByText(/^draft$/i)
    ).toBeVisible({ timeout: 15000 });

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
    // Author the first stage directly (the narrative editor is covered by
    // e2e/course-page.spec.ts) — this test is about a CMS-created course
    // actually playing.
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

describe("CMS-created course with authored interactive stages plays + grades", () => {
  const learnerEmail = "e2e-struct-learner@example.com";
  const SLUG = "e2e-structured-course";
  let learnerSession: string;
  let learnerId: string;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: learnerEmail } });
    await prisma.lesson.deleteMany({ where: { courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { slug: SLUG } });

    // A published CMS course (meta present) with authored narrative + all
    // three interactive stages, written straight to the DB — this test is
    // about the READ/PLAY path; authoring UIs are covered separately.
    await prisma.course.create({
      data: {
        projectId: "seq-elevate",
        strapiId: `cms-${SLUG}`,
        slug: SLUG,
        cluster: "communication",
        durationMinutes: 15,
        status: "published",
        publishedAt: new Date(),
        meta: {
          en: {
            title: "E2E Structured Course",
            tagline: "authored end to end",
            clusterLabel: "Communication",
          },
        },
      },
    });
    // Minimal narrative so the early stages have content.
    for (const stageKey of ["context", "concept", "behaviour", "reflection"]) {
      await prisma.lesson.create({
        data: {
          projectId: "seq-elevate",
          courseSlug: SLUG,
          stageKey,
          narrative: {
            en: {
              title: `Stage ${stageKey}`,
              blocks: [{ kind: "paragraph", text: `Content for ${stageKey}.` }],
            },
          },
        },
      });
    }
    // Simulation — option "b" is the best response.
    await prisma.lesson.create({
      data: {
        projectId: "seq-elevate",
        courseSlug: SLUG,
        stageKey: "simulation",
        structure: {
          kind: "simulation",
          title: { en: "Practise the response" },
          prompt: { en: "A teammate takes credit for your work. You…" },
          instruction: { en: "Choose the strongest response." },
          options: [
            { id: "a", isBest: false, text: { en: "Say nothing" }, feedback: { en: "It festers." } },
            { id: "b", isBest: true, text: { en: "Name it calmly, in private" }, feedback: { en: "Clear and low-heat." } },
            { id: "c", isBest: false, text: { en: "Call them out in the meeting" }, feedback: { en: "Escalates." } },
          ],
        },
      },
    });
    // Scenario — one root with one follow-up.
    await prisma.lesson.create({
      data: {
        projectId: "seq-elevate",
        courseSlug: SLUG,
        stageKey: "scenario",
        structure: {
          kind: "scenario",
          title: { en: "Play it out" },
          setup: { en: "The credit-taking happened again." },
          question: { en: "What is your first move?" },
          followupQuestion: { en: "They get defensive. Now what?" },
          choices: [
            {
              id: "private",
              quality: "best",
              text: { en: "Ask for a quick private word" },
              outcome: { en: "They listen." },
              followups: [
                { id: "listen", quality: "best", text: { en: "Hear them out, restate your ask" }, outcome: { en: "Resolved." } },
              ],
            },
            {
              id: "public",
              quality: "poor",
              text: { en: "Confront them publicly" },
              outcome: { en: "It blows up." },
            },
          ],
        },
      },
    });
    // Assessment — single question, correct = "b".
    await prisma.lesson.create({
      data: {
        projectId: "seq-elevate",
        courseSlug: SLUG,
        stageKey: "assessment",
        structure: {
          kind: "assessment",
          title: { en: "Quick check" },
          intro: { en: "One question to finish." },
          questions: [
            {
              id: "q1",
              correctOptionId: "b",
              question: { en: "Which is an I-statement?" },
              options: [
                { id: "a", text: { en: "You always ignore me" } },
                { id: "b", text: { en: "I feel sidelined when that happens" } },
              ],
            },
          ],
        },
      },
    });

    const learner = await prisma.user.create({
      data: { email: learnerEmail, emailVerified: new Date() },
    });
    learnerId = learner.id;
    await prisma.membership.create({
      data: { userId: learner.id, projectId: "seq-elevate", role: "LEARNER" },
    });
    learnerSession = `e2e-struct-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken: learnerSession,
        userId: learner.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
  });

  test.afterAll(async () => {
    await prisma.courseEnrollment.deleteMany({ where: { userId: learnerId } });
    await prisma.lesson.deleteMany({ where: { courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { slug: SLUG } });
    await prisma.user.deleteMany({ where: { email: learnerEmail } });
  });

  test("all seven stages render, the interactive ones grade, and it completes", async ({
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

    await page.goto(`/en/learner/course/${SLUG}`);
    const cont = () => page.getByRole("button", { name: /^continue$/i }).first();

    // context → concept → behaviour → simulation
    await expect(
      page.getByText("Content for context.").first()
    ).toBeVisible({ timeout: 15000 });
    await cont().click();
    await cont().click();
    await cont().click();

    // Simulation: the authored prompt renders; pick the best option.
    await expect(
      page.getByText(/takes credit for your work/i).first()
    ).toBeVisible();
    await page.getByText(/name it calmly, in private/i).click();
    await expect(page.getByText(/clear and low-heat/i).first()).toBeVisible();
    await cont().click();

    // Scenario: root + follow-up, both authored.
    await expect(page.getByText(/first move/i).first()).toBeVisible();
    await page.getByText(/ask for a quick private word/i).click();
    await page.getByText(/hear them out, restate your ask/i).click();
    await cont().click();

    // reflection → assessment
    await cont().click();

    // Assessment: answer correctly, check, finish.
    await expect(page.getByText(/i feel sidelined/i).first()).toBeVisible();
    await page.getByText(/i feel sidelined/i).click();
    await page.getByRole("button", { name: /check answers/i }).click();
    await cont().click();

    await expect(
      page.getByRole("heading", { name: /course complete/i })
    ).toBeVisible({ timeout: 15000 });

    // Progress persisted for the CMS course.
    await page.waitForTimeout(2000);
    const course = await prisma.course.findFirst({ where: { slug: SLUG } });
    const enrollment = await prisma.courseEnrollment.findFirst({
      where: { userId: learnerId, courseId: course!.id },
    });
    expect(enrollment?.completedAt, "CMS course completed").toBeTruthy();
    expect(
      enrollment?.stagesCompleted.length,
      "all interactive stages walked"
    ).toBeGreaterThan(5);
  });
});

describe("authoring an interactive stage in the CMS", () => {
  const editorEmail = "e2e-struct-editor@example.com";
  const SLUG = "e2e-authored-structure";
  let editorId: string;
  let editorSession: string;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: editorEmail } });
    await prisma.lesson.deleteMany({ where: { courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { slug: SLUG } });

    // A CMS course to author against (meta present, draft).
    await prisma.course.create({
      data: {
        projectId: "seq-elevate",
        strapiId: `cms-${SLUG}`,
        slug: SLUG,
        cluster: "communication",
        durationMinutes: 15,
        status: "draft",
        meta: {
          en: {
            title: "E2E Authored Structure",
            tagline: "author me",
            clusterLabel: "Communication",
          },
        },
      },
    });

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
    editorSession = `e2e-struct-ed-${Date.now()}`;
    await prisma.session.create({
      data: {
        sessionToken: editorSession,
        userId: editor.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });
  });

  test.afterAll(async () => {
    await prisma.lesson.deleteMany({ where: { courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { slug: SLUG } });
    await prisma.auditLog.deleteMany({ where: { actorId: editorId } });
    await prisma.user.deleteMany({ where: { email: editorEmail } });
  });

  test("an editor authors a simulation; validation gates; it persists", async ({
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

    // The course page opens the not-yet-added simulation straight away.
    await page.goto(`/en/content/courses/${SLUG}?lesson=simulation`);
    const panel = page.getByRole("region", {
      name: /^interactive stage — simulation$/i,
    });
    await expect(panel).toBeVisible({ timeout: 15000 });

    // Try to save the empty default → validation must block it.
    await panel.getByRole("button", { name: /save stage/i }).click();
    await expect(panel.getByText(/not ready to save/i)).toBeVisible({
      timeout: 15000,
    });
    // Nothing written yet.
    expect(
      await prisma.lesson.count({
        where: { courseSlug: SLUG, stageKey: "simulation" },
      })
    ).toBe(0);

    // Fill the required fields. The first option is starred best by default.
    await panel.getByLabel(/prompt/i).first().fill("A teammate interrupts you.");
    const optionText = panel.getByLabel(/option text/i);
    await optionText.nth(0).fill("Name it calmly");
    await optionText.nth(1).fill("Say nothing");

    await panel.getByRole("button", { name: /save stage/i }).click();
    await expect(panel.getByText(/^saved$/i)).toBeVisible({
      timeout: 15000,
    });

    // Persisted with the correct shape.
    const lesson = await prisma.lesson.findFirst({
      where: { courseSlug: SLUG, stageKey: "simulation" },
    });
    const structure = lesson?.structure as {
      kind?: string;
      prompt?: { en?: string };
      options?: { isBest?: boolean; text?: { en?: string } }[];
    } | null;
    expect(structure?.kind).toBe("simulation");
    expect(structure?.prompt?.en).toBe("A teammate interrupts you.");
    const best = structure?.options?.filter((o) => o.isBest) ?? [];
    expect(best, "exactly one best option").toHaveLength(1);
    expect(best[0].text?.en).toBe("Name it calmly");

    const log = await prisma.auditLog.findFirst({
      where: {
        actorId: editorId,
        action: "structure.saved",
        entityId: `${SLUG}:simulation`,
      },
    });
    expect(log, "save audited").toBeTruthy();
  });

  test("a stage saved elsewhere since it opened isn't overwritten", async ({
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

    // The simulation saved by the test above.
    await page.goto(`/en/content/courses/${SLUG}?lesson=simulation`);
    const panel = page.getByRole("region", {
      name: /^interactive stage — simulation$/i,
    });
    const optionText = panel.getByLabel(/option text/i);
    await expect(optionText.nth(0)).toHaveValue("Name it calmly", {
      timeout: 15000,
    });

    // Meanwhile a partner adds the German prompt (same row, all languages).
    const where = {
      projectId_courseSlug_stageKey: {
        projectId: "seq-elevate",
        courseSlug: SLUG,
        stageKey: "simulation",
      },
    };
    type Sim = {
      prompt: Record<string, string>;
      options: { text: Record<string, string> }[];
    };
    const before = (await prisma.lesson.findUnique({ where }))
      ?.structure as Sim;
    await prisma.lesson.update({
      where,
      data: {
        structure: {
          ...before,
          prompt: { ...before.prompt, de: "Jemand unterbricht dich." },
        },
      },
    });

    // Saving from this (older) page is refused, and nothing is lost.
    await optionText.nth(0).fill("Name it calmly, now");
    await panel.getByRole("button", { name: /save stage/i }).click();
    await expect(panel.getByRole("alert")).toContainText(
      /someone else saved this stage/i,
      { timeout: 15000 }
    );
    const stored = async () =>
      (await prisma.lesson.findUnique({ where }))?.structure as Sim;
    expect((await stored()).prompt.de, "the German prompt survives").toBe(
      "Jemand unterbricht dich."
    );
    expect((await stored()).options[0].text.en).toBe("Name it calmly");
    await expect(optionText.nth(0)).toHaveValue("Name it calmly, now");

    // Reload the saved version, then save on top of it: both land.
    page.once("dialog", (dialog) => void dialog.accept());
    await panel
      .getByRole("button", { name: /^reload the saved version$/i })
      .click();
    await expect(optionText.nth(0)).toHaveValue("Name it calmly", {
      timeout: 15000,
    });
    await optionText.nth(0).fill("Name it calmly, now");
    await panel.getByRole("button", { name: /save stage/i }).click();
    await expect(panel.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });
    const after = await stored();
    expect(after.prompt.de).toBe("Jemand unterbricht dich.");
    expect(after.options[0].text.en).toBe("Name it calmly, now");
  });

  test("an editor authors an assessment; the ticked answer is the correct id", async ({
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

    await page.goto(`/en/content/courses/${SLUG}?lesson=assessment`);
    const panel = page.getByRole("region", {
      name: /^interactive stage — assessment$/i,
    });
    await expect(panel).toBeVisible({ timeout: 15000 });

    await panel.getByLabel(/^intro$/i).fill("One question to finish.");
    await panel.getByLabel(/^question$/i).first().fill("Which is an I-statement?");
    const answers = panel.getByLabel(/^answer \d$/i);
    await answers.nth(0).fill("You always ignore me");
    await answers.nth(1).fill("I feel sidelined");
    // Tick the SECOND answer as correct.
    await panel.getByLabel(/answer 2 is correct/i).check();

    await panel.getByRole("button", { name: /save stage/i }).click();
    await expect(panel.getByText(/^saved$/i)).toBeVisible({
      timeout: 15000,
    });

    const lesson = await prisma.lesson.findFirst({
      where: { courseSlug: SLUG, stageKey: "assessment" },
    });
    const s = lesson?.structure as {
      questions?: {
        correctOptionId?: string;
        options?: { id: string; text?: { en?: string } }[];
      }[];
    } | null;
    const q = s?.questions?.[0];
    // The correct id must point at the "I feel sidelined" answer.
    const correct = q?.options?.find((o) => o.id === q.correctOptionId);
    expect(correct?.text?.en).toBe("I feel sidelined");
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
