import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient, type Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * "Manage courses" (D33): editors see every course as a card — drafts
 * included — with links into the course page, into each lesson, and to a
 * learner preview; "New course" creates one and opens its page. Nobody else
 * sees any of it.
 *
 * Requires a real database — gated on E2E_DB=1, like db-backed-progress.
 * Other specs create and re-publish courses in parallel, so every assertion
 * is scoped to one card, found by its own course link (a title can be
 * reworded on the course page; the slug can't).
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
const EDITOR = "e2e-grid-editor@example.com";
const LEARNER = "e2e-grid-learner@example.com";
const EMAILS = [EDITOR, LEARNER];

// A draft created in the CMS: no interactive lessons, English copy only.
const SEEDED = { slug: "e2e-grid-course", title: "E2E Grid Course" };
// Made through "New course" in the third test.
const CREATED = { slug: "e2e-grid-new-course", title: "E2E Grid New Course" };
const SLUGS = [SEEDED.slug, CREATED.slug];

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Create a user holding `roles`, plus a live session; returns its token. */
async function signedInUser(email: string, roles: Role[]) {
  const user = await prisma.user.create({
    data: { email, emailVerified: new Date() },
  });
  for (const role of roles) {
    await prisma.membership.create({
      data: { userId: user.id, projectId: PROJECT, role },
    });
  }
  const sessionToken = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await prisma.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 86_400_000),
    },
  });
  return { userId: user.id, sessionToken };
}

async function useSession(
  context: import("@playwright/test").BrowserContext,
  sessionToken: string
) {
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

/** One course's card, found by the link to its course page. */
function card(page: Page, slug: string) {
  return page
    .getByRole("article")
    .filter({ has: page.locator(`a[href="/en/content/courses/${slug}"]`) });
}

async function cleanUp() {
  const users = await prisma.user.findMany({
    where: { email: { in: EMAILS } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: { actorId: { in: users.map((u) => u.id) } },
  });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
  await prisma.lesson.deleteMany({ where: { courseSlug: { in: SLUGS } } });
  await prisma.course.deleteMany({ where: { slug: { in: SLUGS } } });
}

describe("Manage courses grid", () => {
  let editorSession: string;
  let learnerSession: string;

  test.beforeAll(async () => {
    await cleanUp();
    editorSession = (await signedInUser(EDITOR, ["CONTENT_EDITOR"]))
      .sessionToken;
    learnerSession = (await signedInUser(LEARNER, ["LEARNER"])).sessionToken;
    await prisma.course.create({
      data: {
        projectId: PROJECT,
        strapiId: `cms-${SEEDED.slug}`,
        slug: SEEDED.slug,
        cluster: "communication",
        durationMinutes: 15,
        status: "draft",
        meta: {
          en: {
            title: SEEDED.title,
            tagline: "seeded for the grid test",
            clusterLabel: "Communication",
          },
        },
      },
    });
  });

  test.afterAll(async () => {
    await cleanUp();
  });

  test("an editor sees every course as a card, with links into it", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto("/en/content/courses");
    await expect(
      page.getByRole("heading", { level: 1, name: "Manage courses" })
    ).toBeVisible();

    // A built-in course: all seven lessons, one link each.
    const builtIn = card(page, "workplace-conflict");
    await expect(builtIn).toBeVisible();
    await expect(builtIn.getByText("7 lessons")).toBeVisible();
    await expect(builtIn.getByText("Built-in", { exact: true })).toBeVisible();
    await expect(
      builtIn.getByRole("link", { name: "Edit lesson 3: Behaviour model" })
    ).toHaveAttribute(
      "href",
      "/en/content/courses/workplace-conflict?lesson=behaviour"
    );
    const preview = builtIn.getByRole("link", { name: /preview as learner/i });
    await expect(preview).toHaveAttribute(
      "href",
      "/en/learner/course/workplace-conflict?preview=1"
    );
    await expect(preview).toHaveAttribute("target", "_blank");

    // A draft created here: the four lessons it has, numbered 1-4.
    const seeded = card(page, SEEDED.slug);
    await expect(seeded).toBeVisible();
    await expect(
      seeded.getByRole("heading", { level: 2, name: SEEDED.title })
    ).toBeVisible();
    await expect(seeded.getByText(/^draft$/i)).toBeVisible();
    await expect(seeded.getByText("Created here", { exact: true })).toBeVisible();
    await expect(seeded.getByText("4 lessons")).toBeVisible();
    await expect(seeded.getByText("Nobody enrolled yet")).toBeVisible();
    // Language state is spoken, not only shown by an icon.
    await expect(seeded.getByText("German: not started")).toHaveCount(1);
    await expect(
      seeded.getByRole("link", { name: "Edit lesson 4: Reflection" })
    ).toHaveAttribute("href", `/en/content/courses/${SEEDED.slug}?lesson=reflection`);
    await expect(seeded.getByRole("link", { name: /^edit lesson/i })).toHaveCount(4);
    await expect(
      seeded.getByRole("link", { name: /preview as learner/i })
    ).toHaveAttribute("href", `/en/learner/course/${SEEDED.slug}?preview=1`);

    // The whole card is the link: a click on its body opens the course page.
    // (force: the card link's overlay, not the text, receives the click.)
    await seeded.getByText("4 lessons").click({ force: true });
    await expect(page).toHaveURL(new RegExp(`/en/content/courses/${SEEDED.slug}$`));
  });

  test("learners and guests get the editors-only notice, and no courses", async ({
    page,
    context,
  }) => {
    await useSession(context, learnerSession);
    await page.goto("/en/content/courses");
    await expect(
      page.getByRole("heading", { level: 1, name: /editors only/i })
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.getByText(SEEDED.title)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /new course/i })).toHaveCount(0);

    await context.clearCookies();
    await page.goto("/en/content/courses");
    await expect(
      page.getByRole("heading", { level: 1, name: /editors only/i })
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.getByText(SEEDED.title)).toHaveCount(0);
  });

  test("New course creates a draft and opens its course page", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto("/en/content/courses");

    const toggle = page.getByRole("button", { name: /new course/i });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await page.getByLabel(/^title$/i).fill(CREATED.title);
    await page.getByLabel(/^tagline$/i).fill("Made from the grid");
    await page.getByLabel(/skill area/i).fill("Communication");
    await page.getByRole("button", { name: /create draft/i }).click();

    await expect(page).toHaveURL(
      new RegExp(`/en/content/courses/${CREATED.slug}(\\?|$)`),
      { timeout: 15000 }
    );
    const row = await prisma.course.findFirst({
      where: { projectId: PROJECT, slug: CREATED.slug },
    });
    expect(row?.status, "starts as a draft").toBe("draft");
  });

  test("the grid passes axe and fits a 360px phone", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto("/en/content/courses");
    await expect(card(page, SEEDED.slug)).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);

    await page.setViewportSize({ width: 360, height: 800 });
    await expect(card(page, SEEDED.slug)).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    );
    expect(overflow, "no horizontal scrolling").toBeLessThanOrEqual(0);
  });
});
