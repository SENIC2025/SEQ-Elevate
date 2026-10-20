import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PROJECT,
  learnerWithSession,
  narrative,
  outlineOf,
  ownLessonId,
  type R2CourseSeed,
  removeLearners,
  removeR2Course,
  runId,
  seedR2Course,
  signIn,
  structures,
} from "./fixtures/r2-course";

/**
 * Release 2, Stream C (spec 10.2, C-E1 to C-E3): the dashboards and reports
 * read a course as the player plays it — by its lesson plan, in its order,
 * its own lessons ("s-…") included, under its step names (D58, D64).
 *
 * Release 1 counted and named only the seven standard lessons: a course's
 * own lessons were nowhere on the dashboard, the facilitator's view or the
 * statistics, and the dashboard's hero was always the first published
 * course. How each test is red on Release 1's build (main b357cc7, against
 * this database once migrated):
 *
 *   C-E1  every part: the hero, and so "Your journey", is the first
 *         published course; the facilitator's view has the learner at 25%
 *         (the standard lessons the course doesn't list counted, its own
 *         left out), "Currently on: Skill concept", no "Other lessons" time;
 *         the statistics have them on "Concept"
 *   C-E2  a guard there. The spec's reason — Release 1 refuses to publish
 *         a flexible course — is the editor's guard (Stream B; this branch
 *         still applies it), so the course is seeded published, as the
 *         editor will leave it; Release 1 then plays its standard lessons,
 *         finishes it and gives the badge too. On this branch it shows the
 *         finish goes through Release 2's save, own lessons kept
 *   C-E3  the hero is the first published course, which the learner never
 *         opened
 *
 * The courses are seeded the way the course editor leaves them
 * (fixtures/r2-course.ts); a learner's progress in a course's own lessons is
 * seeded too, since the player that plays them is Stream A's. What a learner
 * does here — Continue on a standard lesson, a scenario, the completion
 * screen — is the same in Release 1's player and in Release 2's.
 *
 * Requires a real database — gated on E2E_DB=1, like db-backed-progress.
 * Everything it creates is unique to this run and removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;
// One worker seeds the courses once; a failed test doesn't stop the others.
test.describe.configure({ mode: "default" });

const RUN = runId();
const EMAILS = {
  learner: `e2e-r2c-learner-${RUN}@example.com`,
  staff: `e2e-r2c-staff-${RUN}@example.com`,
  finisher: `e2e-r2c-finisher-${RUN}@example.com`,
  hero: `e2e-r2c-hero-${RUN}@example.com`,
};
const SLUGS = {
  flexible: `e2e-r2c-flexible-${RUN}`,
  finish: `e2e-r2c-finish-${RUN}`,
  heroNow: `e2e-r2c-hero-now-${RUN}`,
  heroDone: `e2e-r2c-hero-done-${RUN}`,
  heroNext: `e2e-r2c-hero-next-${RUN}`,
};

// ---------------------------------------------------------------------------
// Helpers.

/**
 * Seeds a course whose lesson list leaves out the standard text lessons it
 * doesn't name: deleted, as the editor stores it (else they come back).
 */
async function seedCourse(seed: R2CourseSeed) {
  const named = new Set(seed.lessons.map((l) => l.id));
  const removed = ["context", "concept", "behaviour", "reflection"].filter((k) => !named.has(k));
  return seedR2Course(prisma, { ...seed, outline: { ...outlineOf(seed.lessons), removed } });
}

/** A member of staff (FACILITATOR) with a session, as a sign-in leaves it. */
async function staffWithSession(email: string) {
  await prisma.user.deleteMany({ where: { email } });
  const user = await prisma.user.create({
    data: { email, emailVerified: new Date() },
    select: { id: true },
  });
  await prisma.membership.create({
    data: { userId: user.id, projectId: PROJECT, role: "FACILITATOR" },
  });
  const sessionToken = `e2e-r2c-staff-${RUN}-${Math.random().toString(36).slice(2)}`;
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 86_400_000) },
  });
  return { userId: user.id, sessionToken };
}

const courseId = async (slug: string) =>
  (await prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug }, select: { id: true } })).id;

/**
 * Seeds an enrolment, as saves leave one, last changed `hoursAgo` hours ago
 * (updatedAt, the learner's "last active" in a course).
 */
async function enrol(
  userId: string,
  slug: string,
  progress: { stages?: string[]; own?: string[]; completed?: boolean; hoursAgo?: number }
) {
  const row = await prisma.courseEnrollment.create({
    data: {
      userId,
      courseId: await courseId(slug),
      stagesCompleted: (progress.stages ?? []) as never,
      sectionsCompleted: progress.own,
      completedAt: progress.completed ? new Date() : null,
    },
    select: { id: true },
  });
  const at = new Date(Date.now() - (progress.hoursAgo ?? 0) * 3_600_000);
  await prisma.$executeRaw`UPDATE "CourseEnrollment" SET "updatedAt" = ${at} WHERE id = ${row.id}`;
}

/** Time on a lesson, as the player records it (recordStageTime). */
async function timeOn(userId: string, slug: string, stage: string, seconds: number) {
  await prisma.auditLog.create({
    data: {
      projectId: PROJECT,
      actorId: userId,
      action: "stage.time",
      entity: "Stage",
      entityId: `${slug}:${stage}`,
      metadata: { courseSlug: slug, stage, seconds },
    },
  });
}

/** "Your journey" on the learner dashboard: its lines, in order. */
const journey = (page: Page) =>
  page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: /^(your journey|deine reise)$/i }) })
    .getByRole("listitem");

/**
 * The dashboard's hero: the course's title under "Current mission". (The
 * page can hold a second, hidden copy for a moment while it loads.)
 */
const hero = (page: Page) =>
  page
    .getByText("Current mission", { exact: true })
    .filter({ visible: true })
    .locator("xpath=following-sibling::h2[1]");

/** A figure or time row in the facilitator's activity panel, by its label. */
const miniStat = (page: Page, label: string) =>
  page.getByText(label, { exact: true }).filter({ visible: true }).locator("xpath=..");

/** Opens a course in the player and waits for the learner's saved progress to load. */
async function openCourse(page: Page, slug: string) {
  const loaded = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.request().postData() === JSON.stringify([slug, "en"])
  );
  await page.goto(`/en/learner/course/${slug}`);
  await loaded;
  await page.waitForTimeout(300); // the loaded progress is merged in
}

const cont = (page: Page) => page.getByRole("button", { name: /^continue$/i });

// ---------------------------------------------------------------------------

describe("Release 2: dashboards and reports follow the course's lessons", () => {
  const OWN_DONE = ownLessonId();
  const OWN_NEXT = ownLessonId();
  const OWN_HIDDEN = ownLessonId();
  const FINISH_OWN = ownLessonId();
  const ROOT = "Ask to finish your point";
  const FOLLOWUP = "Thank them for waiting afterwards";

  const users: Record<keyof typeof EMAILS, { userId: string; sessionToken: string }> = {} as never;

  test.beforeAll(async () => {
    users.learner = await learnerWithSession(prisma, EMAILS.learner);
    users.finisher = await learnerWithSession(prisma, EMAILS.finisher);
    users.hero = await learnerWithSession(prisma, EMAILS.hero);
    users.staff = await staffWithSession(EMAILS.staff);

    // C-E1: a renamed standard lesson, two of its own, a hidden one of its
    // own, and a standard lesson under its standard name (the other text
    // lessons deleted).
    await seedCourse({
      slug: SLUGS.flexible,
      title: { en: "E2E Speaking up", de: "E2E Sich äußern" },
      lessons: [
        {
          id: "context",
          label: { en: "Warm-up", de: "Aufwärmen" },
          narrative: narrative({ en: { title: "Where we start", text: "E2E: a meeting." } }),
        },
        {
          id: OWN_DONE,
          label: { en: "Your own story", de: "Deine Geschichte" },
          narrative: narrative({ en: { title: "A story", text: "E2E: think of a time." } }),
        },
        {
          id: OWN_NEXT,
          label: { en: "Try it at work", de: "Probier es aus" },
          narrative: narrative({ en: { title: "At work", text: "E2E: try it this week." } }),
        },
        { id: "concept", narrative: narrative({ en: { title: "The idea", text: "E2E: say it early." } }) },
        {
          id: OWN_HIDDEN,
          hidden: true,
          label: { en: "Old exercise" },
          narrative: narrative({ en: { title: "Old", text: "E2E: no longer shown." } }),
        },
      ],
    });

    // C-E2: one lesson of its own (done), then the standard lessons the
    // learner plays — the same, in the same order, in either player
    // (Release 1's always has the four text lessons).
    await seedCourse({
      slug: SLUGS.finish,
      title: { en: "E2E Finish it" },
      lessons: [
        {
          id: FINISH_OWN,
          label: { en: "Before you start" },
          narrative: narrative({ en: { title: "Before", text: "E2E: a word first." } }),
        },
        { id: "context", narrative: narrative({ en: { title: "Where we start", text: "E2E: a meeting." } }) },
        { id: "concept", narrative: narrative({ en: { title: "The idea", text: "E2E: say it early." } }) },
        { id: "behaviour", narrative: narrative({ en: { title: "How it sounds", text: "E2E: calm." } }) },
        {
          id: "scenario",
          structure: {
            ...structures.scenario("E2E: your lead cuts you off in a meeting."),
            followupQuestion: { en: "And afterwards?" },
            choices: [
              {
                id: "c1",
                quality: "best",
                text: { en: ROOT },
                outcome: { en: "You finish." },
                followups: [{ id: "f1", quality: "best", text: { en: FOLLOWUP }, outcome: { en: "Warm." } }],
              },
              {
                id: "c2",
                quality: "poor",
                text: { en: "Stay quiet" },
                outcome: { en: "The point is lost." },
                followups: [{ id: "f2", quality: "poor", text: { en: "Complain later" }, outcome: { en: "Hmm." } }],
              },
            ],
          },
        },
        { id: "reflection" },
      ],
    });

    // C-E3: three courses of three standard lessons (Behaviour model deleted).
    for (const [slug, title] of [
      [SLUGS.heroNow, "E2E The course I'm in"],
      [SLUGS.heroDone, "E2E The course I finished"],
      [SLUGS.heroNext, "E2E The course I open next"],
    ]) {
      await seedCourse({
        slug,
        title: { en: title },
        lessons: ["context", "concept", "reflection"].map((id) => ({
          id,
          narrative: narrative({ en: { title: `${title}: ${id}`, text: "E2E text." } }),
        })),
      });
    }
  });

  test.afterAll(async () => {
    for (const slug of Object.values(SLUGS)) await removeR2Course(prisma, slug);
    await removeLearners(prisma, Object.values(EMAILS));
  });

  test("C-E1: dashboard, “Your journey”, the facilitator's view and the statistics count a course's own lessons and name its steps", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const { userId } = users.learner;
    // Done: the renamed standard lesson, one of its own, and one of its own
    // the course hides since. Next: the other of its own.
    await enrol(userId, SLUGS.flexible, { stages: ["CONTEXT"], own: [OWN_DONE, OWN_HIDDEN], hoursAgo: 1 });
    await timeOn(userId, SLUGS.flexible, "context", 60);
    await timeOn(userId, SLUGS.flexible, OWN_DONE, 120);
    // 4 lessons shown + 1 finished one hidden since; 3 of those 5 done.

    // ---- The learner's dashboard ----
    await signIn(context, users.learner.sessionToken);
    await page.goto("/en/learner");
    await expect(hero(page)).toHaveText("E2E Speaking up");
    await expect(journey(page)).toHaveText([
      "Warm-up",
      "Your own story",
      "Try it at work",
      "Skill concept",
      "and 1 completed lesson no longer in the course",
    ]);
    await expect(page.getByRole("progressbar", { name: "3/5", exact: true })).toHaveAttribute("aria-valuenow", "60");
    await expect(page.getByRole("progressbar", { name: "3/5 your journey" })).toHaveAttribute("aria-valuenow", "60");

    // In German: the course's German step names, the standard one's German name.
    await page.goto("/de/learner");
    await expect(journey(page)).toHaveText([
      "Aufwärmen",
      "Deine Geschichte",
      "Probier es aus",
      "Skill-Konzept",
      "und 1 abgeschlossene Lektion, die nicht mehr im Kurs ist",
    ]);

    // ---- The facilitator's view ----
    await signIn(context, users.staff.sessionToken);
    await page.goto("/en/facilitator");
    const row = page.locator("li", { hasText: EMAILS.learner }).filter({ visible: true });
    await expect(row).toContainText("60%");
    await row.getByRole("button", { name: /open learner/i }).click();
    await expect(miniStat(page, "Currently on")).toContainText("Try it at work");
    await expect(miniStat(page, "Time on task")).toContainText("3m");
    // Time per lesson: the standard lesson by its standard name, the course's
    // own lessons as one row, adding up to the time on task.
    await expect(miniStat(page, "Context")).toContainText("1m");
    await expect(miniStat(page, "Other lessons")).toContainText("2m");

    // ---- The statistics ----
    await page.goto("/en/analytics?live=1");
    await expect(page.getByText("live data", { exact: false }).first()).toBeVisible();
    const stats = page.locator("tr", { hasText: EMAILS.learner }).filter({ visible: true });
    await expect(stats.locator("td").nth(1)).toHaveText("Other lesson");
    await expect(stats.locator("td").nth(2)).toContainText("60%");
    await expect(stats.locator("td").nth(3)).toHaveText("3m");
    await expect(
      page.getByText(
        "Learners now on one of their course's own lessons, outside the seven steps. Figures for each of those lessons come later."
      )
    ).toBeVisible();
  });

  test("C-E2: finishing a flexible course gives its badge; the Comp Card evidence still shows", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = users.finisher;
    await enrol(userId, SLUGS.finish, { own: [FINISH_OWN], hoursAgo: 1 });
    await signIn(context, sessionToken);
    await openCourse(page, SLUGS.finish);

    // The standard lessons, all still to do: three to read, the scenario
    // (root and follow-up), the reflection, to the completion screen.
    await expect(page.getByRole("heading", { name: "Where we start" })).toBeVisible();
    for (const next of ["The idea", "How it sounds"]) {
      await cont(page).click();
      await expect(page.getByRole("heading", { name: next })).toBeVisible();
    }
    await cont(page).click();
    await page.getByRole("button", { name: ROOT }).click();
    await page.getByRole("button", { name: FOLLOWUP }).click();
    await cont(page).click();
    await expect(page.getByRole("main").getByRole("textbox").first()).toBeVisible();
    await cont(page).click();
    await expect(page.getByRole("heading", { name: /course complete/i })).toBeVisible();

    // Saved: finished, the standard lessons by their keys, the lesson of its
    // own kept, and the course's badge (made on this first finish).
    const id = await courseId(SLUGS.finish);
    await expect
      .poll(
        async () => {
          const e = await prisma.courseEnrollment.findUnique({
            where: { userId_courseId: { userId, courseId: id } },
            select: { completedAt: true, stagesCompleted: true, sectionsCompleted: true },
          });
          return e && { done: !!e.completedAt, stages: e.stagesCompleted, own: e.sectionsCompleted };
        },
        { timeout: 15_000 }
      )
      .toEqual({
        done: true,
        stages: ["CONTEXT", "CONCEPT", "BEHAVIOUR", "SCENARIO", "REFLECTION"],
        own: [FINISH_OWN],
      });
    const badge = await prisma.course.findUniqueOrThrow({ where: { id }, select: { badgeId: true } });
    expect(badge.badgeId).not.toBeNull();
    await expect
      .poll(() => prisma.userBadge.count({ where: { userId, badgeId: badge.badgeId! } }), { timeout: 15_000 })
      .toBe(1);

    // The Comp Card's evidence: the scenario path the learner took.
    await page.getByRole("link", { name: /open your comp card/i }).click();
    await expect(page.getByText(`${ROOT} → ${FOLLOWUP}`).filter({ visible: true }).first()).toBeVisible();

    // The dashboard: the course completed, its badge among the learner's.
    await page.goto("/en/learner");
    await expect(
      page.getByRole("link").filter({ hasText: "E2E Finish it" }).getByText("Completed", { exact: true }).first()
    ).toBeVisible();
    await expect(
      page.locator("section", { has: page.getByRole("heading", { name: "Badges" }) }).getByText("E2E Finish it")
    ).toBeVisible();
  });

  test("C-E3: the hero follows the course the learner is in", async ({ page, context }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = users.hero;
    // Under way, last an hour ago; finished, just now. Nothing yet in the third.
    await enrol(userId, SLUGS.heroNow, { stages: ["CONTEXT"], hoursAgo: 1 });
    await enrol(userId, SLUGS.heroDone, { stages: ["CONTEXT", "CONCEPT", "REFLECTION"], completed: true });

    await signIn(context, sessionToken);
    await page.goto("/en/learner");
    await expect(hero(page)).toHaveText("E2E The course I'm in");
    await expect(page.getByRole("progressbar", { name: "1/3 your journey" })).toBeVisible();
    await expect(journey(page)).toHaveText(["Context", "Skill concept", "Reflection"]);

    // The learner starts the third course: the hero follows.
    await openCourse(page, SLUGS.heroNext);
    await cont(page).click();
    const id = await courseId(SLUGS.heroNext);
    await expect
      .poll(
        async () =>
          (
            await prisma.courseEnrollment.findUnique({
              where: { userId_courseId: { userId, courseId: id } },
              select: { stagesCompleted: true },
            })
          )?.stagesCompleted ?? [],
        { timeout: 15_000 }
      )
      .toEqual(["CONTEXT"]);
    await page.goto("/en/learner");
    await expect(hero(page)).toHaveText("E2E The course I open next");
    await expect(page.getByRole("progressbar", { name: "1/3 your journey" })).toBeVisible();
  });
});
