import { test, expect, type Locator, type Page } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson } from "./fixtures/people";
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
 * Release 2 — changing a course people are taking (Stream B, spec 7, D66;
 * B-E1 to B-E6 and B-E8 of spec 10.2).
 *
 * A created course publishes as built: lessons of its own, a hidden one, a
 * new order, added content. Only a list that can't be read or a course with
 * no lesson learners would see is refused, and that refusal is audited. On
 * a course with learners a reorder asks first, inline, with how many
 * learners it touches and how many finished; the confirmed move is audited
 * with that count. A lesson a learner has data in can't be deleted from a
 * published course (Hide is offered instead), while on an unpublished one a
 * lesson nobody has is deleted. A question learners may have answered
 * can't be removed; text can, once confirmed. Remove stage is refused on a
 * lesson of the course's own as on a standard one. The picker warns when a
 * 13th lesson learners see would be added.
 *
 * Learners are counted as D53 counts them: enrolments of LEARNER members,
 * seeded through Prisma with what they did (stagesCompleted for standard
 * lessons, sectionsCompleted for the course's own). Requires a real
 * database — gated on E2E_DB=1. Everything it creates is unique to this run
 * and removed afterwards.
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
const EDITOR = `e2e-r2-live-editor-${RUN}@example.com`;
const LEARNERS = [1, 2, 3].map((n) => `e2e-r2-live-learner${n}-${RUN}@example.com`);
const EMAILS = [EDITOR, ...LEARNERS];

/** B-E1: built like the preview's course, never published. */
const FLEX = `e2e-r2-live-flex-${RUN}`;
/** B-E2: publishable when opened; made unreadable, then empty, behind the page's back. */
const BLOCKED = `e2e-r2-live-blocked-${RUN}`;
/** B-E3: published, two learners (one finished). */
const MOVE = `e2e-r2-live-move-${RUN}`;
/** B-E4: published, a learner with data in the course's own lesson. */
const KEEP = `e2e-r2-live-keep-${RUN}`;
/** B-E4: a draft with a learner who has done only the first lesson. */
const DRAFT = `e2e-r2-live-draft-${RUN}`;
/** B-E5: published, a lesson with added text and a quick check learners get. */
const PARTS = `e2e-r2-live-parts-${RUN}`;
/** B-E6: a lesson of its own whose practice learners get. */
const STAGE = `e2e-r2-live-stage-${RUN}`;
/** B-E8: a draft with twelve lessons learners see. */
const MANY = `e2e-r2-live-many-${RUN}`;
/** Finding 1: published, a learner, no guided practice yet. */
const SLOT = `e2e-r2-live-slot-${RUN}`;
const SLUGS = [FLEX, BLOCKED, MOVE, KEEP, DRAFT, PARTS, STAGE, MANY, SLOT];

const text = (title: string): R2LessonSeed["narrative"] => narrative({ en: { title, text: `E2E ${title} text.` } });
/** A standard text lesson, ready for learners. */
const standardText = (id: string, hidden = false): R2LessonSeed => ({
  id,
  narrative: text(`E2E ${id}`),
  ...(hidden ? { hidden: true } : {}),
});
/** A text lesson of the course's own, named. */
const ownText = (id: string, name: string, hidden = false): R2LessonSeed => ({
  id,
  template: "text",
  label: { en: name },
  narrative: text(name),
  ...(hidden ? { hidden: true } : {}),
});

/**
 * The lesson list as seeded, with the standard text lessons it leaves out
 * deleted: a standard text lesson missing from a stored list is put back
 * (outline.ts resolveOutline), and would be one more lesson learners see.
 */
function listOf(lessons: readonly R2LessonSeed[], hidden: readonly string[] = []) {
  const list = outlineOf(lessons.map((l) => (hidden.includes(l.id) ? { ...l, hidden: true } : l)));
  const removed = ["context", "concept", "behaviour", "reflection"].filter((k) => !lessons.some((l) => l.id === k));
  return { ...list, ...(removed.length ? { removed } : {}) };
}

/** Seed a course whose stored list is exactly its lessons (listOf). */
const seed = (slug: string, status: "draft" | "published", lessons: R2LessonSeed[]) =>
  seedR2Course(prisma, { slug, status, lessons, outline: listOf(lessons) });

/** A CONTENT_EDITOR of the project with a session, as a sign-in leaves it. */
async function editorWithSession(email: string) {
  await prisma.user.deleteMany({ where: { email } });
  const { userId, sessionToken } = await createPerson(prisma, { email, roles: ["CONTENT_EDITOR"] });
  return { userId, sessionToken };
}

/** Enrol a learner with what they did: standard lessons, the course's own, finished or not. */
async function enrol(
  userId: string,
  slug: string,
  did: { stages?: string[]; own?: string[]; finished?: boolean } = {}
) {
  const course = await prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug }, select: { id: true } });
  await prisma.courseEnrollment.create({
    data: {
      userId,
      courseId: course.id,
      stagesCompleted: (did.stages ?? []).map((k) => k.toUpperCase()) as never,
      ...(did.own ? { sectionsCompleted: did.own } : {}),
      ...(did.finished ? { completedAt: new Date() } : {}),
    },
  });
}

async function storedOutline(slug: string) {
  const course = await prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug }, select: { outline: true } });
  return course.outline as { sections: { id: string; hidden?: true }[]; removed?: string[] } | null;
}
const ids = async (slug: string) => (await storedOutline(slug))?.sections.map((s) => s.id) ?? [];

async function statusOf(slug: string) {
  return (await prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug }, select: { status: true } }))
    .status;
}

const lessonList = (page: Page) => page.getByRole("navigation", { name: /^lessons$/i }).filter({ visible: true });
const publishing = (page: Page) => page.getByRole("region", { name: /^publishing$/i }).filter({ visible: true });
const announcements = (page: Page) => page.locator("#workspace-announcements").filter({ visible: true });

async function openCourse(page: Page, slug: string) {
  await page.goto(`/en/content/courses/${slug}`);
  await expect(lessonList(page).getByRole("link").first()).toBeVisible({ timeout: 15000 });
}

/** One lesson on the course page, opened by ?lesson= (visible only: a streamed copy can stay behind). */
async function openLesson(page: Page, slug: string, key: string) {
  await page.goto(`/en/content/courses/${slug}?lesson=${key}`);
  const lesson = page.locator(`#lesson-${key}`).filter({ visible: true });
  await expect(lesson.getByRole("button", { name: /^done$/i })).toBeVisible({ timeout: 15000 });
  return lesson;
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

/** Open "Add lesson" (retried the same way); returns the picker. */
async function openPicker(page: Page): Promise<Locator> {
  const picker = lessonList(page).getByRole("group", { name: /^add a lesson$/i });
  await expect(async () => {
    if (!(await picker.isVisible())) await lessonList(page).getByRole("button", { name: /^add lesson$/i }).click();
    await expect(picker).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  return picker;
}

async function auditOf(action: string, entityId: string) {
  return prisma.auditLog.findMany({
    where: { projectId: PROJECT, action, entityId },
    orderBy: { createdAt: "asc" },
    select: { metadata: true },
  });
}

describe("Release 2 — changing a course people are taking", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  let editorSession: string;
  const learner: string[] = [];
  const OWN_FLEX = ownLessonId();
  const OWN_KEEP = ownLessonId();
  const OWN_STAGE = ownLessonId();

  test.beforeAll(async () => {
    editorSession = (await editorWithSession(EDITOR)).sessionToken;
    for (const email of LEARNERS) learner.push((await learnerWithSession(prisma, email)).userId);

    await seed(FLEX, "draft", [
      standardText("context", true),
      {
        id: "concept",
        narrative: text("E2E concept"),
        parts: [parts.text({ en: "E2E added text." }), parts.quiz("E2E: added check?")],
      },
      { id: "scenario", structure: structures.scenario() },
      standardText("behaviour"),
      ownText(OWN_FLEX, "Wrap-up"),
      standardText("reflection"),
    ]);
    await seed(BLOCKED, "draft", [standardText("context"), standardText("concept")]);

    await seed(MOVE, "published", [standardText("context"), standardText("concept"), standardText("behaviour")]);
    await enrol(learner[0], MOVE, { stages: ["context"] });
    await enrol(learner[1], MOVE, { stages: ["context", "concept", "behaviour"], finished: true });

    await seed(KEEP, "published", [standardText("context"), standardText("concept"), ownText(OWN_KEEP, "Wrap-up")]);
    await enrol(learner[0], KEEP, { stages: ["context", "concept"], own: [OWN_KEEP] });

    await seed(DRAFT, "draft", [standardText("context"), standardText("concept"), standardText("behaviour")]);
    await enrol(learner[0], DRAFT, { stages: ["context"] });

    await seed(PARTS, "published", [
      standardText("context"),
      {
        id: "concept",
        narrative: text("E2E concept"),
        parts: [parts.text({ en: "E2E text to remove." }), parts.quiz("E2E: a question learners answer")],
      },
    ]);
    await enrol(learner[0], PARTS, { stages: ["context"] });

    await seed(STAGE, "published", [
      standardText("context"),
      {
        id: OWN_STAGE,
        template: "practice",
        label: { en: "Own practice" },
        structure: structures.simulation("E2E own: you're cut off."),
      },
    ]);
    await enrol(learner[0], STAGE, { stages: ["context"] });

    await seed(
      MANY,
      "draft",
      Array.from({ length: 12 }, (_, i) => ownText(ownLessonId(), `Lesson ${i + 1}`))
    );

    await seed(SLOT, "published", [standardText("context"), standardText("concept"), standardText("behaviour")]);
    await enrol(learner[2], SLOT, { stages: ["context"] });
  });

  test.afterAll(async () => {
    // Audit rows of this run's editor (a constant email, never an empty filter).
    await prisma.auditLog.deleteMany({ where: { actor: { is: { email: { in: EMAILS } } } } });
    // Users first: their enrolments cascade away with them.
    await removeLearners(prisma, EMAILS);
    for (const slug of SLUGS) await removeR2Course(prisma, slug);
    await prisma.$disconnect();
  });

  test("a course with an own lesson, a hidden lesson, a new order and extra content publishes", async ({
    page,
    context,
  }) => {
    await signIn(context, editorSession);
    await openCourse(page, FLEX);
    const region = publishing(page);
    // Nothing holds it back: no reasons, nothing about a later date.
    await expect(region.getByText("Can't publish yet")).toHaveCount(0);
    await expect(region.getByText(/is a new lesson|is hidden|new order|has added content/)).toHaveCount(0);
    const publish = region.getByRole("button", { name: /^publish$/i });
    await expect(publish).not.toHaveAttribute("aria-disabled", "true");
    await openActions(page, "1. Skill concept"); // hydrated

    await publish.click();
    await expect(region.getByText(/^published$/i)).toBeVisible({ timeout: 15000 });
    expect(await statusOf(FLEX)).toBe("published");
    // The lesson list is as built: nothing was undone to publish it.
    const built = await storedOutline(FLEX);
    expect(built?.sections.map((s) => s.id)).toEqual(["context", "concept", "scenario", "behaviour", OWN_FLEX, "reflection"]);
    expect(built?.sections[0].hidden).toBe(true);
  });

  test("an unreadable list and an empty course are refused, and the refusal is audited", async ({
    page,
    context,
  }) => {
    await signIn(context, editorSession);
    const region = publishing(page);
    const publish = region.getByRole("button", { name: /^publish$/i });

    // Opened while publishable; then the list becomes unreadable behind the page's back.
    await openCourse(page, BLOCKED);
    await expect(publish).not.toHaveAttribute("aria-disabled", "true");
    await openActions(page, "1. Context"); // hydrated
    await prisma.course.updateMany({ where: { projectId: PROJECT, slug: BLOCKED }, data: { outline: { v: 2 } } });
    await publish.click();
    await expect(region.getByRole("alert")).toContainText("This course wasn't published: learners couldn't take it as it is now.", {
      timeout: 15000,
    });
    await expect(region.getByText("The lesson list can't be read")).toBeVisible({ timeout: 15000 });
    await expect(publish).toHaveAttribute("aria-disabled", "true", { timeout: 15000 });
    expect(await statusOf(BLOCKED)).toBe("draft");
    await expect
      .poll(async () => (await auditOf("course.publish_refused", BLOCKED)).map((r) => r.metadata))
      .toEqual([{ error: "cannot-publish", reasons: [{ code: "unreadable" }] }]);

    // Readable again, and opened while publishable; then every lesson is hidden.
    await prisma.course.updateMany({
      where: { projectId: PROJECT, slug: BLOCKED },
      data: { outline: listOf([standardText("context"), standardText("concept")]) as Prisma.InputJsonValue },
    });
    await openCourse(page, BLOCKED);
    await expect(publish).not.toHaveAttribute("aria-disabled", "true");
    await openActions(page, "1. Context"); // hydrated
    await prisma.course.updateMany({
      where: { projectId: PROJECT, slug: BLOCKED },
      data: {
        outline: listOf([standardText("context"), standardText("concept")], ["context", "concept"]) as Prisma.InputJsonValue,
      },
    });
    await publish.click();
    await expect(region.getByRole("alert")).toContainText("This course wasn't published: learners couldn't take it as it is now.", {
      timeout: 15000,
    });
    await expect(region.getByText("No lesson has anything learners can see yet")).toBeVisible({ timeout: 15000 });
    expect(await statusOf(BLOCKED)).toBe("draft");
    await expect
      .poll(async () => (await auditOf("course.publish_refused", BLOCKED)).map((r) => r.metadata))
      .toEqual([
        { error: "cannot-publish", reasons: [{ code: "unreadable" }] },
        { error: "cannot-publish", reasons: [{ code: "no-lessons" }] },
      ]);

    // A page that knows says so before anything is pressed, and takes focus to the reason.
    await openCourse(page, BLOCKED);
    await expect(region.getByText("Can't publish yet")).toBeVisible();
    await expect(publish).toHaveAttribute("aria-disabled", "true");
    await expect(publish).toHaveAccessibleDescription(/can't publish yet/i);
  });

  test("a reorder on a course with a learner asks first, shows the count, and is audited", async ({
    page,
    context,
  }) => {
    await signIn(context, editorSession);
    await openCourse(page, MOVE);
    const actions = await openActions(page, "1. Context");
    // Before it is pressed, it says how many learners it touches.
    await expect(actions.getByRole("button", { name: /^move down$/i })).toHaveAccessibleDescription(
      "2 learners are taking this course (1 finished)."
    );
    await actions.getByRole("button", { name: /^move down$/i }).click();

    // Asked in place: what it is, how many learners, what they notice.
    const ask = lessonList(page).getByRole("group", { name: "Move “Context” in a course learners are taking?" });
    await expect(ask.getByRole("heading")).toBeFocused();
    await expect(ask).toContainText("2 learners are taking this course (1 finished).");
    await expect(ask).toContainText("Their progress is kept.");
    // Escape leaves everything as it was, focus back on the row's Actions button.
    await page.keyboard.press("Escape");
    await expect(ask).toHaveCount(0);
    await expect(lessonList(page).getByRole("button", { name: "Actions for 1. Context", exact: true })).toBeFocused();
    expect(await ids(MOVE)).toEqual(["context", "concept", "behaviour"]);
    expect(await auditOf("section.moved", MOVE)).toEqual([]);

    // Confirmed: moved, announced, audited with the count the server found.
    await actions.getByRole("button", { name: /^move down$/i }).click();
    await ask.getByRole("button", { name: /^move it$/i }).click();
    await expect(announcements(page)).toHaveText("“Context” moved to position 2 of 3.", { timeout: 15000 });
    expect(await ids(MOVE)).toEqual(["concept", "context", "behaviour"]);
    const [moved] = await auditOf("section.moved", MOVE);
    expect(moved.metadata).toMatchObject({ sectionId: "context", learners: 2, confirmed: true });
  });

  test("deleting an own lesson with learner data on a published course is refused and Hide is offered; on an unpublished course with learners, a lesson nobody has is deleted", async ({
    page,
    context,
  }) => {
    await signIn(context, editorSession);
    await openCourse(page, KEEP);
    const own = await openActions(page, "3. Wrap-up");
    await own.getByRole("button", { name: /^delete$/i }).click();
    const confirm = lessonList(page).getByRole("group", { name: "Delete “Wrap-up” in all languages?" });
    await expect(confirm.getByRole("heading")).toBeFocused();
    const blocked = "1 learner has started this course, so this lesson can't be deleted. You can hide it instead.";
    await expect(confirm).toContainText(blocked);
    const del = confirm.getByRole("button", { name: /^delete lesson$/i });
    await expect(del).toHaveAttribute("aria-disabled", "true");
    await expect(del).toHaveAccessibleDescription(blocked);
    // Pressed anyway (by keyboard: an aria-disabled button stays focusable): nothing goes.
    await del.focus();
    await page.keyboard.press("Enter");
    expect(await ids(KEEP)).toContain(OWN_KEEP);

    // Hide instead: asked first, as any change on a course with learners.
    await confirm.getByRole("button", { name: /^hide it$/i }).click();
    const ask = lessonList(page).getByRole("group", { name: "Hide “Wrap-up” from learners?" });
    await expect(ask).toContainText("1 learner is taking this course (0 finished).");
    await ask.getByRole("button", { name: /^hide it$/i }).click();
    await expect(announcements(page)).toHaveText("“Wrap-up” is hidden.", { timeout: 15000 });
    expect((await storedOutline(KEEP))?.sections.find((s) => s.id === OWN_KEEP)?.hidden).toBe(true);
    expect(await prisma.lesson.count({ where: { projectId: PROJECT, courseSlug: KEEP, stageKey: OWN_KEEP } })).toBe(1);

    // A draft with a learner: the lesson they did stays; one nobody has goes.
    await openCourse(page, DRAFT);
    const done = await openActions(page, "1. Context");
    await done.getByRole("button", { name: /^delete$/i }).click();
    const keep = lessonList(page).getByRole("group", { name: "Delete “Context” in all languages?" });
    // Whose work keeps it: that lesson's, not the course's.
    await expect(keep).toContainText(
      "1 learner has already worked on this lesson, so it can't be deleted. You can hide it instead."
    );
    await expect(keep.getByRole("button", { name: /^delete lesson$/i })).toHaveAttribute("aria-disabled", "true");
    await keep.getByRole("button", { name: /^keep it$/i }).click();

    const nobody = await openActions(page, "3. Behaviour model");
    await nobody.getByRole("button", { name: /^delete$/i }).click();
    const go = lessonList(page).getByRole("group", { name: "Delete “Behaviour model” in all languages?" });
    await go.getByRole("button", { name: /^delete lesson$/i }).click();
    await expect(announcements(page)).toHaveText(/^“Behaviour model” deleted\./, { timeout: 15000 });
    expect(await ids(DRAFT)).toEqual(["context", "concept"]);
    expect(
      await prisma.lesson.count({ where: { projectId: PROJECT, courseSlug: DRAFT, stageKey: "behaviour" } })
    ).toBe(0);
  });

  test("a question learners may have answered can't be removed; text can, after confirming", async ({
    page,
    context,
  }) => {
    await signIn(context, editorSession);
    const lesson = await openLesson(page, PARTS, "concept");
    const quiz = lesson.getByRole("group", { name: /^content 3 of 3: quick check$/i });
    const removeQuiz = quiz.getByRole("button", { name: /^remove content 3: quick check$/i });
    await expect(removeQuiz).toHaveAttribute("aria-disabled", "true");
    await expect(removeQuiz).toHaveAccessibleDescription(
      "Learners are taking this course, so a question they may have answered can't be removed. You can still edit it."
    );
    // Pressed anyway: no question asked, nothing removed.
    let dialogs = 0;
    page.on("dialog", (dialog) => {
      dialogs++;
      void dialog.dismiss();
    });
    await removeQuiz.focus();
    await page.keyboard.press("Enter");
    expect(dialogs).toBe(0);

    // The text asks first, with the count, then goes.
    const textPart = lesson.getByRole("group", { name: /^content 2 of 3: text$/i });
    const removeText = textPart.getByRole("button", { name: /^remove content 2: text$/i });
    await removeText.click();
    const ask = lesson.getByRole("group", { name: "Remove this text from “Skill concept”?" });
    await expect(ask.getByRole("heading")).toBeFocused();
    await expect(ask).toContainText("1 learner is taking this course (0 finished).");
    // Escape leaves it, focus back on the Remove that asked.
    await page.keyboard.press("Escape");
    await expect(ask).toHaveCount(0);
    await expect(removeText).toBeFocused();
    await removeText.click();
    await ask.getByRole("button", { name: /^remove it$/i }).click();
    await expect(lesson.getByRole("group", { name: /^content 2 of 2: quick check$/i })).toBeVisible({
      timeout: 15000,
    });
    expect(dialogs).toBe(0);
    const row = await prisma.lesson.findUniqueOrThrow({
      where: { projectId_courseSlug_stageKey: { projectId: PROJECT, courseSlug: PARTS, stageKey: "concept" } },
      select: { parts: true },
    });
    expect((row.parts as { items: { type: string }[] }).items.map((i) => i.type)).toEqual(["main", "quiz"]);
    const [removed] = await prisma.auditLog.findMany({
      where: { projectId: PROJECT, action: "part.removed", entityId: `${PARTS}:concept` },
      select: { metadata: true },
    });
    expect(removed.metadata).toMatchObject({ learners: 1, confirmed: true });
  });

  test("Remove stage on an own lesson with learners is refused", async ({ page, context }) => {
    await signIn(context, editorSession);
    const lesson = await openLesson(page, STAGE, OWN_STAGE);
    const panel = lesson.getByRole("region", { name: /^interactive stage — /i });
    await expect(panel.getByRole("button", { name: /^remove stage$/i })).toBeVisible({ timeout: 15000 });
    page.once("dialog", (dialog) => void dialog.accept());
    await panel.getByRole("button", { name: /^remove stage$/i }).click();
    await expect(panel.getByRole("alert")).toContainText(/1 learner is enrolled/i, { timeout: 15000 });
    const row = await prisma.lesson.findUniqueOrThrow({
      where: { projectId_courseSlug_stageKey: { projectId: PROJECT, courseSlug: STAGE, stageKey: OWN_STAGE } },
      select: { structure: true },
    });
    expect(row.structure, "learners keep the practice").not.toBeNull();
  });

  // Found at integration review (finding 1): the first "Save stage" of
  // "Add guided practice" adds the lesson to what learners get, and asked
  // nothing — the picker's route to the same lesson asks first. Red on
  // Release 1, which saved it straight away.
  test("Add guided practice on a course with a learner asks first when it is saved, and is audited", async ({
    page,
    context,
  }) => {
    await signIn(context, editorSession);
    await openCourse(page, SLOT);
    const slot = lessonList(page).getByRole("button", { name: /^add guided practice$/i });
    // Nothing is asked to open it: only the save would add the lesson.
    await expect(slot).not.toHaveAttribute("aria-disabled", "true");
    const lesson = page.locator("#lesson-simulation").filter({ visible: true });
    const panel = lesson.getByRole("region", { name: /^interactive stage — /i });
    const prompt = panel.getByRole("textbox", { name: /^prompt/i });
    await expect(async () => {
      if (!(await prompt.isVisible())) await slot.click();
      await expect(prompt).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await prompt.fill("E2E slot: a colleague asks for help.");
    await panel.getByRole("textbox", { name: /^option 1 option text$/i }).fill("Ask what they tried");
    await panel.getByRole("textbox", { name: /^option 2 option text$/i }).fill("Do it for them");
    const save = panel.getByRole("button", { name: /^save stage$/i });
    await save.click();

    // Asked in place, with the server's count and what learners notice.
    const ask = lesson.getByRole("group", { name: "Add a lesson to a course learners are taking?" });
    await expect(ask.getByRole("heading")).toBeFocused({ timeout: 15000 });
    await expect(ask).toContainText("1 learner is taking this course (0 finished).");
    await expect(ask).toContainText("Learners who haven't finished will have one more lesson to do");
    const practice = () =>
      prisma.lesson.findFirst({
        where: { projectId: PROJECT, courseSlug: SLOT, stageKey: "simulation" },
        select: { structure: true },
      });
    // Escape: nothing saved, focus back on "Save stage".
    await page.keyboard.press("Escape");
    await expect(ask).toHaveCount(0);
    await expect(save).toBeFocused();
    expect((await practice())?.structure ?? null).toBeNull();

    // Confirmed: saved, in the list, audited with the count.
    await save.click();
    await ask.getByRole("button", { name: /^add it$/i }).click();
    await expect(lessonList(page).getByRole("link", { name: /^4\. Guided practice$/ })).toBeVisible({ timeout: 15000 });
    expect((await practice())?.structure).toBeTruthy();
    const [saved] = await auditOf("structure.saved", `${SLOT}:simulation`);
    expect(saved.metadata).toMatchObject({ kind: "simulation", added: true, learners: 1, confirmed: true });
  });

  test("the 13th visible lesson warns", async ({ page, context }) => {
    await signIn(context, editorSession);
    const warning = /^Learners would see more than 12 lessons in this course\. Check that they need them all\.$/;

    // Twelve lessons learners see: the next one is the 13th.
    await openCourse(page, MANY);
    let picker = await openPicker(page);
    await expect(picker.getByText(warning)).toBeVisible();

    // One of them hidden: the next one is the 12th learners see (13 in the list).
    const saved = (await storedOutline(MANY))!;
    await prisma.course.updateMany({
      where: { projectId: PROJECT, slug: MANY },
      data: {
        outline: {
          ...saved,
          sections: saved.sections.map((s, i) => (i === 0 ? { ...s, hidden: true } : s)),
        } as Prisma.InputJsonValue,
      },
    });
    await openCourse(page, MANY);
    picker = await openPicker(page);
    await expect(picker.getByRole("radio", { name: /^text$/i })).toBeVisible();
    await expect(picker.getByText(warning)).toHaveCount(0);
  });
});
