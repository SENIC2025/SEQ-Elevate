import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Rich lesson text as learners see it (D36): bold, italic, nested lists and
 * indents from the editor's stored format, next to plain text written
 * before it, which must look as it always did. Stored content is checked
 * again on every render, so a lesson written straight into the database
 * can't put links, images or scripts in front of learners. The course
 * page's read view uses the same renderer, so editors see the same.
 *
 * Requires a real database — gated on E2E_DB=1, like db-backed-progress.
 * Seeds its own published course and cleans up after itself.
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
const LEARNER = "e2e-rich-text-learner@example.com";
const EDITOR = "e2e-rich-text-editor@example.com";
const EMAILS = [LEARNER, EDITOR];
const SLUG = "e2e-rich-text";
const LESSON_TITLE = "E2E formatted lesson";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// Rich text as the editor stores it (src/lib/rich-text/types.ts), written
// here straight into the database — as the external CMS or a script could.
type Json = Prisma.InputJsonObject;
const t = (text: string, ...marks: string[]): Json =>
  marks.length
    ? { type: "text", text, marks: marks.map((type) => ({ type })) }
    : { type: "text", text };
const p = (...content: Json[]): Json => ({ type: "paragraph", content });
const li = (...content: Json[]): Json => ({ type: "listItem", content });
const rich = (...content: Json[]): Json => ({
  v: 1,
  doc: { type: "doc", content },
});

const BLOCKS: Json[] = [
  {
    kind: "paragraph",
    // The plain text the save action derives beside it.
    text: "Before you reply, pause first and ask why.\n\n• Notice your first reaction\n• Name the feeling\n\nThen decide.",
    rich: rich(
      p(
        t("Before you reply, "),
        t("pause first", "bold"),
        t(" and "),
        t("ask why", "italic"),
        t(".")
      ),
      {
        type: "bulletList",
        content: [
          li(p(t("Notice your first reaction")), {
            type: "bulletList",
            content: [li(p(t("Name the feeling")))],
          }),
        ],
      },
      { type: "paragraph", attrs: { indent: 2 }, content: [t("Then decide.")] }
    ),
  },
  // Written before rich text: "•" lines are a list, as in Round 1.
  {
    kind: "paragraph",
    text: "Legacy lead-in:\n• Legacy point one\n• Legacy point two",
  },
  {
    kind: "list",
    listStyle: "bullet",
    items: ["Bullet block A", "Bullet block B"],
  },
  // No listStyle: numbered, as every list was before.
  { kind: "list", items: ["Numbered block 1", "Numbered block 2"] },
  // Everything the renderer must refuse to render as markup.
  {
    kind: "callout",
    text: "Hostile plain fallback",
    rich: rich(
      {
        type: "paragraph",
        attrs: { style: "color: red", onclick: "window.__rtPwned = 1" },
        content: [
          t("Hostile <script>window.__rtPwned = 1</script> text"),
          {
            type: "image",
            attrs: { src: "/x.png", onerror: "window.__rtPwned = 1" },
          },
          {
            type: "text",
            text: " and a link",
            marks: [
              {
                type: "link",
                attrs: { href: "javascript:window.__rtPwned = 1" },
              },
              { type: "italic" },
            ],
          },
        ],
      },
      { type: "image", attrs: { src: "/y.png" } },
      { type: "heading", attrs: { level: 1 }, content: [t("Hostile heading")] }
    ),
  },
  // A format version this deployment doesn't know: its plain text shows.
  {
    kind: "paragraph",
    text: "Newer format fallback",
    rich: {
      v: 2,
      doc: { type: "doc", content: [p(t("Only a newer version shows this"))] },
    },
  },
];

/** Create a user holding `role`, plus a live session; returns both ids. */
async function signedInUser(email: string, role: "CONTENT_EDITOR" | "LEARNER") {
  const user = await prisma.user.create({
    data: { email, emailVerified: new Date() },
  });
  await prisma.membership.create({
    data: { userId: user.id, projectId: PROJECT, role },
  });
  const sessionToken = `e2e-rt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
 * Sign in as another user. Open pages are left first: a page's in-flight
 * /api/auth/session call re-sets the session cookie when it returns, and
 * one returning after the switch would sign the previous user back in.
 */
async function useSession(
  context: import("@playwright/test").BrowserContext,
  sessionToken: string
) {
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
 * The rendered block holding `text`. Visible only: when React
 * client-renders a page while it is still streaming, the server's copy can
 * stay behind in a hidden <div>.
 */
function prose(scope: Page | Locator, text: string) {
  return scope.locator(".seq-prose").filter({ hasText: text, visible: true });
}

/** The formatting checks, the same wherever the lesson is shown. */
async function expectFormatted(scope: Page | Locator) {
  const formatted = prose(scope, "Before you reply");
  await expect(formatted.locator("strong")).toHaveText("pause first");
  await expect(formatted.locator("em")).toHaveText("ask why");
  // A nested list, inside its parent item; deeper bullets change shape.
  const outer = formatted.locator(":scope > ul");
  await expect(outer.locator(":scope > li")).toHaveCount(1);
  await expect(outer.locator(":scope > li > ul > li")).toHaveText(
    "Name the feeling"
  );
  await expect(outer).toHaveCSS("list-style-type", "disc");
  await expect(outer.locator("ul")).toHaveCSS("list-style-type", "circle");
  // Two indent steps of 1.5rem.
  await expect(
    formatted.locator("p", { hasText: "Then decide." })
  ).toHaveAttribute("style", /padding-inline-start:\s*3rem/);

  // Plain text from before rich text: its "•" lines are still a list.
  const legacy = prose(scope, "Legacy lead-in:");
  await expect(legacy.locator("p")).toHaveText("Legacy lead-in:");
  await expect(legacy.locator("ul > li")).toHaveText([
    "Legacy point one",
    "Legacy point two",
  ]);

  // List blocks: bullets when the author chose them, numbers otherwise.
  const bullets = scope
    .locator("ul.list-disc")
    .filter({ hasText: "Bullet block", visible: true });
  await expect(bullets.getByRole("listitem")).toHaveText([
    "Bullet block A",
    "Bullet block B",
  ]);
  await expect(
    scope.locator("ol", { hasText: "Bullet block A" })
  ).toHaveCount(0);
  const numbers = scope
    .locator("ol.list-decimal")
    .filter({ hasText: "Numbered block", visible: true });
  await expect(numbers.getByRole("listitem")).toHaveText([
    "Numbered block 1",
    "Numbered block 2",
  ]);

  // A format version it doesn't know shows the block's plain text.
  await expect(prose(scope, "Newer format fallback")).toBeVisible();
  await expect(
    scope.getByText("Only a newer version shows this")
  ).toHaveCount(0);
}

/** Hostile stored content is shown as text, never as markup. */
async function expectInert(scope: Page | Locator) {
  const hostile = prose(scope, "Hostile");
  await expect(hostile).toHaveClass(/\bseq-prose-compact\b/);
  // The script tag is text on the page, not an element.
  await expect(hostile).toContainText(
    "Hostile <script>window.__rtPwned = 1</script> text and a link"
  );
  // The link mark is dropped, the italic kept.
  await expect(hostile.locator("em")).toHaveText("and a link");
  await expect(
    hostile.locator("[style], [onclick], [onerror], [href], [src]")
  ).toHaveCount(0);
  await expect(scope.getByText("Hostile heading")).toHaveCount(0);
  await expect(scope.getByText("Hostile plain fallback")).toHaveCount(0);
  await expect(
    scope.locator(
      ".seq-prose a, .seq-prose img, .seq-prose script, .seq-prose h1, .seq-prose [style*='url']"
    )
  ).toHaveCount(0);
}

describe("Rich lesson text — what learners see", () => {
  let learnerSession: string;
  let editorSession: string;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.lesson.deleteMany({ where: { courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { slug: SLUG } });

    // Published, so a learner can open it.
    await prisma.course.create({
      data: {
        projectId: PROJECT,
        strapiId: `cms-${SLUG}`,
        slug: SLUG,
        cluster: "communication",
        durationMinutes: 10,
        status: "published",
        publishedAt: new Date(),
        meta: {
          en: {
            title: "E2E Rich Text",
            tagline: "formatted lesson text",
            clusterLabel: "Communication",
          },
        },
      },
    });
    // The first lesson, so it's what the player opens on.
    await prisma.lesson.create({
      data: {
        projectId: PROJECT,
        courseSlug: SLUG,
        stageKey: "context",
        narrative: { en: { title: LESSON_TITLE, blocks: BLOCKS } },
      },
    });

    learnerSession = (await signedInUser(LEARNER, "LEARNER")).sessionToken;
    editorSession = (await signedInUser(EDITOR, "CONTENT_EDITOR")).sessionToken;
  });

  test.afterAll(async () => {
    // Users first: their enrolments and sessions cascade away with them.
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.lesson.deleteMany({ where: { courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { slug: SLUG } });
  });

  test("a learner sees the author's formatting, and old text as before", async ({
    page,
    context,
  }) => {
    await useSession(context, learnerSession);
    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(
      page.getByRole("heading", { level: 2, name: LESSON_TITLE })
    ).toBeVisible({ timeout: 15000 });

    await expectFormatted(page);
  });

  test("hostile stored content stays text for learners", async ({
    page,
    context,
  }) => {
    await useSession(context, learnerSession);
    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(
      page.getByRole("heading", { level: 2, name: LESSON_TITLE })
    ).toBeVisible({ timeout: 15000 });

    await expectInert(page);
    // Nothing it carried ran.
    expect(
      await page.evaluate(
        () => (window as unknown as { __rtPwned?: unknown }).__rtPwned
      )
    ).toBeUndefined();
  });

  test("the lesson with rich text has no serious a11y violations", async ({
    page,
    context,
  }) => {
    await useSession(context, learnerSession);
    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(prose(page, "Before you reply")).toBeVisible({
      timeout: 15000,
    });

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
  });

  test("the course page shows editors the lesson exactly as learners see it", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto(`/en/content/courses/${SLUG}`);
    // A closed lesson shows its read view — the learner's renderer.
    const lesson = page.locator("#lesson-context").filter({ visible: true });
    await expect(prose(lesson, "Before you reply")).toBeVisible({
      timeout: 15000,
    });

    await expectFormatted(lesson);
    await expectInert(lesson);
  });
});
