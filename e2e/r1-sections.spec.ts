import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Release 1 — the lesson list of a course created here (spec 11.1, 13.2
 * item 5). An editor adds a lesson of the course's own, names it in English
 * and German, moves, hides and deletes lessons — all through the list's
 * "Actions for …" controls, with each change announced and focus kept in a
 * predictable place. Deleting is refused while a learner is enrolled (G4)
 * and otherwise asks first, listing everything that goes. A colleague's
 * change made in another tab shows up on a stale page instead of being
 * overwritten. A course has at most 15 lessons. The list fits a laptop and
 * a phone, and passes axe with its controls open.
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
const EDITOR = `e2e-r1-sections-editor-${RUN}@example.com`;
const LEARNER = `e2e-r1-sections-learner-${RUN}@example.com`;
const EMAILS = [EDITOR, LEARNER];
const SLUG = `e2e-r1-sections-${RUN}`;
const TITLE = "E2E Lesson List Course";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const para = (text: string) => ({ kind: "paragraph", text });
const written = (title: string) => ({ en: { title, blocks: [para(`${title} text.`)] } });
const SIM = {
  kind: "simulation",
  prompt: { en: "A teammate interrupts you." },
  instruction: { en: "Pick the best response." },
  options: [
    { id: "a", isBest: true, text: { en: "Name it calmly" }, feedback: { en: "Good." } },
    { id: "b", isBest: false, text: { en: "Say nothing" }, feedback: { en: "Hmm." } },
  ],
};

/** The standard lessons the course starts with: four texts and a practice. */
const STANDARD = ["context", "concept", "behaviour", "simulation", "reflection"] as const;

type StoredSection = { id: string; template: string; hidden?: true; label?: Record<string, string> };

async function storedOutline(): Promise<{ sections: StoredSection[]; removed?: string[] } | null> {
  const course = await prisma.course.findFirst({
    where: { projectId: PROJECT, slug: SLUG },
    select: { outline: true },
  });
  return (course?.outline ?? null) as { sections: StoredSection[]; removed?: string[] } | null;
}
const ids = async () => (await storedOutline())?.sections.map((s) => s.id) ?? [];

async function courseId() {
  const course = await prisma.course.findFirstOrThrow({
    where: { projectId: PROJECT, slug: SLUG },
    select: { id: true },
  });
  return course.id;
}

/** Create a user holding `role`, plus a live session; returns both ids. */
async function signedInUser(email: string, role: "CONTENT_EDITOR" | "LEARNER") {
  const user = await prisma.user.create({ data: { email, emailVerified: new Date() } });
  await prisma.membership.create({ data: { userId: user.id, projectId: PROJECT, role } });
  const sessionToken = `e2e-r1s-${RUN}-${Math.random().toString(36).slice(2)}`;
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

/** The lesson list (only the one on screen: the streamed page can hold a hidden copy). */
const lessonList = (page: Page) =>
  page.getByRole("navigation", { name: /^lessons$/i }).filter({ visible: true });

/** The page's polite live region (the lesson list's announcements). */
const announcements = (page: Page) => page.locator('p[role="status"][aria-live="polite"]');

async function openCourse(page: Page) {
  await page.goto(`/en/content/courses/${SLUG}`);
  await expect(lessonList(page).getByRole("link").first()).toBeVisible({ timeout: 15000 });
}

/**
 * Open "Actions for <label>", retried against the hydration race: it is
 * pressed only while still closed, so a slow first press is never undone.
 */
async function openActions(page: Page, label: string): Promise<Locator> {
  const toggle = lessonList(page).getByRole("button", { name: `Actions for ${label}`, exact: true });
  await expect(async () => {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 2000 });
  }).toPass({ timeout: 15000 });
  return lessonList(page).getByRole("group", { name: `Actions for ${label}`, exact: true });
}

/** Open "Add lesson" (retried the same way); returns the picker. */
async function openPicker(page: Page): Promise<Locator> {
  const picker = lessonList(page).getByRole("group", { name: /^add a lesson$/i });
  await expect(async () => {
    if (!(await picker.isVisible())) {
      await lessonList(page).getByRole("button", { name: /^add lesson$/i }).click();
    }
    await expect(picker).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  return picker;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(0);
}

describe("Release 1 — the lesson list", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  let editorSession: string;
  let learnerId: string;

  test.beforeAll(async () => {
    await prisma.course.create({
      data: {
        projectId: PROJECT,
        strapiId: `cms-${SLUG}`,
        slug: SLUG,
        cluster: "communication",
        durationMinutes: 15,
        status: "draft",
        meta: { en: { title: TITLE, tagline: "lessons", clusterLabel: "Communication" } },
      },
    });
    for (const stageKey of STANDARD) {
      const lesson = await prisma.lesson.create({
        data: {
          projectId: PROJECT,
          courseSlug: SLUG,
          stageKey,
          ...(stageKey === "simulation"
            ? { structure: SIM as Prisma.InputJsonValue }
            : { narrative: written(`E2E ${stageKey}`) as Prisma.InputJsonValue }),
        },
      });
      if (stageKey === "behaviour") {
        // Two documents, so the delete confirmation has them to list.
        for (const [i, name] of ["Checklist.pdf", "Script.pdf"].entries()) {
          await prisma.lessonDocument.create({
            data: {
              lessonId: lesson.id,
              name,
              url: `https://example.org/e2e-r1-sections-${RUN}-${i}.pdf`,
              mimeType: "application/pdf",
              sizeBytes: 1000 + i,
              order: i,
              published: true,
            },
          });
        }
      }
    }
    editorSession = (await signedInUser(EDITOR, "CONTENT_EDITOR")).sessionToken;
    learnerId = (await signedInUser(LEARNER, "LEARNER")).userId;
  });

  test.afterAll(async () => {
    // Filtered through the users' emails, a constant of this run, so the
    // filter can never come out empty and match every row.
    await prisma.auditLog.deleteMany({ where: { actor: { is: { email: { in: EMAILS } } } } });
    // Users first: their enrolments cascade away with them.
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.lesson.deleteMany({ where: { projectId: PROJECT, courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { projectId: PROJECT, slug: SLUG } });
    await prisma.$disconnect();
  });

  test("adds a lesson of the course's own, and names it in English and German", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await openCourse(page);

    const picker = await openPicker(page);
    // The first kind takes focus; Escape would close it.
    await expect(picker.getByRole("button", { name: /^blank$/i })).toBeFocused();
    await picker.getByRole("button", { name: /^text$/i }).click();
    await expect(picker.getByRole("button", { name: /^text$/i })).toHaveAttribute("aria-pressed", "true");
    // Said before anything is added: the course is then one for Release 2.
    await expect(picker.getByText(/can be published from release 2/i)).toBeVisible();
    await expect(picker.getByRole("combobox", { name: /^where/i })).toHaveValue("5");
    await picker.getByRole("button", { name: /^add this lesson$/i }).click();

    // It is stored at the end, opens, and its heading takes focus.
    await expect.poll(ids, { timeout: 15000 }).toHaveLength(6);
    const id = (await ids())[5];
    expect(id).toMatch(/^s-[a-z0-9]{8}$/);
    await expect(page.locator(`#lesson-${id}-h`)).toBeFocused();
    await expect(page.locator(`#lesson-${id}-h`)).toHaveText("Text lesson");
    await expect(announcements(page)).toHaveText("“Text lesson” added.");

    // Named in English…
    const actions = await openActions(page, "Text lesson");
    await actions.getByRole("button", { name: /^rename$/i }).click();
    const nameBox = lessonList(page).getByRole("textbox", { name: /^lesson name in english$/i });
    await expect(nameBox).toBeFocused();
    await expect(nameBox).toHaveAttribute("placeholder", "Text lesson");
    await nameBox.fill("Wrap-up");
    await expect(lessonList(page).getByText("7 of 40 characters")).toBeVisible();
    await lessonList(page).getByRole("button", { name: /^save name$/i }).click();
    await expect(lessonList(page).getByRole("link", { name: "Wrap-up", exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(announcements(page)).toHaveText("Name saved.");
    await expect
      .poll(async () => (await storedOutline())?.sections.find((s) => s.id === id)?.label)
      .toEqual({ en: "Wrap-up" });

    // …then in German, the content language now.
    await page
      .getByRole("group", { name: /^content language$/i })
      .getByRole("button", { name: /^german/i })
      .click();
    // German has no name of its own yet: the English one stands in.
    const de = await openActions(page, "Wrap-up");
    await de.getByRole("button", { name: /^rename$/i }).click();
    const deBox = lessonList(page).getByRole("textbox", { name: /^lesson name in german$/i });
    await expect(deBox).toHaveAttribute("lang", "de");
    await deBox.fill("Abschluss");
    await deBox.press("Enter");
    await expect(lessonList(page).getByRole("link", { name: "Abschluss", exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect
      .poll(async () => (await storedOutline())?.sections.find((s) => s.id === id)?.label)
      .toEqual({ en: "Wrap-up", de: "Abschluss" });

    // Over 40 characters is refused, not cut.
    await (await openActions(page, "Abschluss")).getByRole("button", { name: /^rename$/i }).click();
    await deBox.fill("x".repeat(41));
    await expect(deBox).toHaveAttribute("aria-invalid", "true");
    await expect(lessonList(page).getByText("Use 40 characters or fewer.")).toBeVisible();
    // Escape cancels and puts focus back on Rename.
    await deBox.press("Escape");
    await expect(lessonList(page).getByRole("button", { name: /^rename$/i })).toBeFocused();
  });

  test("moves a lesson, announcing where it went and keeping focus on the button", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await openCourse(page);

    const actions = await openActions(page, "1. Context");
    await actions.getByRole("button", { name: /^move down$/i }).click();
    await expect(announcements(page)).toHaveText("“Context” moved to position 2 of 6.", {
      timeout: 15000,
    });
    await expect(page.locator(":focus")).toHaveAccessibleName("Move down");
    expect((await ids()).slice(0, 2)).toEqual(["concept", "context"]);
    // Now out of the standard order: publishing says so.
    await expect(
      page.getByRole("region", { name: /^publishing$/i }).getByText("The lessons are in a new order")
    ).toBeVisible();

    // Back to the top: Move up is then disabled, so focus moves to Move down.
    await page.locator(":focus").press("Shift+Tab"); // Move up
    await expect(page.locator(":focus")).toHaveAccessibleName("Move up");
    await page.keyboard.press("Enter");
    await expect(announcements(page)).toHaveText("“Context” moved to position 1 of 6.", {
      timeout: 15000,
    });
    await expect(page.locator(":focus")).toHaveAccessibleName("Move down");
    expect((await ids()).slice(0, 2)).toEqual(["context", "concept"]);
  });

  test("hides and shows a lesson", async ({ page, context }) => {
    await useSession(context, editorSession);
    await openCourse(page);

    const actions = await openActions(page, "2. Skill concept");
    const hide = actions.getByRole("button", { name: /^hide$/i });
    await expect(hide).toHaveAttribute("aria-pressed", "false");
    await hide.click();
    await expect(announcements(page)).toHaveText("“Skill concept” is hidden.", { timeout: 15000 });
    await expect.poll(async () => (await storedOutline())?.sections[1]).toMatchObject({
      id: "concept",
      hidden: true,
    });
    // Unnumbered while hidden: learners of Release 2 wouldn't see it.
    const shown = await openActions(page, "Skill concept");
    await expect(lessonList(page).getByText(/^hidden$/i)).toBeVisible();
    await expect(shown.getByRole("button", { name: /^hide$/i })).toHaveAttribute("aria-pressed", "true");
    await shown.getByRole("button", { name: /^hide$/i }).click();
    await expect(announcements(page)).toHaveText("“Skill concept” is shown again.", { timeout: 15000 });
    await expect
      .poll(async () => (await storedOutline())?.sections[1]?.hidden)
      .toBeUndefined();
  });

  test("delete: refused while a learner is enrolled, otherwise confirmed with everything that goes", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    const course = await courseId();
    await prisma.courseEnrollment.create({ data: { userId: learnerId, courseId: course } });
    try {
      await openCourse(page);
      // The page knows: Delete says why it can't.
      const actions = await openActions(page, "3. Behaviour model");
      const del = actions.getByRole("button", { name: /^delete$/i });
      await expect(del).toHaveAttribute("aria-disabled", "true");
      await expect(del).toHaveAccessibleDescription(
        "1 learner is enrolled in this course, so this lesson can't be deleted."
      );
    } finally {
      await prisma.courseEnrollment.deleteMany({ where: { userId: learnerId, courseId: course } });
    }

    // A page from before the enrolment: the server refuses (G4).
    await openCourse(page);
    const actions = await openActions(page, "3. Behaviour model");
    await prisma.courseEnrollment.create({ data: { userId: learnerId, courseId: course } });
    try {
      await actions.getByRole("button", { name: /^delete$/i }).click();
      const confirm = lessonList(page).getByRole("group", {
        name: "Delete “Behaviour model” in all languages?",
      });
      await expect(confirm.getByRole("heading")).toBeFocused();
      await confirm.getByRole("button", { name: /^delete lesson$/i }).click();
      await expect(confirm.getByRole("alert")).toHaveText(
        "1 learner is enrolled in this course, so this lesson can't be deleted.",
        { timeout: 15000 }
      );
      expect(await ids()).toContain("behaviour");
    } finally {
      await prisma.courseEnrollment.deleteMany({ where: { userId: learnerId, courseId: course } });
    }

    // Nobody enrolled: the confirmation lists the text, the documents.
    await openCourse(page);
    const again = await openActions(page, "3. Behaviour model");
    await again.getByRole("button", { name: /^delete$/i }).click();
    const confirm = lessonList(page).getByRole("group", {
      name: "Delete “Behaviour model” in all languages?",
    });
    await expect(confirm.getByRole("listitem")).toHaveText(["Its text in English", "1 text", "2 documents"]);
    // "Keep it" keeps it and puts focus back on Delete.
    await confirm.getByRole("button", { name: /^keep it$/i }).click();
    await expect(again.getByRole("button", { name: /^delete$/i })).toBeFocused();

    await again.getByRole("button", { name: /^delete$/i }).click();
    await confirm.getByRole("button", { name: /^delete lesson$/i }).click();
    await expect(announcements(page)).toHaveText("“Behaviour model” deleted.", { timeout: 15000 });
    // Focus goes to the next lesson's link.
    await expect(page.locator(":focus")).toHaveAttribute("href", "#lesson-simulation");
    await expect.poll(ids).not.toContain("behaviour");
    expect((await storedOutline())?.removed).toEqual(["behaviour"]);
    expect(
      await prisma.lesson.count({ where: { projectId: PROJECT, courseSlug: SLUG, stageKey: "behaviour" } })
    ).toBe(0);

    // It can come back, empty.
    const picker = await openPicker(page);
    await expect(picker.getByRole("button", { name: "Add back: Behaviour model (empty)" })).toBeVisible();
    await picker.getByRole("button", { name: /^close$/i }).click();
  });

  test("a colleague's change in another tab shows up instead of being overwritten", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await openCourse(page);
    const before = await ids();
    // This page's actions are open before the colleague's change.
    const mine = await openActions(page, "2. Skill concept");

    const colleague = await context.newPage();
    await colleague.goto(`/en/content/courses/${SLUG}`);
    await expect(lessonList(colleague).getByRole("link", { name: "1. Context" })).toBeVisible({
      timeout: 15000,
    });
    await (await openActions(colleague, "1. Context"))
      .getByRole("button", { name: /^move down$/i })
      .click();
    await expect(announcements(colleague)).toHaveText(/moved to position 2/, { timeout: 15000 });
    const theirs = await ids();
    expect(theirs).not.toEqual(before);
    await colleague.close();

    // The stale page's move is refused, and its list now shows theirs.
    await mine.getByRole("button", { name: /^move down$/i }).click();
    await expect(lessonList(page).getByRole("alert")).toHaveText(
      /someone else changed the lesson list/i,
      { timeout: 15000 }
    );
    expect(await ids()).toEqual(theirs);
    const order = await lessonList(page)
      .getByRole("link")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
    expect(order.slice(0, 2)).toEqual(["#lesson-concept", "#lesson-context"]);

    // Back to the standard order for the tests after this one.
    const saved = await storedOutline();
    const [first, second, ...rest] = saved!.sections;
    await prisma.course.updateMany({
      where: { projectId: PROJECT, slug: SLUG },
      data: { outline: { ...saved, sections: [second, first, ...rest] } as Prisma.InputJsonValue },
    });
  });

  test("a course has at most 15 lessons", async ({ page, context }) => {
    const saved = await storedOutline();
    const own = Array.from({ length: 15 - (saved?.sections.length ?? 0) }, (_, i) => ({
      id: `s-cap${String(i).padStart(5, "0")}`,
      template: "text",
    }));
    await prisma.course.updateMany({
      where: { projectId: PROJECT, slug: SLUG },
      data: {
        outline: { ...saved, sections: [...(saved?.sections ?? []), ...own] } as Prisma.InputJsonValue,
      },
    });
    try {
      await useSession(context, editorSession);
      await openCourse(page);
      const add = lessonList(page).getByRole("button", { name: /^add lesson$/i });
      await expect(add).toHaveAttribute("aria-disabled", "true");
      await expect(add).toHaveAccessibleDescription("A course can have at most 15 lessons.");
    } finally {
      await prisma.course.updateMany({
        where: { projectId: PROJECT, slug: SLUG },
        data: { outline: saved as Prisma.InputJsonValue },
      });
    }
  });

  test("fits a laptop and a phone without sideways scrolling", async ({ page, context }) => {
    await useSession(context, editorSession);
    await openCourse(page);
    await openActions(page, "2. Skill concept");
    await noHorizontalScroll(page);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/en/content/courses/${SLUG}`);
    // A disclosure above the lessons on a phone.
    const toggle = page.getByRole("button", { name: /^lessons \(\d+\)$/i });
    await expect(async () => {
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await openActions(page, "2. Skill concept");
    await noHorizontalScroll(page);
    await openPicker(page);
    await noHorizontalScroll(page);
  });

  test("passes axe with a lesson's actions and the picker open", async ({ page, context }) => {
    await useSession(context, editorSession);
    await openCourse(page);
    await openActions(page, "2. Skill concept");
    await openPicker(page);
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
  });
});
