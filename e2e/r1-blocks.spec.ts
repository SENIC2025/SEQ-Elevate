import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Release 1 — a lesson's content (Stream E, spec 11.2 and 13.2 item 6).
 *
 * An editor adds every kind of content to a lesson of a draft course:
 * text, practice question, branching scenario, quick check, reflection
 * questions and a self-assessment. A question saves as a draft whatever is
 * missing; "Save stage" refuses it until it is ready, naming the box. A save
 * made from a page a colleague has overtaken is refused, and the
 * colleague's version can be loaded. Content can be moved and removed by
 * keyboard-reachable buttons, with focus and an announcement following.
 *
 * On a published course in the standard layout the lesson's main text is
 * still live for learners at once; added content is refused there
 * (Release 2) — the page says why, and a page opened before the course was
 * published is refused by the server ("stale page"). "Remove stage" is
 * refused while learners are enrolled (G5). A lesson of the course's own
 * is edited by its id, video included. axe finds nothing serious with a
 * self-assessment open.
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

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const PROJECT = "seq-elevate";
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const EDITOR = `e2e-r1-blocks-editor-${RUN}@example.com`;
const LEARNER = `e2e-r1-blocks-learner-${RUN}@example.com`;
const EMAILS = [EDITOR, LEARNER];
/** A draft course: content is added here. */
const SLUG = `e2e-r1-blocks-${RUN}`;
/** A published course in the standard layout. */
const LIVE = `e2e-r1-blocks-live-${RUN}`;
const SLUGS = [SLUG, LIVE];
/** A lesson of the draft course's own: a quick check. */
const OWN = "s-e2eblk01";

const para = (text: string) => ({ kind: "paragraph", text });
const narrative = (title: string, text: string) => ({ en: { title, blocks: [para(text)] } });

const SCENARIO = {
  kind: "scenario",
  title: { en: "Play it out" },
  setup: { en: "E2E live setup: a colleague asks for help." },
  question: { en: "What do you do?" },
  followupQuestion: {},
  choices: [
    { id: "c1", quality: "best", text: { en: "Listen first" }, outcome: { en: "They relax." }, followups: [] },
    { id: "c2", quality: "poor", text: { en: "Walk away" }, outcome: { en: "They feel ignored." } },
  ],
};

const lessonWhere = (courseSlug: string, stageKey: string) => ({
  projectId_courseSlug_stageKey: { projectId: PROJECT, courseSlug, stageKey },
});

type StoredItem = { id: string; type: string; data?: unknown; draft?: unknown; blocks?: unknown };

/** The lesson's content list as stored (Lesson.parts), or [] for none. */
async function storedParts(courseSlug: string, stageKey: string): Promise<StoredItem[]> {
  const row = await prisma.lesson.findUnique({
    where: lessonWhere(courseSlug, stageKey),
    select: { parts: true },
  });
  return ((row?.parts as { items?: StoredItem[] } | null)?.items ?? []) as StoredItem[];
}

/** Create a user holding `role`, plus a live session; returns both ids. */
async function signedInUser(email: string, role: "CONTENT_EDITOR" | "LEARNER") {
  const user = await prisma.user.create({
    data: { email, emailVerified: new Date() },
  });
  await prisma.membership.create({
    data: { userId: user.id, projectId: PROJECT, role },
  });
  const sessionToken = `e2e-r1b-${RUN}-${Math.random().toString(36).slice(2)}`;
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
 * Switch the browser to another user. Leave open pages first: an in-flight
 * /api/auth/session call returning after the switch would re-set the old
 * cookie.
 */
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

/**
 * One lesson on the course page, opened by ?lesson=. Visible only: when
 * React client-renders the page while it is still streaming, the server's
 * copy can stay behind in a hidden block.
 */
async function openLesson(page: Page, courseSlug: string, key: string) {
  await page.goto(`/en/content/courses/${courseSlug}?lesson=${key}`);
  const lesson = page.locator(`#lesson-${key}`).filter({ visible: true });
  await expect(lesson.getByRole("button", { name: /^done$/i })).toBeVisible({ timeout: 15000 });
  return lesson;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The editor of the lesson's content of this type ("Quick check · 4 of 7"). */
const partRegion = (lesson: Locator, type: string) =>
  lesson.getByRole("region", { name: new RegExp(`^${escape(type)} · \\d+ of \\d+`, "i") });

/** The header of the lesson's content of this type ("Content 4 of 7: Quick check"). */
const partGroup = (lesson: Locator, type: string) =>
  lesson.getByRole("group", { name: new RegExp(`^content \\d+ of \\d+: ${escape(type)}$`, "i") });

/**
 * Open "Add content" after the lesson's last content and pick `type`.
 * Retried against the hydration race: the button is pressed only while its
 * choices are closed, so a retry never closes them again.
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

/** Continue to step n of the learner player, retried against the hydration race, never past it. */
async function continueTo(page: Page, n: number) {
  const stepBar = page.locator('[aria-current="step"]').filter({ visible: true });
  const next = page.getByRole("button", { name: /^continue$/i }).first();
  await expect(async () => {
    const at = (await stepBar.textContent())?.trim() ?? "";
    if (at.startsWith(String(n - 1))) await next.click();
    await expect(stepBar).toContainText(String(n), { timeout: 5000 });
  }).toPass({ timeout: 20_000 });
}

describe("Release 1 — a lesson's content", () => {
  let editorId: string;
  let editorSession: string;
  let learnerId: string;
  let learnerSession: string;

  test.beforeAll(async () => {
    const meta = (title: string) => ({
      en: { title, tagline: "lesson content", clusterLabel: "Communication" },
    });
    // The draft course: the standard lessons plus a quick check of its own.
    await prisma.course.create({
      data: {
        projectId: PROJECT,
        strapiId: `cms-${SLUG}`,
        slug: SLUG,
        cluster: "communication",
        durationMinutes: 15,
        status: "draft",
        meta: meta("E2E Lesson Content"),
        outline: {
          v: 1,
          sections: [
            { id: "context", template: "context" },
            { id: "concept", template: "concept" },
            { id: "behaviour", template: "behaviour" },
            { id: OWN, template: "quiz", label: { en: "E2E own check" } },
            { id: "reflection", template: "reflection" },
          ],
        },
      },
    });
    for (const [stageKey, title] of [
      ["context", "The situation"],
      ["concept", "The skill"],
      ["behaviour", "What it looks like"],
    ] as const) {
      await prisma.lesson.create({
        data: {
          projectId: PROJECT,
          courseSlug: SLUG,
          stageKey,
          narrative: narrative(title, `E2E ${title} text.`),
        },
      });
    }
    // The published course in the standard layout, with a saved scenario.
    await prisma.course.create({
      data: {
        projectId: PROJECT,
        strapiId: `cms-${LIVE}`,
        slug: LIVE,
        cluster: "communication",
        durationMinutes: 15,
        status: "published",
        publishedAt: new Date(),
        meta: meta("E2E Live Lesson Content"),
      },
    });
    await prisma.lesson.create({
      data: { projectId: PROJECT, courseSlug: LIVE, stageKey: "context", narrative: narrative("Live context", "E2E live context.") },
    });
    await prisma.lesson.create({
      data: { projectId: PROJECT, courseSlug: LIVE, stageKey: "concept", narrative: narrative("Live concept", "E2E live concept.") },
    });
    await prisma.lesson.create({
      data: {
        projectId: PROJECT,
        courseSlug: LIVE,
        stageKey: "scenario",
        structure: SCENARIO as Prisma.InputJsonValue,
      },
    });

    const editor = await signedInUser(EDITOR, "CONTENT_EDITOR");
    editorId = editor.userId;
    editorSession = editor.sessionToken;
    const learner = await signedInUser(LEARNER, "LEARNER");
    learnerId = learner.userId;
    learnerSession = learner.sessionToken;
  });

  test.afterAll(async () => {
    // Audit rows through the users' emails, a constant of this run, so the
    // filter can never come out empty and match every row.
    await prisma.auditLog.deleteMany({
      where: { actor: { is: { email: { in: EMAILS } } } },
    });
    // Users first: their enrolments cascade away with them.
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.lesson.deleteMany({ where: { projectId: PROJECT, courseSlug: { in: SLUGS } } });
    await prisma.course.deleteMany({ where: { projectId: PROJECT, slug: { in: SLUGS } } });
    await prisma.$disconnect();
  });

  test("every kind of content can be added to a lesson, each with its own editor", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    const lesson = await openLesson(page, SLUG, "concept");
    // Only the main content so far: today's editor, no content headers.
    await expect(lesson.getByRole("region", { name: /^lesson text \(english\)$/i })).toBeVisible();
    await expect(lesson.getByRole("group", { name: /^content \d+ of/i })).toHaveCount(0);

    const types = [
      "Text",
      "Practice question",
      "Branching scenario",
      "Quick check",
      "Reflection questions",
      "Self-assessment (1–5)",
    ];
    for (const [i, type] of types.entries()) {
      await addContent(lesson, type);
      const n = i + 2;
      await expect(
        lesson.getByRole("group", { name: `Content ${n} of ${n}: ${type}` })
      ).toBeVisible({ timeout: 15000 });
      // Announced, once, in the page's words.
      await expect(lesson.getByRole("status").filter({ hasText: `${type} added.` })).toHaveCount(1);
    }
    // The main content now has a header too, with no Remove.
    const main = lesson.getByRole("group", { name: "Content 1 of 7: Text" });
    await expect(main.getByRole("button", { name: /^move down$/i })).toBeEnabled();
    await expect(main.getByRole("button", { name: /^remove$/i })).toHaveCount(0);
    // A new question opens with focus in its first box.
    await expect(
      partRegion(lesson, "Self-assessment (1–5)").getByRole("textbox", { name: /^title \(optional\)$/i })
    ).toBeFocused({ timeout: 15000 });

    await expect(lesson.getByText(/learners get the added content from release 2/i)).toBeVisible();
    const items = await storedParts(SLUG, "concept");
    expect(items.map((i) => i.type)).toEqual([
      "main",
      "text",
      "practice",
      "scenario",
      "quiz",
      "reflection",
      "rating",
    ]);
    // A question starts as a draft, never for learners.
    expect(items.filter((i) => i.type !== "main" && i.type !== "text").every((i) => i.data === null)).toBe(true);
    expect(
      await prisma.auditLog.count({ where: { actorId: editorId, action: "part.added" } })
    ).toBe(6);
  });

  test("a question saves as a draft whatever is missing; Save stage names the box first", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    const lesson = await openLesson(page, SLUG, "concept");
    const quiz = partRegion(lesson, "Quick check");
    const question = quiz.getByRole("textbox", { name: /^question 1 question$/i });
    await expect(question).toBeVisible({ timeout: 15000 });

    await quiz.getByRole("button", { name: /^save stage$/i }).click();
    const refused = quiz.getByRole("alert");
    await expect(refused).toContainText(/not ready to save/i, { timeout: 15000 });
    await expect(refused).toContainText("Question 1: write the question.");
    await expect(question).toHaveAttribute("aria-invalid", "true");
    await expect(question).toHaveAccessibleDescription("Question 1: write the question.");

    await question.fill("E2E: what helps most?");
    await quiz.getByRole("button", { name: /^save draft$/i }).click();
    await expect(quiz.getByText(/^draft saved — learners don't see it yet\.$/i)).toBeVisible({
      timeout: 15000,
    });
    let stored = (await storedParts(SLUG, "concept")).find((i) => i.type === "quiz");
    expect(stored?.data).toBeNull();
    expect((stored?.draft as { questions: { question: { en?: string } }[] }).questions[0].question.en).toBe(
      "E2E: what helps most?"
    );

    await quiz.getByRole("textbox", { name: /^question 1 answer 1$/i }).fill("Asking early");
    await quiz.getByRole("textbox", { name: /^question 1 answer 2$/i }).fill("Waiting");
    await quiz.getByRole("radio", { name: /^answer 1 is correct$/i }).check();
    await quiz.getByRole("button", { name: /^save stage$/i }).click();
    await expect(quiz.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });
    stored = (await storedParts(SLUG, "concept")).find((i) => i.type === "quiz");
    expect((stored?.data as { questions: unknown[] } | null)?.questions).toHaveLength(1);
    expect(stored?.draft, "the draft is cleared").toBeNull();
    expect(
      await prisma.auditLog.count({ where: { actorId: editorId, action: "part.saved" } })
    ).toBe(1);

    // The standard reflection questions are ready as they are.
    const reflection = partRegion(lesson, "Reflection questions");
    await expect(reflection.getByRole("textbox", { name: /^question 1 question$/i })).not.toHaveValue("");
    await reflection.getByRole("button", { name: /^save stage$/i }).click();
    await expect(reflection.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });
  });

  test("a save from a page a colleague overtook is refused, and their version can be loaded", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    const lesson = await openLesson(page, SLUG, "concept");
    const rating = partRegion(lesson, "Self-assessment (1–5)");
    await expect(rating.getByRole("textbox", { name: /^what 1 means$/i })).toHaveValue("Not at all like me", {
      timeout: 15000,
    });

    // A colleague saves a draft of the self-assessment after this page opened.
    const items = await storedParts(SLUG, "concept");
    await prisma.lesson.update({
      where: lessonWhere(SLUG, "concept"),
      data: {
        parts: {
          v: 1,
          items: items.map((i) =>
            i.type === "rating"
              ? {
                  ...i,
                  draft: {
                    kind: "rating",
                    minLabel: { en: "Not at all like me" },
                    maxLabel: { en: "Very much like me" },
                    statements: [{ id: "s1", text: { en: "E2E colleague's statement" } }],
                  },
                }
              : i
          ),
        } as Prisma.InputJsonValue,
      },
    });

    await rating.getByRole("button", { name: /^add statement$/i }).click();
    await rating.getByRole("textbox", { name: /^statement 1 statement$/i }).fill("E2E my statement");
    await rating.getByRole("button", { name: /^save draft$/i }).click();
    await expect(rating.getByRole("alert")).toContainText(/someone else saved/i, { timeout: 15000 });
    expect(
      JSON.stringify((await storedParts(SLUG, "concept")).find((i) => i.type === "rating")?.draft)
    ).toContain("E2E colleague's statement");

    page.once("dialog", (dialog) => void dialog.accept());
    await rating.getByRole("button", { name: /^reload the saved version$/i }).click();
    await expect(rating.getByRole("textbox", { name: /^statement 1 statement$/i })).toHaveValue(
      "E2E colleague's statement",
      { timeout: 15000 }
    );

    // Nothing serious for axe with a self-assessment open.
    const scan = await new AxeBuilder({ page }).include("#lesson-concept").withTags(TAGS).analyze();
    const serious = scan.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
  });

  test("content moves by button with focus kept, and goes in all languages when removed", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    const lesson = await openLesson(page, SLUG, "concept");
    const quizHeader = partGroup(lesson, "Quick check");
    await expect(quizHeader).toHaveAccessibleName("Content 5 of 7: Quick check", { timeout: 15000 });

    const up = quizHeader.getByRole("button", { name: /^move up$/i });
    await up.click();
    await expect(quizHeader).toHaveAccessibleName("Content 4 of 7: Quick check", { timeout: 15000 });
    await expect(up).toBeFocused();
    await expect(lesson.getByRole("status").filter({ hasText: "Moved to position 4 of 7." })).toHaveCount(1);
    expect((await storedParts(SLUG, "concept")).map((i) => i.type).indexOf("quiz")).toBe(3);

    // Remove the text: confirmed, then gone from the page and the database.
    const text = partGroup(lesson, "Text").filter({ hasText: /^content 2 of/i });
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toMatch(/removed in all languages/i);
      void dialog.accept();
    });
    await text.getByRole("button", { name: /^remove$/i }).click();
    await expect(lesson.getByRole("group", { name: /^content \d+ of 6:/i }).first()).toBeVisible({
      timeout: 15000,
    });
    expect((await storedParts(SLUG, "concept")).some((i) => i.type === "text")).toBe(false);
    expect(
      await prisma.auditLog.count({ where: { actorId: editorId, action: "part.removed" } })
    ).toBe(1);
  });

  test("a page opened before the course went live is refused by the server, and says why", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    const lesson = await openLesson(page, SLUG, "context");
    const add = lesson.getByRole("button", { name: /^add content after content 1:/i });
    await expect(add).not.toHaveAttribute("aria-disabled", "true");

    // Published meanwhile (as if by a colleague, past the guard: a stale page).
    await prisma.course.updateMany({
      where: { projectId: PROJECT, slug: SLUG },
      data: { status: "published", publishedAt: new Date() },
    });
    try {
      await addContent(lesson, "Text");
      await expect(lesson.getByRole("alert")).toContainText(
        /this course is live, so this change has to wait/i,
        { timeout: 15000 }
      );
      expect(await storedParts(SLUG, "context")).toEqual([]);
    } finally {
      await prisma.course.updateMany({
        where: { projectId: PROJECT, slug: SLUG },
        data: { status: "draft", publishedAt: null },
      });
    }
  });

  test("a lesson of the course's own is edited by its id, video and quick check included", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    const lesson = await openLesson(page, SLUG, OWN);
    await expect(lesson.getByRole("heading", { name: /e2e own check/i }).first()).toBeVisible();
    await expect(lesson.getByRole("heading", { name: /^interactive video$/i })).toBeVisible();
    const quiz = lesson.getByRole("region", { name: /^interactive stage — assessment$/i });
    const question = quiz.getByRole("textbox", { name: /^question 1 question$/i });
    await expect(question).toBeVisible({ timeout: 15000 });
    await question.fill("E2E own: ready?");
    await quiz.getByRole("textbox", { name: /^question 1 answer 1$/i }).fill("Yes");
    await quiz.getByRole("textbox", { name: /^question 1 answer 2$/i }).fill("No");
    await quiz.getByRole("radio", { name: /^answer 1 is correct$/i }).check();
    await quiz.getByRole("button", { name: /^save stage$/i }).click();
    await expect(quiz.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });
    const row = await prisma.lesson.findUnique({ where: lessonWhere(SLUG, OWN) });
    expect((row?.structure as { kind?: string } | null)?.kind).toBe("assessment");
  });

  test("on a live standard course the lesson's text is live at once; added content waits", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    const lesson = await openLesson(page, LIVE, "concept");

    // Added content is refused here until Release 2, and the page says why.
    const add = lesson.getByRole("button", { name: /^add content after content 1:/i });
    await expect(add).toHaveAttribute("aria-disabled", "true");
    await expect(add).toHaveAccessibleDescription(/learners get added content from release 2/i);

    const editor = lesson.getByRole("region", { name: /^lesson text \(english\)$/i });
    const title = editor.getByRole("textbox", { name: /^lesson title$/i });
    // Typed before hydration, the edit would never reach React's state:
    // retry until the editor says there are unsaved changes.
    await expect(async () => {
      await title.fill("E2E live title");
      await expect(editor.getByText(/^unsaved changes$/i)).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await editor.getByRole("button", { name: /^save english$/i }).click();
    await expect(editor.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });

    await useSession(context, learnerSession);
    await page.goto(`/en/learner/course/${LIVE}`);
    await expect(page.locator('[aria-current="step"]').filter({ visible: true })).toContainText("1", {
      timeout: 15000,
    });
    await continueTo(page, 2);
    await expect(page.getByRole("heading", { name: "E2E live title" }).first()).toBeVisible();
    expect(await storedParts(LIVE, "concept")).toEqual([]);
  });

  test("Remove stage is refused while learners are enrolled (G5)", async ({ page, context }) => {
    const course = await prisma.course.findFirstOrThrow({
      where: { projectId: PROJECT, slug: LIVE },
      select: { id: true },
    });
    await prisma.courseEnrollment.upsert({
      where: { userId_courseId: { userId: learnerId, courseId: course.id } },
      create: { userId: learnerId, courseId: course.id },
      update: {},
    });

    await useSession(context, editorSession);
    const lesson = await openLesson(page, LIVE, "scenario");
    const panel = lesson.getByRole("region", { name: /^interactive stage — scenario$/i });
    await expect(panel.getByRole("textbox", { name: /^setup$/i })).toHaveValue(SCENARIO.setup.en, {
      timeout: 15000,
    });
    page.once("dialog", (dialog) => void dialog.accept());
    await panel.getByRole("button", { name: /^remove stage$/i }).click();
    await expect(panel.getByRole("alert")).toContainText(/1 learner is enrolled/i, { timeout: 15000 });
    const row = await prisma.lesson.findUnique({ where: lessonWhere(LIVE, "scenario") });
    expect(row?.structure, "learners keep the scenario").not.toBeNull();
  });
});
