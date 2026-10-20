import { test, expect, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PROJECT,
  learnerWithSession,
  narrative,
  outlineOf,
  parts,
  removeLearners,
  removeR2Course,
  runId,
  seedR2Course,
  signIn,
  type R2LessonSeed,
} from "./fixtures/r2-course";

/**
 * Release 2 — no restructuring of live courses from the cut-off (D67, spec
 * 7.2; B-E7 of spec 10.2). Runs only in the `cutoff` project, against the
 * second server of playwright.config.ts, whose RESTRUCTURE_CLOSED_FROM is in
 * the past (1 January 2020): every published course with learners is past
 * its cut-off there.
 *
 * Moving a lesson, adding one, and adding content are refused with the
 * date, on the page and by the server (a page opened before the course had
 * learners); Hide still works, asking first.
 *
 * Settled at integration (owner's standing instruction): the rule holds
 * for any course with learners, whatever its status, so unpublishing a
 * course, reworking it and publishing it again doesn't get round it. The
 * second test unpublishes a live course and finds it closed all the same,
 * on the page and by the server. Red on Release 1, which has no cut-off
 * and lets a course that isn't published take any change; red on Stream
 * B's rule, which closed only published courses.
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
const EDITOR = `e2e-r2-cutoff-editor-${RUN}@example.com`;
const LEARNER = `e2e-r2-cutoff-learner-${RUN}@example.com`;
const EMAILS = [EDITOR, LEARNER];
/** Published, with a learner from the start. */
const CLOSED = `e2e-r2-cutoff-${RUN}`;
/** Published; its learner arrives after the page opened. */
const STALE = `e2e-r2-cutoff-stale-${RUN}`;
/** Published with a learner, then unpublished on the page (D67's way round). */
const UNPUBLISHED = `e2e-r2-cutoff-unpub-${RUN}`;
/** Not published; its learner arrives after the page opened. */
const STALE_DRAFT = `e2e-r2-cutoff-stale-draft-${RUN}`;
/** Published with a learner, no guided practice: its "Add guided practice" would add a lesson. */
const SLOT = `e2e-r2-cutoff-slot-${RUN}`;
/** Published; its learner arrives while the editor writes its guided practice. */
const SLOT_STALE = `e2e-r2-cutoff-slot-stale-${RUN}`;
const SLUGS = [CLOSED, STALE, UNPUBLISHED, STALE_DRAFT, SLOT, SLOT_STALE];

/** liveChanges.closed with the cut-off of the `cutoff` server, as the page says it in English. */
const CLOSED_TEXT =
  "From 1 January 2020, lessons and content in a course with learners can't be added, moved or removed, even while it isn't published. You can still hide or show lessons, rename them, and edit text and questions.";

const lesson = (id: string): R2LessonSeed => ({
  id,
  narrative: narrative({ en: { title: `E2E ${id}`, text: `E2E ${id} text.` } }),
});

/** Seed a course whose stored list is exactly its lessons: the standard text lessons it leaves out are deleted. */
function seed(slug: string, lessons: R2LessonSeed[], status: "draft" | "published" = "published") {
  const removed = ["context", "concept", "behaviour", "reflection"].filter((k) => !lessons.some((l) => l.id === k));
  return seedR2Course(prisma, {
    slug,
    status,
    lessons,
    outline: { ...outlineOf(lessons), ...(removed.length ? { removed } : {}) },
  });
}

async function editorWithSession(email: string) {
  await prisma.user.deleteMany({ where: { email } });
  const user = await prisma.user.create({ data: { email, emailVerified: new Date() }, select: { id: true } });
  await prisma.membership.create({ data: { userId: user.id, projectId: PROJECT, role: "CONTENT_EDITOR" } });
  const sessionToken = `e2e-r2-cutoff-${RUN}-${Math.random().toString(36).slice(2)}`;
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 86_400_000) },
  });
  return sessionToken;
}

async function enrol(userId: string, slug: string) {
  const course = await prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug }, select: { id: true } });
  await prisma.courseEnrollment.create({
    data: { userId, courseId: course.id, stagesCompleted: ["CONTEXT"] },
  });
}

async function storedOutline(slug: string) {
  const course = await prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug }, select: { outline: true } });
  return course.outline as { sections: { id: string; hidden?: true }[] } | null;
}
const ids = async (slug: string) => (await storedOutline(slug))?.sections.map((s) => s.id) ?? [];

const lessonList = (page: Page) => page.getByRole("navigation", { name: /^lessons$/i }).filter({ visible: true });
const announcements = (page: Page) => page.locator("#workspace-announcements").filter({ visible: true });

async function openCourse(page: Page, slug: string, query = "") {
  await page.goto(`/en/content/courses/${slug}${query}`);
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

describe("Release 2 — the 1 December cut-off", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  let editorSession: string;
  let learnerId: string;

  test.beforeAll(async () => {
    editorSession = await editorWithSession(EDITOR);
    learnerId = (await learnerWithSession(prisma, LEARNER)).userId;
    await seed(CLOSED, [
      lesson("context"),
      { ...lesson("concept"), parts: [parts.text({ en: "E2E added text." })] },
      lesson("behaviour"),
    ]);
    await enrol(learnerId, CLOSED);
    await seed(STALE, [lesson("context"), lesson("concept")]);
    await seed(UNPUBLISHED, [lesson("context"), lesson("concept"), lesson("behaviour")]);
    await enrol(learnerId, UNPUBLISHED);
    await seed(STALE_DRAFT, [lesson("context"), lesson("concept")], "draft");
    await seed(SLOT, [lesson("context"), lesson("concept"), lesson("behaviour")]);
    await enrol(learnerId, SLOT);
    await seed(SLOT_STALE, [lesson("context"), lesson("concept"), lesson("behaviour")]);
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actor: { is: { email: { in: EMAILS } } } } });
    await removeLearners(prisma, EMAILS);
    for (const slug of SLUGS) await removeR2Course(prisma, slug);
    await prisma.$disconnect();
  });

  test("moves are refused with the date; Hide is allowed", async ({ page, context }) => {
    await signIn(context, editorSession);
    await openCourse(page, CLOSED, "?lesson=concept");

    // The page knows: moving and adding say why, with the date.
    const actions = await openActions(page, "1. Context");
    const down = actions.getByRole("button", { name: /^move down$/i });
    await expect(down).toHaveAttribute("aria-disabled", "true");
    await expect(down).toHaveAccessibleDescription(CLOSED_TEXT);
    // Pressed anyway (by keyboard: it stays focusable), nothing moves.
    await down.focus();
    await page.keyboard.press("Enter");
    const add = lessonList(page).getByRole("button", { name: /^add lesson$/i });
    await expect(add).toHaveAttribute("aria-disabled", "true");
    await expect(add).toHaveAccessibleDescription(CLOSED_TEXT);
    // Content too: Add content is refused with the same words.
    const concept = page.locator("#lesson-concept").filter({ visible: true });
    const addContent = concept.getByRole("button", { name: /^add content after content 1:/i });
    await expect(addContent).toHaveAttribute("aria-disabled", "true");
    await expect(addContent).toHaveAccessibleDescription(CLOSED_TEXT);
    expect(await ids(CLOSED)).toEqual(["context", "concept", "behaviour"]);

    // Hide still works, asking first.
    const hide = actions.getByRole("button", { name: /^hide$/i });
    await expect(hide).not.toHaveAttribute("aria-disabled", "true");
    await hide.click();
    const ask = lessonList(page).getByRole("group", { name: "Hide “Context” from learners?" });
    await expect(ask).toContainText("1 learner is taking this course (0 finished).");
    await ask.getByRole("button", { name: /^hide it$/i }).click();
    await expect(announcements(page)).toHaveText("“Context” is hidden.", { timeout: 15000 });
    expect((await storedOutline(CLOSED))?.sections[0]).toMatchObject({ id: "context", hidden: true });

    // A page opened before the course had learners: the server refuses the move, with the date.
    await openCourse(page, STALE);
    const stale = await openActions(page, "1. Context");
    const move = stale.getByRole("button", { name: /^move down$/i });
    await expect(move).not.toHaveAttribute("aria-disabled", "true");
    await enrol(learnerId, STALE);
    await move.click();
    await expect(lessonList(page).getByRole("alert")).toHaveText(CLOSED_TEXT, { timeout: 15000 });
    expect(await ids(STALE)).toEqual(["context", "concept"]);
  });

  // Found at integration review (finding 1): "Add guided practice" (and
  // scenario, quick check) opens the exercise editor, whose first "Save
  // stage" adds the lesson to what learners get. Release 2 as built asked
  // nothing of it: from the cut-off a course with learners gained a lesson.
  // Red on Release 1, which has no cut-off.
  test("Add guided practice is refused with the date, in the list and on its card; a page from before the course had learners is refused on Save stage", async ({
    page,
    context,
  }) => {
    await signIn(context, editorSession);
    await openCourse(page, SLOT);
    const slot = lessonList(page).getByRole("button", { name: /^add guided practice$/i });
    await expect(slot).toHaveAttribute("aria-disabled", "true");
    await expect(slot).toHaveAccessibleDescription(CLOSED_TEXT);
    const card = page.locator("#lesson-simulation").filter({ visible: true });
    const cardAdd = card.getByRole("button", { name: /^add guided practice$/i });
    await expect(cardAdd).toHaveAttribute("aria-disabled", "true");
    await expect(cardAdd).toHaveAccessibleDescription(CLOSED_TEXT);
    // Pressed anyway (by keyboard: it stays focusable), no editor opens.
    await slot.focus();
    await page.keyboard.press("Enter");
    await cardAdd.focus();
    await page.keyboard.press("Enter");
    await expect(card.getByRole("region", { name: /^interactive stage — /i })).toHaveCount(0);

    // A page opened before the course had learners: the editor opens, and
    // the server refuses its "Save stage", with the date.
    await openCourse(page, SLOT_STALE);
    const staleSlot = lessonList(page).getByRole("button", { name: /^add guided practice$/i });
    const stale = page.locator("#lesson-simulation").filter({ visible: true });
    const panel = stale.getByRole("region", { name: /^interactive stage — /i });
    const prompt = panel.getByRole("textbox", { name: /^prompt/i });
    await expect(async () => {
      if (!(await prompt.isVisible())) await staleSlot.click();
      await expect(prompt).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await prompt.fill("E2E cut-off: a colleague asks for help.");
    await panel.getByRole("textbox", { name: /^option 1 option text$/i }).fill("Ask what they tried");
    await panel.getByRole("textbox", { name: /^option 2 option text$/i }).fill("Do it for them");
    await enrol(learnerId, SLOT_STALE);
    await panel.getByRole("button", { name: /^save stage$/i }).click();
    await expect(panel.getByRole("alert").filter({ hasText: CLOSED_TEXT })).toBeVisible({ timeout: 15000 });
    const row = await prisma.lesson.findFirst({
      where: { projectId: PROJECT, courseSlug: SLOT_STALE, stageKey: "simulation" },
      select: { structure: true },
    });
    expect(row?.structure ?? null, "no guided practice was added").toBeNull();
    expect(await ids(SLOT_STALE)).toEqual(["context", "concept", "behaviour"]);
  });

  test("unpublishing doesn't get round it: a course with learners keeps its shape, published or not", async ({
    page,
    context,
  }) => {
    await signIn(context, editorSession);
    await openCourse(page, UNPUBLISHED);

    // Unpublished on the page, to rework it.
    const publishing = page.getByRole("region", { name: /^publishing$/i });
    await publishing.getByRole("button", { name: /^unpublish$/i }).click();
    await publishing.getByRole("button", { name: /^yes, unpublish$/i }).click();
    await expect(publishing.getByText(/^draft$/i)).toBeVisible({ timeout: 15000 });
    await expect
      .poll(async () => (await prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug: UNPUBLISHED } })).status)
      .toBe("draft");

    // Still closed: no move, no new lesson, no delete of a lesson nobody
    // has anything in — each says why, with the date.
    const actions = await openActions(page, "2. Skill concept");
    const down = actions.getByRole("button", { name: /^move down$/i });
    await expect(down).toHaveAttribute("aria-disabled", "true");
    await expect(down).toHaveAccessibleDescription(CLOSED_TEXT);
    const add = lessonList(page).getByRole("button", { name: /^add lesson$/i });
    await expect(add).toHaveAttribute("aria-disabled", "true");
    await expect(add).toHaveAccessibleDescription(CLOSED_TEXT);
    const del = actions.getByRole("button", { name: /^delete$/i });
    await expect(del).toHaveAttribute("aria-disabled", "true");
    await expect(del).toHaveAccessibleDescription(CLOSED_TEXT);
    // Pressed anyway (by keyboard: it stays focusable), nothing moves.
    await down.focus();
    await page.keyboard.press("Enter");
    // Hide stays open.
    await expect(actions.getByRole("button", { name: /^hide$/i })).not.toHaveAttribute("aria-disabled", "true");
    expect(await ids(UNPUBLISHED)).toEqual(["context", "concept", "behaviour"]);

    // A page opened while the unpublished course had no learners: the server refuses, with the date.
    await openCourse(page, STALE_DRAFT);
    const stale = await openActions(page, "1. Context");
    const move = stale.getByRole("button", { name: /^move down$/i });
    await expect(move).not.toHaveAttribute("aria-disabled", "true");
    await enrol(learnerId, STALE_DRAFT);
    await move.click();
    await expect(lessonList(page).getByRole("alert")).toHaveText(CLOSED_TEXT, { timeout: 15000 });
    expect(await ids(STALE_DRAFT)).toEqual(["context", "concept"]);
  });
});
