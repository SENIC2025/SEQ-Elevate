import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Release 1 — the publish guard (D57, spec 5 and 13.2 item 3). Learners only
 * get the standard layout until Release 2, so a created course whose lesson
 * list differs from it can't be published: Publish says why (each reason,
 * linking to its lesson) and stays focusable, taking focus to the reasons.
 * A page that didn't know yet is refused by the server and then says why;
 * so is a lesson-list change on a course that went live meanwhile (G3).
 * Undoing every reason through the list makes the course publishable. A
 * course renamed in the list publishes, and learners keep the standard
 * names. A course published past the guard gives learners the standard
 * lessons, and its editors are told what learners don't get yet.
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
const LEARNER_BYPASS = `e2e-r1-guard-bypass-${RUN}@example.com`;
const EMAILS = [EDITOR, LEARNER, LEARNER_BYPASS];
/** A course built like the preview's (custom, hidden, reordered, extra content). */
const FLEX = `e2e-r1-guard-flex-${RUN}`;
/** A standard draft: refused when stale, then made non-standard and undone. */
const STALE = `e2e-r1-guard-stale-${RUN}`;
/** A standard course whose lessons get names of their own. */
const NAMED = `e2e-r1-guard-named-${RUN}`;
/** Seeded non-standard and published (an old tab, a rollback). */
const BYPASS = `e2e-r1-guard-bypass-${RUN}`;
const SLUGS = [FLEX, STALE, NAMED, BYPASS];
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

/** How many lessons a learner gets, from the player's "1 / n · Context". */
async function learnerLessonCount(page: Page, slug: string) {
  await page.goto(`/en/learner/course/${slug}`);
  const counter = page.getByText(/^1 \/ \d+ · /).filter({ visible: true });
  await expect(counter).toBeVisible({ timeout: 15000 });
  const text = (await counter.textContent()) ?? "";
  return Number(/\/ (\d+)/.exec(text)?.[1]);
}

/** The step bar's names, as a learner sees them. */
async function stepNames(page: Page) {
  const steps = page.getByRole("navigation", { name: /^course stages$/i }).filter({ visible: true });
  await expect(steps).toBeVisible({ timeout: 15000 });
  return steps.getByRole("button").evaluateAll((buttons) =>
    buttons.map((b) => (b.textContent ?? "").replace(/^\d+/, "").trim())
  );
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

  test("a course learners couldn't get as built: Publish says why, and takes focus to the reasons", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await openCourse(page, FLEX);
    const region = publishing(page);
    await expect(region.getByText("Can't publish yet")).toBeVisible();

    // Each reason, linking to its lesson where it is on the page.
    await expect(region.getByRole("link", { name: "“Context” is hidden" })).toHaveAttribute(
      "href",
      "#lesson-context"
    );
    await expect(region.getByRole("link", { name: "“Wrap-up” is a new lesson" })).toHaveAttribute(
      "href",
      `#lesson-${CUSTOM}`
    );
    await expect(region.getByRole("link", { name: "“Skill concept” has added content" })).toHaveAttribute(
      "href",
      "#lesson-concept"
    );
    await expect(region.getByText("The lessons are in a new order")).toBeVisible();

    // Publish: focusable, aria-disabled, described by the list.
    const publish = region.getByRole("button", { name: /^publish$/i });
    await expect(publish).toHaveAttribute("aria-disabled", "true");
    await expect(publish).toHaveAccessibleDescription(/can't publish yet/i);
    await openActions(page, "1. Skill concept"); // hydrated
    await publish.click();
    await expect(page.locator(":focus")).toContainText("Can't publish yet");
    expect(await statusOf(FLEX)).toBe("draft");

    // Preview as learner stays available.
    await expect(page.getByRole("link", { name: /^preview as learner/i }).first()).toBeVisible();
  });

  test("a stale page: the server refuses, says why, and the course stays a draft", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await openCourse(page, STALE);
    const region = publishing(page);
    const publish = region.getByRole("button", { name: /^publish$/i });
    await expect(publish).not.toHaveAttribute("aria-disabled", "true");
    await openActions(page, "1. Context"); // hydrated

    // Meanwhile, the course gets a lesson of its own.
    await setOutline(STALE, {
      v: 1,
      sections: [
        ...standard(["context", "concept", "behaviour", "scenario", "reflection"]),
        { id: CUSTOM, template: "text", label: { en: "Wrap-up" } },
      ],
    });

    await publish.click();
    const alert = region.getByRole("alert");
    await expect(alert).toContainText("so it wasn't published", { timeout: 15000 });
    // The reasons are listed (by the refusal, then by the refreshed page).
    await expect(region.getByText("“Wrap-up” is a new lesson")).toBeVisible({ timeout: 15000 });
    await expect(publish).toHaveAttribute("aria-disabled", "true", { timeout: 15000 });
    expect(await statusOf(STALE)).toBe("draft");
    const refused = await prisma.auditLog.findFirst({
      where: { action: "course.publish_refused", entityId: STALE },
    });
    expect(refused, "refusal audited").toBeTruthy();
  });

  test("undoing every reason through the lesson list makes it publishable", async ({
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
    await expect(publish).toHaveAttribute("aria-disabled", "true");

    // Delete the lesson of its own.
    const own = await openActions(page, "5. Wrap-up");
    await own.getByRole("button", { name: /^delete$/i }).click();
    await lessonList(page).getByRole("button", { name: /^delete lesson$/i }).click();
    await expect(region.getByText("“Wrap-up” is a new lesson")).toHaveCount(0, { timeout: 15000 });

    // Show the hidden one.
    const hidden = await openActions(page, "Behaviour model");
    await hidden.getByRole("button", { name: /^hide$/i }).click();
    await expect(region.getByText("“Behaviour model” is hidden")).toHaveCount(0, { timeout: 15000 });

    // The scenario back before the reflection.
    const scenario = await openActions(page, "5. Applied scenario");
    await scenario.getByRole("button", { name: /^move up$/i }).click();
    await expect(region.getByText("The lessons are in a new order")).toHaveCount(0, { timeout: 15000 });

    await expect(publish).not.toHaveAttribute("aria-disabled", "true");
    await publish.click();
    await expect(region.getByText(/^published$/i)).toBeVisible({ timeout: 15000 });
    expect(await statusOf(STALE)).toBe("published");
  });

  test("a live course refuses a reorder from a page that didn't know it was live", async ({
    page,
    context,
  }) => {
    // STALE is live now; this page opens it as a draft.
    await prisma.course.updateMany({ where: { projectId: PROJECT, slug: STALE }, data: { status: "draft" } });
    await useSession(context, editorSession);
    await openCourse(page, STALE);
    const actions = await openActions(page, "2. Skill concept");
    const before = (
      (await prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug: STALE } })).outline as {
        sections: { id: string }[];
      }
    ).sections.map((s) => s.id);
    await prisma.course.updateMany({ where: { projectId: PROJECT, slug: STALE }, data: { status: "published" } });

    await actions.getByRole("button", { name: /^move down$/i }).click();
    await expect(lessonList(page).getByRole("alert")).toHaveText(
      /this course is live, so this change has to wait/i,
      { timeout: 15000 }
    );
    const after = (
      (await prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug: STALE } })).outline as {
        sections: { id: string }[];
      }
    ).sections.map((s) => s.id);
    expect(after).toEqual(before);
    // The refreshed page knows it is live: the move is locked, with the reason.
    await expect(actions.getByRole("button", { name: /^move down$/i })).toHaveAttribute(
      "aria-disabled",
      "true",
      { timeout: 15000 }
    );
  });

  test("a standard course renamed in the list publishes; learners keep the standard names", async ({
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
    // A name is never a reason: only the note that learners see it later.
    await expect(region.getByText("Learners see your lesson names from Release 2.")).toBeVisible({
      timeout: 15000,
    });
    const publish = region.getByRole("button", { name: /^publish$/i });
    await expect(publish).not.toHaveAttribute("aria-disabled", "true");
    await publish.click();
    await expect(region.getByText(/^published$/i)).toBeVisible({ timeout: 15000 });
    expect(await statusOf(NAMED)).toBe("published");

    const { sessionToken } = await signedInUser(LEARNER, "LEARNER");
    await useSession(context, sessionToken);
    await page.goto(`/en/learner/course/${NAMED}`);
    expect(await stepNames(page)).toEqual([
      "Context",
      "Skill concept",
      "Behaviour model",
      "Applied scenario",
      "Reflection",
    ]);
    await expect(page.getByText("Where we start")).toHaveCount(0);
  });

  test("a course published past the guard: learners get the standard lessons; editors are told", async ({
    page,
    context,
  }) => {
    const learner = await signedInUser(LEARNER_BYPASS, "LEARNER");
    await useSession(context, learner.sessionToken);
    // The four standard lessons in their order, the hidden one included;
    // nothing of the lesson of its own.
    expect(await learnerLessonCount(page, BYPASS)).toBe(4);
    expect(await stepNames(page)).toEqual(["Context", "Skill concept", "Behaviour model", "Reflection"]);
    await expect(page.getByText(OWN_TEXT)).toHaveCount(0);

    // Progress saves, in Release 0's lesson keys.
    await expect(async () => {
      const step = page.locator('[aria-current="step"]').filter({ visible: true });
      if (((await step.textContent()) ?? "").trim().startsWith("1")) {
        await page.getByRole("button", { name: /^continue$/i }).first().click();
      }
      await expect(step).toContainText("2", { timeout: 5000 });
    }).toPass({ timeout: 20_000 });
    const course = await prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug: BYPASS } });
    await expect
      .poll(
        async () =>
          (
            await prisma.courseEnrollment.findUnique({
              where: { userId_courseId: { userId: learner.userId, courseId: course.id } },
              select: { stagesCompleted: true },
            })
          )?.stagesCompleted ?? [],
        { timeout: 15000 }
      )
      .toEqual(["context"]);

    // The editor is told what learners don't get yet.
    await useSession(context, editorSession);
    await openCourse(page, BYPASS);
    const region = publishing(page);
    await expect(
      region.getByText(/learners don't get all of this course yet/i)
    ).toBeVisible();
    await expect(region.getByRole("link", { name: "“Wrap-up” is a new lesson" })).toBeVisible();
    await expect(region.getByRole("link", { name: "“Behaviour model” is hidden" })).toBeVisible();
  });
});
