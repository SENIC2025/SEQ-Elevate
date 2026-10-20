import { test, expect, type Page, type Route } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PROJECT,
  learnerWithSession,
  narrative,
  outlineOf,
  ownLessonId,
  parts,
  removeLearners,
  removeR2Course,
  runId,
  seedR2Course,
  signIn,
  structures,
  type R2LessonSeed,
} from "./fixtures/r2-course";

/**
 * Release 2, Stream A: where a learner opens a course, and moving through
 * it in order (spec 5.5, 5.6, Q4; 10.2 A-E3, A-E4, A-E5, A-E7, A-E8).
 *
 *   A-E3   a signed-in learner who did three lessons opens at the fourth —
 *          from the server's first answer, no flash of lesson 1 — and after
 *          an editor reorders the lessons, at the first one not done
 *          (standard and flexible courses); the one check after the
 *          progress loads moves a learner who hasn't started yet.
 *   A-E4   practice and scenario answers come back on Back and on reload,
 *          on a standard lesson's stage screen and in a lesson of the
 *          course's own.
 *   A-E5   Guard: a slow progress load never moves a learner who already
 *          clicked (Release 1 never moves anyone, so it passes there too).
 *   A-E7   in order after a reorder: the step bar can't reach past the
 *          first lesson not done, a done lesson beyond it included; Back
 *          always works; after the last lesson, Continue goes to the one
 *          still to do and says so (as an editor's preview reaches it).
 *   A-E8   a guest's progress in a lesson of the course's own, their resume,
 *          and the move into the account on sign-in.
 *
 * Each but A-E5 is red on the Release 1 build (main b357cc7): it opens a
 * signed-in learner at lesson 1, gives learners the standard lessons only,
 * keeps practice and scenario answers in the screen alone, and lets a done
 * lesson be opened from the step bar.
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
const COURSES = {
  standard: `e2e-r2-resume-std-${RUN}`,
  reorderStd: `e2e-r2-resume-rstd-${RUN}`,
  reorderFlex: `e2e-r2-resume-rflex-${RUN}`,
  answers: `e2e-r2-resume-ans-${RUN}`,
  order: `e2e-r2-resume-order-${RUN}`,
  orderPreview: `e2e-r2-resume-orderp-${RUN}`,
  guest: `e2e-r2-resume-guest-${RUN}`,
};
const emails: string[] = [];
async function learner(tag: string) {
  const email = `e2e-r2-resume-${tag}-${RUN}@example.com`;
  emails.push(email);
  return learnerWithSession(prisma, email);
}

// ---------------------------------------------------------------------------
// Courses.

const text = (title: string) => narrative({ en: { title, text: `E2E ${title} text.` } });

/** A course in the standard layout: four text lessons and the three exercises. */
const STANDARD: R2LessonSeed[] = [
  { id: "context", narrative: text("The situation") },
  { id: "concept", narrative: text("The skill") },
  { id: "behaviour", narrative: text("What it looks like") },
  { id: "simulation", structure: structures.simulation() },
  { id: "scenario", structure: structures.scenario() },
  { id: "reflection", narrative: text("Look back") },
  { id: "assessment", structure: structures.assessment() },
];

/** A course in the standard layout as it would be stored, its lessons in `order`. */
const outlineIn = (order: string[]) => ({
  v: 1,
  sections: order.map((id) => ({ id, template: id.startsWith("s-") ? "text" : id })),
});

/** Lessons of the course's own with text only, named by `names`. */
function ownLessons(names: string[]): { ids: string[]; lessons: R2LessonSeed[] } {
  const ids = names.map(() => ownLessonId());
  return {
    ids,
    lessons: names.map((name, i) => ({ id: ids[i], label: { en: name }, narrative: text(name) })),
  };
}
/** The standard text lessons are always listed unless deleted. */
const NO_STANDARD = ["context", "concept", "behaviour", "reflection"];

/** A course of five text lessons of its own, "One" to "Five", and nothing else. */
async function seedOrderCourse(slug: string) {
  const own = ownLessons(["One", "Two", "Three", "Four", "Five"]);
  await seedR2Course(prisma, { slug, lessons: own.lessons, outline: { ...outlineOf(own.lessons), removed: NO_STANDARD } });
  return own;
}

// ---------------------------------------------------------------------------
// The page. Only what's on screen.

const stepButtons = (page: Page) =>
  page.getByRole("navigation", { name: /^course stages$/i }).filter({ visible: true }).getByRole("button");
const counter = (page: Page) => page.getByText(/^\d+ \/ \d+ · /).filter({ visible: true });
const continueButton = (page: Page) =>
  page.getByRole("main").getByRole("button", { name: /^continue$/i }).filter({ visible: true });
const backButton = (page: Page, name: string) =>
  page.getByRole("main").getByRole("button", { name, exact: true }).filter({ visible: true }).last();
const announcer = (page: Page) => page.locator("[data-player-announcer]");

/** Continue to step n, retried against the hydration race, never past it. */
async function continueTo(page: Page, n: number) {
  await expect(async () => {
    const at = (await counter(page).textContent())?.trim() ?? "";
    if (at.startsWith(`${n - 1} /`)) await continueButton(page).click();
    await expect(counter(page)).toHaveText(new RegExp(`^${n} / `), { timeout: 5000 });
  }).toPass({ timeout: 20_000 });
}

/** The learner's row in `slug`. */
async function rowOf(userId: string, slug: string) {
  return prisma.courseEnrollment.findFirst({
    where: { userId, course: { slug } },
    select: { stagesCompleted: true, sectionsCompleted: true, simulationChoice: true, scenarioRoot: true, responses: true },
  });
}

/** An enrolment as a learner leaves it, written directly. */
async function enrol(userId: string, slug: string, o: { stages?: string[]; sections?: string[] }) {
  const course = await prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug }, select: { id: true } });
  await prisma.courseEnrollment.create({
    data: {
      userId,
      courseId: course.id,
      stagesCompleted: (o.stages ?? []) as never,
      ...(o.sections ? { sectionsCompleted: o.sections as Prisma.InputJsonValue } : {}),
    },
    select: { id: true },
  });
}

/**
 * Holds the page's load of `slug`'s saved progress (loadCourseProgress,
 * called with the slug and the language) until `release()`.
 */
async function holdProgressLoad(page: Page, slug: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let held = 0;
  await page.route(`**/learner/course/${slug}*`, async (route: Route) => {
    const req = route.request();
    if (req.method() === "POST" && req.postData() === JSON.stringify([slug, "en"])) {
      held++;
      await released;
    }
    await route.continue();
  });
  return { release: () => release(), held: () => held };
}

describe("Release 2 — resume and order", () => {
  test.beforeAll(async () => {
    await seedR2Course(prisma, { slug: COURSES.standard, lessons: STANDARD, outline: null });
  });

  test.afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users.map((u) => u.id) } } });
    await removeLearners(prisma, emails);
    for (const slug of Object.values(COURSES)) await removeR2Course(prisma, slug);
    await prisma.$disconnect();
  });

  test("A-E3: a signed-in learner who did three lessons opens at the fourth, from the server's first answer", async ({
    page,
    context,
  }) => {
    const { userId, sessionToken } = await learner("three");
    await signIn(context, sessionToken);
    await page.goto(`/en/learner/course/${COURSES.standard}`);
    await expect(counter(page)).toHaveText("1 / 7 · Context", { timeout: 15000 });
    await continueTo(page, 2);
    await continueTo(page, 3);
    await continueTo(page, 4);
    await expect
      .poll(async () => (await rowOf(userId, COURSES.standard))?.stagesCompleted ?? [], { timeout: 15000 })
      .toEqual(["CONTEXT", "CONCEPT", "BEHAVIOUR"]);

    // The server's own page already opens there: lesson 1 never shows first.
    const html = await (await page.request.get(`/en/learner/course/${COURSES.standard}`)).text();
    expect(html).toMatch(/aria-current="step"[^>]*>(?:(?!<\/button>).)*>4<\/span>/);
    await page.reload();
    await expect(counter(page)).toHaveText("4 / 7 · Guided practice", { timeout: 15000 });
    await expect(stepButtons(page).nth(2)).toHaveAccessibleName("Behaviour model, done");
  });

  test("A-E3: after an editor reorders the lessons, a standard course opens at the first lesson not done", async ({
    page,
    context,
  }) => {
    await seedR2Course(prisma, { slug: COURSES.reorderStd, lessons: STANDARD });
    const { userId, sessionToken } = await learner("rstd");
    await enrol(userId, COURSES.reorderStd, { stages: ["CONTEXT", "CONCEPT"] });
    // "Behaviour model" moved to the front.
    await prisma.course.updateMany({
      where: { projectId: PROJECT, slug: COURSES.reorderStd },
      data: { outline: outlineIn(["behaviour", "context", "concept", "simulation", "scenario", "reflection", "assessment"]) },
    });
    await signIn(context, sessionToken);
    await page.goto(`/en/learner/course/${COURSES.reorderStd}`);
    await expect(counter(page)).toHaveText("1 / 7 · Behaviour model", { timeout: 15000 });
    await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText("What it looks like");
    // A lesson not done before done ones: said to be new to them.
    await expect(page.getByText("New lesson: added after you started.")).toBeVisible();
    // After it, the next lesson not done: the done ones in between pass by.
    await continueTo(page, 2);
    await continueTo(page, 3);
    await continueTo(page, 4);
    await expect(counter(page)).toHaveText("4 / 7 · Guided practice");
  });

  test("A-E3: after a reorder, a flexible course opens at the first lesson not done", async ({ page, context }) => {
    const own = ownLessons(["First", "Second", "Third"]);
    await seedR2Course(prisma, {
      slug: COURSES.reorderFlex,
      lessons: own.lessons,
      outline: { ...outlineOf(own.lessons), removed: NO_STANDARD },
    });
    const { userId, sessionToken } = await learner("rflex");
    await enrol(userId, COURSES.reorderFlex, { sections: [own.ids[0], own.ids[1]] });
    // "Third" moved between the two done.
    await prisma.course.updateMany({
      where: { projectId: PROJECT, slug: COURSES.reorderFlex },
      data: { outline: { ...outlineOf([own.lessons[0], own.lessons[2], own.lessons[1]]), removed: NO_STANDARD } },
    });
    await signIn(context, sessionToken);
    await page.goto(`/en/learner/course/${COURSES.reorderFlex}`);
    await expect(counter(page)).toHaveText("2 / 3 · Third", { timeout: 15000 });
    await expect(stepButtons(page).first()).toHaveAccessibleName("First, done");
    await expect(stepButtons(page).nth(2)).toHaveAccessibleName("Second, done");
  });

  test("A-E3: the one check after the progress loads moves a learner who hasn't started yet, and says where", async ({
    page,
    context,
  }) => {
    const { userId, sessionToken } = await learner("recheck");
    await enrol(userId, COURSES.standard, { stages: ["CONTEXT", "CONCEPT", "BEHAVIOUR"] });
    await signIn(context, sessionToken);
    const hold = await holdProgressLoad(page, COURSES.standard);
    await page.goto(`/en/learner/course/${COURSES.standard}`);
    await expect(counter(page)).toHaveText("4 / 7 · Guided practice", { timeout: 15000 });
    await expect.poll(hold.held).toBe(1);
    // Meanwhile, on another device, the practice was done too.
    const course = await prisma.course.findFirstOrThrow({ where: { slug: COURSES.standard }, select: { id: true } });
    await prisma.courseEnrollment.update({
      where: { userId_courseId: { userId, courseId: course.id } },
      data: { stagesCompleted: ["CONTEXT", "CONCEPT", "BEHAVIOUR", "SIMULATION"] },
      select: { id: true },
    });
    hold.release();
    await expect(counter(page)).toHaveText("5 / 7 · Applied scenario", { timeout: 15000 });
    await expect(announcer(page)).toHaveText(/^Opened where you left off: step 5 of 7, Applied scenario\.\s?$/);
  });

  test("A-E5 (guard): a slow progress load never moves a learner who already clicked", async ({ page, context }) => {
    const { userId, sessionToken } = await learner("slow");
    await enrol(userId, COURSES.standard, { stages: ["CONTEXT", "CONCEPT", "BEHAVIOUR"] });
    await signIn(context, sessionToken);
    const hold = await holdProgressLoad(page, COURSES.standard);
    await page.goto(`/en/learner/course/${COURSES.standard}`);
    await expect(counter(page)).toHaveText(/^\d+ \/ 7 · /, { timeout: 15000 });
    // Meanwhile, on another device, the practice was done too…
    const course = await prisma.course.findFirstOrThrow({ where: { slug: COURSES.standard }, select: { id: true } });
    await prisma.courseEnrollment.update({
      where: { userId_courseId: { userId, courseId: course.id } },
      data: { stagesCompleted: ["CONTEXT", "CONCEPT", "BEHAVIOUR", "SIMULATION"] },
      select: { id: true },
    });
    // …and here the learner goes back to the start while their progress is on its way.
    await expect(async () => {
      if (!(await counter(page).textContent())?.startsWith("1 /")) await stepButtons(page).first().click();
      await expect(counter(page)).toHaveText(/^1 \/ 7 · /, { timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    hold.release();
    await expect.poll(hold.held).toBe(1);
    // Well after the progress has loaded: still where they went.
    await page.waitForTimeout(2500);
    await expect(counter(page)).toHaveText("1 / 7 · Context");
  });

  test("A-E4: practice and scenario answers come back on Back and on reload — on stage screens", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const { sessionToken } = await learner("stdanswers");
    await signIn(context, sessionToken);
    await page.goto(`/en/learner/course/${COURSES.standard}`);
    await expect(counter(page)).toHaveText("1 / 7 · Context", { timeout: 15000 });
    for (const n of [2, 3, 4]) await continueTo(page, n);
    const main = page.getByRole("main");
    await main.getByRole("button", { name: "Let me finish, please." }).click();
    await expect(main.getByText("Clear and calm.")).toBeVisible();
    await continueTo(page, 5);
    await main.getByRole("button", { name: "Ask to finish your point" }).click();
    await expect(main.getByText("You finish.")).toBeVisible();

    // Back: the practice answer is there, chosen.
    await backButton(page, "Guided practice").click();
    await expect(counter(page)).toHaveText("4 / 7 · Guided practice");
    await expect(main.getByRole("button", { name: "Let me finish, please." })).toHaveAttribute("aria-pressed", "true");
    await expect(main.getByText("Clear and calm.")).toBeVisible();
    await continueTo(page, 5);
    await expect(main.getByText("You finish.")).toBeVisible();

    // A reload: both are there.
    await page.waitForTimeout(1500); // the last answer's save
    await page.reload();
    await expect(counter(page)).toHaveText("5 / 7 · Applied scenario", { timeout: 15000 });
    await expect(main.getByText("You finish.")).toBeVisible();
    await backButton(page, "Guided practice").click();
    await expect(main.getByText("Clear and calm.")).toBeVisible();
    await expect(main.getByRole("button", { name: "Say nothing." })).toBeDisabled();
  });

  test("A-E4: practice and scenario answers come back on Back and on reload — in a lesson of the course's own", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const own = ownLessons(["Warm-up", "Practise", "Wrap-up"]);
    own.lessons[1].parts = [parts.practice("E2E: you're interrupted again.", "p-respra01"), parts.scenario("E2E: a colleague talks over you.", "p-ressce01")];
    await seedR2Course(prisma, {
      slug: COURSES.answers,
      lessons: own.lessons,
      outline: { ...outlineOf(own.lessons), removed: NO_STANDARD },
    });
    const { userId, sessionToken } = await learner("ownanswers");
    await signIn(context, sessionToken);
    await page.goto(`/en/learner/course/${COURSES.answers}`);
    await expect(counter(page)).toHaveText("1 / 3 · Warm-up", { timeout: 15000 });
    await continueTo(page, 2);
    const practice = page.getByRole("main").getByRole("region", { name: "Try a small move" });
    const scenario = page.getByRole("main").getByRole("region", { name: "The bigger moment" });
    await practice.getByRole("button", { name: "Let me finish, please." }).click();
    await scenario.getByRole("button", { name: "Ask to finish your point" }).click();
    await continueTo(page, 3);
    await backButton(page, "Practise").click();
    await expect(counter(page)).toHaveText("2 / 3 · Practise");
    await expect(practice.getByText("Clear and calm.")).toBeVisible();
    await expect(scenario.getByText("You finish.")).toBeVisible();

    await expect
      .poll(async () => Object.keys((((await rowOf(userId, COURSES.answers))?.responses ?? {}) as { items?: object }).items ?? {}).sort(), {
        timeout: 15000,
      })
      .toEqual([`${own.ids[1]}/p-respra01`, `${own.ids[1]}/p-ressce01`]);
    await page.reload();
    await expect(counter(page)).toHaveText("3 / 3 · Wrap-up", { timeout: 15000 });
    await backButton(page, "Practise").click();
    await expect(practice.getByRole("button", { name: "Let me finish, please." })).toHaveAttribute("aria-pressed", "true");
    await expect(practice.getByText("Clear and calm.")).toBeVisible();
    await expect(scenario.getByText("You finish.")).toBeVisible();
  });

  test("A-E7: in order after a reorder: the bar reaches the first lesson not done, no further; Back always works", async ({
    page,
    context,
  }) => {
    const own = await seedOrderCourse(COURSES.order);
    const { sessionToken, userId } = await learner("order");
    // "Four" was done before an editor moved "Three" in front of it.
    await enrol(userId, COURSES.order, { sections: [own.ids[0], own.ids[1], own.ids[3]] });
    await signIn(context, sessionToken);
    await page.goto(`/en/learner/course/${COURSES.order}`);
    await expect(counter(page)).toHaveText("3 / 5 · Three", { timeout: 15000 });
    const bar = stepButtons(page);
    await expect(bar.nth(0)).toBeEnabled();
    await expect(bar.nth(1)).toBeEnabled();
    await expect(bar.nth(2)).toBeEnabled();
    // Done, but past the first lesson not done: ticked, and closed.
    await expect(bar.nth(3)).toHaveAccessibleName("Four, done");
    await expect(bar.nth(3)).toBeDisabled();
    await expect(bar.nth(4)).toBeDisabled();

    // Back always works.
    await backButton(page, "Two").click();
    await expect(counter(page)).toHaveText("2 / 5 · Two");
    await backButton(page, "One").click();
    await expect(counter(page)).toHaveText("1 / 5 · One");
    await expect(backButton(page, "One")).toBeDisabled();
    await bar.nth(2).click();
    await expect(counter(page)).toHaveText("3 / 5 · Three");
    // On in order: the done one in its place, then the last.
    await continueTo(page, 4);
    await continueTo(page, 5);
    await continueButton(page).click();
    await expect(page.getByRole("heading", { name: /course complete/i })).toBeVisible({ timeout: 15000 });
  });

  test("A-E7: after the last lesson, Continue goes to the lesson still to do and says so", async ({ page, context }) => {
    // An editor's preview reaches any lesson (D35); learners in order only
    // get past the last with every lesson done.
    const own = await seedOrderCourse(COURSES.orderPreview);
    const editor = await learner("order-editor");
    await prisma.membership.create({ data: { userId: editor.userId, projectId: PROJECT, role: "CONTENT_EDITOR" } });
    await signIn(context, editor.sessionToken);
    await page.goto(`/en/learner/course/${COURSES.orderPreview}?preview=1&lesson=${own.ids[4]}`);
    await expect(counter(page)).toHaveText("5 / 5 · Five", { timeout: 15000 });
    await expect(async () => {
      if ((await counter(page).textContent())?.startsWith("5 /")) await continueButton(page).click();
      await expect(counter(page)).toHaveText("1 / 5 · One", { timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await expect(announcer(page)).toHaveText(/^Before you finish: “One” is still to do\.\s?$/);
  });

  test("A-E8: a guest's progress in a lesson of the course's own: kept, resumed, and moved into the account on sign-in", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const own = ownLessons(["Warm-up", "Next"]);
    own.lessons[0].parts = [parts.rating([{ en: "E2E: I say when I disagree." }], "p-guestrt1")];
    await seedR2Course(prisma, {
      slug: COURSES.guest,
      lessons: [...own.lessons, { id: "concept", narrative: text("The idea") }],
      outline: { ...outlineOf([...own.lessons, { id: "concept" }]), removed: ["context", "behaviour", "reflection"] },
    });
    const { userId, sessionToken } = await learner("guest");

    // As a guest.
    await page.goto(`/en/learner/course/${COURSES.guest}`);
    await expect(counter(page)).toHaveText("1 / 3 · Warm-up", { timeout: 15000 });
    const rating = page.getByRole("main").getByRole("group", { name: "E2E: I say when I disagree." });
    await expect(async () => {
      await rating.getByRole("radio", { name: "5 of 5" }).check();
      await expect(rating.getByRole("radio", { name: "5 of 5" })).toBeChecked({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await continueTo(page, 2);

    // Back in this browser: where they left off, the answer kept.
    await page.reload();
    await expect(counter(page)).toHaveText("2 / 3 · Next", { timeout: 15000 });
    await backButton(page, "Warm-up").click();
    await expect(rating.getByRole("radio", { name: "5 of 5" })).toBeChecked();

    // Signing in moves it into the (empty) account.
    await context.addCookies([
      { name: "authjs.session-token", value: sessionToken, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);
    await page.goto("/en/learner");
    await expect
      .poll(async () => {
        const row = await rowOf(userId, COURSES.guest);
        return {
          sections: row?.sectionsCompleted ?? null,
          rating: ((row?.responses ?? {}) as { items?: Record<string, unknown> }).items?.[`${own.ids[0]}/p-guestrt1`] ?? null,
        };
      }, { timeout: 20_000 })
      .toMatchObject({ sections: [own.ids[0]], rating: { type: "rating", values: { s1: 5 } } });
    await page.goto(`/en/learner/course/${COURSES.guest}`);
    await expect(counter(page)).toHaveText("2 / 3 · Next", { timeout: 15000 });
  });
});
