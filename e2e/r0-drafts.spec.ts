import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Release 0 — draft saving for exercises, and clearer "Not ready to save".
 *
 * An editor can keep an unfinished applied scenario as a draft; learners
 * never see it (they keep seeing what was saved for them, or nothing). The
 * course page marks the draft, and so do the warnings before publishing.
 * "Save stage" still refuses an exercise learners would get stuck in, and
 * says exactly which choice and field is missing. A field whose English was
 * cleared no longer blocks a save when another language has text.
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
const EDITOR = `e2e-r0-drafts-editor-${RUN}@example.com`;
const LEARNER = `e2e-r0-drafts-learner-${RUN}@example.com`;
const EMAILS = [EDITOR, LEARNER];
const SLUG = `e2e-r0-drafts-${RUN}`;
const TITLE = "E2E Drafts Course";

const SETUP = "E2E draft setup: a teammate snaps at you.";
const LIVE_SETUP = "E2E live setup: a colleague interrupts you.";

const lessonWhere = (stageKey: string) => ({
  projectId_courseSlug_stageKey: { projectId: PROJECT, courseSlug: SLUG, stageKey },
});

/** Create a user holding `role`, plus a live session; returns both ids. */
async function signedInUser(email: string, role: "CONTENT_EDITOR" | "LEARNER") {
  const user = await prisma.user.create({
    data: { email, emailVerified: new Date() },
  });
  await prisma.membership.create({
    data: { userId: user.id, projectId: PROJECT, role },
  });
  const sessionToken = `e2e-r0d-${RUN}-${Math.random().toString(36).slice(2)}`;
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
 * The applied-scenario editor on the course page, once its stage has loaded.
 *
 * Its boxes are found by role and accessible name: each sits inside its
 * <label>, so once a box holds text, a label-text match ("Setup …") no longer
 * equals the name a screen reader announces ("Setup").
 */
async function openScenario(page: Page) {
  await page.goto(`/en/content/courses/${SLUG}?lesson=scenario`);
  const panel = page
    .locator("#lesson-scenario")
    .filter({ visible: true })
    .getByRole("region", { name: /^interactive stage — scenario$/i });
  await expect(panel.getByRole("textbox", { name: /^setup$/i })).toBeVisible({ timeout: 15000 });
  return panel;
}

/** How many lessons a learner gets, from the player's "1 / n · Context". */
async function learnerLessonCount(page: Page) {
  await page.goto(`/en/learner/course/${SLUG}`);
  // Only the one on screen: the streamed page can hold a hidden copy for a
  // moment before React moves it in.
  const counter = page.getByText(/^1 \/ \d+ · /).filter({ visible: true });
  await expect(counter).toBeVisible({ timeout: 15000 });
  const text = (await counter.textContent()) ?? "";
  return Number(/\/ (\d+)/.exec(text)?.[1]);
}

describe("Release 0 — exercise drafts", () => {
  let editorId: string;
  let editorSession: string;
  let learnerSession: string;

  test.beforeAll(async () => {
    // Published, so the learner checks what reaches learners.
    await prisma.course.create({
      data: {
        projectId: PROJECT,
        strapiId: `cms-${SLUG}`,
        slug: SLUG,
        cluster: "communication",
        durationMinutes: 15,
        status: "published",
        publishedAt: new Date(),
        meta: {
          en: { title: TITLE, tagline: "drafts", clusterLabel: "Communication" },
        },
      },
    });
    const editor = await signedInUser(EDITOR, "CONTENT_EDITOR");
    editorId = editor.userId;
    editorSession = editor.sessionToken;
    learnerSession = (await signedInUser(LEARNER, "LEARNER")).sessionToken;
  });

  test.afterAll(async () => {
    // Both users' audit rows: the editor's saves, and the learner's course
    // opens and time on lessons from the player. Filtered through the users'
    // emails, a constant of this run, so the filter can never come out empty
    // and match every row (an unset id would, if beforeAll failed early).
    // Done before the users go: deleting a user keeps their rows, unowned.
    await prisma.auditLog.deleteMany({
      where: { actor: { is: { email: { in: EMAILS } } } },
    });
    // Users first: their enrolments cascade away with them.
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.lesson.deleteMany({ where: { projectId: PROJECT, courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { projectId: PROJECT, slug: SLUG } });
    await prisma.$disconnect();
  });

  test("an unfinished scenario saves as a draft that learners never see", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    const panel = await openScenario(page);

    // What is missing is listed before anything is typed, naming each field.
    await expect(panel.getByText(/still missing before learners can use this/i)).toBeVisible();
    await expect(panel.getByText("Write the setup.")).toBeVisible();

    await panel.getByRole("textbox", { name: /^setup$/i }).fill(SETUP);
    await panel.getByRole("textbox", { name: /^first question$/i }).fill("What do you do?");
    // Each repeated box is named by its place: "Choice 1 Choice text".
    await panel.getByRole("textbox", { name: /^choice 1 choice text$/i }).fill("Talk to them privately");

    // Not complete: "Save stage" says exactly what is missing, and writes nothing.
    await panel.getByRole("button", { name: /^save stage$/i }).click();
    const refused = panel.getByRole("alert");
    await expect(refused).toContainText(/not ready to save/i, { timeout: 15000 });
    await expect(refused).toContainText("Choice 1: write the outcome shown.");
    await expect(refused).toContainText("Choice 2: write the choice text.");
    // The box it names is marked invalid, with the reason as its description,
    // and the reason takes the author there.
    const choice2 = panel.getByRole("textbox", { name: /^choice 2 choice text$/i });
    await expect(choice2).toHaveAttribute("aria-invalid", "true");
    await expect(choice2).toHaveAccessibleDescription("Choice 2: write the choice text.");
    await expect(
      panel.getByRole("textbox", { name: /^choice 1 choice text$/i })
    ).not.toHaveAttribute("aria-invalid", "true");
    await refused.getByRole("button", { name: "Choice 2: write the choice text." }).click();
    await expect(choice2).toBeFocused();
    expect(
      await prisma.lesson.count({ where: { courseSlug: SLUG, stageKey: "scenario" } })
    ).toBe(0);

    // "Save draft" keeps it anyway.
    await panel.getByRole("button", { name: /^save draft$/i }).click();
    await expect(panel.getByText(/^draft saved — learners don't see it yet\.$/i)).toBeVisible({
      timeout: 15000,
    });
    const row = await prisma.lesson.findUnique({ where: lessonWhere("scenario") });
    expect((row?.structureDraft as { setup?: { en?: string } } | null)?.setup?.en).toBe(SETUP);
    expect(row?.structure, "nothing saved for learners").toBeNull();
    const log = await prisma.auditLog.findFirst({
      where: { actorId: editorId, action: "structure.draft_saved" },
    });
    expect(log, "draft save audited").toBeTruthy();

    // The learner gets the four lessons only, and none of the draft.
    await useSession(context, learnerSession);
    expect(await learnerLessonCount(page)).toBe(4);
    await expect(page.getByText(SETUP)).toHaveCount(0);
  });

  test("the course page marks the draft, and so do the publishing warnings", async ({
    page,
    context,
  }) => {
    // The warnings show while the course isn't published.
    await prisma.course.updateMany({
      where: { projectId: PROJECT, slug: SLUG },
      data: { status: "draft" },
    });
    try {
      await useSession(context, editorSession);
      const panel = await openScenario(page);

      // The draft opens in the editor, clearly labelled.
      await expect(panel.getByRole("textbox", { name: /^setup$/i })).toHaveValue(SETUP);
      await expect(panel.getByText(/^draft — learners don't see this yet$/i)).toBeVisible();
      await expect(
        page.locator("#lesson-scenario").filter({ visible: true }).getByText(/^draft saved$/i)
      ).toBeVisible();
      // The lesson list names the drafted lesson to edit, not "Add …" again.
      const nav = page.getByRole("navigation", { name: /^lessons$/i });
      await expect(nav.getByText(/^draft$/i)).toBeVisible();
      await expect(
        nav.getByRole("button", { name: /^applied scenario\s*draft$/i })
      ).toBeVisible();
      await expect(nav.getByRole("button", { name: /^add an applied scenario/i })).toHaveCount(0);
      await expect(
        page.getByText("The “Applied scenario” lesson has a draft that learners don't see yet.")
      ).toBeVisible();
    } finally {
      await prisma.course.updateMany({
        where: { projectId: PROJECT, slug: SLUG },
        data: { status: "published" },
      });
    }
  });

  test("a follow-up with no question is refused by name; once complete it goes live", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    const panel = await openScenario(page);
    await expect(panel.getByRole("textbox", { name: /^setup$/i })).toHaveValue(SETUP);

    await panel.getByRole("textbox", { name: /^choice 1 outcome shown$/i }).fill("They listen.");
    await panel.getByRole("textbox", { name: /^choice 2 choice text$/i }).fill("Snap back");
    await panel.getByRole("textbox", { name: /^choice 2 outcome shown$/i }).fill("It gets worse.");
    // A follow-up under choice 1, left blank: learners would be stuck there.
    await panel.getByRole("button", { name: /^add follow-up$/i }).first().click();

    await panel.getByRole("button", { name: /^save stage$/i }).click();
    const refused = panel.getByRole("alert");
    await expect(refused).toContainText(/write the follow-up question/i, { timeout: 15000 });
    await expect(refused).toContainText("Follow-up 1.1: write the follow-up text.");
    await expect(refused).toContainText("Follow-up 1.1: write the follow-up outcome.");
    await expect(
      panel.getByRole("textbox", { name: /^follow-up 1\.1 follow-up outcome$/i })
    ).toHaveAttribute("aria-invalid", "true");
    expect(
      (await prisma.lesson.findUnique({ where: lessonWhere("scenario") }))?.structure,
      "still nothing for learners"
    ).toBeNull();

    await panel.getByRole("textbox", { name: /^follow-up question$/i }).fill("What next?");
    await panel
      .getByRole("textbox", { name: /^follow-up 1\.1 follow-up text$/i })
      .fill("Ask what happened");
    await panel
      .getByRole("textbox", { name: /^follow-up 1\.1 follow-up outcome$/i })
      .fill("You hear their side.");
    await panel.getByRole("button", { name: /^save stage$/i }).click();
    await expect(panel.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });

    // Saved for learners, and the draft is gone.
    const row = await prisma.lesson.findUnique({ where: lessonWhere("scenario") });
    const structure = row?.structure as {
      setup?: { en?: string };
      choices?: { followups?: { text?: { en?: string } }[] }[];
    } | null;
    expect(structure?.setup?.en).toBe(SETUP);
    expect(structure?.choices?.[0]?.followups?.[0]?.text?.en).toBe("Ask what happened");
    expect(row?.structureDraft, "draft cleared").toBeNull();
    await expect(panel.getByText(/^draft — learners don't see this yet$/i)).toHaveCount(0);

    // The course is published: learners have the scenario straight away.
    await useSession(context, learnerSession);
    expect(await learnerLessonCount(page)).toBe(5);
  });

  test("discarding a draft goes back to the version learners see", async ({
    page,
    context,
  }) => {
    // A draft beside the live scenario, as a colleague might have left it.
    const live = (await prisma.lesson.findUnique({ where: lessonWhere("scenario") }))
      ?.structure as Record<string, unknown>;
    await prisma.lesson.update({
      where: lessonWhere("scenario"),
      data: {
        structure: { ...live, setup: { en: LIVE_SETUP } },
        structureDraft: { ...live, setup: { en: "E2E unfinished rewrite" } },
      },
    });

    // The course as learners get it (the editor's preview builds it the same
    // way, and can open the scenario directly) has the live version only.
    await useSession(context, editorSession);
    await page.goto(`/en/learner/course/${SLUG}?preview=1&lesson=scenario`);
    await expect(page.getByText(LIVE_SETUP).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("E2E unfinished rewrite")).toHaveCount(0);

    const panel = await openScenario(page);
    await expect(panel.getByRole("textbox", { name: /^setup$/i })).toHaveValue("E2E unfinished rewrite");
    await expect(panel.getByText(/learners still see the last saved version/i)).toBeVisible();

    page.once("dialog", (dialog) => void dialog.accept());
    await panel.getByRole("button", { name: /^discard draft$/i }).click();
    await expect(panel.getByText(/^draft discarded\.$/i)).toBeVisible({ timeout: 15000 });
    await expect(panel.getByRole("textbox", { name: /^setup$/i })).toHaveValue(LIVE_SETUP);
    const row = await prisma.lesson.findUnique({ where: lessonWhere("scenario") });
    expect(row?.structureDraft).toBeNull();
    expect((row?.structure as { setup?: { en?: string } }).setup?.en).toBe(LIVE_SETUP);
  });

  test("removing a stage doesn't delete a draft a colleague saved meanwhile", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    const panel = await openScenario(page);
    await expect(panel.getByRole("textbox", { name: /^setup$/i })).toHaveValue(LIVE_SETUP);
    await expect(panel.getByText(/^draft — learners don't see this yet$/i)).toHaveCount(0);

    // A colleague saves a draft after this page opened, so it isn't shown here.
    const live = (await prisma.lesson.findUnique({ where: lessonWhere("scenario") }))
      ?.structure as Record<string, unknown>;
    await prisma.lesson.update({
      where: lessonWhere("scenario"),
      data: { structureDraft: { ...live, setup: { en: "E2E colleague's draft" } } },
    });

    page.once("dialog", (dialog) => void dialog.accept());
    await panel.getByRole("button", { name: /^remove stage$/i }).click();
    await expect(panel.getByRole("alert")).toContainText(/so nothing was removed/i, {
      timeout: 15000,
    });
    const row = await prisma.lesson.findUnique({ where: lessonWhere("scenario") });
    expect((row?.structureDraft as { setup?: { en?: string } } | null)?.setup?.en).toBe(
      "E2E colleague's draft"
    );
    expect((row?.structure as { setup?: { en?: string } } | null)?.setup?.en).toBe(LIVE_SETUP);

    // Reloading shows the colleague's draft, clearly marked.
    await panel.getByRole("button", { name: /^reload the saved version$/i }).click();
    await expect(panel.getByRole("textbox", { name: /^setup$/i })).toHaveValue("E2E colleague's draft", {
      timeout: 15000,
    });
    await expect(panel.getByText(/^draft — learners don't see this yet$/i)).toBeVisible();
  });

  test("a field cleared in English saves when German has the text", async ({
    page,
    context,
  }) => {
    // A quick check written in German, whose English boxes were typed in and
    // emptied again (stored as ""). It used to be refused as blank.
    await prisma.lesson.create({
      data: {
        projectId: PROJECT,
        courseSlug: SLUG,
        stageKey: "assessment",
        structureDraft: {
          kind: "assessment",
          intro: { en: "", de: "Eine kurze Frage." },
          questions: [
            {
              id: "q1",
              correctOptionId: "b",
              question: { en: "", de: "Was ist eine Ich-Botschaft?" },
              options: [
                { id: "a", text: { en: "", de: "Du hörst nie zu." } },
                { id: "b", text: { de: "Ich fühle mich übergangen." } },
              ],
            },
          ],
        } as Prisma.InputJsonValue,
      },
    });

    await useSession(context, editorSession);
    await page.goto(`/en/content/courses/${SLUG}?lesson=assessment`);
    const panel = page
      .locator("#lesson-assessment")
      .filter({ visible: true })
      .getByRole("region", { name: /^interactive stage — assessment$/i });
    await expect(panel.getByRole("textbox", { name: /^intro$/i })).toBeVisible({ timeout: 15000 });
    // Nothing is listed as missing: German text is enough.
    await expect(panel.getByText(/still missing before learners can use this/i)).toHaveCount(0);

    await panel.getByRole("button", { name: /^save stage$/i }).click();
    await expect(panel.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });

    const row = await prisma.lesson.findUnique({ where: lessonWhere("assessment") });
    const quiz = row?.structure as {
      questions?: { question?: Record<string, string> }[];
    } | null;
    // The emptied English is dropped, so English learners get the German.
    expect(quiz?.questions?.[0]?.question).toEqual({ de: "Was ist eine Ich-Botschaft?" });
    expect(row?.structureDraft).toBeNull();
  });
});
