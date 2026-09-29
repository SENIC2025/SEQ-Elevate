import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * The course page in "Manage courses" (D33): an editor rewords a course per
 * language, edits a lesson's blocks, and is asked before unsaved work is
 * thrown away. Learners see the saved changes straight away.
 *
 * Requires a real database — gated on E2E_DB=1, like db-backed-progress.
 * Publishing, the structure editor and creating a course are covered there.
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
const EDITOR = "e2e-course-page-editor@example.com";
const LEARNER = "e2e-course-page-learner@example.com";
const EMAILS = [EDITOR, LEARNER];
// A built-in course (rewording goes to copyOverride, D34)…
const BUILT_IN = "workplace-conflict";
// …and one created here, seeded with a concept lesson to edit.
const SLUG = "e2e-course-page";
const TITLE = "E2E Course Page";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Create a user holding `role`, plus a live session; returns both ids. */
async function signedInUser(email: string, role: "CONTENT_EDITOR" | "LEARNER") {
  const user = await prisma.user.create({
    data: { email, emailVerified: new Date() },
  });
  await prisma.membership.create({
    data: { userId: user.id, projectId: PROJECT, role },
  });
  const sessionToken = `e2e-cp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
 * Leave every open page before switching users. A page's in-flight
 * /api/auth/session call re-sets the session cookie when it returns, and one
 * returning after the switch would sign the previous user back in.
 */
async function leaveOpenPages(
  context: import("@playwright/test").BrowserContext
) {
  for (const open of context.pages()) await open.goto("about:blank");
}

async function useSession(
  context: import("@playwright/test").BrowserContext,
  sessionToken: string
) {
  await leaveOpenPages(context);
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

async function clearBuiltInRewording() {
  await prisma.course.updateMany({
    where: { projectId: PROJECT, slug: BUILT_IN },
    data: { copyOverride: Prisma.DbNull },
  });
}

describe("Manage courses — the course page", () => {
  let editorId: string;
  let editorSession: string;
  let learnerSession: string;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.lesson.deleteMany({ where: { courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { slug: SLUG } });
    await clearBuiltInRewording();

    // Published, so the learner can check what editors save.
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
          en: {
            title: TITLE,
            tagline: "edit me",
            clusterLabel: "Communication",
          },
        },
      },
    });
    await prisma.lesson.create({
      data: {
        projectId: PROJECT,
        courseSlug: SLUG,
        stageKey: "concept",
        narrative: {
          en: {
            title: "The idea",
            blocks: [
              { kind: "paragraph", text: "First paragraph." },
              { kind: "callout", text: "Original key message." },
              { kind: "list", items: ["One", "Two"] },
            ],
          },
        },
      },
    });

    const editor = await signedInUser(EDITOR, "CONTENT_EDITOR");
    editorId = editor.userId;
    editorSession = editor.sessionToken;
    learnerSession = (await signedInUser(LEARNER, "LEARNER")).sessionToken;
  });

  test.afterAll(async () => {
    await clearBuiltInRewording();
    await prisma.auditLog.deleteMany({ where: { actorId: editorId } });
    // Users first: their enrolments cascade away with them.
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.lesson.deleteMany({ where: { courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { slug: SLUG } });
  });

  test("an editor rewords a built-in course in German only, then restores it", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto(`/en/content/courses/${BUILT_IN}?lang=de`);
    const copy = page.getByRole("region", {
      name: /^course title and subtitle$/i,
    });
    await expect(copy).toBeVisible({ timeout: 15000 });

    const title = copy.getByLabel(/^course title$/i);
    // Typed before hydration, the edit would never reach React's state (and
    // Save would store the old title): retry until the page reacts to it by
    // describing the field with the shipped wording.
    await expect(async () => {
      await title.fill("E2E Titel");
      await expect(title).toHaveAccessibleDescription(
        "Built-in: Einen kleinen Konflikt am Arbeitsplatz meistern",
        { timeout: 2000 }
      );
    }).toPass({ timeout: 15000 });
    await copy
      .getByRole("button", { name: /^save title and subtitle$/i })
      .click();
    await expect(copy.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });

    const row = await prisma.course.findFirst({
      where: { projectId: PROJECT, slug: BUILT_IN },
      select: { copyOverride: true },
    });
    const override = row?.copyOverride as Record<
      string,
      { title?: string }
    > | null;
    expect(override?.de?.title, "German rewording stored").toBe("E2E Titel");
    expect(override?.en, "English untouched").toBeUndefined();
    const log = await prisma.auditLog.findFirst({
      where: {
        actorId: editorId,
        action: "course.meta_updated",
        entityId: BUILT_IN,
      },
    });
    expect(log, "rewording audited").toBeTruthy();

    // Live at once for German learners; English learners are unaffected.
    await useSession(context, learnerSession);
    await page.goto("/de/learner");
    await expect(page.getByText("E2E Titel").first()).toBeVisible({
      timeout: 15000,
    });
    await page.goto("/en/learner");
    await expect(
      page.getByText(/handling a small workplace conflict/i).first()
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("E2E Titel")).toHaveCount(0);

    // "Use built-in wording" puts the shipped title back.
    await useSession(context, editorSession);
    await page.goto(`/en/content/courses/${BUILT_IN}?lang=de`);
    await expect(title).toHaveValue("E2E Titel", { timeout: 15000 });
    // Retry a click that landed before hydration; the button goes away once
    // the shipped wording is back.
    const restore = copy.getByRole("button", { name: /^use built-in wording$/i });
    await expect(async () => {
      if (await restore.isVisible()) await restore.click();
      await expect(title).toHaveValue(
        "Einen kleinen Konflikt am Arbeitsplatz meistern",
        { timeout: 3000 }
      );
    }).toPass({ timeout: 15000 });
    await expect(title).toHaveAccessibleDescription("");
    const after = await prisma.course.findFirst({
      where: { projectId: PROJECT, slug: BUILT_IN },
      select: { copyOverride: true },
    });
    expect(
      (after?.copyOverride as Record<string, unknown> | null)?.de,
      "German rewording removed"
    ).toBeUndefined();
  });

  test("a created course gains a Greek title without touching English", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto(`/en/content/courses/${SLUG}?lang=el`);
    const copy = page.getByRole("region", {
      name: /^course title and subtitle$/i,
    });
    await expect(copy.getByText(/not translated yet/i)).toBeVisible({
      timeout: 15000,
    });

    await copy.getByLabel(/^course title$/i).fill("E2E Ελληνικός τίτλος");
    await copy
      .getByRole("button", { name: /^save title and subtitle$/i })
      .click();
    await expect(copy.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "E2E Ελληνικός τίτλος"
    );

    const course = await prisma.course.findFirst({ where: { slug: SLUG } });
    const meta = course?.meta as Record<string, { title?: string }>;
    expect(meta.el?.title).toBe("E2E Ελληνικός τίτλος");
    expect(meta.en?.title, "English copy unchanged").toBe(TITLE);
  });

  test("an editor reorders, duplicates, removes and adds blocks; learners see it", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto(`/en/content/courses/${SLUG}?lesson=concept`);

    // ?lesson= opens that lesson and scrolls to it.
    // Visible only: when React client-renders the page while it is still
    // streaming, the server's copy can stay behind in a hidden <div>.
    const lesson = page.locator("#lesson-concept").filter({ visible: true });
    const editor = lesson.getByRole("region", { name: /lesson text/i });
    await expect(editor).toBeVisible({ timeout: 15000 });
    await expect(lesson).toBeInViewport();

    // Seeded: paragraph, callout, list.
    const blocks = editor.getByRole("group", { name: /^block \d+ of \d+/i });
    await expect(blocks).toHaveCount(3);

    // Move block 2 (the callout) down → paragraph, list, callout.
    await blocks
      .nth(1)
      .getByRole("button", { name: /^move block down$/i })
      .click();
    await expect(blocks.nth(2)).toHaveAccessibleName(/key message/i);

    // Duplicate block 1 → paragraph, paragraph, list, callout.
    await blocks
      .nth(0)
      .getByRole("button", { name: /^duplicate block$/i })
      .click();
    await expect(blocks).toHaveCount(4);

    // Remove the last block (the callout) — it can still be undone.
    await blocks
      .nth(3)
      .getByRole("button", { name: /^remove block$/i })
      .click();
    await expect(blocks).toHaveCount(3);
    await expect(editor.getByRole("button", { name: /^undo$/i })).toBeVisible();

    // Add a key message at the end, from the templates.
    await editor.getByRole("button", { name: /^add block$/i }).click();
    await editor
      .getByRole("button", { name: /^key message \(callout\)$/i })
      .click();
    await expect(blocks).toHaveCount(4);
    await editor.getByLabel(/^key message text$/i).fill("E2E remember this");

    await editor.getByRole("button", { name: /^save english$/i }).click();
    await expect(editor.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });

    const row = await prisma.lesson.findFirst({
      where: { courseSlug: SLUG, stageKey: "concept" },
    });
    const saved =
      (
        row?.narrative as {
          en?: { blocks?: { kind: string; text?: string }[] };
        } | null
      )?.en?.blocks ?? [];
    expect(saved.map((b) => b.kind)).toEqual([
      "paragraph",
      "paragraph",
      "list",
      "callout",
    ]);
    expect(saved[1].text, "the duplicate is a copy").toBe("First paragraph.");
    expect(saved[3].text).toBe("E2E remember this");

    // The course is published, so a learner sees it straight away.
    await useSession(context, learnerSession);
    await page.goto(`/en/learner/course/${SLUG}`);
    // context → concept (retry against the hydration race, as elsewhere)
    const keyMessage = page.getByText("E2E remember this").first();
    await expect(async () => {
      await page.getByRole("button", { name: /^continue$/i }).first().click();
      await expect(keyMessage).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await expect(page.getByText("Original key message.")).toHaveCount(0);
  });

  test("switching language with unsaved text asks first, and Cancel keeps it", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto(`/en/content/courses/${SLUG}?lesson=behaviour`);
    const editor = page
      .locator("#lesson-behaviour")
      .getByRole("region", { name: /lesson text/i });
    await expect(editor).toBeVisible({ timeout: 15000 });
    await editor.getByLabel(/^lesson title$/i).fill("Unsaved E2E title");

    let asked = "";
    page.once("dialog", (dialog) => {
      asked = dialog.message();
      void dialog.dismiss();
    });
    const languages = page.getByRole("group", { name: /^content language$/i });
    await languages.getByRole("button", { name: /^german/i }).click();
    await expect.poll(() => asked).toMatch(/unsaved changes/i);

    // Still English, and the typing is still there.
    await expect(
      languages.getByRole("button", { name: /^english/i })
    ).toHaveAttribute("aria-pressed", "true");
    await expect(editor.getByLabel(/^lesson title$/i)).toHaveValue(
      "Unsaved E2E title"
    );
    // Nothing was written.
    expect(
      await prisma.lesson.count({
        where: { courseSlug: SLUG, stageKey: "behaviour" },
      })
    ).toBe(0);
  });

  test("an unknown course is a not-found page; a learner gets the notice", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto("/en/content/courses/does-not-exist");
    // Next 16 streams a 200 header, so check what renders.
    await expect(
      page.getByRole("heading", { name: /couldn.t find that page/i })
    ).toBeVisible({ timeout: 15000 });

    await useSession(context, learnerSession);
    await page.goto(`/en/content/courses/${SLUG}`);
    await expect(
      page.getByRole("heading", { name: /editors only/i })
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(TITLE)).toHaveCount(0);
  });

  test("the course page, with a lesson open, has no serious a11y violations", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto(`/en/content/courses/${SLUG}?lesson=concept`);
    await expect(
      page
        .locator("#lesson-concept")
        .getByRole("region", { name: /lesson text/i })
    ).toBeVisible({ timeout: 15000 });

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
  });
});
