import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  learnerWithSession,
  narrative,
  ownLessonId,
  partId,
  parts,
  removeLearners,
  removeR2Course,
  runId,
  seedR2Course,
  signIn,
} from "./fixtures/r2-course";

/**
 * Release 2, Foundation (spec 10.2, F-E1 to F-E5): a learner's progress is
 * never lost or taken back.
 *
 * Release 1 saved a course's whole progress from whatever a tab held, so a
 * tab opened before the learner did something elsewhere — a "stale" tab —
 * put its older copy back over it: a finished course un-finished, another
 * tab's answers gone. Release 2 sends only what changed since the server
 * last confirmed (D62.b) and merges it under the enrolment's lock, and a
 * database trigger keeps a completion even from code that tries to clear
 * it (D62.c). Each F-E test is red on Release 1's build (main b357cc7) run
 * one of two ways (spec 9): against this database once migrated, as it
 * serves while Release 2's migration applies, or against Release 1's own
 * schema, which has no trigger:
 *
 *   F-E1  migrated: the finished course's answers wiped (the trigger keeps
 *         completedAt); Release 1's schema: completedAt cleared as well
 *   F-E2  the last tab to save a reflection wins (both ways)
 *   F-E3  a stale tab's practice answer replaces the newer one (both ways)
 *   F-E4  Release 1's schema: no trigger, a completion can be cleared.
 *         Migrated, it is a guard: the trigger is the database's, so it
 *         holds whichever build writes.
 *   F-E5  migrated: "Download my data" leaves out the new columns (Release
 *         1's schema has none to seed)
 *
 * The guard after them (D68) passes on Release 1, which has no outbox: an
 * answer this tab kept while the server didn't know its build must never
 * come back over a newer one.
 *
 * They play the bundled workplace-conflict course in the player as it is
 * (Release 1's, until Stream A), in two tabs of one browser signed in as
 * the same learner. The rows are read with Release 1's columns only, so
 * the tests read the same on a database without the Release 2 migration.
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
test.describe.configure({ mode: "serial" });

const RUN = runId();
const EMAILS = {
  staleComplete: `e2e-r2-stale-complete-${RUN}@example.com`,
  twoReflections: `e2e-r2-two-reflections-${RUN}@example.com`,
  stalePractice: `e2e-r2-stale-practice-${RUN}@example.com`,
  trigger: `e2e-r2-trigger-${RUN}@example.com`,
  exported: `e2e-r2-export-${RUN}@example.com`,
  outbox: `e2e-r2-outbox-${RUN}@example.com`,
};
const SLUG = "workplace-conflict";
const FLEXIBLE = `e2e-r2-safety-${RUN}`;
const ALL_SEVEN = ["CONTEXT", "CONCEPT", "BEHAVIOUR", "SIMULATION", "SCENARIO", "REFLECTION", "ASSESSMENT"];

/** A learner's enrolment in a course, by Release 1's columns. */
async function enrolment(userId: string, slug = SLUG) {
  return prisma.courseEnrollment.findFirst({
    where: { userId, course: { slug } },
    select: {
      completedAt: true,
      stagesCompleted: true,
      simulationChoice: true,
      scenarioRoot: true,
      scenarioFollowup: true,
      reflection: true,
      assessment: true,
    },
  });
}

// ---------------------------------------------------------------------------
// The player.

const cont = (page: Page) => page.getByRole("button", { name: /^continue$/i });

/** Opens the course in a new tab and waits until its saved progress has loaded. */
async function openTab(context: BrowserContext) {
  const page = await context.newPage();
  const loaded = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.request().postData() === JSON.stringify([SLUG, "en"])
  );
  await page.goto(`/en/learner/course/${SLUG}`);
  await loaded;
  await page.waitForTimeout(300); // the loaded progress is merged in
  return page;
}

/**
 * The page's next save of the course's progress — Release 1's whole copy or
 * Release 2's patch, which both start ["<slug>",{ — answered by the server.
 * `holding` narrows it to a save carrying that text.
 */
function nextSave(page: Page, holding?: string) {
  return page.waitForResponse(async (r) => {
    const req = r.request();
    const body = req.postData() ?? "";
    return (
      req.method() === "POST" &&
      !!(await req.headerValue("next-action")) &&
      body.startsWith(`["${SLUG}",{`) &&
      (!holding || body.includes(holding))
    );
  });
}

/** From the course's first lesson to its practice (the player opens at the first). */
async function toPractice(page: Page) {
  for (let i = 0; i < 3; i++) await cont(page).click();
  await expect(page.getByText(/look who finally showed up/i)).toBeVisible();
}
const practice = (page: Page, option: RegExp) => page.getByText(option).click();
const BEST = /the bus was late\. when you say/i;
const SORRY = /sorry, sorry, won't happen again/i;

/** From the practice's answer to the reflection. */
async function toReflection(page: Page) {
  await cont(page).click();
  await page.getByText(/wait for a quiet moment, then talk to sam/i).click();
  await page.getByText(/addressed directly from now on/i).click();
  await cont(page).click();
  await expect(reflectionBox(page, 0)).toBeVisible();
}
const reflectionBox = (page: Page, n: number) => page.getByRole("main").getByRole("textbox").nth(n);

/** From the reflection to the completion screen. */
async function toCompletion(page: Page) {
  await cont(page).click();
  await page.getByText("Describes what you felt and what you'd prefer").click();
  await page.getByText("Notice what you're feeling").click();
  await page.getByText("It lets both people be heard without an audience").click();
  await page.getByRole("button", { name: /check answers/i }).click();
  await cont(page).click();
  await expect(page.getByRole("heading", { name: /course complete/i })).toBeVisible();
}

// ---------------------------------------------------------------------------

describe("Release 2: a learner's progress is never taken back", () => {
  const users: Record<keyof typeof EMAILS, { userId: string; sessionToken: string }> = {} as never;

  test.beforeAll(async () => {
    for (const [key, email] of Object.entries(EMAILS) as [keyof typeof EMAILS, string][]) {
      users[key] = await learnerWithSession(prisma, email);
    }
  });

  test.afterAll(async () => {
    await removeLearners(prisma, Object.values(EMAILS));
    await removeR2Course(prisma, FLEXIBLE);
  });

  test("F-E1: a stale tab can't un-complete a course", async ({ context }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = users.staleComplete;
    await signIn(context, sessionToken);

    // Tab A: the first lesson done, saved.
    const a = await openTab(context);
    const first = nextSave(a);
    await cont(a).click();
    await first;
    expect((await enrolment(userId))?.stagesCompleted).toEqual(["CONTEXT"]);

    // Tab B: the whole course, to its completion screen.
    const b = await openTab(context);
    await toPractice(b);
    await practice(b, BEST);
    await toReflection(b);
    await toCompletion(b);
    await expect.poll(async () => (await enrolment(userId))?.completedAt ?? null).not.toBeNull();
    await b.waitForTimeout(1500); // every save of tab B is in
    const finished = await enrolment(userId);
    expect(finished).toMatchObject({
      stagesCompleted: ALL_SEVEN,
      simulationChoice: "iStatement",
      scenarioRoot: "private",
      assessment: { checked: true },
    });

    // Tab A never saw any of it, and does one more step: its save mustn't
    // take back what tab B finished.
    const stale = nextSave(a);
    await cont(a).click();
    await stale;
    const after = await enrolment(userId);
    expect(after?.completedAt, "the course is still complete").toEqual(finished?.completedAt);
    expect(after?.stagesCompleted, "every lesson is still done").toEqual(ALL_SEVEN);
    expect(after, "the finished course's answers are still there").toEqual(finished);
  });

  test("F-E2: two tabs answering different reflection questions keep both", async ({ context }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = users.twoReflections;
    await signIn(context, sessionToken);

    // Both tabs reach the reflection before either answers it.
    const a = await openTab(context);
    await toPractice(a);
    await practice(a, BEST);
    await toReflection(a);
    const b = await openTab(context);
    await toPractice(b);
    await practice(b, BEST);
    await toReflection(b);

    const fromA = nextSave(a, "From tab A");
    await reflectionBox(a, 0).fill("From tab A");
    await fromA;
    const fromB = nextSave(b, "From tab B");
    await reflectionBox(b, 1).fill("From tab B");
    await fromB;

    expect((await enrolment(userId))?.reflection).toMatchObject({
      p1: "From tab A",
      p2: "From tab B",
    });
  });

  test("F-E3: a stale tab's old practice answer doesn't replace a newer one it never changed", async ({
    context,
  }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = users.stalePractice;
    await signIn(context, sessionToken);

    // Tab A answers the practice, and it's saved.
    const a = await openTab(context);
    await toPractice(a);
    await practice(a, BEST);
    const answered = nextSave(a, "iStatement");
    await cont(a).click();
    await answered;

    // Tab B opens later and changes the answer.
    const b = await openTab(context);
    await toPractice(b);
    await practice(b, SORRY);
    const changed = nextSave(b, "shrink");
    await cont(b).click();
    await changed;
    expect((await enrolment(userId))?.simulationChoice).toBe("shrink");

    // Tab A still shows its own answer, and answers the next lesson.
    const next = nextSave(a, "private");
    await a.getByText(/wait for a quiet moment, then talk to sam/i).click();
    await next;
    expect(await enrolment(userId)).toMatchObject({
      simulationChoice: "shrink",
      scenarioRoot: "private",
    });
  });

  test("F-E4: the database keeps a completion an older build tries to clear", async () => {
    const { userId } = users.trigger;
    const course = await prisma.course.findFirstOrThrow({ where: { slug: SLUG }, select: { id: true } });
    const completedAt = new Date("2026-11-10T09:00:00.000Z");
    const { id } = await prisma.courseEnrollment.create({
      data: { userId, courseId: course.id, stagesCompleted: ALL_SEVEN as never, completedAt },
      select: { id: true },
    });

    // What Release 1's whole-progress save writes from a tab that never
    // saw the completion.
    await prisma.courseEnrollment.updateMany({
      where: { id },
      data: { completedAt: null, stagesCompleted: ["CONTEXT"], scenarioRoot: "private" },
    });
    const row = () =>
      prisma.courseEnrollment.findUniqueOrThrow({
        where: { id },
        select: { completedAt: true, stagesCompleted: true, scenarioRoot: true },
      });
    expect(await row()).toEqual({ completedAt, stagesCompleted: ALL_SEVEN, scenarioRoot: "private" });

    // Lessons are only ever added, in the order first done.
    await prisma.courseEnrollment.updateMany({
      where: { id },
      data: { stagesCompleted: ["ASSESSMENT", "CONTEXT"] },
    });
    expect((await row()).stagesCompleted).toEqual(ALL_SEVEN);

    // Resetting a learner's progress deletes the row.
    await prisma.courseEnrollment.delete({ where: { id }, select: { id: true } });
    expect(await enrolment(userId)).toBeNull();
  });

  test("Guard (D68): an answer kept while the build was gone never comes back over a newer one", async ({
    context,
  }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = users.outbox;
    await signIn(context, sessionToken);
    const page = `**/en/learner/course/${SLUG}`;

    // Tab A answers the practice while the server doesn't know this page's
    // build (a deploy, or the rollback of spec 10.6): the save is answered
    // "unknown action", and the answer goes to the tab's outbox.
    const a = await openTab(context);
    await toPractice(a);
    let unknown = 0;
    await a.route(page, async (route) => {
      const req = route.request();
      if (
        unknown === 0 &&
        req.method() === "POST" &&
        !!(await req.headerValue("next-action")) &&
        (req.postData() ?? "").includes("iStatement")
      ) {
        unknown++;
        return route.fulfill({ status: 200, headers: { "x-nextjs-action-not-found": "1" }, body: "" });
      }
      await route.continue();
    });
    await practice(a, BEST);
    await cont(a).click();
    await expect.poll(() => unknown).toBe(1);
    await a.unroute(page);

    // The build is back: tab A's next save gets through, the kept answer
    // with it.
    const through = nextSave(a, "private");
    await a.getByText(/wait for a quiet moment, then talk to sam/i).click();
    await through;
    await expect
      .poll(async () => (await enrolment(userId))?.simulationChoice)
      .toBe("iStatement");

    // In another tab, the learner changes the practice answer.
    const b = await openTab(context);
    await toPractice(b);
    await practice(b, SORRY);
    const changed = nextSave(b, "shrink");
    await cont(b).click();
    await changed;
    await b.close();
    expect((await enrolment(userId))?.simulationChoice).toBe("shrink");

    // Tab A loads the course again. What its outbox kept is on the server
    // already, and older than that change: it mustn't come back over it.
    const loaded = a.waitForResponse(
      (r) => r.request().method() === "POST" && r.request().postData() === JSON.stringify([SLUG, "en"])
    );
    await a.reload();
    await loaded;
    await a.waitForTimeout(2500); // a save of anything restored is in by now
    expect((await enrolment(userId))?.simulationChoice, "the newer answer stays").toBe("shrink");
  });

  test("F-E5: Download my data holds sectionsCompleted and responses", async ({ context }) => {
    const { userId, sessionToken } = users.exported;
    const own = ownLessonId();
    const rating = partId();
    const course = await seedR2Course(prisma, {
      slug: FLEXIBLE,
      lessons: [
        { id: "context", narrative: narrative({ en: { title: "Start", text: "E2E: start here." } }) },
        {
          id: own,
          label: { en: "Your own" },
          narrative: narrative({ en: { title: "Your own", text: "E2E: a lesson of its own." } }),
          parts: [parts.rating(undefined, rating)],
        },
      ],
    });
    const responses = {
      v: 1,
      items: { [`${own}/${rating}`]: { type: "rating", values: { s1: 4 }, at: "2026-11-10T09:00:00.000Z" } },
    };
    await prisma.courseEnrollment.create({
      data: { userId, courseId: course.id, stagesCompleted: ["CONTEXT"], sectionsCompleted: [own], responses },
      select: { id: true },
    });

    await signIn(context, sessionToken);
    const res = await context.request.get("/api/me/export");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { courses: Record<string, unknown>[] };
    const exported = body.courses.find((c) => c.course === FLEXIBLE);
    expect(exported).toMatchObject({ stagesCompleted: ["CONTEXT"] });
    expect(exported?.sectionsCompleted, "lessons of the course's own").toEqual([own]);
    expect(exported?.responses, "answers per item").toEqual(responses);
  });
});
