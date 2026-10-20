import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Release 1: a course in the standard layout is exactly what it was for
 * learners (D60). A signed-in learner walks a published course created here
 * — in English and in German — and the built-in "workplace-conflict", and
 * every step is compared with what learners got on Release 0: the
 * accessibility tree of the page's main area (`ariaSnapshot`) and the
 * "n / N · name" counter, when the step opens and once it is answered.
 *
 * The baseline (e2e/fixtures/r1-learner-baseline.json) was recorded by
 * running this file on the Release 0 build (main @ 1c857aa) with
 * R1_BASELINE=record; it is plain text, the same on every platform. Release
 * 1 must match it exactly — also after an editor renames the steps, which
 * learners only see from Release 2.
 *
 * Phase 2 (Release 1 only) stores the course's lesson list with every step
 * renamed in English and German, directly through Prisma, and walks it
 * again against the same baseline: learners keep the standard names until
 * Release 2.
 *
 * Requires a real database — gated on E2E_DB=1, like db-backed-progress.
 * The course has a fixed slug and is rebuilt at the start; everything it
 * creates is removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const RECORD = process.env.R1_BASELINE === "record";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;
test.describe.configure({ mode: "serial" });

const PROJECT = "seq-elevate";
const SLUG = "e2e-r1-standard";
const BUILT_IN = "workplace-conflict";
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const LEARNER = `e2e-r1-identical-learner-${RUN}@example.com`;
const LEARNER_DE = `e2e-r1-identical-learner-de-${RUN}@example.com`;
const LEARNER_BUILT_IN = `e2e-r1-identical-builtin-${RUN}@example.com`;
const LEARNER_NAMED = `e2e-r1-identical-named-${RUN}@example.com`;
const LEARNER_NAMED_DE = `e2e-r1-identical-named-de-${RUN}@example.com`;
const EMAILS = [LEARNER, LEARNER_DE, LEARNER_BUILT_IN, LEARNER_NAMED, LEARNER_NAMED_DE];

const BASELINE_FILE = path.resolve("e2e/fixtures/r1-learner-baseline.json");

type Captured = { aria: string; counter: string | null };
const recorded: Record<string, Captured> = {};
const baseline: Record<string, Captured> =
  !RECORD && existsSync(BASELINE_FILE)
    ? JSON.parse(readFileSync(BASELINE_FILE, "utf8"))
    : {};

// ---------------------------------------------------------------------------
// The course: every kind of lesson a created course has today, written in
// English, with German text for the narrative lessons.

const para = (text: string) => ({ kind: "paragraph", text });
const narrative = (
  en: { title: string; subtitle?: string; blocks: unknown[] },
  de?: { title: string; subtitle?: string; blocks: unknown[] }
) => (de ? { en, de } : { en });

const LESSONS = [
  {
    stageKey: "context",
    narrative: narrative(
      {
        title: "The situation",
        subtitle: "Read this first",
        blocks: [
          para("You are three weeks into a new job. Read https://example.org/guide before you start."),
          { kind: "list", items: ["Your team lead is busy", "A deadline is close"] },
        ],
      },
      {
        title: "Die Lage",
        subtitle: "Lies das zuerst",
        blocks: [
          para("Du bist seit drei Wochen im neuen Job. Lies https://example.org/guide, bevor du anfängst."),
          { kind: "list", items: ["Deine Teamleitung hat viel zu tun", "Eine Frist ist nah"] },
        ],
      }
    ),
  },
  {
    stageKey: "concept",
    narrative: narrative(
      {
        title: "The skill",
        blocks: [
          para("Asking early saves time for everyone."),
          { kind: "callout", text: "Say what you tried, then ask one clear question." },
        ],
      },
      {
        title: "Die Fähigkeit",
        blocks: [
          para("Früh fragen spart allen Zeit."),
          { kind: "callout", text: "Sag, was du versucht hast, und stell dann eine klare Frage." },
        ],
      }
    ),
  },
  {
    stageKey: "behaviour",
    narrative: narrative({
      title: "What it looks like",
      blocks: [
        { kind: "compare", left: { title: "Instead of", items: ["I'm stuck."] }, right: { title: "Try", items: ["I tried two things; can you help with the third?"] } },
      ],
    }),
  },
  {
    stageKey: "simulation",
    structure: {
      kind: "simulation",
      title: { en: "Practise asking" },
      prompt: { en: "Your report is due tomorrow and one figure is missing." },
      instruction: { en: "Pick what you would say." },
      options: [
        { id: "a", isBest: true, text: { en: "I checked the shared folder and the old report; where else could the figure be?" }, feedback: { en: "Clear and specific." } },
        { id: "b", isBest: false, text: { en: "I can't do this." }, feedback: { en: "They can't help if they don't know what you tried." } },
      ],
    },
  },
  {
    stageKey: "scenario",
    structure: {
      kind: "scenario",
      title: { en: "Ask for help" },
      setup: { en: "Your lead walks past your desk." },
      question: { en: "What do you do?" },
      followupQuestion: { en: "They say they have five minutes now. What next?" },
      choices: [
        {
          id: "c1",
          quality: "best",
          text: { en: "Ask if they have five minutes today." },
          outcome: { en: "They agree to talk." },
          followups: [
            { id: "f1", quality: "best", text: { en: "Show the two things you tried." }, outcome: { en: "You solve it together." } },
            { id: "f2", quality: "okay", text: { en: "Explain the whole project first." }, outcome: { en: "The five minutes run out." } },
          ],
        },
        { id: "c2", quality: "poor", text: { en: "Wait until Friday." }, outcome: { en: "The deadline passes." } },
      ],
    },
  },
  {
    stageKey: "reflection",
    narrative: narrative(
      { title: "Look back", blocks: [para("Think about the last time you needed help.")] },
      { title: "Rückblick", blocks: [para("Denk an das letzte Mal, als du Hilfe gebraucht hast.")] }
    ),
  },
  {
    stageKey: "assessment",
    structure: {
      kind: "assessment",
      title: { en: "Quick check" },
      intro: { en: "Two questions." },
      questions: [
        { id: "q1", correctOptionId: "a", question: { en: "When is it best to ask?" }, options: [{ id: "a", text: { en: "Early" } }, { id: "b", text: { en: "After the deadline" } }] },
        { id: "q2", correctOptionId: "b", question: { en: "What do you say first?" }, options: [{ id: "a", text: { en: "Nothing" } }, { id: "b", text: { en: "What you tried" } }] },
      ],
    },
  },
];

async function seedCourse() {
  await cleanCourse();
  await prisma.course.create({
    data: {
      projectId: PROJECT,
      strapiId: `cms-${SLUG}`,
      slug: SLUG,
      cluster: "communicationEi",
      durationMinutes: 15,
      status: "published",
      publishedAt: new Date("2026-10-01T09:00:00Z"),
      meta: {
        en: { title: "E2E Asking for help", tagline: "Short and real", clusterLabel: "Communication" },
        de: { title: "E2E Um Hilfe bitten", tagline: "Kurz und echt", clusterLabel: "Kommunikation" },
      },
    },
  });
  for (const l of LESSONS) {
    const lesson = await prisma.lesson.create({
      data: {
        projectId: PROJECT,
        courseSlug: SLUG,
        stageKey: l.stageKey,
        narrative: (l.narrative as Prisma.InputJsonValue | undefined) ?? undefined,
        structure: (l.structure as Prisma.InputJsonValue | undefined) ?? undefined,
      },
    });
    if (l.stageKey === "context") {
      await prisma.lessonDocument.create({
        data: {
          lessonId: lesson.id,
          name: "Asking for help — checklist.pdf",
          url: "https://example.org/e2e-r1-checklist.pdf",
          mimeType: "application/pdf",
          sizeBytes: 48_213,
          order: 1,
          published: true,
        },
      });
    }
  }
}

/*
 * Phase 2 (addendum 6): the course with its lesson list stored as an editor
 * leaves it after renaming every step in English and German — the seven
 * standard lessons in the standard order, so still the standard layout.
 * Learners see the standard names until Release 2, so the walk must match
 * the same Release 0 baseline.
 */
const STANDARD_IDS = [
  "context",
  "concept",
  "behaviour",
  "simulation",
  "scenario",
  "reflection",
  "assessment",
] as const;
const NAMED_OUTLINE = {
  v: 1,
  sections: STANDARD_IDS.map((id, i) => ({
    id,
    template: id,
    label: { en: `Our step ${i + 1}`, de: `Unser Schritt ${i + 1}` },
  })),
};

async function nameEveryStep() {
  await prisma.course.update({
    where: { projectId_slug: { projectId: PROJECT, slug: SLUG } },
    data: { outline: NAMED_OUTLINE as Prisma.InputJsonValue },
  });
}

/** What a learner's progress holds: Release 0's stage keys only. */
async function stagesCompletedOf(userId: string): Promise<string[]> {
  const course = await prisma.course.findFirstOrThrow({
    where: { projectId: PROJECT, slug: SLUG },
    select: { id: true },
  });
  const enrolment = await prisma.courseEnrollment.findUnique({
    where: { userId_courseId: { userId, courseId: course.id } },
    select: { stagesCompleted: true },
  });
  return enrolment?.stagesCompleted ?? [];
}

async function cleanCourse() {
  await prisma.lesson.deleteMany({ where: { projectId: PROJECT, courseSlug: SLUG } });
  await prisma.course.deleteMany({ where: { projectId: PROJECT, slug: SLUG } });
  await prisma.badge.deleteMany({
    where: { projectId: PROJECT, slug: { startsWith: `${SLUG}-complete` } },
  });
}

async function learner(email: string) {
  await prisma.user.deleteMany({ where: { email } });
  const user = await prisma.user.create({
    data: { email, emailVerified: new Date() },
  });
  await prisma.membership.create({
    data: { userId: user.id, projectId: PROJECT, role: "LEARNER" },
  });
  const sessionToken = `e2e-r1-${RUN}-${Math.random().toString(36).slice(2)}`;
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 86_400_000) },
  });
  return { userId: user.id, sessionToken };
}

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

// ---------------------------------------------------------------------------
// The walk.

const continueButton = (page: Page) =>
  page.getByRole("button", { name: /^(continue|weiter)$/i }).first();
// The visible one: while the page streams in, the server's copy can sit in
// a hidden block for a moment.
const stepBar = (page: Page) =>
  page.locator('[aria-current="step"]').filter({ visible: true });

/** Record, or compare with Release 0, what the learner sees now. */
async function capture(page: Page, key: string) {
  await page.waitForLoadState("networkidle");
  // Colours and smooth scrolls settle first; the tree doesn't change with
  // them, but a step that is still mounting would.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running")
  );
  const aria = await page.getByRole("main").ariaSnapshot();
  const counter = await page
    .getByText(/^\d+ \/ \d+ · /)
    .filter({ visible: true })
    .first()
    .textContent({ timeout: 2000 })
    .catch(() => null);
  const got: Captured = { aria, counter: counter?.trim() ?? null };
  if (RECORD) {
    recorded[key] = got;
    return;
  }
  expect(baseline[key], `a Release 0 baseline for "${key}"`).toBeTruthy();
  expect(got, `what learners see at "${key}"`).toEqual(baseline[key]);
}

/** Continue to step n, retried against the hydration race, never past it. */
async function continueTo(page: Page, n: number) {
  await expect(async () => {
    const at = (await stepBar(page).textContent())?.trim() ?? "";
    if (at.startsWith(String(n - 1))) await continueButton(page).click();
    await expect(stepBar(page)).toContainText(String(n), { timeout: 5000 });
  }).toPass({ timeout: 20_000 });
}

async function walkCreated(page: Page, locale: "en" | "de", tag: string) {
  const k = (step: string) => `${tag}:${locale}:${step}`;
  await page.goto(`/${locale}/learner/course/${SLUG}`);
  await expect(stepBar(page)).toContainText("1", { timeout: 15000 });
  await capture(page, k("1-context"));
  await continueTo(page, 2);
  await capture(page, k("2-concept"));
  await continueTo(page, 3);
  await capture(page, k("3-behaviour"));
  await continueTo(page, 4);
  await capture(page, k("4-simulation"));
  await page.getByText(/I checked the shared folder and the old report/).click();
  await capture(page, k("4-simulation-answered"));
  await continueTo(page, 5);
  await capture(page, k("5-scenario"));
  await page.getByText("Ask if they have five minutes today.").click();
  await page.getByText("Show the two things you tried.").click();
  await capture(page, k("5-scenario-answered"));
  await continueTo(page, 6);
  await capture(page, k("6-reflection"));
  await continueTo(page, 7);
  await capture(page, k("7-assessment"));
  await page.getByRole("button", { name: /Early/ }).click();
  await page.getByRole("button", { name: /What you tried/ }).click();
  await page.getByRole("button", { name: /^(check answers|antworten prüfen)$/i }).click();
  await capture(page, k("7-assessment-checked"));
  await continueButton(page).click();
  await expect(
    page.getByRole("heading", { name: /^(course complete|kurs abgeschlossen)/i })
  ).toBeVisible();
  await capture(page, k("8-complete"));
}

async function walkBuiltIn(page: Page, tag: string) {
  const k = (step: string) => `${tag}:en:${step}`;
  await page.goto(`/en/learner/course/${BUILT_IN}`);
  await expect(stepBar(page)).toContainText("1", { timeout: 15000 });
  await capture(page, k("1-context"));
  await continueTo(page, 2);
  await capture(page, k("2-concept"));
  await continueTo(page, 3);
  await capture(page, k("3-behaviour"));
  await continueTo(page, 4);
  await capture(page, k("4-simulation"));
  await page.getByText(/the bus was late\. when you say/i).click();
  await capture(page, k("4-simulation-answered"));
  await continueTo(page, 5);
  await capture(page, k("5-scenario"));
  await page.getByText(/wait for a quiet moment, then talk to sam/i).click();
  await page.getByText(/addressed directly from now on/i).click();
  await capture(page, k("5-scenario-answered"));
  await continueTo(page, 6);
  await capture(page, k("6-reflection"));
  await continueTo(page, 7);
  await capture(page, k("7-assessment"));
  for (const text of [
    "Describes what you felt and what you'd prefer",
    "Notice what you're feeling",
    "It lets both people be heard without an audience",
  ]) {
    await page.getByRole("button", { name: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
  }
  await page.getByRole("button", { name: /^check answers$/i }).click();
  await capture(page, k("7-assessment-checked"));
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: /^course complete/i })).toBeVisible();
  await capture(page, k("8-complete"));
}

describe("Release 1 — standard-layout courses are unchanged for learners", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeAll(async () => {
    await seedCourse();
  });

  test.afterAll(async () => {
    if (RECORD) {
      writeFileSync(BASELINE_FILE, `${JSON.stringify(recorded, null, 1)}\n`);
    }
    await prisma.auditLog.deleteMany({
      where: { actor: { is: { email: { in: EMAILS } } } },
    });
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await cleanCourse();
    await prisma.$disconnect();
  });

  test("a course created here, in English: every step as on Release 0", async ({
    page,
    context,
  }) => {
    const { sessionToken } = await learner(LEARNER);
    await useSession(context, sessionToken);
    await walkCreated(page, "en", "created");
  });

  test("the same course in German: every step as on Release 0", async ({
    page,
    context,
  }) => {
    const { sessionToken } = await learner(LEARNER_DE);
    await useSession(context, sessionToken);
    await walkCreated(page, "de", "created");
  });

  test("the built-in course: every step as on Release 0", async ({ page, context }) => {
    const { sessionToken } = await learner(LEARNER_BUILT_IN);
    await useSession(context, sessionToken);
    await walkBuiltIn(page, "builtin");
  });

  // Phase 2 compares with the baseline Release 0 recorded; recording it
  // (on Release 0, which has no Course.outline) runs phase 1 only.
  test("phase 2 — with every step renamed in English and German, still as on Release 0", async ({
    page,
    context,
  }) => {
    test.skip(RECORD, "phase 2 only compares; the baseline comes from phase 1 on Release 0");
    await nameEveryStep();

    const en = await learner(LEARNER_NAMED);
    await useSession(context, en.sessionToken);
    await walkCreated(page, "en", "created");

    const de = await learner(LEARNER_NAMED_DE);
    await useSession(context, de.sessionToken);
    await walkCreated(page, "de", "created");

    // Progress was saved, in Release 0's stage keys only (the StageKey enum
    // stores them in capitals: CONTEXT …).
    for (const userId of [en.userId, de.userId]) {
      const done = await stagesCompletedOf(userId);
      expect(done.length).toBeGreaterThan(0);
      expect(
        done.every((k) => (STANDARD_IDS as readonly string[]).includes(k.toLowerCase()))
      ).toBe(true);
    }
  });
});
