import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PROJECT,
  learnerWithSession,
  narrative,
  removeLearners,
  removeR2Course,
  runId,
  seedR2Course,
  signIn,
  type R2LessonSeed,
} from "./fixtures/r2-course";

/**
 * Release 2, integration — I-E3 (spec 4.1, 4.9, 10.2): finishing a course
 * at the same moment, twice over.
 *
 *   Two learners finish a course that has no badge yet, at once. Each save
 *   that completes it makes the course's badge if there is none, taking
 *   the Course row FOR UPDATE first (ensureCourseBadge), then the learner's
 *   enrolment: no deadlock, one badge made, both learners get it, both
 *   enrolments completed.
 *   One learner finishes in two tabs at once, each tab with an answer of
 *   its own: completed once, the badge once, every lesson once, and both
 *   answers kept (merged per field under the enrolment lock, D62).
 *
 * In both, no server action fails on the way (the pages would retry it,
 * and a learner would never know; the server would log it). The course is
 * in the standard layout (four text lessons, the learner three in), so the
 * same clicks finish it on Release 1. There, the two learners are a guard
 * (Release 1 also made the badge under the Course lock); the two tabs are
 * red: its whole-row save keeps only the last tab's answers.
 *
 * Requires a real database — gated on E2E_DB=1. Everything it creates is
 * unique to this run and removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;
test.describe.configure({ mode: "serial" });

const RUN = runId();
/** Finished by two learners at once. */
const TWO_LEARNERS = `e2e-r2-conc-two-${RUN}`;
/** Finished by one learner in two tabs at once. */
const TWO_TABS = `e2e-r2-conc-tabs-${RUN}`;
const EMAILS = {
  a: `e2e-r2-conc-a-${RUN}@example.com`,
  b: `e2e-r2-conc-b-${RUN}@example.com`,
  tabs: `e2e-r2-conc-tabs-${RUN}@example.com`,
};

const text = (title: string): R2LessonSeed["narrative"] => narrative({ en: { title, text: `${title}: text.` } });
/** The standard layout's text lessons: context, concept, behaviour and reflection. */
const LESSONS: R2LessonSeed[] = [
  { id: "context", narrative: text("E2E Conc context") },
  { id: "concept", narrative: text("E2E Conc concept") },
  { id: "behaviour", narrative: text("E2E Conc behaviour") },
  { id: "reflection", narrative: text("E2E Conc reflection") },
];

async function courseOf(slug: string) {
  return prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug }, select: { id: true, badgeId: true } });
}

/** Three lessons done: the learner opens the course at its last one. */
async function threeIn(userId: string, slug: string) {
  await prisma.courseEnrollment.create({
    data: { userId, courseId: (await courseOf(slug)).id, stagesCompleted: ["CONTEXT", "CONCEPT", "BEHAVIOUR"] },
  });
}

async function rowOf(userId: string, slug: string) {
  return prisma.courseEnrollment.findFirstOrThrow({
    where: { userId, course: { projectId: PROJECT, slug } },
    select: { stagesCompleted: true, completedAt: true, reflection: true, sectionsCompleted: true, responses: true },
  });
}

/** Server actions that failed (status 5xx) on this page: each would be retried, silently. */
function failedActions(page: Page): string[] {
  const failed: string[] = [];
  page.on("response", (res) => {
    const req = res.request();
    if (req.method() === "POST" && req.headers()["next-action"] && res.status() >= 500) {
      failed.push(`${res.status()} ${req.url()}`);
    }
  });
  return failed;
}

const counter = (page: Page) => page.getByText(/^\d+ \/ \d+ · /).filter({ visible: true });
const continueButton = (page: Page) =>
  page.getByRole("main").getByRole("button", { name: /^continue$/i }).filter({ visible: true });
const complete = (page: Page) => page.getByRole("heading", { name: /^course complete/i });

/**
 * The course open at its last lesson, its saved progress loaded (the page
 * is ready to finish it). Release 2 opens it there (spec 5.5); Release 1
 * opens a signed-in learner at lesson 1, so Continue takes it there — the
 * three lessons before are done either way.
 */
async function atLastLesson(page: Page, slug: string) {
  await page.goto(`/en/learner/course/${slug}`);
  await expect(counter(page)).toHaveText(/^\d+ \/ 4 · /, { timeout: 15000 });
  await page.waitForLoadState("networkidle");
  await expect(async () => {
    const at = (await counter(page).textContent())?.trim() ?? "";
    if (!at.startsWith("4 /")) await continueButton(page).click();
    await expect(counter(page)).toHaveText("4 / 4 · Reflection", { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await page.waitForLoadState("networkidle");
}

async function learnerContext(browser: Browser, sessionToken: string): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await signIn(context, sessionToken);
  return context;
}

describe("Release 2 — finishing a course at the same moment (I-E3)", () => {
  const users: Record<keyof typeof EMAILS, { userId: string; sessionToken: string }> = {} as never;

  test.beforeAll(async () => {
    for (const slug of [TWO_LEARNERS, TWO_TABS]) {
      // A course created here (meta set) with no badge yet: the first save that completes it makes one.
      await seedR2Course(prisma, { slug, title: { en: `E2E Finish together ${slug}` }, lessons: LESSONS, outline: null });
      expect((await courseOf(slug)).badgeId).toBeNull();
    }
    for (const [k, email] of Object.entries(EMAILS)) {
      users[k as keyof typeof EMAILS] = await learnerWithSession(prisma, email);
    }
    await threeIn(users.a.userId, TWO_LEARNERS);
    await threeIn(users.b.userId, TWO_LEARNERS);
    await threeIn(users.tabs.userId, TWO_TABS);
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actor: { is: { email: { in: Object.values(EMAILS) } } } } });
    await removeLearners(prisma, Object.values(EMAILS));
    for (const slug of [TWO_LEARNERS, TWO_TABS]) await removeR2Course(prisma, slug);
    await prisma.$disconnect();
  });

  test("two learners finishing a course without a badge at once: no deadlock, one badge made, both get it", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const [ca, cb] = await Promise.all([
      learnerContext(browser, users.a.sessionToken),
      learnerContext(browser, users.b.sessionToken),
    ]);
    try {
      const [pa, pb] = await Promise.all([ca.newPage(), cb.newPage()]);
      const failed = [...[pa, pb].map(failedActions)];
      await Promise.all([atLastLesson(pa, TWO_LEARNERS), atLastLesson(pb, TWO_LEARNERS)]);

      // Both press the last Continue at the same moment.
      await Promise.all([continueButton(pa).click(), continueButton(pb).click()]);
      await Promise.all([expect(complete(pa)).toBeVisible({ timeout: 15000 }), expect(complete(pb)).toBeVisible({ timeout: 15000 })]);

      // Both saved: completed, every lesson, and the badge — made once.
      await expect
        .poll(
          async () => {
            const course = await courseOf(TWO_LEARNERS);
            const badges = await prisma.userBadge.findMany({
              where: { userId: { in: [users.a.userId, users.b.userId] } },
              select: { badgeId: true },
            });
            return {
              badge: course.badgeId !== null,
              awarded: badges.map((b) => b.badgeId === course.badgeId),
              completed: [
                (await rowOf(users.a.userId, TWO_LEARNERS)).completedAt !== null,
                (await rowOf(users.b.userId, TWO_LEARNERS)).completedAt !== null,
              ],
            };
          },
          { timeout: 20000 }
        )
        .toEqual({ badge: true, awarded: [true, true], completed: [true, true] });
      expect(await prisma.badge.count({ where: { projectId: PROJECT, slug: { startsWith: TWO_LEARNERS } } })).toBe(1);
      for (const u of [users.a, users.b]) {
        expect((await rowOf(u.userId, TWO_LEARNERS)).stagesCompleted).toEqual([
          "CONTEXT",
          "CONCEPT",
          "BEHAVIOUR",
          "REFLECTION",
        ]);
      }
      expect(failed.flat(), "no server action failed on the way").toEqual([]);
    } finally {
      await Promise.all([ca.close(), cb.close()]);
    }
  });

  test("one learner finishing in two tabs at once, an answer in each: completed once, one badge, both answers kept", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const context = await learnerContext(browser, users.tabs.sessionToken);
    try {
      const [one, two] = [await context.newPage(), await context.newPage()];
      const failed = [one, two].map(failedActions);
      await atLastLesson(one, TWO_TABS);
      await atLastLesson(two, TWO_TABS);

      // A different reflection answer in each tab (the first and the second question).
      await one.getByRole("main").getByRole("textbox").nth(0).fill("E2E from tab one");
      await two.getByRole("main").getByRole("textbox").nth(1).fill("E2E from tab two");

      // Both finish at the same moment.
      await Promise.all([continueButton(one).click(), continueButton(two).click()]);
      await Promise.all([expect(complete(one)).toBeVisible({ timeout: 15000 }), expect(complete(two)).toBeVisible({ timeout: 15000 })]);

      await expect
        .poll(
          async () => {
            const row = await rowOf(users.tabs.userId, TWO_TABS);
            const reflection = (row.reflection ?? {}) as Record<string, string>;
            return {
              completed: row.completedAt !== null,
              stages: row.stagesCompleted,
              p1: reflection.p1 ?? "",
              p2: reflection.p2 ?? "",
            };
          },
          { timeout: 20000 }
        )
        .toEqual({
          completed: true,
          stages: ["CONTEXT", "CONCEPT", "BEHAVIOUR", "REFLECTION"],
          p1: "E2E from tab one",
          p2: "E2E from tab two",
        });
      const course = await courseOf(TWO_TABS);
      expect(course.badgeId).not.toBeNull();
      expect(await prisma.userBadge.count({ where: { userId: users.tabs.userId } })).toBe(1);
      expect(await prisma.badge.count({ where: { projectId: PROJECT, slug: { startsWith: TWO_TABS } } })).toBe(1);
      expect(failed.flat(), "no server action failed on the way").toEqual([]);
    } finally {
      await context.close();
    }
  });
});
