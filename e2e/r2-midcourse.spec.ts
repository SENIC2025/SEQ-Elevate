import { test, expect, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PROJECT,
  learnerWithSession,
  narrative,
  outlineOf,
  ownLessonId,
  removeLearners,
  removeR2Course,
  runId,
  seedR2Course,
  signIn,
  structures,
  type R2LessonSeed,
} from "./fixtures/r2-course";

/**
 * Release 2, integration — I-E2 (spec 7.4, 10.2): what learners in the
 * middle of a published course get when an editor changes it. Each change
 * is made on the course page, as an editor makes it — asked first, with
 * how many learners it touches (D66) — and then seen from both sides: a
 * learner still in the course, and one who finished it.
 *
 *   reorder    the learner carries on from the first lesson they haven't
 *              done, told it is new or moved; a done lesson after it is
 *              ticked but can't be jumped to; progress and answers as they
 *              were.
 *   hide       a finished lesson leaves the step bar; it still counts, so
 *              the percentage doesn't move; what they did in it is kept.
 *   content    a quick check added to a done standard lesson whose
 *              practice they answered: the lesson stays done and is drawn
 *              by the sectioned view from the next load (spec 5.3), the
 *              practice answer is still there (same simulation/main key),
 *              and on the revisit Continue asks for the new question.
 *   insert     a lesson added before lessons they did: they are taken
 *              there and told; their percentage goes down (the editor saw
 *              the count first); the learner who finished stays at 100%
 *              and still opens the course on its completion screen.
 *
 * Progress is never lost and completion never goes backwards silently:
 * the rows keep every lesson and answer, and percentages are read where
 * staff read them (the facilitator view).
 *
 * Red on Release 1 (main b357cc7): it refuses a reorder on a published
 * course with a lesson of its own (spec 10.2: "changes refused"), so the
 * first test fails where the move should ask; and its learners never get
 * this course's own lesson.
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
const SLUG = `e2e-r2-mid-${RUN}`;
const EMAILS = {
  editor: `e2e-r2-mid-editor-${RUN}@example.com`,
  staff: `e2e-r2-mid-staff-${RUN}@example.com`,
  going: `e2e-r2-mid-going-${RUN}@example.com`,
  finished: `e2e-r2-mid-finished-${RUN}@example.com`,
};
const NOTES = ownLessonId();

const text = (title: string): R2LessonSeed["narrative"] => narrative({ en: { title, text: `${title}: text.` } });

/** context, concept, practice, a lesson of its own, behaviour, quick check; the standard reflection deleted. */
const LESSONS: R2LessonSeed[] = [
  { id: "context", narrative: text("E2E Mid context") },
  { id: "concept", narrative: text("E2E Mid concept") },
  { id: "simulation", structure: structures.simulation("E2E: you're interrupted again.") },
  { id: NOTES, template: "text", label: { en: "Your notes" }, narrative: text("E2E Your notes") },
  { id: "behaviour", narrative: text("E2E Mid behaviour") },
  { id: "assessment", structure: structures.assessment("E2E: when do you speak up?") },
];

/** A member of the project with a session: an editor, or staff for the facilitator view. */
async function staffWithSession(email: string, role: "CONTENT_EDITOR" | "FACILITATOR") {
  await prisma.user.deleteMany({ where: { email } });
  const user = await prisma.user.create({ data: { email, emailVerified: new Date() }, select: { id: true } });
  await prisma.membership.create({ data: { userId: user.id, projectId: PROJECT, role } });
  const sessionToken = `e2e-r2-mid-${RUN}-${Math.random().toString(36).slice(2)}`;
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 86_400_000) },
  });
  return sessionToken;
}

async function courseId() {
  return (await prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug: SLUG }, select: { id: true } }))
    .id;
}

async function rowOf(userId: string) {
  return prisma.courseEnrollment.findFirstOrThrow({
    where: { userId, course: { projectId: PROJECT, slug: SLUG } },
    select: {
      stagesCompleted: true,
      sectionsCompleted: true,
      simulationChoice: true,
      simulationCorrect: true,
      responses: true,
      completedAt: true,
    },
  });
}

async function storedIds() {
  const course = await prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug: SLUG }, select: { outline: true } });
  return ((course.outline as { sections: { id: string; hidden?: true }[] } | null)?.sections ?? []).map((s) =>
    s.hidden ? `(${s.id})` : s.id
  );
}

// ------------------------------------------------------------------ page ---

const lessonList = (page: Page) => page.getByRole("navigation", { name: /^lessons$/i }).filter({ visible: true });
const announcements = (page: Page) => page.locator("#workspace-announcements").filter({ visible: true });
const stepButtons = (page: Page) =>
  page.getByRole("navigation", { name: /^course stages$/i }).filter({ visible: true }).getByRole("button");
const counter = (page: Page) => page.getByText(/^\d+ \/ \d+ · /).filter({ visible: true });
const continueButton = (page: Page) =>
  page.getByRole("main").getByRole("button", { name: /^continue$/i }).filter({ visible: true });
const NEW_NOTE = "You haven't done this lesson yet. It's new, or it has moved.";
const COUNTS = "2 learners are taking this course (1 finished).";

async function openCourse(page: Page) {
  await page.goto(`/en/content/courses/${SLUG}`);
  await expect(lessonList(page).getByRole("link").first()).toBeVisible({ timeout: 15000 });
}

/** Open "Actions for <label>", retried against the hydration race (pressed only while closed). */
async function openActions(page: Page, label: string): Promise<Locator> {
  const toggle = lessonList(page).getByRole("button", { name: `Actions for ${label}`, exact: true });
  await expect(async () => {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 2000 });
  }).toPass({ timeout: 15000 });
  return lessonList(page).getByRole("group", { name: `Actions for ${label}`, exact: true });
}

/** The learner opens the course where the server says they are. */
async function openAsLearner(page: Page, expected: RegExp | string) {
  await page.goto(`/en/learner/course/${SLUG}`);
  await expect(counter(page)).toHaveText(expected, { timeout: 15000 });
}

/** Continue to step n, retried against the hydration race, never past it. */
async function continueTo(page: Page, n: number) {
  await expect(async () => {
    const at = (await counter(page).textContent())?.trim() ?? "";
    if (at.startsWith(`${n - 1} /`)) await continueButton(page).click();
    await expect(counter(page)).toHaveText(new RegExp(`^${n} / `), { timeout: 5000 });
  }).toPass({ timeout: 20_000 });
}

/** Each learner's progress as staff see it in the facilitator view. */
async function progressSeenByStaff(page: Page, staffSession: string) {
  await signIn(page.context(), staffSession);
  await page.goto("/en/facilitator");
  const pct = async (email: string) => {
    const row = page.locator("li", { hasText: email }).filter({ visible: true });
    await expect(row).toBeVisible({ timeout: 15000 });
    return (await row.textContent())?.match(/(\d+)%/)?.[1] ?? null;
  };
  return { going: await pct(EMAILS.going), finished: await pct(EMAILS.finished) };
}

describe("Release 2 — learners in the middle of a course an editor changes (I-E2, spec 7.4)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  let editor: string;
  let staff: string;
  let going: { userId: string; sessionToken: string };
  let finished: { userId: string; sessionToken: string };

  test.beforeAll(async () => {
    editor = await staffWithSession(EMAILS.editor, "CONTENT_EDITOR");
    staff = await staffWithSession(EMAILS.staff, "FACILITATOR");
    going = await learnerWithSession(prisma, EMAILS.going);
    finished = await learnerWithSession(prisma, EMAILS.finished);
    await seedR2Course(prisma, {
      slug: SLUG,
      title: { en: "E2E Mid-course" },
      lessons: LESSONS,
      outline: { ...outlineOf(LESSONS), removed: ["reflection"] },
    });
    const id = await courseId();
    // Three lessons in, the practice answered (its best option).
    await prisma.courseEnrollment.create({
      data: {
        userId: going.userId,
        courseId: id,
        stagesCompleted: ["CONTEXT", "CONCEPT", "SIMULATION"],
        simulationChoice: "o1",
        simulationCorrect: true,
      },
    });
    // Every lesson done, the course completed.
    await prisma.courseEnrollment.create({
      data: {
        userId: finished.userId,
        courseId: id,
        stagesCompleted: ["CONTEXT", "CONCEPT", "SIMULATION", "BEHAVIOUR", "ASSESSMENT"],
        sectionsCompleted: [NOTES],
        simulationChoice: "o2",
        simulationCorrect: false,
        completedAt: new Date("2026-10-15T10:00:00Z"),
      },
    });
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actor: { is: { email: { in: Object.values(EMAILS) } } } } });
    await removeLearners(prisma, Object.values(EMAILS));
    await removeR2Course(prisma, SLUG);
    await prisma.$disconnect();
  });

  test("reorder: the learner carries on from the first lesson not done; a done one after it is ticked, not reachable; nothing lost", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const before = await rowOf(going.userId);

    // The editor moves the course's own lesson up, before the practice the learner did.
    await signIn(context, editor);
    await openCourse(page);
    const actions = await openActions(page, "4. Your notes");
    await actions.getByRole("button", { name: /^move up$/i }).click();
    const ask = lessonList(page).getByRole("group", { name: "Move “Your notes” in a course learners are taking?" });
    await expect(ask).toContainText(COUNTS);
    await ask.getByRole("button", { name: /^move it$/i }).click();
    await expect(announcements(page)).toHaveText("“Your notes” moved to position 3 of 6.", { timeout: 15000 });
    expect(await storedIds()).toEqual(["context", "concept", NOTES, "simulation", "behaviour", "assessment"]);

    // The learner opens at the first lesson they haven't done, told why it comes now.
    await signIn(context, going.sessionToken);
    await openAsLearner(page, "3 / 6 · Your notes");
    await expect(page.getByRole("main").getByText(NEW_NOTE)).toBeVisible();
    await expect(stepButtons(page)).toHaveCount(6);
    await expect(stepButtons(page).nth(0)).toHaveAccessibleName("Context, done");
    await expect(stepButtons(page).nth(0)).toBeEnabled();
    // Done, but after the first lesson not done: ticked, and not reachable (Q4).
    await expect(stepButtons(page).nth(3)).toHaveAccessibleName("Guided practice, done");
    await expect(stepButtons(page).nth(3)).toBeDisabled();
    await expect(page.getByRole("main").getByRole("button", { name: "Skill concept", exact: true })).toBeEnabled();

    // Nothing of theirs changed, and the percentages are what they were.
    expect(await rowOf(going.userId)).toEqual(before);
    expect(await progressSeenByStaff(page, staff)).toEqual({ going: "50", finished: "100" });
  });

  test("hide a finished lesson: it leaves the step bar, still counts, and what they did in it is kept", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await signIn(context, editor);
    await openCourse(page);
    const actions = await openActions(page, "2. Skill concept");
    await actions.getByRole("button", { name: /^hide$/i }).click();
    const ask = lessonList(page).getByRole("group", { name: "Hide “Skill concept” from learners?" });
    await expect(ask).toContainText(COUNTS);
    await expect(ask).toContainText("still counts towards their progress");
    await ask.getByRole("button", { name: /^hide it$/i }).click();
    await expect(announcements(page)).toHaveText("“Skill concept” is hidden.", { timeout: 15000 });

    await signIn(context, going.sessionToken);
    await openAsLearner(page, "2 / 5 · Your notes");
    await expect(stepButtons(page)).toHaveCount(5);
    await expect(page.getByRole("navigation", { name: /^course stages$/i }).filter({ visible: true })).not.toContainText(
      "Skill concept"
    );
    expect((await rowOf(going.userId)).stagesCompleted).toEqual(["CONTEXT", "CONCEPT", "SIMULATION"]);
    // 5 lessons shown and the hidden one they finished: 3 of 6 done, as before.
    expect(await progressSeenByStaff(page, staff)).toEqual({ going: "50", finished: "100" });
  });

  test("content added to a done lesson: it stays done, its answer is kept, it is drawn anew, and Continue asks for the new question", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    // The editor adds a quick check to the practice lesson the learner did, and saves it for learners.
    await signIn(context, editor);
    await page.goto(`/en/content/courses/${SLUG}?lesson=simulation`);
    const lesson = page.locator("#lesson-simulation").filter({ visible: true });
    await expect(lesson.getByRole("button", { name: /^done$/i })).toBeVisible({ timeout: 15000 });
    const add = lesson.getByRole("button", { name: /^add content after content \d+:/i }).last();
    const choices = lesson.getByText("Choose what to add:").locator("..");
    await expect(async () => {
      if ((await add.getAttribute("aria-expanded")) !== "true") await add.click();
      await expect(choices).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await choices.getByRole("button", { name: "Quick check", exact: true }).click();
    const ask = lesson.getByRole("group", { name: "Add content to “Guided practice”?" });
    await expect(ask).toContainText(COUNTS);
    await ask.getByRole("button", { name: /^add it$/i }).click();
    const quiz = lesson.getByRole("region", { name: /^Quick check · \d+ of \d+/i });
    const question = quiz.getByRole("textbox", { name: /^question 1 question$/i });
    await expect(question).toBeVisible({ timeout: 15000 });
    await question.fill("E2E: added after you did this lesson?");
    await quiz.getByRole("textbox", { name: /^question 1 answer 1$/i }).fill("Yes");
    await quiz.getByRole("textbox", { name: /^question 1 answer 2$/i }).fill("No");
    await quiz.getByRole("radio", { name: /^answer 1 is correct$/i }).check();
    await quiz.getByRole("button", { name: /^save stage$/i }).click();
    await expect(quiz.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });

    // Nobody's progress moved.
    expect(await progressSeenByStaff(page, staff)).toEqual({ going: "50", finished: "100" });

    // The learner carries on: the practice lesson is still done, drawn by
    // the sectioned view now, with their answer.
    await signIn(context, going.sessionToken);
    await openAsLearner(page, "2 / 5 · Your notes");
    await expect(stepButtons(page).nth(2)).toHaveAccessibleName("Guided practice, done");
    await continueTo(page, 3);
    await expect(counter(page)).toHaveText("3 / 5 · Guided practice");
    const main = page.getByRole("main");
    const practice = main.getByRole("region", { name: "Practice question" });
    await expect(practice.getByRole("button", { name: "Let me finish, please." })).toHaveAttribute("aria-pressed", "true");
    await expect(practice.getByText("Clear and calm.")).toBeVisible();
    const added = main.getByRole("region", { name: "Quick check" });
    await expect(added.getByText("E2E: added after you did this lesson?")).toBeVisible();

    // On this visit Continue asks for the new question, and goes on once it's checked.
    await expect(continueButton(page)).toHaveAccessibleDescription("Answer 1 more question, then select “Check answers”.");
    await continueButton(page).click();
    await expect(counter(page)).toHaveText("3 / 5 · Guided practice");
    await added.getByRole("button", { name: /^Yes/ }).click();
    await added.getByRole("button", { name: /^check answers$/i }).click();
    await expect(added.getByText("You got 1 out of 1 right.")).toBeVisible();
    await continueTo(page, 4);
    await expect(counter(page)).toHaveText("4 / 5 · Behaviour model");

    // The practice answer stayed where it always was; the new answer is by lesson and item.
    await expect
      .poll(async () => Object.keys(((await rowOf(going.userId)).responses as { items?: object } | null)?.items ?? {}), {
        timeout: 15000,
      })
      .toEqual([expect.stringMatching(/^simulation\/p-[a-z0-9]{8}$/)]);
    const row = await rowOf(going.userId);
    expect(row.simulationChoice).toBe("o1");
    expect(row.simulationCorrect).toBe(true);
    expect(row.stagesCompleted).toEqual(["CONTEXT", "CONCEPT", "SIMULATION"]);
    expect(row.sectionsCompleted).toEqual([NOTES]);
  });

  test("a lesson inserted before ones done: the learner is taken there and told, their percentage drops as the editor was warned; a finished learner stays at 100%", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const finishedBefore = await rowOf(finished.userId);

    // The editor adds the standard reflection back, at the start.
    await signIn(context, editor);
    await openCourse(page);
    const picker = lessonList(page).getByRole("group", { name: /^add a lesson$/i });
    await expect(async () => {
      if (!(await picker.isVisible())) await lessonList(page).getByRole("button", { name: /^add lesson$/i }).click();
      await expect(picker).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await picker.getByRole("radio", { name: "Add back: Reflection (empty)" }).check();
    await picker.getByRole("combobox").selectOption({ label: "At the start" });
    await picker.getByRole("button", { name: /^add this lesson$/i }).click();
    const ask = lessonList(page).getByRole("group", { name: "Add a lesson to a course learners are taking?" });
    await expect(ask).toContainText(COUNTS);
    await expect(ask).toContainText("those who finished keep their badge and stay at 100%");
    await ask.getByRole("button", { name: /^add it$/i }).click();
    await expect.poll(storedIds, { timeout: 15000 }).toEqual([
      "reflection",
      "context",
      "(concept)",
      NOTES,
      "simulation",
      "behaviour",
      "assessment",
    ]);

    // The learner in progress is taken to it, and told.
    await signIn(context, going.sessionToken);
    await openAsLearner(page, "1 / 6 · Reflection");
    await expect(page.getByRole("main").getByText(NEW_NOTE)).toBeVisible();
    await expect(stepButtons(page).nth(1)).toHaveAccessibleName("Context, done");

    // One more lesson to do: 4 of 7 (6 shown and the hidden one they
    // finished). The learner who finished stays at 100%.
    expect(await progressSeenByStaff(page, staff)).toEqual({ going: "57", finished: "100" });

    // The finished learner's course is still complete: they open it on its completion screen.
    await signIn(context, finished.sessionToken);
    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(page.getByRole("heading", { name: /^course complete/i })).toBeVisible({ timeout: 15000 });
    expect(await rowOf(finished.userId)).toEqual(finishedBefore);
  });
});
