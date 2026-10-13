import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { StageKey } from "@prisma/client";

/**
 * Release 0, progress and translations:
 *
 * - a course created in the CMS has its own number of lessons (here five:
 *   the four narrative ones plus a guided practice), and both the learner
 *   dashboard and the facilitator's view count against those, not against
 *   the seven-step list;
 * - a German translation typed and then cleared shows German learners the
 *   English text, never a blank, and the course page warns the editor that
 *   German isn't written yet.
 *
 * Requires a real database — gated on E2E_DB=1, like db-backed-progress.
 * Everything it creates carries this run's id and is removed afterwards.
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
const SLUG = `e2e-r0-progress-${RUN}`;
const TITLE = `E2E Asking for help ${RUN}`;
const EDITOR = `e2e-r0-editor-${RUN}@example.com`;
const FACILITATOR = `e2e-r0-facilitator-${RUN}@example.com`;
const FINISHER = `e2e-r0-finisher-${RUN}@example.com`;
const HALFWAY = `e2e-r0-halfway-${RUN}@example.com`;
const HALFWAY_NAME = `E2E Halfway ${RUN}`;
const EMAILS = [EDITOR, FACILITATOR, FINISHER, HALFWAY];

const ALL_SEVEN: StageKey[] = [
  "CONTEXT",
  "CONCEPT",
  "BEHAVIOUR",
  "SIMULATION",
  "SCENARIO",
  "REFLECTION",
  "ASSESSMENT",
];
/** The lessons the course created here has, as the database names them. */
const OWN_LESSONS: StageKey[] = [
  "CONTEXT",
  "CONCEPT",
  "BEHAVIOUR",
  "SIMULATION",
  "REFLECTION",
];

/** English lesson text, and a German version cleared back to blanks. */
const lesson = (title: string, text: string) => ({
  en: { title, subtitle: "Read this first", blocks: [{ kind: "paragraph", text }] },
  de: { title: " ", subtitle: "", blocks: [{ kind: "paragraph", text: "" }] },
});

async function signedInUser(
  email: string,
  role: "CONTENT_EDITOR" | "FACILITATOR" | "LEARNER",
  name?: string
) {
  const user = await prisma.user.create({
    data: { email, name, emailVerified: new Date() },
  });
  await prisma.membership.create({
    data: { userId: user.id, projectId: PROJECT, role },
  });
  const sessionToken = `e2e-r0-${RUN}-${Math.random().toString(36).slice(2)}`;
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
 * Sign in as another user. Every open page is left first: a page's
 * in-flight /api/auth/session call re-sets the session cookie when it
 * returns, and one returning after the switch would sign the previous user
 * back in.
 */
async function useSession(
  context: import("@playwright/test").BrowserContext,
  sessionToken: string | null
) {
  for (const open of context.pages()) await open.goto("about:blank");
  await context.clearCookies();
  if (!sessionToken) return;
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

describe("Release 0 — progress per course and cleared translations", () => {
  let courseId: string;
  let editor: { userId: string; sessionToken: string };
  let facilitator: { userId: string; sessionToken: string };
  let finisher: { userId: string; sessionToken: string };
  let halfway: { userId: string; sessionToken: string };

  test.beforeAll(async () => {
    // A draft first, so the course page shows its "before you publish"
    // warnings; it is published before the learners come in.
    const course = await prisma.course.create({
      data: {
        projectId: PROJECT,
        strapiId: `cms-${SLUG}`,
        slug: SLUG,
        cluster: "communicationEi",
        durationMinutes: 15,
        status: "draft",
        meta: {
          en: {
            title: TITLE,
            tagline: "Short and real",
            clusterLabel: "Communication",
          },
          // Typed in German, then cleared again.
          de: { title: "", tagline: "  ", clusterLabel: "" },
        },
      },
    });
    courseId = course.id;
    await prisma.lesson.createMany({
      data: [
        {
          projectId: PROJECT,
          courseSlug: SLUG,
          stageKey: "context",
          narrative: lesson("The situation", "You are stuck on a task."),
        },
        {
          projectId: PROJECT,
          courseSlug: SLUG,
          stageKey: "concept",
          narrative: lesson("The skill", "Ask early and be specific."),
        },
        {
          projectId: PROJECT,
          courseSlug: SLUG,
          stageKey: "behaviour",
          narrative: lesson("What it looks like", "Say what you tried."),
        },
        {
          projectId: PROJECT,
          courseSlug: SLUG,
          stageKey: "simulation",
          structure: {
            kind: "simulation",
            title: { en: "Practise asking", de: "" },
            prompt: { en: "What do you say to your colleague?", de: " " },
            instruction: { en: "Pick one.", de: "" },
            options: [
              {
                id: "a",
                isBest: true,
                text: { en: "I tried two things; can you help?", de: "" },
                feedback: { en: "Clear and specific.", de: "" },
              },
              {
                id: "b",
                isBest: false,
                text: { en: "Never mind.", de: "" },
                feedback: { en: "They can't help if they don't know.", de: "" },
              },
            ],
          },
        },
      ],
    });

    editor = await signedInUser(EDITOR, "CONTENT_EDITOR");
    facilitator = await signedInUser(FACILITATOR, "FACILITATOR");
    finisher = await signedInUser(FINISHER, "LEARNER");
    halfway = await signedInUser(HALFWAY, "LEARNER", HALFWAY_NAME);
  });

  test.afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: EMAILS } },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: { actorId: { in: users.map((u) => u.id) } },
    });
    // Users first: their memberships, sessions and enrolments cascade away.
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.courseEnrollment.deleteMany({ where: { courseId } });
    await prisma.lesson.deleteMany({ where: { courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { slug: SLUG } });
  });

  test("the course page says German isn't written when it was cleared", async ({
    page,
    context,
  }) => {
    await useSession(context, editor.sessionToken);
    await page.goto(`/en/content/courses/${SLUG}`);
    await expect(page.getByText(/^before you publish$/i)).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByText(/no german title and subtitle yet/i)
    ).toBeVisible();
    // Context, concept, behaviour and the practice: all blank in German.
    await expect(
      page.getByText(/4 lessons have no german text yet/i)
    ).toBeVisible();
  });

  test("German learners get the English text where German was cleared", async ({
    page,
    context,
  }) => {
    await prisma.course.update({
      where: { id: courseId },
      data: { status: "published", publishedAt: new Date() },
    });
    await useSession(context, null);

    await page.goto("/de/learner");
    await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 15000 });

    await page.goto(`/de/learner/course/${SLUG}`);
    await expect(
      page.getByRole("heading", { name: "The situation" })
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("You are stuck on a task.")).toBeVisible();

    // On to the guided practice: its title, prompt and options in English.
    const weiter = () => page.getByRole("button", { name: /^weiter$/i });
    await weiter().click(); // context → concept
    await expect(page.getByRole("heading", { name: "The skill" })).toBeVisible();
    await weiter().click(); // concept → behaviour
    await expect(
      page.getByRole("heading", { name: "What it looks like" })
    ).toBeVisible();
    await weiter().click(); // behaviour → practice
    await expect(
      page.getByRole("heading", { name: "Practise asking" })
    ).toBeVisible();
    await expect(
      page.getByText("What do you say to your colleague?")
    ).toBeVisible();
    await expect(
      page.getByText("I tried two things; can you help?")
    ).toBeVisible();
  });

  test("a learner who finished every course sees 100%", async ({
    page,
    context,
  }) => {
    await useSession(context, finisher.sessionToken);
    await page.goto("/en/learner");
    await expect(
      page.getByRole("link", { name: new RegExp(TITLE) })
    ).toBeVisible({ timeout: 15000 });

    // Every course learners can open from here (coming-soon ones aren't
    // links). Each is marked finished with exactly its own lessons — five
    // for the course made here, which the seven-step count read as 5/7.
    const hrefs = await page
      .locator('a[href*="/learner/course/"]')
      .evaluateAll((links) =>
        links.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? "")
      );
    const slugs = [
      ...new Set(hrefs.map((h) => h.split("/learner/course/")[1])),
    ].filter(Boolean);
    expect(slugs).toContain(SLUG);
    for (const slug of slugs) {
      const course = await prisma.course.findFirst({
        where: { projectId: PROJECT, slug },
        select: { id: true },
      });
      expect(course, `course row for ${slug}`).toBeTruthy();
      await prisma.courseEnrollment.create({
        data: {
          userId: finisher.userId,
          courseId: course!.id,
          stagesCompleted: slug === SLUG ? OWN_LESSONS : ALL_SEVEN,
          completedAt: new Date(),
        },
      });
    }

    await page.reload();
    // The first bar is "Overall completion".
    const overall = page.getByRole("progressbar").first();
    await expect(overall).toHaveAttribute("aria-valuenow", "100", {
      timeout: 15000,
    });
    await expect(
      page.getByText(`${slugs.length} of ${slugs.length} courses completed`)
    ).toBeVisible();
  });

  test("the facilitator sees progress against the course's own lessons", async ({
    page,
    context,
  }) => {
    // Four of the course's five lessons done; Reflection is next.
    await prisma.courseEnrollment.create({
      data: {
        userId: halfway.userId,
        courseId,
        stagesCompleted: ["CONTEXT", "CONCEPT", "BEHAVIOUR", "SIMULATION"],
      },
    });

    await useSession(context, facilitator.sessionToken);
    await page.goto("/en/facilitator");
    const row = page.getByRole("listitem").filter({ hasText: HALFWAY_NAME });
    // 4 of 5, not 4 of 7 (57%).
    await expect(row).toContainText("80%", { timeout: 15000 });

    await row.getByRole("button", { name: /^open learner$/i }).click();
    const position = page.getByText("Currently on", { exact: true }).locator("..");
    // Not "Applied scenario", a step this course doesn't have.
    await expect(position).toContainText("Reflection");
  });
});
