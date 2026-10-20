import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  learnerWithSession,
  ownLessonId,
  removeLearners,
  removeR2Course,
  runId,
  seedR2Course,
  signIn,
  type R2LessonSeed,
} from "./fixtures/r2-course";
import { AE1_NAMES, AE1_PARTS, AE1_TITLE, ae1Lessons } from "./fixtures/r2-ae1-course";

/**
 * Release 2, Stream A: the one learner player (D63, spec 5, 10.2 A-E1,
 * A-E2, A-E6, A-E9, A-E10, A-E11).
 *
 * A published course is seeded the way the course editor leaves it: two
 * lessons of its own, "context" and "reflection" hidden, the scenario moved before
 * "behaviour", every step named in English and German, extra content of
 * every kind on "concept", a video with an in-video question on a lesson
 * of its own, and documents (one published, one not) — the A-E1 course of
 * e2e/fixtures/r2-ae1-course.ts, which the recorded walk's phase 3 plays too.
 *
 *   A-E1   it plays as built: its own lessons, its order, the hidden one
 *          left out, the step names in the bar, Back and the counter (en,
 *          de), every kind of content, the video and the documents.
 *   A-E2   answers per item survive a reload, signed in (the row holds
 *          them by "lesson/content", the four standard ones in their
 *          columns, standard lessons in stagesCompleted only) and as a
 *          guest (the browser's store).
 *   A-E6   Continue before an answer: visible, says what it waits for;
 *          pressed, it names the item and the need, focuses the item —
 *          its top below the sticky header, the page not moved when it
 *          was in view, at once under reduced motion — in en, de and el;
 *          no sideways scroll at 320 px.
 *   A-E9   axe on every kind of content, in en, de and el, at 320 px, on
 *          the whole page: first as a learner — a lesson not done before
 *          done ones with its note, an item marked by an early Continue,
 *          done steps, the reload banner — then every lesson in a preview.
 *   5.9    on a phone the in-video question shows below the video, not
 *          over it; focus goes to it and then back to the video.
 *   A-E10  a published course with no lesson to show says so: no
 *          completion, no badge.
 *   A-E11  a save answered "unknown action" (a deploy happened): the reload
 *          banner, the answer kept, and saved after the reload (D68).
 *   D62.d  an answer the server can't store stays on the screen, and a note
 *          under its item says it wasn't saved.
 *
 * Each is red on the Release 1 build (main b357cc7): it gives learners
 * the standard lessons only (so the learner's own lessons — A-E9's learner
 * pass and D62.d included — aren't there, and a course whose outline
 * removed them all still has its four standard text lessons), keeps no
 * answer but the four standard ones, hides Continue until an answer, and
 * drops a save the server doesn't recognise.
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

const RUN = runId();
const SLUG = `e2e-r2-player-${RUN}`;
const EMPTY = `e2e-r2-player-empty-${RUN}`;
const EMAILS = {
  plays: `e2e-r2-player-plays-${RUN}@example.com`,
  done: `e2e-r2-player-done-${RUN}@example.com`,
  answers: `e2e-r2-player-answers-${RUN}@example.com`,
  cont: `e2e-r2-player-continue-${RUN}@example.com`,
  empty: `e2e-r2-player-empty-${RUN}@example.com`,
  stale: `e2e-r2-player-stale-${RUN}@example.com`,
  lang: `e2e-r2-player-lang-${RUN}@example.com`,
  refused: `e2e-r2-player-refused-${RUN}@example.com`,
};
/** Learners a test makes for itself, removed with the others. */
const MORE: string[] = [];
async function moreLearner(tag: string) {
  const email = `e2e-r2-player-${tag}-${RUN}@example.com`;
  MORE.push(email);
  return learnerWithSession(prisma, email);
}
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// ---------------------------------------------------------------------------
// The course.

const WARMUP = ownLessonId();
const WRAPUP = ownLessonId();
const P = AE1_PARTS;
const LESSONS: R2LessonSeed[] = ae1Lessons({ warmup: WARMUP, wrapup: WRAPUP, cueId: `e2e-cue-${RUN}` });
const NAMES = AE1_NAMES;

// ---------------------------------------------------------------------------
// The page. Only what's on screen: while the page streams in, the server's
// copy can sit in a hidden block for a moment.

const stepButtons = (page: Page) =>
  page.getByRole("navigation", { name: /^(course stages|kursschritte|βήματα του μαθήματος)$/i }).filter({ visible: true }).getByRole("button");
const counter = (page: Page) => page.getByText(/^\d+ \/ \d+ · /).filter({ visible: true });
const continueButton = (page: Page) =>
  page.getByRole("main").getByRole("button", { name: /^(continue|weiter|συνέχεια)$/i }).filter({ visible: true });
const region = (page: Page, name: string) => page.getByRole("main").getByRole("region", { name, exact: true });
const announcer = (page: Page) => page.locator("[data-player-announcer]");

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

/** The answers to lesson 1's scenario: a first choice and its follow-up. */
async function answerHallway(page: Page) {
  const hallway = region(page, "The hallway");
  await clickUntil(hallway.getByRole("button", { name: "Raise a hand and say you'd like to finish" }), () =>
    expect(hallway.getByText("They pause and listen.")).toBeVisible({ timeout: 2000 })
  );
  await hallway.getByRole("button", { name: "Finish your point briefly" }).click();
  await expect(hallway.getByText("Your point lands.")).toBeVisible();
}

/** Lesson 2: the extra quick check checked, two ratings, an own reflection, the practice. */
async function answerConcept(page: Page) {
  const quiz = region(page, "Quick check");
  await quiz.getByRole("button", { name: /^Early/ }).click();
  await quiz.getByRole("button", { name: /^check answers$/i }).click();
  await expect(quiz.getByText("You got 1 out of 1 right.")).toBeVisible();
  const reflection = region(page, "Reflection questions");
  await reflection.getByRole("textbox", { name: "E2E: what stopped you?" }).fill("E2E: the clock.");
  const rating = region(page, "Self-assessment");
  await rating.getByRole("group", { name: "E2E: I say when I disagree." }).getByRole("radio", { name: "4 of 5" }).check();
  await rating.getByRole("group", { name: "E2E: I ask for time to finish." }).getByRole("radio", { name: "2 of 5" }).check();
  const practice = region(page, "Try a small move");
  await practice.getByRole("button", { name: "Let me finish, please." }).click();
  await expect(practice.getByText("Clear and calm.")).toBeVisible();
}

/** A learner's row in the course, Release 1's columns and Release 2's. */
async function rowOf(userId: string, slug = SLUG) {
  return prisma.courseEnrollment.findFirst({
    where: { userId, course: { slug } },
    select: {
      completedAt: true,
      stagesCompleted: true,
      sectionsCompleted: true,
      simulationChoice: true,
      scenarioRoot: true,
      scenarioFollowup: true,
      assessment: true,
      responses: true,
    },
  });
}

async function noSideScroll(page: Page, where = "") {
  const [overflow, wide] = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    // The elements reaching past the screen outside any scroll box, to say which.
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== "visible") return true;
      }
      return false;
    };
    const past = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > width + 0.5 && !clipped(el))
      .slice(-3)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}: ${el.textContent?.slice(0, 40)}`);
    // And where the extra width comes from: the widest boxes, outside any scroll box.
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => !clipped(el) && el.scrollWidth > width)
      .slice(-4)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} sw=${el.scrollWidth} r=${Math.round(el.getBoundingClientRect().right)}`);
    past.push(...wide);
    return [document.documentElement.scrollWidth - width, past] as const;
  });
  expect(overflow, `no sideways scrolling ${where} ${JSON.stringify(wide)}`).toBeLessThanOrEqual(0);
}

/** The player's whole page: header, the player, the footer (spec 5.12). */
async function axeClean(page: Page, where: string) {
  // Once colours have finished fading (transition-colors): mid-fade they
  // are a blend of two.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad, `${where}: ${JSON.stringify(bad.map((v) => [v.id, v.nodes.map((n) => n.target)]))}`).toEqual([]);
}

describe("Release 2 — the learner player", () => {
  const users: Record<keyof typeof EMAILS, { userId: string; sessionToken: string }> = {} as never;

  test.beforeAll(async () => {
    await seedR2Course(prisma, {
      slug: SLUG,
      title: AE1_TITLE,
      lessons: LESSONS,
    });
    for (const [k, email] of Object.entries(EMAILS)) {
      users[k as keyof typeof EMAILS] = await learnerWithSession(prisma, email);
    }
  });

  test.afterAll(async () => {
    const more = await prisma.user.findMany({ where: { email: { in: MORE } }, select: { id: true } });
    const ids = [...Object.values(users).map((u) => u.userId), ...more.map((u) => u.id)];
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await removeLearners(prisma, [...Object.values(EMAILS), ...MORE]);
    await removeR2Course(prisma, SLUG);
    await removeR2Course(prisma, EMPTY);
    await prisma.$disconnect();
  });

  test("A-E1: a published flexible course plays as built: its lessons, order, names, every kind of content, video and documents", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await signIn(context, users.plays.sessionToken);
    await page.goto(`/en/learner/course/${SLUG}`);
    const main = page.getByRole("main");

    // Its own lessons, in its order, by their names; the hidden one left out.
    await expect(stepButtons(page)).toHaveCount(6, { timeout: 15000 });
    for (const [i, name] of NAMES.en.entries()) {
      await expect(stepButtons(page).nth(i)).toHaveAccessibleName(i === 0 ? `1 ${name}` : `${i + 1} ${name}`);
    }
    await expect(page.getByText("E2E hidden context text.")).toHaveCount(0);
    await expect(counter(page)).toHaveText("1 / 6 · Warm-up");
    await expect(main.getByRole("heading", { level: 2 })).toHaveText("Before you start");

    // Its published document, not the other.
    await expect(main.getByRole("button", { name: "E2E checklist.pdf" })).toBeVisible();
    await expect(page.getByText("E2E unpublished.pdf")).toHaveCount(0);

    // A scenario with a follow-up, in a lesson of its own.
    await answerHallway(page);
    await continueTo(page, 2);

    // Every kind of extra content on a standard lesson, its main text first.
    await expect(counter(page)).toHaveText("2 / 6 · The idea");
    await expect(main.getByRole("heading", { level: 2 })).toHaveText("Why speaking up works");
    await expect(main.getByText("E2E concept text.")).toBeVisible();
    await expect(main.getByText("E2E extra text: say it early.")).toBeVisible();
    for (const name of ["Quick check", "Reflection questions", "Self-assessment", "Try a small move"]) {
      await expect(main.getByRole("heading", { level: 3, name, exact: true })).toHaveCount(1);
    }
    // Back is named by the lesson it goes to; the first step is done.
    const back = main.getByRole("button", { name: "Warm-up", exact: true });
    await expect(back).toBeEnabled();
    await expect(stepButtons(page).first()).toHaveAccessibleName("Warm-up, done");
    await answerConcept(page);
    await continueTo(page, 3);

    // A standard lesson, moved before "behaviour", by its stage screen, renamed.
    await expect(counter(page)).toHaveText("3 / 6 · Try it");
    await expect(main.getByRole("heading", { level: 2 })).toHaveText("The bigger moment");
    await expect(main.getByRole("button", { name: "The idea", exact: true })).toBeVisible();
    await clickUntil(main.getByRole("button", { name: "Ask to finish your point" }), () =>
      expect(main.getByText("You finish.")).toBeVisible({ timeout: 2000 })
    );
    await continueTo(page, 4);
    await expect(counter(page)).toHaveText("4 / 6 · Behaviour model");
    await expect(main.getByText("E2E behaviour text.")).toBeVisible();
    await continueTo(page, 5);

    // A lesson of its own with a video and an in-video question, answered
    // and recorded with the lesson's id (spec 5.9).
    await expect(counter(page)).toHaveText("5 / 6 · Wrap-up");
    const video = page.getByTestId("lesson-video");
    await expect(video).toBeVisible();
    await expect(video.locator("track[kind='captions']")).toHaveCount(1);
    const dialog = page.getByRole("dialog");
    await expect(async () => {
      await video.evaluate((v: HTMLVideoElement) => {
        v.currentTime = 6;
      });
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000 });
    await dialog.getByText("Speaking early").click();
    await dialog.getByRole("button", { name: /^submit$/i }).click();
    await dialog.getByRole("button", { name: /continue watching/i }).click();
    await expect
      .poll(async () => {
        const row = await prisma.auditLog.findFirst({
          where: { actorId: users.plays.userId, action: "video.cue_answered", entityId: `e2e-cue-${RUN}` },
          select: { metadata: true },
        });
        return row?.metadata ?? null;
      }, { timeout: 15000 })
      .toMatchObject({ courseSlug: SLUG, correct: true, lessonId: WRAPUP });
    await region(page, "Practice question").getByRole("button", { name: "It was fine." }).click();
    await continueTo(page, 6);

    // The standard quick check, then the course is complete.
    await expect(counter(page)).toHaveText("6 / 6 · Quick check");
    await main.getByRole("button", { name: /^Early/ }).click();
    await main.getByRole("button", { name: /^check answers$/i }).click();
    await continueButton(page).click();
    await expect(page.getByRole("heading", { name: /course complete/i })).toBeVisible({ timeout: 15000 });
  });

  test("A-E1: the same course in German: the step names in the bar, Back and the counter", async ({
    page,
    context,
  }) => {
    // A learner who completed the course: it opens on its completion
    // screen; every step can be opened.
    const course = await prisma.course.findFirstOrThrow({ where: { slug: SLUG }, select: { id: true } });
    await prisma.courseEnrollment.create({
      data: {
        userId: users.done.userId,
        courseId: course.id,
        stagesCompleted: ["CONCEPT", "SCENARIO", "BEHAVIOUR", "ASSESSMENT"],
        sectionsCompleted: [WARMUP, WRAPUP],
        completedAt: new Date(),
      },
      select: { id: true },
    });
    await signIn(context, users.done.sessionToken);
    await page.goto(`/de/learner/course/${SLUG}`);
    await expect(stepButtons(page)).toHaveCount(6, { timeout: 15000 });
    for (const [i, name] of NAMES.de.entries()) {
      await expect(stepButtons(page).nth(i)).toHaveAccessibleName(`${name}, erledigt`);
    }
    await stepButtons(page).nth(1).click();
    await expect(counter(page)).toHaveText("2 / 6 · Die Idee");
    await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText("Warum es wirkt");
    await expect(page.getByRole("main").getByRole("button", { name: "Aufwärmen", exact: true })).toBeEnabled();
  });

  test("A-E1: in Greek, a step name written only in English says so (WCAG 3.1.2)", async ({ page, context }) => {
    // Review finding 6 on Stream A: the course's own lessons are named in
    // English and German only, and on a Greek page "Warm-up" and
    // "Wrap-up" were read with Greek speech in the step bar, Back and the
    // counter. Its renamed standard lessons have no Greek name: they keep
    // their standard Greek ones.
    await signIn(context, users.lang.sessionToken);
    await page.goto(`/el/learner/course/${SLUG}`);
    await expect(counter(page)).toHaveText("1 / 6 · Warm-up", { timeout: 15000 });
    await expect(page.locator("html")).toHaveAttribute("lang", "el");
    await expect(stepButtons(page)).toHaveCount(6);
    for (const [i, name] of NAMES.el.entries()) {
      await expect(stepButtons(page).nth(i)).toHaveAccessibleName(`${i + 1} ${name}`);
    }
    await expect(counter(page).locator('span[lang="en"]')).toHaveText("Warm-up");
    const named = (i: number) => stepButtons(page).nth(i).locator("[lang]");
    await expect(named(0)).toHaveAttribute("lang", "en");
    await expect(named(4)).toHaveAttribute("lang", "en");
    // Names in Greek: no lang of their own.
    for (const i of [1, 2, 3, 5]) await expect(named(i)).toHaveCount(0);

    await answerHallwayIn(page, "el");
    await continueTo(page, 2);
    await expect(counter(page)).toHaveText(`2 / 6 · ${NAMES.el[1]}`);
    await expect(counter(page).locator("[lang]")).toHaveCount(0);
    await expect(stepButtons(page).first()).toHaveAccessibleName("Warm-up, ολοκληρώθηκε");
    await expect(
      page.getByRole("main").getByRole("button", { name: "Warm-up", exact: true }).locator('span[lang="en"]')
    ).toHaveCount(1);
  });

  test("A-E2: answers per item survive a reload, stored by lesson and item; standard lessons stay in their column", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const { userId, sessionToken } = users.answers;
    await signIn(context, sessionToken);
    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(counter(page)).toHaveText("1 / 6 · Warm-up", { timeout: 15000 });
    await answerHallway(page);
    await continueTo(page, 2);
    await answerConcept(page);
    await continueTo(page, 3);
    const main = page.getByRole("main");
    await clickUntil(main.getByRole("button", { name: "Ask to finish your point" }), () =>
      expect(main.getByText("You finish.")).toBeVisible({ timeout: 2000 })
    );
    await continueTo(page, 4);

    // Saved: per item, the four standard answers in their columns.
    await expect
      .poll(async () => (await rowOf(userId))?.stagesCompleted ?? [], { timeout: 15000 })
      .toEqual(["CONCEPT", "SCENARIO"]);
    const row = (await rowOf(userId))!;
    expect(row.sectionsCompleted).toEqual([WARMUP]);
    expect(row.scenarioRoot).toBe("c1");
    expect(row.simulationChoice).toBeNull();
    const items = (row.responses as { items: Record<string, unknown> }).items;
    expect(Object.keys(items).sort()).toEqual(
      [`${WARMUP}/${P.hallway}`, `concept/${P.quiz}`, `concept/${P.rating}`, `concept/${P.reflection}`, `concept/${P.practice}`].sort()
    );
    expect(items[`${WARMUP}/${P.hallway}`]).toMatchObject({ type: "scenario", rootId: "hall-raise", followupId: "hall-finish" });
    expect(items[`concept/${P.quiz}`]).toMatchObject({ type: "quiz", answers: { q1: "a" }, checked: true });
    expect(items[`concept/${P.rating}`]).toMatchObject({ type: "rating", values: { s1: 4, s2: 2 } });
    expect(items[`concept/${P.reflection}`]).toMatchObject({ type: "reflection", text: { r2: "E2E: the clock." } });
    expect(items[`concept/${P.practice}`]).toMatchObject({ type: "practice", optionId: "o1", correct: true });

    // A reload: they all come back.
    await page.reload();
    await expect(counter(page)).toHaveText("4 / 6 · Behaviour model", { timeout: 15000 });
    await stepButtons(page).nth(1).click();
    await expect(counter(page)).toHaveText("2 / 6 · The idea");
    await expect(region(page, "Quick check").getByText("You got 1 out of 1 right.")).toBeVisible();
    await expect(
      region(page, "Reflection questions").getByRole("textbox", { name: "E2E: what stopped you?" })
    ).toHaveValue("E2E: the clock.");
    await expect(
      region(page, "Self-assessment").getByRole("group", { name: "E2E: I say when I disagree." }).getByRole("radio", { name: "4 of 5" })
    ).toBeChecked();
    await expect(region(page, "Try a small move").getByText("Clear and calm.")).toBeVisible();
    await stepButtons(page).first().click();
    await expect(region(page, "The hallway").getByText("Your point lands.")).toBeVisible();
  });

  test("A-E2: as a guest, the same answers survive a reload in the browser's store", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(counter(page)).toHaveText("1 / 6 · Warm-up", { timeout: 15000 });
    await answerHallway(page);
    await continueTo(page, 2);
    await answerConcept(page);
    await continueTo(page, 3);

    await page.reload();
    // The guest's progress is read from the browser: they open where they left off.
    await expect(counter(page)).toHaveText("3 / 6 · Try it", { timeout: 15000 });
    await stepButtons(page).nth(1).click();
    await expect(region(page, "Quick check").getByText("You got 1 out of 1 right.")).toBeVisible();
    await expect(
      region(page, "Reflection questions").getByRole("textbox", { name: "E2E: what stopped you?" })
    ).toHaveValue("E2E: the clock.");
    await expect(
      region(page, "Self-assessment").getByRole("group", { name: "E2E: I ask for time to finish." }).getByRole("radio", { name: "2 of 5" })
    ).toBeChecked();
    await stepButtons(page).first().click();
    await expect(region(page, "The hallway").getByText("Your point lands.")).toBeVisible();
  });

  for (const locale of ["en", "de", "el"] as const) {
    test(`A-E6: Continue before an answer says what it waits for; pressed, it names the item and takes the learner there (${locale})`, async ({
      page,
      context,
    }) => {
      test.setTimeout(90_000);
      const words = {
        en: {
          hint: "To continue, choose what you would do.",
          announce: "The hallway: To continue, choose what you would do.",
          several: "2 questions above still need an answer.",
        },
        de: {
          hint: "Wähle, was du tun würdest, um weiterzumachen.",
          announce: "Der Flur: Wähle, was du tun würdest, um weiterzumachen.",
          several: "2 Fragen oben brauchen noch eine Antwort.",
        },
        el: {
          hint: "Για να συνεχίσεις, διάλεξε τι θα έκανες.",
          announce: "The hallway: Για να συνεχίσεις, διάλεξε τι θα έκανες.",
          several: "2 ερωτήσεις παραπάνω χρειάζονται ακόμη απάντηση.",
        },
      }[locale];
      // Each language's own learner: each starts afresh.
      const { sessionToken } = await moreLearner(`cont-${locale}`);
      await signIn(context, sessionToken);
      await page.goto(`/${locale}/learner/course/${SLUG}`);
      await expect(counter(page)).toHaveText(/^1 \/ 6 · /, { timeout: 15000 });

      // Visible before any answer, with what it waits for above it.
      const cont = continueButton(page);
      await expect(cont).toBeVisible();
      await expect(cont).toHaveAccessibleDescription(words.hint);

      // The heading in view, Continue in view: pressing moves nothing.
      const heading = page
        .getByRole("main")
        .getByRole("heading", { level: 3, name: locale === "de" ? "Der Flur" : "The hallway" });
      await cont.scrollIntoViewIfNeeded();
      await heading.scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => window.scrollY);
      await expect(async () => {
        await cont.click();
        await expect(heading).toBeFocused({ timeout: 2000 });
      }).toPass({ timeout: 20_000 });
      expect(await page.evaluate(() => window.scrollY), "focus doesn't scroll a target in view").toBe(before);
      await expect(counter(page)).toHaveText(/^1 \/ 6 · /);
      // Named, with its need: in the live region and as the heading's description.
      await expect(announcer(page)).toHaveText(new RegExp(`^${words.announce.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s?$`));
      await expect(heading).toHaveAccessibleDescription(words.hint);

      // Lesson 2 at a phone's width, under reduced motion: Continue from the
      // bottom takes the learner up to the first item, its top just below
      // the sticky header, at once.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 320, height: 640 });
      await answerHallwayIn(page, locale);
      await continueTo(page, 2);
      await noSideScroll(page);
      await expect(page.getByRole("main").getByText(words.several)).toBeVisible();
      await cont.scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        const w = window as unknown as { __scrolls: string[] };
        w.__scrolls = [];
        const scrollTo = window.scrollTo.bind(window);
        window.scrollTo = ((o: ScrollToOptions) => {
          w.__scrolls.push(o.behavior ?? "auto");
          scrollTo(o);
        }) as typeof window.scrollTo;
      });
      await cont.click();
      // The quick check's first unanswered question, the first item missing.
      const question = page.getByRole("main").getByRole("group", { name: /E2E: when do you speak up\?/ });
      await expect(question).toBeFocused();
      await expect(question).toHaveAccessibleDescription(/^(Answer 1 more question|Beantworte noch 1 Frage|Απάντησε σε 1 ακόμη ερώτηση)/);
      expect(await page.evaluate(() => (window as unknown as { __scrolls: string[] }).__scrolls)).toEqual(["auto"]);
      const [headerBottom, top] = await page.evaluate(() => {
        const header = document.querySelector("header")!.getBoundingClientRect().bottom;
        return [header, (document.activeElement as HTMLElement).getBoundingClientRect().top];
      });
      expect(top, "the item's top is below the sticky header").toBeGreaterThanOrEqual(headerBottom);
      expect(top - headerBottom).toBeLessThanOrEqual(17);
      await noSideScroll(page);
    });
  }

  test("A-E9: every kind of content passes axe in en, de and el, and reflows at 320 px", async ({ page, context }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 320, height: 720 });
    const words = {
      en: { title: "Before you start", note: "You haven't done this lesson yet. It's new, or it has moved.", banner: "A new version is available." },
      de: { title: "Bevor du anfängst", note: "Diese Lektion hast du noch nicht gemacht. Sie ist neu oder wurde verschoben.", banner: "Eine neue Version ist verfügbar." },
      el: { title: "Before you start", note: "Δεν έχεις κάνει ακόμη αυτή την ενότητα. Είναι νέα ή έχει μετακινηθεί.", banner: "Υπάρχει νέα έκδοση." },
    };
    const course = await prisma.course.findFirstOrThrow({ where: { slug: SLUG }, select: { id: true } });

    // As a learner, the screens only learners get. Each language's learner
    // did "The idea" before an editor put "Warm-up" in front of it: they
    // open at Warm-up, which says it is still to do.
    for (const locale of ["en", "de", "el"] as const) {
      const w = words[locale];
      const learner = await moreLearner(`axe-${locale}`);
      await prisma.courseEnrollment.create({
        data: { userId: learner.userId, courseId: course.id, stagesCompleted: ["CONCEPT"] },
        select: { id: true },
      });
      await signIn(context, learner.sessionToken);
      await page.goto(`/${locale}/learner/course/${SLUG}`);
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { level: 2 })).toHaveText(w.title, { timeout: 15000 });
      await expect(main.getByText(w.note)).toBeVisible();
      await noSideScroll(page, `${locale} learner: new lesson`);
      await axeClean(page, `${locale} learner: new lesson`);

      // Continue pressed early: the item marked, its note under its heading.
      const heading = main.getByRole("heading", { level: 3, name: locale === "de" ? "Der Flur" : "The hallway" });
      await expect(async () => {
        await continueButton(page).click();
        await expect(heading).toBeFocused({ timeout: 2000 });
      }).toPass({ timeout: 20_000 });
      await noSideScroll(page, `${locale} learner: marked`);
      await axeClean(page, `${locale} learner: marked`);

      // On to "The idea": "Warm-up, done" and "The idea, done" in the bar.
      await answerHallwayIn(page, locale);
      await continueTo(page, 2);
      await expect(stepButtons(page).first()).toHaveAccessibleName(/, (done|erledigt|ολοκληρώθηκε)$/);
      await noSideScroll(page, `${locale} learner: done steps`);
      await axeClean(page, `${locale} learner: done steps`);

      // A deploy meanwhile: the next save is an unknown action, and the
      // reload banner shows.
      const url = `**/learner/course/${SLUG}`;
      await page.route(url, async (route) => {
        const req = route.request();
        if (req.method() === "POST" && !!(await req.headerValue("next-action")) && (req.postData() ?? "").includes('"v":2')) {
          return route.fulfill({ status: 200, headers: { "x-nextjs-action-not-found": "1" }, body: "" });
        }
        await route.continue();
      });
      await main
        .getByRole("group", { name: "E2E: I say when I disagree." })
        .getByRole("radio", { name: /^4 / })
        .check();
      await expect(page.getByRole("alert").filter({ hasText: w.banner })).toBeVisible({ timeout: 15000 });
      await noSideScroll(page, `${locale} learner: reload banner`);
      await axeClean(page, `${locale} learner: reload banner`);
      await page.unroute(url);
    }

    // Every lesson, as an editor's preview shows it: exactly what learners
    // get (D35), and it reaches every lesson.
    const editor = await moreLearner("axe");
    await prisma.membership.create({ data: { userId: editor.userId, projectId: "seq-elevate", role: "CONTENT_EDITOR" } });
    await signIn(context, editor.sessionToken);
    for (const locale of ["en", "de", "el"] as const) {
      for (const lesson of [WARMUP, "concept", "scenario", "behaviour", WRAPUP, "assessment"]) {
        await page.goto(`/${locale}/learner/course/${SLUG}?preview=1&lesson=${lesson}`);
        await expect(counter(page)).toBeVisible({ timeout: 15000 });
        await noSideScroll(page, `${locale} ${lesson}`);
        await axeClean(page, `${locale} ${lesson}`);
      }
    }
  });

  // Found at integration review (finding 9): every piece of content was a
  // region named by its heading, so the two text pieces of "The idea"
  // (each headed "Text", for screen readers) made two landmarks named
  // "Text" — axe's landmark-unique, a best practice A-E9's WCAG tags leave
  // out. Learners get the published course's lesson; the same course as a
  // draft is the editor's preview of it, which Release 1 drew with the
  // same markup: red there for this reason, not for what it plays.
  test("no two landmarks of a lesson are named alike (axe landmark-unique): the A-E1 course's lesson 2", async ({
    page,
    context,
  }) => {
    const DRAFT = `${SLUG}-draft`;
    await seedR2Course(prisma, { slug: DRAFT, title: AE1_TITLE, lessons: LESSONS, status: "draft" });
    try {
      const editor = await moreLearner("landmarks");
      await prisma.membership.create({ data: { userId: editor.userId, projectId: "seq-elevate", role: "CONTENT_EDITOR" } });
      await signIn(context, editor.sessionToken);
      const words = {
        en: { title: "Why speaking up works", text: "E2E extra text: say it early." },
        de: { title: "Warum es wirkt", text: "E2E Zusatztext: sag es früh." },
      };
      for (const slug of [DRAFT, SLUG]) {
        for (const locale of ["en", "de"] as const) {
          await page.goto(`/${locale}/learner/course/${slug}?preview=1&lesson=concept`);
          const main = page.getByRole("main");
          await expect(main.getByRole("heading", { level: 2, name: words[locale].title })).toBeVisible({ timeout: 15000 });
          // As learners get it: the lesson's extra content is there — on
          // Release 1 only in the draft's preview.
          if (slug === DRAFT) await expect(main.getByText(words[locale].text)).toBeVisible();
          const results = await new AxeBuilder({ page }).include("main").withRules(["landmark-unique"]).analyze();
          expect(
            results.violations.map((v) => [v.id, v.nodes.map((n) => n.target)]),
            `${slug} (${locale}): landmarks named alike`
          ).toEqual([]);
          if (slug === SLUG) await expect(main.getByText(words[locale].text)).toBeVisible();
        }
      }
    } finally {
      await removeR2Course(prisma, DRAFT);
    }
  });

  test("5.9: on a phone the in-video question shows below the video; focus goes to it, then back to the video", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await page.goto("/en/learner/course/workplace-conflict");
    const concept = page.getByText(/watch: speaking up without blame/i);
    await clickUntil(page.getByRole("button", { name: "Continue", exact: true }), () =>
      expect(concept).toBeVisible({ timeout: 2000 })
    );
    const video = page.getByTestId("lesson-video");
    const dialog = page.getByRole("dialog");
    await expect(async () => {
      await video.evaluate((v: HTMLVideoElement) => {
        v.currentTime = 6;
      });
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10000 });

    // Below the video, not over it — so not modal: the page stays usable.
    const frame = (await video.boundingBox())!;
    const panel = (await dialog.boundingBox())!;
    expect(panel.y, "the question starts below the video").toBeGreaterThanOrEqual(frame.y + frame.height - 1);
    await expect(dialog).not.toHaveAttribute("aria-modal", "true");
    await expect(dialog.getByRole("heading", { level: 3 })).toBeFocused();
    await expect(page.locator("#cue-question")).toHaveCount(0);

    await dialog.getByText("Whose fault it is").click();
    await dialog.getByRole("button", { name: /^submit$/i }).click();
    await dialog.getByRole("button", { name: /continue watching/i }).click();
    await expect(dialog).toHaveCount(0);
    await expect(video, "focus back on the video's controls").toBeFocused();
  });

  test("A-E10: a published course with no lesson to show says so: no completion, no badge", async ({ page, context }) => {
    const { userId, sessionToken } = users.empty;
    // Its only lesson has nothing to show; the standard text lessons are deleted.
    const nothing = ownLessonId();
    await seedR2Course(prisma, {
      slug: EMPTY,
      lessons: [{ id: nothing, label: { en: "Nothing yet" } }],
      outline: {
        v: 1,
        sections: [{ id: nothing, template: "text", label: { en: "Nothing yet" } }],
        removed: ["context", "concept", "behaviour", "reflection"],
      },
    });
    await signIn(context, sessionToken);
    await page.goto(`/en/learner/course/${EMPTY}`);
    await expect(page.getByRole("main")).toBeVisible({ timeout: 15000 });
    // Time for a completion to be saved, were there one: Release 1's player
    // fell back to the completion screen, badge and all, for a course with
    // no stage (CoursePlayer.tsx:84-88). Spec 10.2 names that as A-E10's
    // Release 1 failure, but Release 1 can't reach it with a course built
    // here: it gives learners the four standard text lessons this outline
    // removed, so there it fails at the "no lessons" text below.
    await page.waitForTimeout(2500);
    expect(await prisma.userBadge.count({ where: { userId } }), "no badge for nothing").toBe(0);
    await expect(page.getByRole("heading", { name: /course complete/i })).toHaveCount(0);
    expect(await rowOf(userId, EMPTY), "no enrolment: nothing done, nothing completed").toBeNull();
    await expect(page.getByRole("main").getByText("This course has no lessons yet.")).toBeVisible();
  });

  test("D62.d: an answer the server can't store stays on the screen, and a note under its item says so", async ({
    page,
    context,
  }) => {
    // Review finding 1 on Stream A. The learner's stored answers can't be
    // read (something else is in the column): the server keeps them, and
    // refuses every new answer to a lesson's own content ("invalid").
    const { userId, sessionToken } = users.refused;
    const course = await prisma.course.findFirstOrThrow({ where: { slug: SLUG }, select: { id: true } });
    await prisma.courseEnrollment.create({
      data: { userId, courseId: course.id, responses: ["not", "answers"] },
      select: { id: true },
    });
    await signIn(context, sessionToken);
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText("Before you start", {
      timeout: 15000,
    });
    const hallway = region(page, "The hallway");
    await clickUntil(hallway.getByRole("button", { name: "Raise a hand and say you'd like to finish" }), () =>
      expect(hallway.getByText("They pause and listen.")).toBeVisible({ timeout: 2000 })
    );
    const NOTE = "This answer couldn't be saved. You can carry on, but it won't be there after a reload or on another device.";
    await expect(hallway.getByText(NOTE)).toBeVisible({ timeout: 15000 });
    await expect(announcer(page)).toHaveText(new RegExp(`^${NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s?$`));
    // The answer is still on the screen; what was stored is kept as it was.
    await expect(hallway.getByText("They pause and listen.")).toBeVisible();
    expect((await rowOf(userId))?.responses).toEqual(["not", "answers"]);
    await noSideScroll(page, "refused");
    await axeClean(page, "refused");
    // The learner can carry on.
    await hallway.getByRole("button", { name: "Finish your point briefly" }).click();
    await continueTo(page, 2);
  });

  test("A-E11: a save answered 'unknown action' shows the reload banner, keeps the answer, and saves it after the reload", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = users.stale;
    await signIn(context, sessionToken);
    const url = `**/en/learner/course/${SLUG}`;
    let unknown = 0;
    await page.route(url, async (route) => {
      const req = route.request();
      if (req.method() === "POST" && !!(await req.headerValue("next-action")) && (req.postData() ?? "").includes("hall-raise")) {
        unknown++;
        return route.fulfill({ status: 200, headers: { "x-nextjs-action-not-found": "1" }, body: "" });
      }
      await route.continue();
    });
    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(counter(page)).toHaveText("1 / 6 · Warm-up", { timeout: 15000 });
    const hallway = region(page, "The hallway");
    await clickUntil(hallway.getByRole("button", { name: "Raise a hand and say you'd like to finish" }), () =>
      expect(hallway.getByText("They pause and listen.")).toBeVisible({ timeout: 2000 })
    );

    // The banner, and the answer still on screen.
    const banner = page.getByRole("alert").filter({ hasText: "A new version is available." });
    await expect(banner).toBeVisible({ timeout: 15000 });
    expect(unknown).toBeGreaterThan(0);
    await expect(hallway.getByText("They pause and listen.")).toBeVisible();
    expect(await rowOf(userId)).toBeNull();

    // The new build is there: Reload, and the kept answer is saved.
    await page.unroute(url);
    await banner.getByRole("button", { name: "Reload" }).click();
    await expect(counter(page)).toHaveText("1 / 6 · Warm-up", { timeout: 15000 });
    await expect
      .poll(async () => {
        const row = await rowOf(userId);
        return (row?.responses as { items?: Record<string, unknown> } | null)?.items?.[`${WARMUP}/${P.hallway}`] ?? null;
      }, { timeout: 15000 })
      .toMatchObject({ type: "scenario", rootId: "hall-raise" });
    await expect(region(page, "The hallway").getByText("They pause and listen.")).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "A new version is available." })).toHaveCount(0);
  });
});

/** Lesson 1's scenario answered, whatever the page's language (the content is English). */
async function answerHallwayIn(page: Page, locale: "en" | "de" | "el") {
  const name = locale === "de" ? "Der Flur" : "The hallway";
  const hallway = region(page, name);
  await clickUntil(hallway.getByRole("button", { name: "Raise a hand and say you'd like to finish" }), () =>
    expect(hallway.getByText("They pause and listen.")).toBeVisible({ timeout: 2000 })
  );
  await hallway.getByRole("button", { name: "Finish your point briefly" }).click();
  await expect(hallway.getByText("Your point lands.")).toBeVisible();
}
