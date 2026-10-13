import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Release 1, Stream C: a flexible course previews with every kind of
 * content (spec 13.2 item 2).
 *
 * A draft course is seeded through Prisma with its lesson list stored the
 * way the editor leaves it: a lesson of its own (s-…) named in English and
 * German, "context" hidden, "scenario" moved before "behaviour", and
 * "concept" holding extra content of every kind — text, two quick checks,
 * reflection questions of its own, a self-assessment with three statements,
 * a practice question — plus a quick check that is only a draft. The first
 * lesson of its own holds a branching scenario with follow-ups; a second
 * one ("Wrap-up") ends the course, so ?lesson= can open somewhere other
 * than the start.
 *
 * An editor's "Preview as learner" plays it in the sectioned preview: the
 * course's own order and step names, every kind of content, answers that
 * stay apart and stay put, a self-assessment used by keyboard alone,
 * Continue that says what's missing, focus that stays in the lesson when a
 * pressed button goes, quick-check results not shown by colour alone, the editors' note about the draft,
 * "Edit this lesson" pointing at the lesson of its own — and nothing saved.
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
const EDITOR = `e2e-r1-preview-editor-${RUN}@example.com`;
const EMAILS = [EDITOR];
const SLUG = `e2e-r1-preview-${RUN}`;
// Lessons of the course's own: "s-" + 8 × [a-z0-9], unique to this run.
const customId = () => `s-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
const CUSTOM = customId();
let CUSTOM2 = customId();
while (CUSTOM2 === CUSTOM) CUSTOM2 = customId();

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// ---------------------------------------------------------------------------
// The course.

const para = (text: string) => ({ kind: "paragraph", text });
const twoOptions = (a: string, b: string) => [
  { id: "a", text: { en: a } },
  { id: "b", text: { en: b } },
];

const OUTLINE = {
  v: 1,
  sections: [
    { id: CUSTOM, template: "text", label: { en: "Warm-up", de: "Aufwärmen" } },
    { id: "context", template: "context", hidden: true },
    { id: "concept", template: "concept" },
    { id: "scenario", template: "scenario" },
    { id: "behaviour", template: "behaviour" },
    { id: "reflection", template: "reflection" },
    { id: CUSTOM2, template: "text", label: { en: "Wrap-up", de: "Abschluss" } },
  ],
};

const CUSTOM_PARTS = {
  v: 1,
  items: [
    { id: "main", type: "main" },
    {
      id: "p-scen0001",
      type: "scenario",
      data: {
        kind: "scenario",
        title: { en: "The hallway" },
        setup: { en: "A colleague talks over you in the hallway." },
        question: { en: "What do you do first?" },
        followupQuestion: { en: "They stop. What do you say next?" },
        choices: [
          {
            id: "c1",
            quality: "best",
            text: { en: "Raise a hand and say you'd like to finish" },
            outcome: { en: "They pause and listen." },
            followups: [
              { id: "f1", quality: "best", text: { en: "Finish your point briefly" }, outcome: { en: "Your point lands." } },
              { id: "f2", quality: "okay", text: { en: "Start again from the top" }, outcome: { en: "They drift off." } },
            ],
          },
          { id: "c2", quality: "poor", text: { en: "Walk away" }, outcome: { en: "Nothing changes." } },
        ],
      },
      draft: null,
    },
  ],
};

const CONCEPT_PARTS = {
  v: 1,
  items: [
    { id: "main", type: "main" },
    {
      id: "p-text0001",
      type: "text",
      blocks: { en: [para("E2E extra text: say it early.")], de: [para("E2E Zusatztext: sag es früh.")] },
    },
    {
      id: "p-quiz0001",
      type: "quiz",
      data: {
        kind: "assessment",
        intro: { en: "First check." },
        questions: [
          { id: "q1", correctOptionId: "a", question: { en: "When do you speak up?" }, options: twoOptions("Early", "Never") },
        ],
      },
      draft: null,
    },
    {
      id: "p-quiz0002",
      type: "quiz",
      data: {
        kind: "assessment",
        title: { en: "Second check" },
        intro: { en: "Same question, its own answers." },
        questions: [
          { id: "q1", correctOptionId: "a", question: { en: "When do you speak up?" }, options: twoOptions("Early", "Never") },
        ],
      },
      draft: null,
    },
    {
      id: "p-refl0001",
      type: "reflection",
      data: {
        kind: "reflection",
        intro: { en: "Think of last week." },
        prompts: [
          { id: "r1", label: { en: "When did you hold back?" } },
          { id: "r2", label: { en: "What stopped you?" } },
          { id: "r3", label: { en: "What would you try next time?" } },
          { id: "r4", label: { en: "Who could help you?" } },
        ],
      },
      draft: null,
    },
    {
      id: "p-rate0001",
      type: "rating",
      data: {
        kind: "rating",
        minLabel: { en: "Not at all like me" },
        maxLabel: { en: "Very much like me" },
        statements: [
          { id: "s1", text: { en: "I say when I disagree." } },
          { id: "s2", text: { en: "I ask for time to finish." } },
          { id: "s3", text: { en: "I name what I need." } },
        ],
      },
      draft: null,
    },
    {
      id: "p-prac0001",
      type: "practice",
      data: {
        kind: "simulation",
        prompt: { en: "You're interrupted for the third time." },
        instruction: { en: "Choose what you would say." },
        options: [
          { id: "o1", isBest: true, text: { en: "Let me finish this thought, please." }, feedback: { en: "Clear and calm." } },
          { id: "o2", isBest: false, text: { en: "Say nothing." }, feedback: { en: "The pattern goes on." } },
        ],
      },
      draft: null,
    },
    {
      // Only a draft: the preview leaves it out and tells the editor.
      id: "p-draft001",
      type: "quiz",
      data: null,
      draft: {
        kind: "assessment",
        intro: { en: "E2E draft-only check." },
        questions: [
          { id: "q1", correctOptionId: "a", question: { en: "E2E draft-only question?" }, options: twoOptions("Yes", "No") },
        ],
      },
    },
  ],
};

const LESSONS: { stageKey: string; narrative?: unknown; structure?: unknown; parts?: unknown }[] = [
  { stageKey: "context", narrative: { en: { title: "E2E hidden context", blocks: [para("E2E hidden context text.")] } } },
  {
    stageKey: "concept",
    narrative: {
      en: { title: "The idea", blocks: [para("E2E concept text.")] },
      de: { title: "Die Idee", blocks: [para("E2E Konzepttext.")] },
    },
    parts: CONCEPT_PARTS,
  },
  {
    stageKey: "scenario",
    structure: {
      kind: "scenario",
      title: { en: "Applied scenario" },
      setup: { en: "Your lead cuts you off in a meeting." },
      question: { en: "What do you do?" },
      followupQuestion: { en: "" },
      choices: [
        { id: "c1", quality: "best", text: { en: "Ask to finish your point" }, outcome: { en: "You finish." } },
        { id: "c2", quality: "poor", text: { en: "Stay quiet" }, outcome: { en: "The point is lost." } },
      ],
    },
  },
  { stageKey: "behaviour", narrative: { en: { title: "What it looks like", blocks: [para("E2E behaviour text.")] } } },
  { stageKey: "reflection", narrative: { en: { title: "Look back", blocks: [para("Think about speaking up.")] } } },
  {
    stageKey: CUSTOM,
    narrative: {
      en: { title: "Before you start", blocks: [para("E2E warm-up text.")] },
      de: { title: "Bevor du anfängst", blocks: [para("E2E Aufwärmtext.")] },
    },
    parts: CUSTOM_PARTS,
  },
  {
    stageKey: CUSTOM2,
    narrative: {
      en: { title: "Bringing it together", blocks: [para("E2E wrap-up text.")] },
      de: { title: "Alles zusammen", blocks: [para("E2E Abschlusstext.")] },
    },
  },
];

const json = (v: unknown) => (v === undefined ? undefined : (v as Prisma.InputJsonValue));

async function seedCourse() {
  await cleanCourse();
  await prisma.course.create({
    data: {
      projectId: PROJECT,
      strapiId: `cms-${SLUG}`,
      slug: SLUG,
      cluster: "communication",
      durationMinutes: 15,
      status: "draft",
      outline: json(OUTLINE),
      meta: {
        en: { title: "E2E Flexible Preview", tagline: "every kind of content", clusterLabel: "Communication" },
        de: { title: "E2E Flexible Vorschau", tagline: "jede Art Inhalt", clusterLabel: "Kommunikation" },
      },
    },
  });
  for (const l of LESSONS) {
    await prisma.lesson.create({
      data: {
        projectId: PROJECT,
        courseSlug: SLUG,
        stageKey: l.stageKey,
        narrative: json(l.narrative),
        structure: json(l.structure),
        parts: json(l.parts),
      },
    });
  }
}

async function cleanCourse() {
  await prisma.lesson.deleteMany({ where: { projectId: PROJECT, courseSlug: SLUG } });
  await prisma.course.deleteMany({ where: { projectId: PROJECT, slug: SLUG } });
  await prisma.badge.deleteMany({ where: { projectId: PROJECT, slug: { startsWith: SLUG } } });
}

// ---------------------------------------------------------------------------
// Users.

async function signedInUser(email: string) {
  await prisma.user.deleteMany({ where: { email } });
  const user = await prisma.user.create({ data: { email, emailVerified: new Date() } });
  await prisma.membership.create({
    data: { userId: user.id, projectId: PROJECT, role: "CONTENT_EDITOR" },
  });
  const sessionToken = `e2e-r1p-${RUN}-${Math.random().toString(36).slice(2)}`;
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

/** Enrolments, audit rows and badges `userId` has for the course. */
async function tracesOf(userId: string) {
  const course = await prisma.course.findFirst({
    where: { projectId: PROJECT, slug: SLUG },
    select: { id: true },
  });
  const [enrolments, audits, badges] = await Promise.all([
    course ? prisma.courseEnrollment.count({ where: { userId, courseId: course.id } }) : 0,
    prisma.auditLog.count({
      where: { actorId: userId, OR: [{ entityId: SLUG }, { entityId: { startsWith: `${SLUG}:` } }] },
    }),
    prisma.userBadge.count({ where: { userId } }),
  ]);
  return { enrolments, audits, badges };
}

// ---------------------------------------------------------------------------
// The page. Only what's on screen: while the page streams in, the server's
// copy can sit in a hidden block for a moment.

const steps = (page: Page) =>
  page.getByRole("navigation", { name: /^(course stages|kursschritte)$/i }).filter({ visible: true });
const counter = (page: Page) => page.getByText(/^\d+ \/ \d+ · /).filter({ visible: true });
const continueButton = (page: Page) =>
  page.getByRole("button", { name: /^(continue|weiter)$/i }).filter({ visible: true });
/** A piece of content: its region, named by its heading. */
const region = (page: Page, name: string) =>
  page.getByRole("main").getByRole("region", { name, exact: true });

/** Continue to step n, retried against the hydration race, never past it. */
async function continueTo(page: Page, n: number) {
  await expect(async () => {
    const at = (await counter(page).textContent())?.trim() ?? "";
    if (at.startsWith(`${n - 1} /`)) await continueButton(page).click();
    await expect(counter(page)).toHaveText(new RegExp(`^${n} / `), { timeout: 5000 });
  }).toPass({ timeout: 20_000 });
}

/** Click until `done` holds — once hydrated a single click does it; never clicks again after. */
async function clickUntil(target: Locator, done: () => Promise<void>) {
  await expect(async () => {
    try {
      await done();
      return;
    } catch {
      await target.click();
    }
    await done();
  }).toPass({ timeout: 20_000 });
}

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((v) => [v.id, v.nodes.map((n) => n.target)]))).toEqual([]);
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, "no horizontal scrolling").toBeLessThanOrEqual(0);
}

describe("Release 1 — a flexible course previews with every kind of content", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  let editorId: string;
  let editorSession: string;

  test.beforeAll(async () => {
    await seedCourse();
    const editor = await signedInUser(EDITOR);
    editorId = editor.userId;
    editorSession = editor.sessionToken;
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actor: { is: { email: { in: EMAILS } } } } });
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await cleanCourse();
    await prisma.$disconnect();
  });

  test("the course's own order and step names, the hidden lesson left out, and the Release 2 banner", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(
      page.getByText(/this preview shows the new layout\. learners get it from release 2/i).first()
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/draft preview/i).first()).toBeVisible();

    const names = ["Warm-up", "Skill concept", "Applied scenario", "Behaviour model", "Reflection", "Wrap-up"];
    const buttons = steps(page).getByRole("button");
    await expect(buttons).toHaveCount(names.length);
    for (const [i, name] of names.entries()) {
      await expect(buttons.nth(i)).toHaveAccessibleName(new RegExp(`${name}$`));
    }
    await expect(page.getByText("E2E hidden context text.")).toHaveCount(0);
    await expect(counter(page)).toHaveText("1 / 6 · Warm-up");
    await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText("Before you start");

    // "Edit this lesson" opens the lesson of the course's own on its page.
    const lessonHref = `/en/content/courses/${SLUG}?lesson=${CUSTOM}&lang=en`;
    await expect(page.getByRole("link", { name: /^edit this lesson$/i })).toHaveAttribute("href", lessonHref);
    await expect(page.getByRole("link", { name: /^back to editing$/i })).toHaveAttribute("href", lessonHref);
  });

  test("German step names under /de", async ({ page, context }) => {
    await useSession(context, editorSession);
    await page.goto(`/de/learner/course/${SLUG}`);
    const names = ["Aufwärmen", "Skill-Konzept", "Anwendung", "Verhaltens-Modell", "Reflexion", "Abschluss"];
    const buttons = steps(page).getByRole("button");
    await expect(buttons).toHaveCount(names.length, { timeout: 15000 });
    for (const [i, name] of names.entries()) {
      await expect(buttons.nth(i)).toHaveAccessibleName(new RegExp(`${name}$`));
    }
    await expect(counter(page)).toHaveText("1 / 6 · Aufwärmen");
    await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText("Bevor du anfängst");
    await expect(page.getByRole("link", { name: /^diese lektion bearbeiten$/i })).toHaveAttribute(
      "href",
      `/de/content/courses/${SLUG}?lesson=${CUSTOM}&lang=de`
    );
  });

  test("an editor plays every kind of content, and nothing is saved", async ({ page, context }) => {
    await useSession(context, editorSession);
    await page.goto(`/en/learner/course/${SLUG}`);
    const main = page.getByRole("main");
    await expect(counter(page)).toHaveText("1 / 6 · Warm-up", { timeout: 15000 });

    // Continue before answering: focus goes to the scenario that's waiting,
    // and a polite announcement says why. Pressing it again is harmless.
    const hallway = main.getByRole("heading", { level: 3, name: "The hallway" });
    const announcement = page.getByRole("status").filter({ hasText: "Answer this first to continue." });
    await expect(async () => {
      await continueButton(page).click();
      await expect(hallway).toBeFocused({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await expect(announcement).toHaveCount(1);
    await expect(counter(page)).toHaveText("1 / 6 · Warm-up");

    // The scenario with a follow-up.
    const scenario = region(page, "The hallway");
    await scenario.getByRole("button", { name: "Raise a hand and say you'd like to finish" }).click();
    await expect(scenario.getByText("They pause and listen.")).toBeVisible();
    await scenario.getByRole("button", { name: "Finish your point briefly" }).click();
    await expect(scenario.getByText("Your point lands.")).toBeVisible();
    // The follow-up buttons went: focus is on the outcome that took their place.
    await expect(page.locator(":focus")).toContainText("Your point lands.");
    // "Try different choices" goes too: focus moves to the scenario's heading.
    await scenario.getByRole("button", { name: "Try different choices" }).click();
    await expect(hallway).toBeFocused();
    await scenario.getByRole("button", { name: "Raise a hand and say you'd like to finish" }).click();
    await scenario.getByRole("button", { name: "Finish your point briefly" }).click();
    await expect(scenario.getByText("Your point lands.")).toBeVisible();
    await continueTo(page, 2);

    // Every kind of content in "concept", the draft-only one left out.
    await expect(counter(page)).toHaveText("2 / 6 · Skill concept");
    await expect(main.getByText("E2E concept text.")).toBeVisible();
    await expect(main.getByText("E2E extra text: say it early.")).toBeVisible();
    for (const name of [
      "Text",
      "Quick check",
      "Second check",
      "Reflection questions",
      "Self-assessment",
      "Practice question",
    ]) {
      await expect(main.getByRole("heading", { level: 3, name, exact: true })).toHaveCount(
        name === "Text" ? 2 : 1
      );
    }
    await expect(page.getByText("E2E draft-only question?")).toHaveCount(0);
    await expect(
      main.getByText(/for editors: one piece of content isn't shown here — only a draft so far, or not ready yet\./i)
    ).toBeVisible();

    // Two quick checks keep their own answers.
    const quiz1 = region(page, "Quick check");
    const quiz2 = region(page, "Second check");
    await quiz1.getByRole("button", { name: /Early/ }).click();
    await expect(quiz1.getByRole("button", { name: /Early/ })).toHaveAttribute("aria-pressed", "true");
    await expect(quiz2.getByRole("button", { name: /Early/ })).toHaveAttribute("aria-pressed", "false");
    await quiz2.getByRole("button", { name: /Never/ }).click();
    await expect(quiz1.getByRole("button", { name: /Never/ })).toHaveAttribute("aria-pressed", "false");

    // Continue now goes to the first quick check: answered, not checked.
    await continueButton(page).click();
    await expect(main.getByRole("heading", { level: 3, name: "Quick check", exact: true })).toBeFocused();
    await quiz1.getByRole("button", { name: /^check answers$/i }).click();
    await expect(quiz1.getByText("You got 1 out of 1 right.")).toBeVisible();
    // "Check answers" went: focus is on the quick check's heading, not the page.
    await expect(main.getByRole("heading", { level: 3, name: "Quick check", exact: true })).toBeFocused();
    await expect(quiz1.getByRole("button", { name: "Early (your answer, correct)" })).toBeVisible();
    await quiz2.getByRole("button", { name: /^check answers$/i }).click();
    await expect(quiz2.getByText("You got 0 out of 1 right.")).toBeVisible();
    await expect(main.getByRole("heading", { level: 3, name: "Second check", exact: true })).toBeFocused();
    // Which answer was right is said in words, not by colour alone.
    await expect(quiz2.getByRole("button", { name: "Never (your answer, not correct)" })).toBeVisible();
    await expect(quiz2.getByRole("button", { name: "Early (the correct answer)" })).toBeVisible();

    // Reflection questions of its own: four labelled boxes.
    const reflection = region(page, "Reflection questions");
    await expect(reflection.getByRole("textbox")).toHaveCount(4);
    await reflection.getByRole("textbox", { name: "What stopped you?" }).fill("E2E: the clock.");

    // The self-assessment, by keyboard alone.
    const rating = region(page, "Self-assessment");
    await expect(rating.getByText("1 = Not at all like me · 5 = Very much like me")).toBeVisible();
    const first = rating.getByRole("group", { name: "I say when I disagree." });
    const second = rating.getByRole("group", { name: "I ask for time to finish." });
    await expect(rating.getByRole("group")).toHaveCount(3);
    await expect(first).toHaveAccessibleDescription("1 = Not at all like me · 5 = Very much like me");
    await expect(first.getByRole("radio")).toHaveCount(5);
    await first.getByRole("radio", { name: "1 of 5" }).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(first.getByRole("radio", { name: "3 of 5" })).toBeChecked();
    await page.keyboard.press("Tab");
    await expect(second.getByRole("radio", { name: "1 of 5" })).toBeFocused();
    await page.keyboard.press("Space");
    await expect(second.getByRole("radio", { name: "1 of 5" })).toBeChecked();
    await expect(first.getByRole("radio", { name: "3 of 5" })).toBeChecked();

    // The practice question: the last one waiting.
    await continueButton(page).click();
    await expect(main.getByRole("heading", { level: 3, name: "Practice question", exact: true })).toBeFocused();
    const practice = region(page, "Practice question");
    await practice.getByRole("button", { name: "Say nothing." }).click();
    await expect(practice.getByText("The pattern goes on.")).toBeVisible();
    // "Try another" goes once pressed: focus moves to the question's heading.
    await practice.getByRole("button", { name: "Try another" }).click();
    await expect(main.getByRole("heading", { level: 3, name: "Practice question", exact: true })).toBeFocused();
    await practice.getByRole("button", { name: "Let me finish this thought, please." }).click();
    await expect(practice.getByText("Clear and calm.")).toBeVisible();

    await axeClean(page);
    await continueTo(page, 3);

    // Back: every answer is still there.
    // Back, named by the lesson it goes to (the last such button: after the step bar).
    await page.getByRole("button", { name: "Skill concept", exact: true }).filter({ visible: true }).last().click();
    await expect(counter(page)).toHaveText("2 / 6 · Skill concept");
    await expect(region(page, "Quick check").getByText("You got 1 out of 1 right.")).toBeVisible();
    await expect(region(page, "Second check").getByText("You got 0 out of 1 right.")).toBeVisible();
    await expect(
      region(page, "Reflection questions").getByRole("textbox", { name: "What stopped you?" })
    ).toHaveValue("E2E: the clock.");
    await expect(
      region(page, "Self-assessment")
        .getByRole("group", { name: "I say when I disagree." })
        .getByRole("radio", { name: "3 of 5" })
    ).toBeChecked();
    await expect(region(page, "Practice question").getByText("Clear and calm.")).toBeVisible();

    // On to the end: the applied scenario, behaviour, reflection.
    await continueTo(page, 3);
    await clickUntil(main.getByRole("button", { name: "Stay quiet" }), () =>
      expect(main.getByText("The point is lost.")).toBeVisible({ timeout: 2000 })
    );
    await continueTo(page, 4);
    await continueTo(page, 5);
    await expect(main.getByRole("textbox")).toHaveCount(3);
    await continueTo(page, 6);
    await expect(main.getByText("E2E wrap-up text.")).toBeVisible();
    await continueButton(page).click();
    await expect(page.getByRole("heading", { name: /course complete/i })).toBeVisible({ timeout: 15000 });

    // Nothing was saved: no enrolment, no statistics, no badge.
    await page.waitForTimeout(2000);
    expect(await tracesOf(editorId)).toEqual({ enrolments: 0, audits: 0, badges: 0 });
  });

  test("opens at a lesson of the course's own with ?lesson=, and passes axe on a phone", async ({
    page,
    context,
  }) => {
    await useSession(context, editorSession);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/en/learner/course/${SLUG}?preview=1&lesson=concept`);
    const current = steps(page).locator('[aria-current="step"]');
    await expect(current).toHaveAccessibleName(/skill concept$/i, { timeout: 15000 });
    await expect(region(page, "Self-assessment").getByRole("radio")).toHaveCount(15);
    await noSideScroll(page);
    await axeClean(page);

    // A hidden lesson isn't in the preview: it starts at the beginning.
    await page.goto(`/en/learner/course/${SLUG}?preview=1&lesson=context`);
    await expect(current).toHaveAccessibleName(/warm-up$/i, { timeout: 15000 });

    // A lesson of the course's own, not the first: it opens there.
    await page.goto(`/en/learner/course/${SLUG}?preview=1&lesson=${CUSTOM2}`);
    await expect(current).toHaveAccessibleName("6 Wrap-up", { timeout: 15000 });
    // (The "n / N · name" counter is hidden on a phone, as in the learner player.)
    await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText("Bringing it together");
    await expect(page.getByRole("link", { name: /^edit this lesson$/i })).toHaveAttribute(
      "href",
      `/en/content/courses/${SLUG}?lesson=${CUSTOM2}&lang=en`
    );
    await noSideScroll(page);
    await axeClean(page);

    await page.waitForTimeout(1000);
    expect(await tracesOf(editorId)).toEqual({ enrolments: 0, audits: 0, badges: 0 });
  });
});
