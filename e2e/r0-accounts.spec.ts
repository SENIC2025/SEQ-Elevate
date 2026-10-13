import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Release 0, accounts stream:
 * - staff who open the site are not turned into learners, and keep their
 *   learner features; a person with no role still becomes a learner (C11);
 * - a facilitator's note is saved for a learner of the project, and refused,
 *   with a message, for someone who no longer is one (C20);
 * - staff who still hold the LEARNER role an older release gave them aren't
 *   learners: not on the roster, not in the Learners figure, and a note
 *   about them is refused;
 * - a course created in the platform gets a badge, and a learner who earns
 *   it still has it after a reload (C9).
 *
 * Requires a real database — gated on E2E_DB=1, like db-backed-progress.
 * Every email and course slug is unique to the run, and everything the run
 * made is removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;
test.describe.configure({ mode: "serial" });

const PROJECT = "seq-elevate";
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = (who: string) => `e2e-r0acc-${who}-${RUN}@example.com`;
const FACILITATOR = email("facilitator");
const EDITOR = email("editor");
const LEARNER = email("learner");
const NEWCOMER = email("newcomer");
const OLD_ADMIN = email("old-admin");
const COLLEAGUE = email("colleague");
const EMAILS = [FACILITATOR, EDITOR, LEARNER, NEWCOMER, OLD_ADMIN, COLLEAGUE];
const LEARNER_NAME = `R0 Learner ${RUN}`;
const OLD_ADMIN_NAME = `R0 Old Admin ${RUN}`;
const COLLEAGUE_NAME = `R0 Colleague ${RUN}`;
// The course an editor creates here; its slug is what slugify makes of it.
const COURSE_TITLE = `E2E Badge Course ${RUN}`;
const COURSE_SLUG = COURSE_TITLE.toLowerCase().replace(/[^a-z0-9]+/g, "-");
// A bundled course's badge (from the seed), held by a staff member.
const BUNDLED_BADGE = { slug: "voice-without-edges", name: "Voice without edges" };

type Role = "ADMIN" | "FACILITATOR" | "CONTENT_EDITOR" | "LEARNER";
const STAFF_ROLES: Role[] = ["ADMIN", "FACILITATOR", "CONTENT_EDITOR"];

/** A user holding `roles` in the project, plus a live session. */
async function signedInUser(address: string, roles: Role[], name?: string) {
  const user = await prisma.user.create({
    data: { email: address, name, emailVerified: new Date() },
  });
  for (const role of roles) {
    await prisma.membership.create({
      data: { userId: user.id, projectId: PROJECT, role },
    });
  }
  const sessionToken = `e2e-r0acc-${RUN}-${Math.random().toString(36).slice(2)}`;
  await prisma.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 86_400_000),
    },
  });
  return { userId: user.id, sessionToken };
}

/**
 * Sign in as the holder of `sessionToken`. Every open page is left first:
 * an in-flight /api/auth/session call could otherwise set the previous
 * user's cookie again when it returns.
 */
async function signInAs(
  context: import("@playwright/test").BrowserContext,
  sessionToken: string
) {
  for (const open of context.pages()) await open.goto("about:blank");
  await context.clearCookies();
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
}

const learnerRoles = (userId: string) =>
  prisma.membership.count({
    where: { userId, projectId: PROJECT, role: "LEARNER" },
  });

/**
 * The project's learners as the database holds them right now (among
 * `userIds`, when given): a LEARNER membership and no staff role in the
 * project. Written out here, not taken from the app, so the spec checks the
 * app against the rule itself.
 */
const learnerCount = (userIds?: string[]) =>
  prisma.membership.count({
    where: {
      ...(userIds ? { userId: { in: userIds } } : {}),
      projectId: PROJECT,
      role: "LEARNER",
      user: {
        memberships: {
          none: { projectId: PROJECT, role: { in: STAFF_ROLES } },
        },
      },
    },
  });

/** The figure under "Learners" on the admin dashboard, as a number. */
async function learnersFigure(page: import("@playwright/test").Page) {
  const value = page
    .getByRole("main")
    .locator("p", { hasText: /^learners$/i })
    .locator("xpath=following-sibling::p[1]");
  return Number(await value.textContent());
}

/** The learner dashboard's Badges panel. */
const badgesPanel = (page: import("@playwright/test").Page) =>
  page
    .getByRole("heading", { name: /^badges$/i })
    .locator("xpath=ancestor::section[1]");

describe("Release 0 — accounts", () => {
  let facilitator: { userId: string; sessionToken: string };
  let editor: { userId: string; sessionToken: string };
  let learner: { userId: string; sessionToken: string };
  let newcomer: { userId: string; sessionToken: string };
  let oldAdmin: { userId: string; sessionToken: string };

  async function cleanUp() {
    const users = await prisma.user.findMany({
      where: { email: { in: EMAILS } },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: { actorId: { in: users.map((u) => u.id) } },
    });
    // Observations, validations, enrollments, badges awarded, memberships
    // and sessions go with their users.
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.lesson.deleteMany({ where: { courseSlug: COURSE_SLUG } });
    await prisma.course.deleteMany({ where: { slug: COURSE_SLUG } });
    await prisma.badge.deleteMany({
      where: { projectId: PROJECT, slug: { startsWith: `${COURSE_SLUG}-complete` } },
    });
  }

  test.beforeAll(async () => {
    await cleanUp();
    facilitator = await signedInUser(FACILITATOR, ["FACILITATOR"]);
    editor = await signedInUser(EDITOR, ["CONTENT_EDITOR"]);
    learner = await signedInUser(LEARNER, ["LEARNER"], LEARNER_NAME);
    newcomer = await signedInUser(NEWCOMER, []);
    // An admin who opened a learner page before Release 0, which gave them
    // the LEARNER role; Release 0 leaves that row in place.
    oldAdmin = await signedInUser(OLD_ADMIN, ["ADMIN", "LEARNER"], OLD_ADMIN_NAME);
  });

  test.afterAll(async () => {
    await cleanUp();
    // No $disconnect(): Prisma releases the pool on worker exit.
  });

  test("staff who open the site stay staff, and keep their badges", async ({
    page,
    context,
  }) => {
    // Each staff member holds a badge, so the dashboard shows when the
    // learner store has loaded, which is after it asked for a membership.
    const badge = await prisma.badge.findUnique({
      where: { projectId_slug: { projectId: PROJECT, slug: BUNDLED_BADGE.slug } },
    });
    expect(badge, "the seeded badge exists").toBeTruthy();
    for (const staff of [editor, facilitator]) {
      await prisma.userBadge.create({
        data: { userId: staff.userId, badgeId: badge!.id },
      });
      await signInAs(context, staff.sessionToken);
      await page.goto("/en/learner");
      await expect(badgesPanel(page).getByText(BUNDLED_BADGE.name)).toBeVisible({
        timeout: 15000,
      });
      expect(await learnerRoles(staff.userId), "not made a learner").toBe(0);
    }

    // Neither shows up on the facilitator's roster; the learner does.
    // The roster only: the header names whoever is signed in, here the
    // facilitator.
    await page.goto("/en/facilitator");
    const roster = page.getByRole("main");
    await expect(roster.getByText(LEARNER_NAME)).toBeVisible({ timeout: 15000 });
    await expect(roster.getByText(FACILITATOR)).toHaveCount(0);
    await expect(roster.getByText(EDITOR)).toHaveCount(0);
  });

  test("someone who signs in with no role becomes a learner", async ({
    page,
    context,
  }) => {
    await signInAs(context, newcomer.sessionToken);
    await page.goto("/en/learner");
    await expect
      .poll(() => learnerRoles(newcomer.userId), { timeout: 15000 })
      .toBe(1);
  });

  test("a facilitator's note is saved for a learner, and refused once they aren't one", async ({
    page,
    context,
  }) => {
    await signInAs(context, facilitator.sessionToken);
    await page.goto("/en/facilitator");
    const openLearner = () =>
      page
        .getByRole("listitem")
        .filter({ hasText: LEARNER_NAME })
        .getByRole("button", { name: /open learner/i })
        .click();
    const note = page.getByPlaceholder(/what did you notice/i);
    const save = page.getByRole("button", { name: /^save$/i });

    await openLearner();
    await note.fill("Listened, then asked a clear question.");
    await save.click();
    await expect(page.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("alert").filter({ hasText: /wasn't saved/i })).toHaveCount(0);
    expect(
      await prisma.observation.count({
        where: { observerId: facilitator.userId, observedId: learner.userId },
      })
    ).toBe(1);

    // An admin removes the learner while the page is open.
    await prisma.membership.deleteMany({
      where: { userId: learner.userId, projectId: PROJECT },
    });
    await note.fill("A second note, after they left.");
    await save.click();
    await expect(
      page.getByRole("alert").filter({ hasText: /wasn't saved/i })
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/^saved$/i)).toHaveCount(0);
    expect(
      await prisma.observation.count({
        where: { observerId: facilitator.userId, observedId: learner.userId },
      }),
      "nothing more was written"
    ).toBe(1);

    // Back as a learner for the next test.
    await prisma.membership.create({
      data: { userId: learner.userId, projectId: PROJECT, role: "LEARNER" },
    });
  });

  test("staff who still hold an old learner role are not learners", async ({
    page,
    context,
  }) => {
    // A colleague still listed as a learner when the facilitator opens the
    // page, and given a staff role while it is open: from then on they are
    // staff holding an old LEARNER row, like the admin from beforeAll.
    const colleague = await signedInUser(COLLEAGUE, ["LEARNER"], COLLEAGUE_NAME);
    await signInAs(context, facilitator.sessionToken);
    await page.goto("/en/facilitator");
    const roster = page.getByRole("main");
    await expect(roster.getByText(COLLEAGUE_NAME)).toBeVisible({ timeout: 15000 });
    // The admin who still holds LEARNER isn't on the roster at all.
    await expect(roster.getByText(OLD_ADMIN_NAME)).toHaveCount(0);

    await page
      .getByRole("listitem")
      .filter({ hasText: COLLEAGUE_NAME })
      .getByRole("button", { name: /open learner/i })
      .click();
    await prisma.membership.create({
      data: { userId: colleague.userId, projectId: PROJECT, role: "FACILITATOR" },
    });
    await page.getByPlaceholder(/what did you notice/i).fill("A note about a colleague.");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /wasn't saved/i })
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/^saved$/i)).toHaveCount(0);
    expect(
      await prisma.observation.count({ where: { observedId: colleague.userId } }),
      "nothing was written about the colleague"
    ).toBe(0);

    // Opened again, the roster leaves both of them out; the learner stays.
    await page.goto("/en/facilitator");
    await expect(roster.getByText(LEARNER_NAME)).toBeVisible({ timeout: 15000 });
    await expect(roster.getByText(COLLEAGUE_NAME)).toHaveCount(0);
    await expect(roster.getByText(OLD_ADMIN_NAME)).toHaveCount(0);

    // Both still hold their LEARNER row, and the rule leaves both out.
    const staff = [oldAdmin.userId, colleague.userId];
    expect(
      await prisma.membership.count({
        where: { userId: { in: staff }, projectId: PROJECT, role: "LEARNER" },
      })
    ).toBe(2);
    expect(await learnerCount(staff)).toBe(0);

    // The admin's Learners figure counts learners only. Other specs may add
    // learners meanwhile, so the figure is read again until it matches the
    // database.
    await signInAs(context, oldAdmin.sessionToken);
    await page.goto("/en/admin");
    await expect(page.getByRole("heading", { name: /admin dashboard/i })).toBeVisible({
      timeout: 15000,
    });
    await expect
      .poll(
        async () => {
          await page.reload();
          const [shown, learners] = [await learnersFigure(page), await learnerCount()];
          return shown - learners;
        },
        { timeout: 20000 }
      )
      .toBe(0);
  });

  test("a badge earned on a course created in the platform is still there after a reload", async ({
    page,
    context,
  }) => {
    // The editor creates the course; it comes with its badge.
    await signInAs(context, editor.sessionToken);
    await page.goto("/en/content");
    await page.getByLabel(/^title$/i).first().fill(COURSE_TITLE);
    await page.getByLabel(/^tagline$/i).first().fill("Say it, kindly");
    await page.getByLabel(/skill area/i).first().fill("Communication");
    await page.getByRole("button", { name: /create draft/i }).first().click();
    await expect(page).toHaveURL(new RegExp(`/en/content/courses/${COURSE_SLUG}`), {
      timeout: 15000,
    });
    const course = await prisma.course.findFirst({
      where: { projectId: PROJECT, slug: COURSE_SLUG },
      include: { badge: true },
    });
    expect(course?.badge, "the course is linked to a badge").toBeTruthy();
    expect(course?.badge?.slug).toBe(`${COURSE_SLUG}-complete`);
    expect(course?.badge?.name).toBe(COURSE_TITLE);

    // Published with a little content (authoring is covered elsewhere).
    for (const stageKey of ["context", "concept", "behaviour", "reflection"]) {
      await prisma.lesson.create({
        data: {
          projectId: PROJECT,
          courseSlug: COURSE_SLUG,
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
    await prisma.course.update({
      where: { id: course!.id },
      data: { status: "published", publishedAt: new Date() },
    });

    // The learner walks it to the end.
    await signInAs(context, learner.sessionToken);
    await page.goto(`/en/learner/course/${COURSE_SLUG}`);
    await expect(page.getByText("Content for context.").first()).toBeVisible({
      timeout: 15000,
    });
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: /^continue$/i }).first().click();
    }
    await expect(
      page.getByRole("heading", { name: /course complete/i })
    ).toBeVisible({ timeout: 15000 });

    // Saved on the server…
    await expect
      .poll(
        () =>
          prisma.userBadge.count({
            where: { userId: learner.userId, badgeId: course!.badgeId! },
          }),
        { timeout: 15000 }
      )
      .toBe(1);

    // …so after a reload it's on the dashboard, by its name.
    await page.goto("/en/learner");
    await page.reload();
    await expect(badgesPanel(page).getByText(COURSE_TITLE)).toBeVisible({
      timeout: 15000,
    });
    await expect(badgesPanel(page).getByText(`${COURSE_SLUG}-complete`)).toHaveCount(0);
  });
});
