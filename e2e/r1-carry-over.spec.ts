import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Release 1 — a course built on Release 0 carries over unchanged (D56, spec
 * 13.2 item 4). It is seeded as Release 0 left it: rich text in the context
 * and skill concept with a German translation, a scenario saved for learners
 * with a draft beside it, a quick check saved before the size limits and
 * over one of them, a video and two documents — and no lesson list or added
 * content stored (`outline` and `parts` empty).
 *
 * The course page shows the same lessons, in the same order and with the
 * same numbers, the draft mark, the video and the documents, and still
 * offers "Add guided practice" for the missing practice. "Save stage" on the
 * old quick check still works after a small fix. Adding a quick check to
 * the skill concept and removing it again leaves nothing stored, and the
 * course stays in the standard layout. Throughout, the stored main content
 * stays byte for byte what it was, except where a save was made on purpose.
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

const PROJECT = "seq-elevate";
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const EDITOR = `e2e-r1-carry-editor-${RUN}@example.com`;
const EMAILS = [EDITOR];
const SLUG = `e2e-r1-carry-${RUN}`;
const TITLE = "E2E Carry-over Course";

const VIDEO_TITLE = "E2E carry-over video";
const DOCS = ["E2E carry-over worksheet.pdf", "E2E carry-over photo.png"];

const para = (text: string) => ({ kind: "paragraph", text });
// Rich text as Release 0 stores it (D36): marks inside a paragraph, a list.
const rich = (text: string) => ({
  kind: "paragraph",
  text,
  rich: {
    v: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Ask " },
            { type: "text", text: "early", marks: [{ type: "bold" }] },
            { type: "text", text: ", not late." },
          ],
        },
      ],
    },
  },
});

const NARRATIVE: Record<string, unknown> = {
  context: {
    en: {
      title: "E2E The situation",
      subtitle: "Read this first",
      blocks: [para("You are new in the team."), { kind: "list", items: ["One", "Two"] }],
    },
    de: {
      title: "E2E Die Lage",
      subtitle: "Lies das zuerst",
      blocks: [para("Du bist neu im Team."), { kind: "list", items: ["Eins", "Zwei"] }],
    },
  },
  concept: {
    en: { title: "E2E The skill", blocks: [rich("Ask early, not late."), { kind: "callout", text: "One clear question." }] },
    de: { title: "E2E Die Fähigkeit", blocks: [para("Frag früh, nicht spät.")] },
  },
};

const SCENARIO = {
  kind: "scenario",
  setup: { en: "E2E carry-over: your lead walks past." },
  question: { en: "What do you do?" },
  followupQuestion: {},
  choices: [
    { id: "c1", quality: "best", text: { en: "Ask for five minutes" }, outcome: { en: "They agree." } },
    { id: "c2", quality: "poor", text: { en: "Wait" }, outcome: { en: "The deadline passes." } },
  ],
};
const SCENARIO_DRAFT = { ...SCENARIO, setup: { en: "E2E carry-over: an unfinished rewrite." } };

// Saved before Release 0's size limits: a German intro over 2,000 characters.
const LONG_INTRO = "Eine lange Einleitung zum Schnellcheck. ".repeat(60).trim();
const ASSESSMENT = {
  kind: "assessment",
  title: { en: "E2E Quick check" },
  intro: { en: "Two questoins.", de: LONG_INTRO },
  questions: [
    {
      id: "q1",
      correctOptionId: "a",
      question: { en: "When is it best to ask?" },
      options: [{ id: "a", text: { en: "Early" } }, { id: "b", text: { en: "Late" } }],
    },
  ],
};

type Row = {
  stageKey: string;
  narrative: unknown;
  structure: unknown;
  structureDraft: unknown;
  parts: unknown;
  video: unknown;
};

/** Every lesson row of the course, as stored, by stage key. */
async function rows(): Promise<Record<string, Row>> {
  const lessons = await prisma.lesson.findMany({
    where: { projectId: PROJECT, courseSlug: SLUG },
    select: { stageKey: true, narrative: true, structure: true, structureDraft: true, parts: true, video: true },
  });
  return Object.fromEntries(lessons.map((l) => [l.stageKey, l]));
}

async function outlineOf() {
  const course = await prisma.course.findFirstOrThrow({
    where: { projectId: PROJECT, slug: SLUG },
    select: { outline: true },
  });
  return course.outline;
}

/** Create a content editor with a live session; returns both ids. */
async function signedInEditor(email: string) {
  const user = await prisma.user.create({ data: { email, emailVerified: new Date() } });
  await prisma.membership.create({ data: { userId: user.id, projectId: PROJECT, role: "CONTENT_EDITOR" } });
  const sessionToken = `e2e-r1c-${RUN}-${Math.random().toString(36).slice(2)}`;
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 86_400_000) },
  });
  return { userId: user.id, sessionToken };
}

async function useSession(context: BrowserContext, sessionToken: string) {
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

const lessonList = (page: Page) =>
  page.getByRole("navigation", { name: /^lessons$/i }).filter({ visible: true });

/** Open one lesson for editing; ready once its "Done" shows (hydrated). */
async function openLesson(page: Page, key: string) {
  await page.goto(`/en/content/courses/${SLUG}?lesson=${key}`);
  const lesson = page.locator(`#lesson-${key}`).filter({ visible: true });
  await expect(lesson.getByRole("button", { name: /^done$/i })).toBeVisible({ timeout: 15000 });
  return lesson;
}

/**
 * Open "Add content" after the lesson's last content and pick `type`,
 * retried against the hydration race without ever closing it again.
 */
async function addContent(lesson: Locator, type: string) {
  const add = lesson.getByRole("button", { name: /^add content after content \d+:/i }).last();
  const choices = lesson.getByText("Choose what to add:").locator("..");
  await expect(async () => {
    if ((await add.getAttribute("aria-expanded")) !== "true") await add.click();
    await expect(choices).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await choices.getByRole("button", { name: type, exact: true }).click();
}

describe("Release 1 — a Release 0 course carries over", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  let editorSession: string;
  /** The rows as seeded, before anything was edited. */
  let before: Record<string, Row>;

  test.beforeAll(async () => {
    await prisma.course.create({
      data: {
        projectId: PROJECT,
        strapiId: `cms-${SLUG}`,
        slug: SLUG,
        cluster: "communication",
        durationMinutes: 15,
        status: "draft",
        meta: {
          en: { title: TITLE, tagline: "carry-over", clusterLabel: "Communication" },
          de: { title: "E2E Übernahme", tagline: "Übernahme", clusterLabel: "Kommunikation" },
        },
      },
    });
    const context = await prisma.lesson.create({
      data: {
        projectId: PROJECT,
        courseSlug: SLUG,
        stageKey: "context",
        narrative: NARRATIVE.context as Prisma.InputJsonValue,
        video: { provider: "file", src: "/demo/sample-lesson.webm", title: VIDEO_TITLE, cues: [] },
      },
    });
    for (const [i, name] of DOCS.entries()) {
      await prisma.lessonDocument.create({
        data: {
          lessonId: context.id,
          name,
          url: `https://example.org/e2e-r1-carry-${i}`,
          mimeType: name.endsWith(".pdf") ? "application/pdf" : "image/png",
          sizeBytes: 1000 + i,
          order: i,
          published: i === 0,
        },
      });
    }
    await prisma.lesson.create({
      data: {
        projectId: PROJECT,
        courseSlug: SLUG,
        stageKey: "concept",
        narrative: NARRATIVE.concept as Prisma.InputJsonValue,
      },
    });
    await prisma.lesson.create({
      data: {
        projectId: PROJECT,
        courseSlug: SLUG,
        stageKey: "scenario",
        structure: SCENARIO,
        structureDraft: SCENARIO_DRAFT,
      },
    });
    await prisma.lesson.create({
      data: { projectId: PROJECT, courseSlug: SLUG, stageKey: "assessment", structure: ASSESSMENT },
    });
    editorSession = (await signedInEditor(EDITOR)).sessionToken;
    before = await rows();
    expect(await outlineOf()).toBeNull();
    for (const row of Object.values(before)) expect(row.parts).toBeNull();
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actor: { is: { email: { in: EMAILS } } } } });
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.lesson.deleteMany({ where: { projectId: PROJECT, courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { projectId: PROJECT, slug: SLUG } });
    await prisma.badge.deleteMany({ where: { projectId: PROJECT, slug: { startsWith: SLUG } } });
    await prisma.$disconnect();
  });

  test("the course page shows the same lessons, numbers, draft mark, video and documents", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto(`/en/content/courses/${SLUG}`);
    const list = lessonList(page);
    await expect(list.getByRole("link").first()).toBeVisible({ timeout: 15000 });

    // The standard lessons in the standard order, numbered as before; the
    // scenario keeps its draft mark.
    await expect(list.getByRole("link")).toHaveText([
      /^1\. Context$/,
      /^2\. Skill concept$/,
      /^3\. Behaviour model$/,
      /^4\. Applied scenario\s*Draft$/,
      /^5\. Reflection$/,
      /^6\. Quick check$/,
    ]);
    // The missing practice is still offered, as on Release 0.
    await expect(list.getByRole("button", { name: /^add guided practice/i })).toBeVisible();

    // The context lesson's video and both documents (the draft one too).
    const lesson = page.locator("#lesson-context").filter({ visible: true });
    await expect(lesson.getByText(VIDEO_TITLE)).toBeVisible();
    for (const name of DOCS) await expect(lesson.getByText(name)).toBeVisible();

    // Nothing to hold publishing back: the course is in the standard layout.
    const publishing = page.getByRole("region", { name: /^publishing$/i }).filter({ visible: true });
    await expect(publishing.getByText("Can't publish yet")).toHaveCount(0);
    await expect(publishing.getByRole("button", { name: /^publish$/i })).not.toHaveAttribute(
      "aria-disabled",
      "true"
    );

    // Opening the page wrote nothing.
    expect(await rows()).toEqual(before);
    expect(await outlineOf()).toBeNull();
  });

  test("Save stage on the quick check saved before the limits still works after a small fix", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    const lesson = await openLesson(page, "assessment");
    const panel = lesson.getByRole("region", { name: /^interactive stage — /i });
    const intro = panel.getByRole("textbox", { name: /^intro$/i });
    await expect(intro).toHaveValue("Two questoins.", { timeout: 15000 });

    await intro.fill("Two questions.");
    await panel.getByRole("button", { name: /^save stage$/i }).click();
    await expect(panel.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });
    await expect(panel.getByRole("alert")).toHaveCount(0);

    const saved = (await rows()).assessment.structure as typeof ASSESSMENT;
    expect(saved.intro.en).toBe("Two questions.");
    expect(saved.intro.de, "the long German intro is kept as it was").toBe(LONG_INTRO);
    expect(saved.questions).toEqual(ASSESSMENT.questions);
  });

  test("a quick check added to the skill concept and removed again leaves nothing stored", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    const lesson = await openLesson(page, "concept");
    await addContent(lesson, "Quick check");
    const header = lesson.getByRole("group", { name: /^content 2 of 2: quick check$/i });
    await expect(header).toBeVisible({ timeout: 15000 });
    const added = (await rows()).concept.parts as { items: { type: string }[] } | null;
    expect(added?.items.map((i) => i.type)).toEqual(["main", "quiz"]);

    // The course now has content learners only get from Release 2.
    const publishing = page.getByRole("region", { name: /^publishing$/i }).filter({ visible: true });
    await expect(publishing.getByText("“Skill concept” has added content")).toBeVisible({
      timeout: 15000,
    });

    page.once("dialog", (dialog) => void dialog.accept());
    await header.getByRole("button", { name: /^remove content 2: quick check$/i }).click();
    await expect(header).toHaveCount(0, { timeout: 15000 });
    await expect(publishing.getByText("“Skill concept” has added content")).toHaveCount(0, {
      timeout: 15000,
    });

    const after = await rows();
    expect(after.concept.parts, "only the main content is left, stored as nothing").toBeNull();
    expect(await outlineOf(), "the course keeps today's layout").toBeNull();
  });

  test("the stored main content is unchanged, except where a save was made", async () => {
    const after = await rows();
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const key of Object.keys(before)) {
      const was = before[key];
      const now = after[key];
      expect(now.narrative, `${key} narrative`).toEqual(was.narrative);
      expect(now.video, `${key} video`).toEqual(was.video);
      expect(now.parts, `${key} parts`).toBeNull();
      if (key === "assessment") continue; // saved on purpose above
      expect(now.structure, `${key} structure`).toEqual(was.structure);
      expect(now.structureDraft, `${key} draft`).toEqual(was.structureDraft);
    }
    const docs = await prisma.lessonDocument.findMany({
      where: { lesson: { projectId: PROJECT, courseSlug: SLUG } },
      orderBy: { order: "asc" },
      select: { name: true, published: true },
    });
    expect(docs).toEqual([
      { name: DOCS[0], published: true },
      { name: DOCS[1], published: false },
    ]);
  });
});
