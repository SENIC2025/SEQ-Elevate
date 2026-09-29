import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient, type Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * "Preview as learner" (D35): an editor plays a course in the real player,
 * from any lesson, and can jump to any step — and nothing they do is saved
 * (no enrolment, no progress, no badge, no statistics). Editors also get
 * "Edit this lesson", pointing at the lesson they're on; learners get
 * neither, and can't skip ahead with ?lesson=.
 *
 * Requires a real database — gated on E2E_DB=1, like db-backed-progress.
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
const EDITOR = "e2e-preview-editor@example.com";
const LEARNER = "e2e-preview-learner@example.com";
const EMAILS = [EDITOR, LEARNER];
// A draft course created here: four narrative lessons and a quick check.
const SLUG = "e2e-preview-draft";
const BUILT_IN = "workplace-conflict";

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

/** Remove the test users and everything they left behind. */
async function removeUsers() {
  const users = await prisma.user.findMany({
    where: { email: { in: EMAILS } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  // Audit rows outlive their user (actor set to null), so delete them first.
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  // Enrolments, badges, memberships and sessions cascade with the user.
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

/** Enrolments, audit rows and badges `userId` has for `slug`. */
async function tracesOf(userId: string, slug: string) {
  const course = await prisma.course.findFirst({
    where: { projectId: PROJECT, slug },
    select: { id: true },
  });
  const [enrolments, audits, badges] = await Promise.all([
    course
      ? prisma.courseEnrollment.count({
          where: { userId, courseId: course.id },
        })
      : 0,
    // course.opened is keyed by the slug, stage.time by "slug:stage".
    prisma.auditLog.count({
      where: {
        actorId: userId,
        OR: [{ entityId: slug }, { entityId: { startsWith: `${slug}:` } }],
      },
    }),
    prisma.userBadge.count({ where: { userId } }),
  ]);
  return { enrolments, audits, badges };
}

describe("Preview as learner", () => {
  let editorId: string;
  let editorSession: string;
  let learnerSession: string;

  test.beforeAll(async () => {
    await removeUsers();
    await prisma.lesson.deleteMany({ where: { courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { slug: SLUG } });

    await prisma.course.create({
      data: {
        projectId: PROJECT,
        strapiId: `cms-${SLUG}`,
        slug: SLUG,
        cluster: "communication",
        durationMinutes: 15,
        status: "draft",
        meta: {
          en: {
            title: "E2E Preview Draft",
            tagline: "previewed, never saved",
            clusterLabel: "Communication",
          },
        },
      },
    });
    for (const stageKey of ["context", "concept", "behaviour", "reflection"]) {
      await prisma.lesson.create({
        data: {
          projectId: PROJECT,
          courseSlug: SLUG,
          stageKey,
          narrative: {
            en: {
              title: `Stage ${stageKey}`,
              blocks: [{ kind: "paragraph", text: `Content for ${stageKey}.` }],
            },
          },
        },
      });
    }
    await prisma.lesson.create({
      data: {
        projectId: PROJECT,
        courseSlug: SLUG,
        stageKey: "assessment",
        structure: {
          kind: "assessment",
          title: { en: "Quick check" },
          intro: { en: "One question to finish." },
          questions: [
            {
              id: "q1",
              correctOptionId: "b",
              question: { en: "Which is an I-statement?" },
              options: [
                { id: "a", text: { en: "You always ignore me" } },
                { id: "b", text: { en: "I feel sidelined when that happens" } },
              ],
            },
          ],
        },
      },
    });

    const editor = await signedInUser(EDITOR, ["CONTENT_EDITOR"]);
    editorId = editor.userId;
    editorSession = editor.sessionToken;
    learnerSession = (await signedInUser(LEARNER, ["LEARNER"])).sessionToken;
  });

  test.afterAll(async () => {
    await removeUsers();
    await prisma.lesson.deleteMany({ where: { courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { slug: SLUG } });
  });

  test("an editor previews a draft from any lesson, and nothing is saved", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto(`/en/learner/course/${SLUG}?preview=1&lesson=assessment`);
    await expect(page.getByText(/draft preview/i).first()).toBeVisible({
      timeout: 15000,
    });

    // It opens on the quick check, not at the start.
    const steps = page.getByRole("navigation", { name: /course stages/i });
    await expect(steps.locator('[aria-current="step"]')).toContainText(
      /quick check/i
    );
    // Scoped to the visible main landmark: when React client-renders the
    // page while it is still streaming (a provider above it updated during
    // load), the server's copy of the first lesson shown can stay behind in
    // a hidden <div> at the end of <body>.
    const main = page.getByRole("main");
    await expect(main.getByText("Which is an I-statement?")).toBeVisible();
    // Only the lessons this course has: four narrative ones and the check.
    await expect(steps.getByRole("button")).toHaveCount(5);

    // Preview may jump anywhere, including back to the start…
    await steps.getByRole("button", { name: /context$/i }).click();
    await expect(page.getByText("Content for context.").first()).toBeVisible();

    // …and walk the whole course to the end.
    const cont = () => page.getByRole("button", { name: /^continue$/i }).first();
    await cont().click(); // context → concept
    await expect(page.getByText("Content for concept.").first()).toBeVisible();
    await cont().click(); // concept → behaviour
    await cont().click(); // behaviour → reflection
    await cont().click(); // reflection → assessment
    await main.getByText(/i feel sidelined/i).click();
    await page.getByRole("button", { name: /check answers/i }).click();
    await cont().click();
    await expect(
      page.getByRole("heading", { name: /course complete/i })
    ).toBeVisible({ timeout: 15000 });

    // Progress writes are debounced (700 ms): give any stray one time to land.
    await page.waitForTimeout(2000);
    expect(await tracesOf(editorId, SLUG)).toEqual({
      enrolments: 0,
      audits: 0,
      badges: 0,
    });
  });

  test("a draft is always a preview for an editor, even without ?preview", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(page.getByText(/draft preview/i).first()).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole("link", { name: /^back to editing$/i })
    ).toHaveAttribute("href", `/en/content/courses/${SLUG}?lesson=context&lang=en`);

    await page.getByRole("button", { name: /^continue$/i }).first().click();
    await expect(page.getByText("Content for concept.").first()).toBeVisible();

    await page.waitForTimeout(2000);
    expect((await tracesOf(editorId, SLUG)).enrolments).toBe(0);
    expect((await tracesOf(editorId, SLUG)).audits).toBe(0);
  });

  test("previewing a published course is sandboxed and accessible", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto(`/en/learner/course/${BUILT_IN}?preview=1&lesson=behaviour`);
    await expect(
      page.getByText(/nothing you do here is saved/i).first()
    ).toBeVisible({ timeout: 15000 });

    const steps = page.getByRole("navigation", { name: /course stages/i });
    await expect(steps.locator('[aria-current="step"]')).toContainText(
      /behaviour model/i
    );
    // Every step is reachable in a preview, the ones ahead included.
    await expect(
      steps.getByRole("button", { name: /quick check$/i })
    ).toBeEnabled();

    const lessonHref = `/en/content/courses/${BUILT_IN}?lesson=behaviour&lang=en`;
    await expect(
      page.getByRole("link", { name: /^edit this lesson$/i })
    ).toHaveAttribute("href", lessonHref);
    await expect(
      page.getByRole("link", { name: /^back to editing$/i })
    ).toHaveAttribute("href", lessonHref);

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);

    await page.getByRole("button", { name: /^continue$/i }).first().click();
    await page.waitForTimeout(2000);
    expect(await tracesOf(editorId, BUILT_IN)).toEqual({
      enrolments: 0,
      audits: 0,
      badges: 0,
    });
  });

  test("a preview in another language links back in the editor's own, and stays a preview when the menu language changes", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    // As "Preview as learner" opens it from an English course page that is
    // writing German: German player, English editor.
    await page.goto(
      `/de/learner/course/${BUILT_IN}?preview=1&lesson=behaviour&ui=en`
    );
    await expect(
      page.getByText(/nichts, was du hier tust, wird gespeichert/i).first()
    ).toBeVisible({ timeout: 15000 });
    // Both ways back open the course page with English menus, writing German.
    await expect(
      page.locator(
        `a[href="/en/content/courses/${BUILT_IN}?lesson=behaviour&lang=de"]`
      )
    ).toHaveCount(2);

    // Switching the menu language keeps the preview (and the lesson).
    await page.getByRole("combobox", { name: /^language/i }).selectOption("en");
    await expect(page).toHaveURL(
      new RegExp(
        `/en/learner/course/${BUILT_IN}\\?preview=1&lesson=behaviour&ui=en$`
      ),
      { timeout: 15000 }
    );
    await expect(
      page.getByText(/nothing you do here is saved/i).first()
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: /course stages/i })
        .locator('[aria-current="step"]')
    ).toContainText(/behaviour model/i);

    await page.getByRole("button", { name: /^continue$/i }).first().click();
    await page.waitForTimeout(2000);
    expect(await tracesOf(editorId, BUILT_IN)).toEqual({
      enrolments: 0,
      audits: 0,
      badges: 0,
    });
  });

  test("an editor on a live course gets Edit this lesson for the lesson they're on", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto(`/en/learner/course/${BUILT_IN}`);

    const edit = page.getByRole("link", { name: /^edit this lesson$/i });
    await expect(edit).toHaveAttribute(
      "href",
      `/en/content/courses/${BUILT_IN}?lesson=context&lang=en`,
      { timeout: 15000 }
    );
    // Not a preview: no banner.
    await expect(page.getByText(/nothing you do here is saved/i)).toHaveCount(0);

    await page.getByRole("button", { name: /^continue$/i }).first().click();
    await expect(edit).toHaveAttribute(
      "href",
      `/en/content/courses/${BUILT_IN}?lesson=concept&lang=en`
    );
  });

  test("a learner gets no edit link and can't skip ahead with ?lesson", async ({
    page,
    context,
  }) => {
    await useSession(context, learnerSession);
    await page.goto(`/en/learner/course/${BUILT_IN}?preview=1&lesson=assessment`);

    const steps = page.getByRole("navigation", { name: /course stages/i });
    await expect(steps.locator('[aria-current="step"]')).toContainText(
      /context/i,
      { timeout: 15000 }
    );
    await expect(
      steps.getByRole("button", { name: /quick check$/i })
    ).toBeDisabled();
    await expect(page.getByRole("link", { name: /edit this lesson/i })).toHaveCount(
      0
    );
    await expect(page.getByText(/nothing you do here is saved/i)).toHaveCount(0);
  });
});
