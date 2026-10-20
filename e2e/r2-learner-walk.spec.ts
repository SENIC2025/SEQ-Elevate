import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { applyR2Deltas, type Captured } from "./fixtures/r2-deltas";

/**
 * Release 2, the recorded learner walk (spec 10.3, D63): a course in the
 * standard layout, and a built-in course, are what they were for learners —
 * the same lessons, order, titles, content, saved answers and completion —
 * with markup that differs only by the closed list of spec 5.12
 * (e2e/fixtures/r2-deltas.ts). It replaces Release 1's
 * r1-learner-identical.spec.ts.
 *
 * Phase 1. A signed-in learner walks a published course created here — in
 * English and in German — and the built-in "workplace-conflict"; every
 * step, when it opens and once it is answered, is compared with
 * applyR2Deltas(the Release 0 recording, e2e/fixtures/r1-learner-baseline.json,
 * pinned in r2-fixture-pin.test.ts): the accessibility tree of the page's
 * main area (`ariaSnapshot`) and the "n / N · name" counter. Any other
 * difference fails. The learner's row is then what Release 1 writes for
 * the same walk, read the way every reader reads it (a reflection or quick
 * check never touched may be stored as Release 1's empty value or as {}),
 * and the two new columns stay NULL: a standard course writes nothing new
 * (spec 2.3).
 *
 * Phase 2. The course's lesson list is stored with every step renamed in
 * English and German (directly through Prisma) and walked again: only D5
 * differs from phase 1 — the step bar, Back and the counter show the new
 * names; lesson titles don't change. This flips Release 1's phase 2, where
 * learners kept the standard names, on purpose.
 *
 * Run on the Release 1 build, phase 1 fails at D1–D4 and only there:
 * every comparison is soft, so the run lists each step that differs, and
 * with R2_WALK_DELTAS=none (compare with the recording as it is) Release 1
 * passes phase 1 — Release 1 is the recording, so what it lacks is exactly
 * the list.
 *
 * With R2_WALK_VIDEO=1 Playwright records a video of each walk, for the
 * release check (spec 10.3). Requires a real database — gated on E2E_DB=1, like
 * db-backed-progress. The course has a fixed slug and is rebuilt at the
 * start; everything it creates is removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
/** "none": compare with the Release 0 recording as it is (to show Release 1 equals it). */
const NO_DELTAS = process.env.R2_WALK_DELTAS === "none";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;
test.describe.configure({ mode: "serial" });

const PROJECT = "seq-elevate";
const SLUG = "e2e-r2-walk-standard";
const BUILT_IN = "workplace-conflict";
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const LEARNER = `e2e-r2-walk-learner-${RUN}@example.com`;
const LEARNER_DE = `e2e-r2-walk-learner-de-${RUN}@example.com`;
const LEARNER_BUILT_IN = `e2e-r2-walk-builtin-${RUN}@example.com`;
const LEARNER_NAMED = `e2e-r2-walk-named-${RUN}@example.com`;
const LEARNER_NAMED_DE = `e2e-r2-walk-named-de-${RUN}@example.com`;
const EMAILS = [LEARNER, LEARNER_DE, LEARNER_BUILT_IN, LEARNER_NAMED, LEARNER_NAMED_DE];

// The Release 0 recording Release 1 matched exactly (pinned by SHA-256 in
// src/lib/r2-fixture-pin.test.ts).
const BASELINE_FILE = path.resolve("e2e/fixtures/r1-learner-baseline.json");
const baseline: Record<string, Captured> = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));

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
 * Phase 2: the course with its lesson list stored as an editor leaves it
 * after renaming every step in English and German — the seven standard
 * lessons in the standard order, so still the standard layout. Learners
 * see the new names (D58, D5).
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

/** The renamed steps, by the standard name learners saw before (D5). */
const STANDARD_NAMES = {
  en: ["Context", "Skill concept", "Behaviour model", "Guided practice", "Applied scenario", "Reflection", "Quick check"],
  de: ["Kontext", "Skill-Konzept", "Verhaltens-Modell", "Geführte Übung", "Anwendung", "Reflexion", "Schnellcheck"],
};
const RENAMED = {
  en: Object.fromEntries(STANDARD_NAMES.en.map((n, i) => [n, `Our step ${i + 1}`])),
  de: Object.fromEntries(STANDARD_NAMES.de.map((n, i) => [n, `Unser Schritt ${i + 1}`])),
};

async function nameEveryStep() {
  await prisma.course.update({
    where: { projectId_slug: { projectId: PROJECT, slug: SLUG } },
    data: { outline: NAMED_OUTLINE as Prisma.InputJsonValue },
  });
}

/**
 * A learner's row in `slug`, read as every reader reads it: a reflection
 * or quick check never touched is Release 1's empty value or {} — the same.
 */
async function rowOf(userId: string, slug: string) {
  const course = await prisma.course.findFirstOrThrow({
    where: { projectId: PROJECT, slug },
    select: { id: true },
  });
  const e = await prisma.courseEnrollment.findUnique({
    where: { userId_courseId: { userId, courseId: course.id } },
  });
  if (!e) return null;
  const reflection = (e.reflection ?? {}) as Record<string, string>;
  const assessment = (e.assessment ?? {}) as { answers?: Record<string, string>; checked?: boolean };
  return {
    completed: e.completedAt !== null,
    stagesCompleted: e.stagesCompleted,
    simulationChoice: e.simulationChoice,
    simulationCorrect: e.simulationCorrect,
    scenarioRoot: e.scenarioRoot,
    scenarioFollowup: e.scenarioFollowup,
    reflection: { p1: reflection.p1 ?? "", p2: reflection.p2 ?? "", p3: reflection.p3 ?? "" },
    assessment: { answers: assessment.answers ?? {}, checked: assessment.checked ?? false },
    sectionsCompleted: e.sectionsCompleted,
    responses: e.responses,
  };
}

const ALL_SEVEN = ["CONTEXT", "CONCEPT", "BEHAVIOUR", "SIMULATION", "SCENARIO", "REFLECTION", "ASSESSMENT"];

/**
 * What Release 1 writes for the walk (r1-learner-identical.spec.ts on the
 * Release 1 build): every lesson, the answers chosen, nothing typed, and
 * nothing in Release 2's columns.
 */
const R1_WRITES = {
  created: {
    completed: true,
    stagesCompleted: ALL_SEVEN,
    simulationChoice: "a",
    simulationCorrect: true,
    scenarioRoot: "c1",
    scenarioFollowup: "f1",
    reflection: { p1: "", p2: "", p3: "" },
    assessment: { answers: { q1: "a", q2: "b" }, checked: true },
    sectionsCompleted: null,
    responses: null,
  },
  builtin: {
    completed: true,
    stagesCompleted: ALL_SEVEN,
    simulationChoice: "iStatement",
    simulationCorrect: true,
    scenarioRoot: "private",
    scenarioFollowup: "privateBoundary",
    reflection: { p1: "", p2: "", p3: "" },
    assessment: { answers: { q1: "b", q2: "b", q3: "b" }, checked: true },
    sectionsCompleted: null,
    responses: null,
  },
};

/** The walk's last save is in: the course completed, its last lesson stored. */
async function walkSaved(userId: string, slug: string) {
  await expect
    .poll(async () => {
      const row = await rowOf(userId, slug);
      return !!row?.completed && row.stagesCompleted.includes("ASSESSMENT");
    }, { timeout: 15_000 })
    .toBe(true);
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

/**
 * Compare what the learner sees now with the Release 0 recording plus the
 * closed list (renamed steps in phase 2). Soft: a run lists every step
 * that differs, not only the first.
 */
async function capture(page: Page, key: string, names?: Record<string, string>) {
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
  expect(baseline[key], `a Release 0 recording for "${key}"`).toBeTruthy();
  const expected = NO_DELTAS ? baseline[key] : applyR2Deltas(key, baseline[key], { names });
  expect.soft(got, `what learners see at "${key}"`).toEqual(expected);
}

/** Continue to step n, retried against the hydration race, never past it. */
async function continueTo(page: Page, n: number) {
  await expect(async () => {
    const at = (await stepBar(page).textContent())?.trim() ?? "";
    if (at.startsWith(String(n - 1))) await continueButton(page).click();
    await expect(stepBar(page)).toContainText(String(n), { timeout: 5000 });
  }).toPass({ timeout: 20_000 });
}

async function walkCreated(page: Page, locale: "en" | "de", tag: string, names?: Record<string, string>) {
  const k = (step: string) => `${tag}:${locale}:${step}`;
  const see = (step: string) => capture(page, k(step), names);
  await page.goto(`/${locale}/learner/course/${SLUG}`);
  await expect(stepBar(page)).toContainText("1", { timeout: 15000 });
  await see("1-context");
  await continueTo(page, 2);
  await see("2-concept");
  await continueTo(page, 3);
  await see("3-behaviour");
  await continueTo(page, 4);
  await see("4-simulation");
  await page.getByText(/I checked the shared folder and the old report/).click();
  await see("4-simulation-answered");
  await continueTo(page, 5);
  await see("5-scenario");
  await page.getByText("Ask if they have five minutes today.").click();
  await page.getByText("Show the two things you tried.").click();
  await see("5-scenario-answered");
  await continueTo(page, 6);
  await see("6-reflection");
  await continueTo(page, 7);
  await see("7-assessment");
  await page.getByRole("button", { name: /Early/ }).click();
  await page.getByRole("button", { name: /What you tried/ }).click();
  await page.getByRole("button", { name: /^(check answers|antworten prüfen)$/i }).click();
  await see("7-assessment-checked");
  await continueButton(page).click();
  await expect(
    page.getByRole("heading", { name: /^(course complete|kurs abgeschlossen)/i })
  ).toBeVisible();
  await see("8-complete");
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

// Every walk on video for the release check (spec 10.3): R2_WALK_VIDEO=1.
// Playwright needs its ffmpeg for that (npx playwright install ffmpeg).
test.use({ video: process.env.R2_WALK_VIDEO === "1" ? "on" : "off" });

describe("Release 2 — the recorded learner walk", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeAll(async () => {
    await seedCourse();
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { actor: { is: { email: { in: EMAILS } } } },
    });
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await cleanCourse();
    await prisma.$disconnect();
  });

  test("phase 1 — a course created here, in English: every step as recorded, but for the closed list", async ({
    page,
    context,
  }) => {
    const { userId, sessionToken } = await learner(LEARNER);
    await useSession(context, sessionToken);
    await walkCreated(page, "en", "created");
    await walkSaved(userId, SLUG);
    expect(await rowOf(userId, SLUG), "what Release 1 writes, and nothing new").toEqual(R1_WRITES.created);
  });

  test("phase 1 — the same course in German", async ({ page, context }) => {
    const { userId, sessionToken } = await learner(LEARNER_DE);
    await useSession(context, sessionToken);
    await walkCreated(page, "de", "created");
    await walkSaved(userId, SLUG);
    expect(await rowOf(userId, SLUG), "what Release 1 writes, and nothing new").toEqual(R1_WRITES.created);
  });

  test("phase 1 — the built-in course", async ({ page, context }) => {
    const { userId, sessionToken } = await learner(LEARNER_BUILT_IN);
    await useSession(context, sessionToken);
    await walkBuiltIn(page, "builtin");
    await walkSaved(userId, BUILT_IN);
    expect(await rowOf(userId, BUILT_IN), "what Release 1 writes, and nothing new").toEqual(R1_WRITES.builtin);
  });

  test("phase 2 — every step renamed in English and German: the names in the step bar, Back and the counter, and nothing else", async ({
    page,
    context,
  }) => {
    test.skip(NO_DELTAS, "phase 2 shows Release 2's names; Release 1 kept the standard ones");
    await nameEveryStep();

    const en = await learner(LEARNER_NAMED);
    await useSession(context, en.sessionToken);
    await walkCreated(page, "en", "created", RENAMED.en);

    const de = await learner(LEARNER_NAMED_DE);
    await useSession(context, de.sessionToken);
    await walkCreated(page, "de", "created", RENAMED.de);

    // Progress was saved in Release 0's stage keys only, nothing in the new columns.
    for (const userId of [en.userId, de.userId]) {
      await walkSaved(userId, SLUG);
      expect(await rowOf(userId, SLUG)).toEqual(R1_WRITES.created);
    }
  });
});
