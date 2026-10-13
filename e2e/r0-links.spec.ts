import {
  test,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Quick links (Release 0): web and email addresses typed in lesson text
 * work as links for learners — in rich paragraphs (bold and italic ones
 * too), their lists, plain text written before rich text, list blocks, key
 * messages, compare sides and a quick check's intro; in the player and on
 * the course page. Only https, http and mailto are ever links; they open
 * in a new tab, say so to screen readers, stay readable and focusable, and
 * a long one wraps on a 320 px phone. Nothing stored changes, and the editor keeps plain text.
 *
 * Requires a real database — gated on E2E_DB=1, like db-backed-progress.
 * Seeds its own published course under names unique to this run, and
 * removes everything it made afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;
test.describe.configure({ mode: "serial", timeout: 90_000 });

const PROJECT = "seq-elevate";
// Unique per run, so parallel or interrupted runs never share data.
const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const LEARNER = `e2e-r0-links-learner-${RUN}@example.com`;
const EDITOR = `e2e-r0-links-editor-${RUN}@example.com`;
const EMAILS = [LEARNER, EDITOR];
const SLUG = `e2e-r0-links-${RUN}`;
const LESSON_TITLE = "E2E quick links lesson";
const QUIZ_INTRO = "Stuck? Read https://example.org/quiz-help first.";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const NEW_TAB = "(opens in a new tab)";

// Long enough to be wider than a 320 px screen on one line.
const LONG_URL = `https://example.org/${"a-very-long-path-segment-".repeat(6)}end`;

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

// The first lesson, written straight into the database as the CMS or a
// script could; the save action would store the same shapes.
const BLOCKS: Json[] = [
  {
    kind: "paragraph",
    text: "Read https://example.org/guide. Questions? Write to help@example.org.\n\n• Tips: https://example.org/tips\n  • mailto:team@example.org",
    rich: rich(
      p(
        t("Read "),
        t("https://example.org/guide", "bold"),
        t(". Questions? Write to "),
        t("help@example.org", "italic"),
        t(".")
      ),
      {
        type: "bulletList",
        content: [
          li(p(t("Tips: https://example.org/tips")), {
            type: "bulletList",
            content: [li(p(t("mailto:team@example.org")))],
          }),
        ],
      }
    ),
  },
  // Written before rich text: plain text, its "•" lines a list.
  {
    kind: "paragraph",
    text: `Legacy (see https://en.wikipedia.org/wiki/Mercury_(planet)).\n• Long: ${LONG_URL}`,
  },
  {
    kind: "list",
    listStyle: "bullet",
    items: ["Visit https://example.org/list.", "No address in this point"],
  },
  { kind: "callout", text: "Ask HELP@example.org any time" },
  {
    kind: "compare",
    compare: [
      { label: "Instead", text: "Guess", tone: "negative" },
      { label: "Better", text: "Check http://example.org/facts", tone: "positive" },
    ],
  },
  // Other schemes are never links, in any letter case.
  {
    kind: "paragraph",
    text: "Hostile: javascript:window.__r0Pwned=1 JAVASCRIPT:window.__r0Pwned=1 data:text/html,<b>x</b> vbscript:msgbox(1) file:///etc/passwd",
  },
  { kind: "paragraph", text: "Plain words stay plain." },
];

/** Create a user holding `role`, plus a live session; returns both ids. */
async function signedInUser(email: string, role: "CONTENT_EDITOR" | "LEARNER") {
  const user = await prisma.user.create({
    data: { email, emailVerified: new Date() },
  });
  await prisma.membership.create({
    data: { userId: user.id, projectId: PROJECT, role },
  });
  const sessionToken = `e2e-r0l-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
 * Pages the links lead to, answered here: the test never leaves the
 * machine, and a new tab still really opens.
 */
async function stubExternalSites(context: BrowserContext) {
  await context.route(/^https?:\/\/(?:[a-z]+\.)?(?:example\.org|wikipedia\.org)\//, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Elsewhere</title><p>Another site</p>",
    })
  );
}

/** The visible main landmark (a hidden server copy can linger). */
function main(page: Page) {
  return page.getByRole("main").filter({ visible: true });
}

/** A link by its visible text, with the new-tab cue in its name. */
function linkNamed(scope: Page | Locator, shown: string) {
  return scope
    .getByRole("link", { name: `${shown} ${NEW_TAB}`, exact: true })
    .filter({ visible: true });
}

async function openLessonAsLearner(page: Page) {
  await page.goto(`/en/learner/course/${SLUG}`);
  await expect(
    main(page).getByRole("heading", { level: 2, name: LESSON_TITLE })
  ).toBeVisible({ timeout: 15000 });
  return main(page);
}

/** Every link the lesson text should show, and where it goes. */
async function expectLessonLinks(scope: Page | Locator) {
  const expected: [shown: string, href: string][] = [
    ["https://example.org/guide", "https://example.org/guide"],
    ["help@example.org", "mailto:help@example.org"],
    ["https://example.org/tips", "https://example.org/tips"],
    ["mailto:team@example.org", "mailto:team@example.org"],
    [
      "https://en.wikipedia.org/wiki/Mercury_(planet)",
      "https://en.wikipedia.org/wiki/Mercury_(planet)",
    ],
    [LONG_URL, LONG_URL],
    ["https://example.org/list", "https://example.org/list"],
    ["HELP@example.org", "mailto:HELP@example.org"],
    ["http://example.org/facts", "http://example.org/facts"],
  ];
  for (const [shown, href] of expected) {
    const link = linkNamed(scope, shown);
    await expect(link, shown).toHaveCount(1);
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }

  // Bold and italic stay inside the link.
  await expect(
    linkNamed(scope, "https://example.org/guide").locator("strong")
  ).toHaveText("https://example.org/guide");
  await expect(
    linkNamed(scope, "help@example.org").locator("em")
  ).toHaveText("help@example.org");
  // Links in a rich list, nested too, and in plain text's list.
  await expect(
    scope.locator("li li").filter({ visible: true }).getByRole("link")
  ).toHaveText(`mailto:team@example.org ${NEW_TAB}`);
  await expect(
    scope
      .locator("ul.list-disc > li")
      .filter({ hasText: "Visit", visible: true })
  ).toHaveText(`Visit https://example.org/list ${NEW_TAB}.`);

  // Punctuation and the closing bracket stay outside the link.
  const legacy = scope
    .locator(".seq-prose p")
    .filter({ hasText: "Legacy", visible: true });
  await expect(legacy).toHaveText(
    `Legacy (see https://en.wikipedia.org/wiki/Mercury_(planet) ${NEW_TAB}).`
  );

  // Only http(s) and mailto, nothing else becomes a link.
  const hrefs = await scope
    .locator("a.seq-link")
    .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThanOrEqual(expected.length);
  for (const href of hrefs) expect(href).toMatch(/^(?:https?:\/\/|mailto:)/);
  const hostile = scope
    .locator(".seq-prose")
    .filter({ hasText: "Hostile:", visible: true });
  await expect(hostile).toContainText("javascript:window.__r0Pwned=1");
  await expect(hostile).toContainText("JAVASCRIPT:window.__r0Pwned=1");
  await expect(hostile).toContainText("data:text/html,<b>x</b>");
  await expect(hostile.locator("a, b")).toHaveCount(0);
  await expect(
    scope
      .locator(".seq-prose")
      .filter({ hasText: "Plain words stay plain.", visible: true })
      .locator("a, .seq-link")
  ).toHaveCount(0);
}

describe("Quick links in lesson text", () => {
  let learnerSession: string;
  let editorSession: string;

  test.beforeAll(async () => {
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
            title: "E2E Quick Links",
            tagline: "addresses that work",
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
    // A quick check whose intro has an address: practice-lesson text
    // that the course page shows editors through the same renderer.
    await prisma.lesson.create({
      data: {
        projectId: PROJECT,
        courseSlug: SLUG,
        stageKey: "assessment",
        structure: {
          kind: "assessment",
          title: { en: "Quick check" },
          intro: { en: QUIZ_INTRO },
          questions: [
            {
              id: "q1",
              correctOptionId: "a",
              question: { en: "Where do you look first?" },
              options: [
                { id: "a", text: { en: "The help page" } },
                { id: "b", text: { en: "Nowhere" } },
              ],
            },
          ],
        },
      },
    });
    learnerSession = (await signedInUser(LEARNER, "LEARNER")).sessionToken;
    editorSession = (await signedInUser(EDITOR, "CONTENT_EDITOR")).sessionToken;
  });

  test.afterAll(async () => {
    // Both users' audit rows: the editor's saves, and the learner's
    // course opens and time on lessons. Filtered through the users' emails,
    // a constant of this run, so the filter can never come out empty and
    // match every row (an unset id would, if beforeAll failed early). Done
    // before the users go: deleting a user keeps their rows, unowned.
    await prisma.auditLog.deleteMany({
      where: { actor: { is: { email: { in: EMAILS } } } },
    });
    // Users first: their enrolments and sessions cascade away with them.
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.lesson.deleteMany({ where: { courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { slug: SLUG } });
    await prisma.$disconnect();
  });

  test("a learner gets working links for the addresses typed in the lesson", async ({
    page,
    context,
  }) => {
    await useSession(context, learnerSession);
    const lesson = await openLessonAsLearner(page);
    await expectLessonLinks(lesson);
    // Nothing the hostile text carried ran.
    expect(
      await page.evaluate(
        () => (window as unknown as { __r0Pwned?: unknown }).__r0Pwned
      )
    ).toBeUndefined();
  });

  test("a link opens in a new tab, without a handle back to the lesson", async ({
    page,
    context,
  }) => {
    await useSession(context, learnerSession);
    await stubExternalSites(context);
    const lesson = await openLessonAsLearner(page);

    const opened = context.waitForEvent("page");
    await linkNamed(lesson, "https://example.org/guide").click();
    const tab = await opened;
    await tab.waitForLoadState();
    expect(tab.url()).toBe("https://example.org/guide");
    // noopener and noreferrer, as the other site sees it.
    expect(await tab.evaluate(() => window.opener)).toBeNull();
    expect(await tab.evaluate(() => document.referrer)).toBe("");
    await tab.close();
    // The lesson is still where the learner left it.
    await expect(
      main(page).getByRole("heading", { level: 2, name: LESSON_TITLE })
    ).toBeVisible();
  });

  test("links are underlined, readable, and show a clear focus ring", async ({
    page,
    context,
  }) => {
    await useSession(context, learnerSession);
    const lesson = await openLessonAsLearner(page);
    const link = linkNamed(lesson, "https://example.org/tips");
    await expect(link).toHaveCSS("text-decoration-line", "underline");

    // Keyboard focus, as a learner tabbing through the lesson gets it.
    await page.keyboard.press("Shift");
    await link.focus();
    await expect(link).toBeFocused();
    await expect(link).toHaveCSS("outline-style", "solid");
    await expect(link).toHaveCSS("outline-width", "2px");

    const scan = async () => {
      // Colours fade over 150 ms (transition-colors) after a change such as
      // switching high contrast on; measured mid-fade they are a blend of
      // the two themes. Scan what learners end up seeing.
      await page.waitForFunction(() =>
        document.getAnimations().every((a) => a.playState !== "running")
      );
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      // Each failing rule with the elements it failed on, so a failure says
      // where to look.
      return results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    };
    expect(await scan()).toEqual([]);

    // The reading-help high-contrast setting: still readable, bolder line.
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-contrast", "true")
    );
    await expect(link).toHaveCSS("text-decoration-thickness", "2px");
    expect(await scan()).toEqual([]);
  });

  test("a long address wraps on a 320 px phone instead of widening the page", async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await useSession(context, learnerSession);
    const lesson = await openLessonAsLearner(page);
    const link = linkNamed(lesson, LONG_URL);
    await link.scrollIntoViewIfNeeded();
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
  });

  test("nothing stored changed: the links exist only on the page", async ({
    page,
    context,
  }) => {
    await useSession(context, learnerSession);
    await openLessonAsLearner(page);
    const row = await prisma.lesson.findUnique({
      where: {
        projectId_courseSlug_stageKey: {
          projectId: PROJECT,
          courseSlug: SLUG,
          stageKey: "context",
        },
      },
    });
    expect(row?.narrative).toEqual({
      en: { title: LESSON_TITLE, blocks: JSON.parse(JSON.stringify(BLOCKS)) },
    });
  });

  test("the course page shows editors the same links", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto(`/en/content/courses/${SLUG}`);
    // A closed lesson shows its read view — the learner's renderer.
    const lesson = page.locator("#lesson-context").filter({ visible: true });
    await expect(linkNamed(lesson, "https://example.org/guide")).toBeVisible({
      timeout: 15000,
    });
    await expectLessonLinks(lesson);

    // Practice-lesson text too: the quick check's intro is a link on the
    // course page and, the same, in the player.
    const quiz = page.locator("#lesson-assessment").filter({ visible: true });
    await expect(linkNamed(quiz, "https://example.org/quiz-help")).toHaveAttribute(
      "href",
      "https://example.org/quiz-help"
    );
    await page.goto(`/en/learner/course/${SLUG}?preview=1&lesson=assessment`);
    const player = main(page);
    await expect(
      player.getByRole("heading", { level: 2, name: "Quick check" })
    ).toBeVisible({ timeout: 15000 });
    await expect(
      player.locator("p").filter({ hasText: "Stuck?", visible: true })
    ).toHaveText(`Stuck? Read https://example.org/quiz-help ${NEW_TAB} first.`);
    await expect(linkNamed(player, "https://example.org/quiz-help")).toHaveAttribute(
      "href",
      "https://example.org/quiz-help"
    );
  });

  test("an author types an address; it's saved as plain text and works for learners", async ({
    page,
    context,
  }) => {
    const conceptKey = {
      projectId_courseSlug_stageKey: {
        projectId: PROJECT,
        courseSlug: SLUG,
        stageKey: "concept",
      },
    };
    await prisma.lesson.upsert({
      where: conceptKey,
      create: {
        projectId: PROJECT,
        courseSlug: SLUG,
        stageKey: "concept",
        narrative: {
          en: {
            title: "Typed links lesson",
            blocks: [{ kind: "paragraph", text: "Start here." }],
          },
        },
      },
      update: {},
    });

    await useSession(context, editorSession);
    await page.goto(`/en/content/courses/${SLUG}?lesson=concept`);
    const region = page
      .locator("#lesson-concept")
      .filter({ visible: true })
      .getByRole("region", { name: /lesson text/i });
    await expect(region).toBeVisible({ timeout: 15000 });
    const block = region.getByRole("group", { name: /^block 1 of 1/i });

    // Open the paragraph's editor from its preview (retried: a click
    // before hydration does nothing), and type at the end.
    const preview = block.getByRole("button", { name: /^edit paragraph$/i });
    const textbox = block.getByRole("textbox", { name: /^paragraph text$/i });
    await expect(async () => {
      if (await preview.isVisible()) await preview.click({ timeout: 2000 });
      await expect(textbox).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30000 });
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" Visit https://example.org/typed, or mail typed@example.org.");
    // The editor keeps plain text: no link while editing.
    await expect(textbox.locator("a")).toHaveCount(0);

    await region.getByRole("button", { name: /^save english$/i }).click();
    await expect(region.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });

    // Stored as typed: plain text, no link mark, no href.
    const row = await prisma.lesson.findUnique({ where: conceptKey });
    const saved = JSON.stringify(row?.narrative ?? null);
    expect(saved).toContain("https://example.org/typed");
    expect(saved).toContain("typed@example.org");
    expect(saved).not.toMatch(/"link"|href/);

    // The block's preview looks like the learner's, but its addresses
    // aren't links: the preview itself is the button that opens the editor.
    await page.goto(`/en/content/courses/${SLUG}?lesson=concept`);
    const reopened = page
      .locator("#lesson-concept")
      .filter({ visible: true })
      .getByRole("button", { name: /^edit paragraph$/i });
    await expect(reopened.locator(".seq-link").first()).toHaveText(
      "https://example.org/typed",
      { timeout: 15000 }
    );
    await expect(reopened.locator("a")).toHaveCount(0);

    // In the player (the editor's preview of it), they are links.
    await page.goto(`/en/learner/course/${SLUG}?preview=1&lesson=concept`);
    const player = main(page);
    await expect(
      player.getByRole("heading", { name: "Typed links lesson" })
    ).toBeVisible({ timeout: 15000 });
    await expect(linkNamed(player, "https://example.org/typed")).toHaveAttribute(
      "href",
      "https://example.org/typed"
    );
    await expect(linkNamed(player, "typed@example.org")).toHaveAttribute(
      "href",
      "mailto:typed@example.org"
    );
  });
});
