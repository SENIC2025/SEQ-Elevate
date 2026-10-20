import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Release 1's publish guard (D57, spec 5 and 13.2 item 3), as Release 2
 * lifts it (D66, spec 7.1). A created course publishes as built: its own
 * lessons, hidden ones, a new order and added content no longer hold it
 * back, on the page or on the server (a stale page publishes too). Only a
 * course with no lesson learners would see is refused before anything is
 * pressed: Publish says why and stays focusable, taking focus to the
 * reason. Changes to the list and the content ask nothing while nobody is
 * taking the course; a reorder from a page that didn't know the course had
 * a learner is asked about, with the count the server found. Renaming says
 * nothing about later dates, and a course published with lessons of its own
 * no longer tells its editors that learners miss any of it. (What learners
 * get is the learner player's: r2-player.spec.ts.)
 *
 * Requires a real database — gated on E2E_DB=1, like db-backed-progress.
 * Everything it creates is unique to this run and removed afterwards; the
 * page is driven into a refusal with the stale-page technique (addendum 6):
 * open it, change the course through Prisma, then press the control.
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
const EDITOR = `e2e-r1-guard-editor-${RUN}@example.com`;
const LEARNER = `e2e-r1-guard-learner-${RUN}@example.com`;
const EMAILS = [EDITOR, LEARNER];
/** A course built like the preview's (custom, hidden, reordered, extra content). */
const FLEX = `e2e-r1-guard-flex-${RUN}`;
/** A standard draft: refused when stale, then made non-standard and undone. */
const STALE = `e2e-r1-guard-stale-${RUN}`;
/** A standard course whose lessons get names of their own. */
const NAMED = `e2e-r1-guard-named-${RUN}`;
/** Seeded non-standard and published (an old tab, a rollback). */
const BYPASS = `e2e-r1-guard-bypass-${RUN}`;
/** A standard draft whose only reason is content added to a lesson. */
const EXTRA = `e2e-r1-guard-extra-${RUN}`;
const SLUGS = [FLEX, STALE, NAMED, BYPASS, EXTRA];
const CUSTOM = "s-guard001";
const OWN_TEXT = "E2E guard: a lesson of the course's own.";

const para = (text: string) => ({ kind: "paragraph", text });
const written = (title: string, text = `${title} text.`) => ({ en: { title, blocks: [para(text)] } });
const SCENARIO = {
  kind: "scenario",
  setup: { en: "A colleague takes credit for your idea." },
  question: { en: "What do you do?" },
  followupQuestion: {},
  choices: [
    { id: "c1", quality: "best", text: { en: "Talk to them after" }, outcome: { en: "They listen." } },
    { id: "c2", quality: "poor", text: { en: "Say nothing" }, outcome: { en: "It happens again." } },
  ],
};
const NARRATIVE_KEYS = ["context", "concept", "behaviour", "reflection"] as const;
const standard = (keys: readonly string[]) => keys.map((id) => ({ id, template: id }));

type Section = { id: string; template: string; hidden?: true; label?: Record<string, string> };

async function seedCourse(
  slug: string,
  opts: {
    status?: "draft" | "published";
    outline?: { v: 1; sections: Section[]; removed?: string[] };
    scenario?: boolean;
    custom?: boolean;
    conceptParts?: unknown;
  } = {}
) {
  await prisma.course.create({
    data: {
      projectId: PROJECT,
      strapiId: `cms-${slug}`,
      slug,
      cluster: "communication",
      durationMinutes: 15,
      status: opts.status ?? "draft",
      publishedAt: opts.status === "published" ? new Date() : null,
      meta: { en: { title: `E2E Guard ${slug}`, tagline: "guard", clusterLabel: "Communication" } },
      ...(opts.outline ? { outline: opts.outline as Prisma.InputJsonValue } : {}),
    },
  });
  for (const stageKey of NARRATIVE_KEYS) {
    await prisma.lesson.create({
      data: {
        projectId: PROJECT,
        courseSlug: slug,
        stageKey,
        narrative: written(`E2E ${stageKey}`) as Prisma.InputJsonValue,
        ...(stageKey === "concept" && opts.conceptParts
          ? { parts: opts.conceptParts as Prisma.InputJsonValue }
          : {}),
      },
    });
  }
  if (opts.scenario) {
    await prisma.lesson.create({
      data: { projectId: PROJECT, courseSlug: slug, stageKey: "scenario", structure: SCENARIO },
    });
  }
  if (opts.custom) {
    await prisma.lesson.create({
      data: {
        projectId: PROJECT,
        courseSlug: slug,
        stageKey: CUSTOM,
        narrative: written("Wrap-up", OWN_TEXT) as Prisma.InputJsonValue,
      },
    });
  }
}

async function setOutline(slug: string, outline: unknown) {
  await prisma.course.updateMany({
    where: { projectId: PROJECT, slug },
    data: { outline: outline === null ? Prisma.DbNull : (outline as Prisma.InputJsonValue) },
  });
}

async function statusOf(slug: string) {
  const course = await prisma.course.findFirstOrThrow({
    where: { projectId: PROJECT, slug },
    select: { status: true },
  });
  return course.status;
}

/** Create a user holding `role`, plus a live session; returns both ids. */
async function signedInUser(email: string, role: "CONTENT_EDITOR" | "LEARNER") {
  const user = await prisma.user.create({ data: { email, emailVerified: new Date() } });
  await prisma.membership.create({ data: { userId: user.id, projectId: PROJECT, role } });
  const sessionToken = `e2e-r1g-${RUN}-${Math.random().toString(36).slice(2)}`;
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 86_400_000) },
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

const lessonList = (page: Page) =>
  page.getByRole("navigation", { name: /^lessons$/i }).filter({ visible: true });
const publishing = (page: Page) =>
  page.getByRole("region", { name: /^publishing$/i }).filter({ visible: true });

async function openCourse(page: Page, slug: string) {
  await page.goto(`/en/content/courses/${slug}`);
  await expect(lessonList(page).getByRole("link").first()).toBeVisible({ timeout: 15000 });
}

/**
 * Open "Actions for <label>", retried against the hydration race: it is
 * pressed only while still closed, so a slow first press is never undone.
 * Once it opens the page is hydrated, so a single press elsewhere is safe.
 */
async function openActions(page: Page, label: string): Promise<Locator> {
  const toggle = lessonList(page).getByRole("button", { name: `Actions for ${label}`, exact: true });
  await expect(async () => {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 2000 });
  }).toPass({ timeout: 15000 });
  return lessonList(page).getByRole("group", { name: `Actions for ${label}`, exact: true });
}

describe("Release 1 — the publish guard", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  let editorSession: string;

  test.beforeAll(async () => {
    // Like the preview's course: a lesson of its own named in English and
    // German, context hidden, the scenario before the behaviour model, and
    // extra content in the skill concept.
    await seedCourse(FLEX, {
      scenario: true,
      custom: true,
      conceptParts: {
        v: 1,
        items: [
          { id: "main", type: "main" },
          { id: "p-guard001", type: "text", blocks: { en: [para("Extra text.")] } },
        ],
      },
      outline: {
        v: 1,
        sections: [
          { id: "context", template: "context", hidden: true },
          { id: "concept", template: "concept" },
          { id: "scenario", template: "scenario" },
          { id: "behaviour", template: "behaviour" },
          { id: CUSTOM, template: "text", label: { en: "Wrap-up", de: "Abschluss" } },
          { id: "reflection", template: "reflection" },
        ],
      },
    });
    await seedCourse(STALE, { scenario: true, custom: true });
    await seedCourse(NAMED, { scenario: true });
    await seedCourse(EXTRA, {
      scenario: true,
      conceptParts: {
        v: 1,
        items: [
          { id: "main", type: "main" },
          { id: "p-guard002", type: "text", blocks: { en: [para("E2E extra text to remove.")] } },
        ],
      },
    });
    await seedCourse(BYPASS, {
      status: "published",
      custom: true,
      outline: {
        v: 1,
        sections: [
          ...standard(["context", "concept"]),
          { id: CUSTOM, template: "text", label: { en: "Wrap-up" } },
          { id: "behaviour", template: "behaviour", hidden: true },
          ...standard(["reflection"]),
        ],
      },
    });
    editorSession = (await signedInUser(EDITOR, "CONTENT_EDITOR")).sessionToken;
  });

  test.afterAll(async () => {
    // Filtered through the users' emails, a constant of this run, so the
    // filter can never come out empty and match every row.
    await prisma.auditLog.deleteMany({ where: { actor: { is: { email: { in: EMAILS } } } } });
    // Users first: their enrolments cascade away with them.
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.lesson.deleteMany({ where: { projectId: PROJECT, courseSlug: { in: SLUGS } } });
    await prisma.course.deleteMany({ where: { projectId: PROJECT, slug: { in: SLUGS } } });
    // Publishing gives a course its badge.
    for (const slug of SLUGS) {
      await prisma.badge.deleteMany({ where: { projectId: PROJECT, slug: { startsWith: slug } } });
    }
    await prisma.$disconnect();
  });

  test("a course built like the preview's publishes as it is; with no lesson learners see, Publish says why", async ({
    page,
    context,
  }) => {
    // Release 2 (D66) flips Release 1's guard: its own lesson, the hidden
    // one, the new order and the added content no longer hold it back.
    const built = await prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug: FLEX } });
    const hiddenAll = {
      ...(built.outline as { v: 1; sections: Section[] }),
      sections: (built.outline as { sections: Section[] }).sections.map((s) => ({ ...s, hidden: true as const })),
    };
    await setOutline(FLEX, hiddenAll);
    await useSession(context, editorSession);
    await openCourse(page, FLEX);
    const region = publishing(page);
    await expect(region.getByText("Can't publish yet")).toBeVisible();
    await expect(region.getByText("No lesson has anything learners can see yet")).toBeVisible();

    // Publish: focusable, aria-disabled, described by the reason.
    const publish = region.getByRole("button", { name: /^publish$/i });
    await expect(publish).toHaveAttribute("aria-disabled", "true");
    await expect(publish).toHaveAccessibleDescription(/can't publish yet/i);
    await openActions(page, "Skill concept"); // hydrated
    // Pressed as a keyboard user would: Playwright's click waits for an
    // enabled element, and an aria-disabled one never is.
    await publish.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(":focus")).toContainText("Can't publish yet");
    expect(await statusOf(FLEX)).toBe("draft");
    // Preview as learner stays available.
    await expect(page.getByRole("link", { name: /^preview as learner/i }).first()).toBeVisible();

    // As built (one lesson hidden, its own lesson, a new order, added content): it publishes.
    await setOutline(FLEX, built.outline);
    await openCourse(page, FLEX);
    await expect(region.getByText("Can't publish yet")).toHaveCount(0);
    await expect(region.getByText(/is a new lesson|is hidden|new order|has added content/)).toHaveCount(0);
    await expect(publish).not.toHaveAttribute("aria-disabled", "true");
    await openActions(page, "1. Skill concept"); // hydrated
    await publish.click();
    await expect(region.getByText(/^published$/i)).toBeVisible({ timeout: 15000 });
    expect(await statusOf(FLEX)).toBe("published");
  });

  test("a stale page publishes a course that gained a lesson of its own meanwhile", async ({ page, context }) => {
    await useSession(context, editorSession);
    await openCourse(page, STALE);
    const region = publishing(page);
    const publish = region.getByRole("button", { name: /^publish$/i });
    await expect(publish).not.toHaveAttribute("aria-disabled", "true");
    await openActions(page, "1. Context"); // hydrated

    // Meanwhile, the course gets a lesson of its own: nothing to refuse (D66).
    await setOutline(STALE, {
      v: 1,
      sections: [
        ...standard(["context", "concept", "behaviour", "scenario", "reflection"]),
        { id: CUSTOM, template: "text", label: { en: "Wrap-up" } },
      ],
    });

    await publish.click();
    await expect(region.getByText(/^published$/i)).toBeVisible({ timeout: 15000 });
    await expect(region.getByRole("alert")).toHaveCount(0);
    expect(await statusOf(STALE)).toBe("published");
    const refused = await prisma.auditLog.findFirst({
      where: { action: "course.publish_refused", entityId: STALE },
    });
    expect(refused, "nothing refused").toBeNull();
    // A draft again for the tests after this one.
    await prisma.course.updateMany({ where: { projectId: PROJECT, slug: STALE }, data: { status: "draft" } });
  });

  test("the lesson list's changes never hold publishing back, and ask nothing without learners", async ({
    page,
    context,
  }) => {
    // Hidden, out of order, and a lesson of its own.
    await setOutline(STALE, {
      v: 1,
      sections: [
        ...standard(["context", "concept"]),
        { id: "behaviour", template: "behaviour", hidden: true },
        { id: "reflection", template: "reflection" },
        { id: "scenario", template: "scenario" },
        { id: CUSTOM, template: "text", label: { en: "Wrap-up" } },
      ],
    });
    await useSession(context, editorSession);
    await openCourse(page, STALE);
    const region = publishing(page);
    const publish = region.getByRole("button", { name: /^publish$/i });
    await expect(publish).not.toHaveAttribute("aria-disabled", "true");
    // Nobody is taking the course: no change asks first.
    const asks = lessonList(page).getByRole("group", { name: /learners are taking\?|from learners\?|to learners again\?/ });

    // Delete the lesson of its own.
    const own = await openActions(page, "5. Wrap-up");
    await own.getByRole("button", { name: /^delete$/i }).click();
    await lessonList(page).getByRole("button", { name: /^delete lesson$/i }).click();
    await expect(lessonList(page).getByRole("link", { name: /wrap-up/i })).toHaveCount(0, { timeout: 15000 });

    // Show the hidden one.
    const hidden = await openActions(page, "Behaviour model");
    await hidden.getByRole("button", { name: /^show$/i }).click();
    await expect(lessonList(page).getByRole("link", { name: "3. Behaviour model" })).toBeVisible({
      timeout: 15000,
    });

    // The scenario back before the reflection.
    const scenario = await openActions(page, "5. Applied scenario");
    await scenario.getByRole("button", { name: /^move up$/i }).click();
    await expect(lessonList(page).getByRole("link", { name: "4. Applied scenario" })).toBeVisible({
      timeout: 15000,
    });
    await expect(asks).toHaveCount(0);

    await expect(publish).not.toHaveAttribute("aria-disabled", "true");
    await publish.click();
    await expect(region.getByText(/^published$/i)).toBeVisible({ timeout: 15000 });
    expect(await statusOf(STALE)).toBe("published");
  });

  test("added content never holds publishing back; removing it asks only the browser's question", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto(`/en/content/courses/${EXTRA}?lesson=concept`);
    const lesson = page.locator("#lesson-concept").filter({ visible: true });
    await expect(lesson.getByRole("button", { name: /^done$/i })).toBeVisible({ timeout: 15000 });
    const region = publishing(page);
    const publish = region.getByRole("button", { name: /^publish$/i });
    await expect(region.getByText("“Skill concept” has added content")).toHaveCount(0);
    await expect(publish).not.toHaveAttribute("aria-disabled", "true");

    // Remove the added text (in every language, once confirmed).
    const text = lesson.getByRole("group", { name: /^content 2 of 2: text$/i });
    page.once("dialog", (dialog) => void dialog.accept());
    await text.getByRole("button", { name: /^remove content 2: text$/i }).click();
    await expect(text).toHaveCount(0, { timeout: 15000 });
    await expect
      .poll(async () => {
        const concept = await prisma.lesson.findUniqueOrThrow({
          where: { projectId_courseSlug_stageKey: { projectId: PROJECT, courseSlug: EXTRA, stageKey: "concept" } },
          select: { parts: true },
        });
        return concept.parts;
      }, { message: "only the main content is left, stored as nothing" })
      .toBeNull();

    await expect(publish).not.toHaveAttribute("aria-disabled", "true");
    await publish.click();
    await expect(region.getByText(/^published$/i)).toBeVisible({ timeout: 15000 });
    expect(await statusOf(EXTRA)).toBe("published");
  });

  test("a reorder from a page that didn't know the course had a learner asks first, with the server's count", async ({
    page,
    context,
  }) => {
    // STALE is live now, with nobody taking it when this page opens.
    await useSession(context, editorSession);
    await openCourse(page, STALE);
    const actions = await openActions(page, "2. Skill concept");
    const order = async () =>
      (
        (await prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug: STALE } })).outline as {
          sections: { id: string }[];
        }
      ).sections.map((s) => s.id);
    const before = await order();
    const { userId } = await signedInUser(LEARNER, "LEARNER");
    const course = await prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug: STALE } });
    await prisma.courseEnrollment.create({ data: { userId, courseId: course.id, stagesCompleted: ["CONTEXT"] } });

    // The server asks first; the page asks the editor, with the server's count.
    await actions.getByRole("button", { name: /^move down$/i }).click();
    const ask = lessonList(page).getByRole("group", { name: "Move “Skill concept” in a course learners are taking?" });
    await expect(ask).toContainText("1 learner is taking this course (0 finished).", { timeout: 15000 });
    await expect(ask.getByRole("heading")).toBeFocused();
    expect(await order()).toEqual(before);

    await ask.getByRole("button", { name: /^move it$/i }).click();
    await expect.poll(order, { timeout: 15000 }).not.toEqual(before);
    const moved = await prisma.auditLog.findFirst({
      where: { action: "section.moved", entityId: STALE },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    });
    expect(moved?.metadata).toMatchObject({ sectionId: "concept", learners: 1, confirmed: true });
  });

  test("a standard course renamed in the list publishes, with nothing said about the names (D58)", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await openCourse(page, NAMED);
    const actions = await openActions(page, "1. Context");
    await actions.getByRole("button", { name: /^rename$/i }).click();
    const box = lessonList(page).getByRole("textbox", { name: /^lesson name in english$/i });
    await box.fill("Where we start");
    await box.press("Enter");
    await expect(lessonList(page).getByRole("link", { name: "1. Where we start" })).toBeVisible({
      timeout: 15000,
    });

    const region = publishing(page);
    // A name is never a reason, and nothing waits for a later date.
    await expect(page.getByText(/lesson names from/i)).toHaveCount(0);
    const publish = region.getByRole("button", { name: /^publish$/i });
    await expect(publish).not.toHaveAttribute("aria-disabled", "true");
    await publish.click();
    await expect(region.getByText(/^published$/i)).toBeVisible({ timeout: 15000 });
    expect(await statusOf(NAMED)).toBe("published");
  });

  test("a course published with lessons of its own: nothing says learners miss any of it", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await openCourse(page, BYPASS);
    const region = publishing(page);
    await expect(region.getByText(/^published$/i)).toBeVisible();
    await expect(region.getByText(/learners don't get all of this course yet/i)).toHaveCount(0);
    await expect(region.getByRole("link", { name: "“Wrap-up” is a new lesson" })).toHaveCount(0);
    await expect(region.getByRole("link", { name: "“Behaviour model” is hidden" })).toHaveCount(0);
  });
});
