import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, removePeople, runId, signIn, type Person } from "./fixtures/people";
import { PROJECT, narrative, ownLessonId, type R2LessonSeed } from "./fixtures/r2-course";
import { readyOf, removeECourse, seedECourse, setReady } from "./fixtures/r3-e-course";
import { callAction } from "./fixtures/server-action";
import de from "../src/messages/de.json";
import en from "../src/messages/en.json";

/**
 * Release 3, Stream E (spec 9, D90; 18.2: E-E1, E-E2, E-E3, E-E8): a course
 * created in the CMS reaches learners in German or Greek only once that
 * language is switched on for it. Until then a German learner gets the
 * whole course in English, with a note, and its text marked lang="en"
 * (WCAG 3.1.2), never a field-by-field mix of German and English.
 *
 *   E-E1  a /de learner on a created course not switched on for German
 *         reads English everywhere they read it: the dashboard's card,
 *         hero and the hero's step names (marked, with "Auf Englisch"),
 *         the player (the note, its title and lessons marked, the
 *         interface not) and the Comp Card's course title (the course as
 *         played); the partner admin switches German on in the course
 *         page's panel by keyboard, focus staying on the switch, and Manage
 *         courses says in a word that German is live; then German, unmarked
 *   E-E2  an editor's preview in German shows the German, and says German
 *         learners get English until it is switched on (in Greek, with the
 *         language's name in lower case mid-sentence)
 *   E-E3  the switch: a language not fully written asks first, and says
 *         what its coverage doesn't check; switching is logged; a
 *         facilitator and an editor calling it directly are refused, and a
 *         built-in course has no switch
 *   E-E8  a /de learner finishes two lessons in English; German is switched
 *         on; they resume at lesson 3 in German, finish, get the badge, and
 *         the Comp Card holds the course and the scenario choices as they
 *         played them; German switched off again changes no progress, and
 *         the completion screen is the course's English, marked; in a later
 *         visit the Comp Card has the course and the choices in English,
 *         marked (expected to fail until Stream B's files do so: see there)
 *
 * Each is red on Release 2's build: it has no switch, so a German learner
 * gets German wherever it is written and English elsewhere, and no editor
 * is told anything.
 *
 * Requires a real database — gated on E2E_DB=1. Everything the run makes
 * is unique to it and removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;
// In order, in one worker, each test on its own: a failure doesn't skip the
// rest (each sets the switches it starts from).
test.describe.configure({ mode: "default" });

const RUN = runId();
const COURSE = "src/app/actions/course.ts";

/* ----------------------------------------------------------- courses --- */

const LANG = {
  slug: `e2e-r3-lang-${RUN}`,
  title: { en: `Speaking up ${RUN}`, de: `Sich äußern ${RUN}`, el: `Μιλώντας ${RUN}` },
};
const langLessons: R2LessonSeed[] = [
  {
    id: ownLessonId(),
    label: { en: "First steps", de: "Erste Schritte" },
    narrative: narrative({
      en: { title: "The situation", text: "E2E: the English text." },
      de: { title: "Die Situation", text: "E2E: der deutsche Text." },
    }),
  },
  {
    id: ownLessonId(),
    label: { en: "Looking back", de: "Rückblick" },
    narrative: narrative({
      en: { title: "What changed", text: "E2E: more English text." },
      de: { title: "Was sich geändert hat", text: "E2E: mehr deutscher Text." },
    }),
  },
];

const WALK = {
  slug: `e2e-r3-walk-${RUN}`,
  title: { en: `Saying no ${RUN}`, de: `Nein sagen ${RUN}` },
};
const both = (en: string, de: string) => ({ en, de });
const walkLessons: R2LessonSeed[] = [
  {
    id: ownLessonId(),
    label: both("One", "Eins"),
    narrative: narrative({ en: { title: "Lesson one", text: "E2E one." }, de: { title: "Lektion eins", text: "E2E eins." } }),
  },
  {
    id: ownLessonId(),
    label: both("Two", "Zwei"),
    narrative: narrative({ en: { title: "Lesson two", text: "E2E two." }, de: { title: "Lektion zwei", text: "E2E zwei." } }),
  },
  {
    id: "scenario",
    label: both("The moment", "Der Moment"),
    structure: {
      kind: "scenario",
      title: both("The bigger moment", "Der große Moment"),
      setup: both("E2E: your lead cuts you off.", "E2E: Deine Leitung unterbricht dich."),
      question: both("What do you do?", "Was tust du?"),
      followupQuestion: both("And then?", "Und dann?"),
      choices: [
        {
          id: "c1",
          quality: "best",
          text: both("Ask to finish", "Bitte ausreden lassen"),
          outcome: both("You finish.", "Du sprichst zu Ende."),
          followups: [
            {
              id: "f1",
              quality: "best",
              text: both("Thank them", "Dich bedanken"),
              outcome: both("It lands well.", "Das kommt gut an."),
            },
          ],
        },
        {
          id: "c2",
          quality: "poor",
          text: both("Stay quiet", "Schweigen"),
          outcome: both("The point is lost.", "Der Punkt geht verloren."),
        },
      ],
    },
  },
  {
    id: ownLessonId(),
    label: both("Four", "Vier"),
    narrative: narrative({ en: { title: "Lesson four", text: "E2E four." }, de: { title: "Lektion vier", text: "E2E vier." } }),
  },
];

/* ------------------------------------------------------------ people --- */

const emails = {
  learner: `e2e-r3-lang-learner-${RUN}@example.com`,
  walker: `e2e-r3-lang-walker-${RUN}@example.com`,
  paa: `e2e-r3-lang-paa-${RUN}@example.com`,
  editor: `e2e-r3-lang-editor-${RUN}@example.com`,
  facilitator: `e2e-r3-lang-fa-${RUN}@example.com`,
  reader: `e2e-r3-lang-reader-${RUN}@example.com`,
};
let learner: Person;
let walker: Person;
let paa: Person;
let editor: Person;
let facilitator: Person;
let reader: Person;

/* -------------------------------------------------------- the screens --- */

/** The dashboard card of the course: the link around its title. */
const card = (page: Page, slug: string) =>
  page.getByRole("main").locator(`a[href$="/learner/course/${slug}"]`).filter({ has: page.locator("p.font-semibold") });
const heroTitle = (page: Page) => page.getByRole("main").locator("h2").first();
/** The player's course title (its one visible level-1 heading). */
const courseTitle = (page: Page) => page.getByRole("heading", { level: 1 });
const counter = (page: Page) => page.getByText(/^\d+ \/ \d+ · /).filter({ visible: true });
const continueButton = (page: Page, name: string) =>
  page.getByRole("main").getByRole("button", { name, exact: true }).filter({ visible: true });

/** Continue to step n (of the counter), retried against the hydration race, never past it. */
async function continueTo(page: Page, n: number, name: string) {
  await expect(async () => {
    const at = (await counter(page).textContent())?.trim() ?? "";
    if (at.startsWith(`${n - 1} /`)) await continueButton(page, name).click();
    await expect(counter(page)).toHaveText(new RegExp(`^${n} / `), { timeout: 5000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * The Comp Card, reached in the app as a learner does (the Dashboard link,
 * then the Comp Card's): it names the course the learner last played, as
 * they played it, which a page loaded afresh doesn't know.
 */
async function compCardFromPlayer(page: Page) {
  await page.getByRole("link", { name: de.coursePlayer.dashboard, exact: true }).first().click();
  await expect(page).toHaveURL(/\/de\/learner$/);
  await page.getByRole("main").locator('a[href="/de/learner/comp-card"]').first().click();
  await expect(page).toHaveURL(/\/de\/learner\/comp-card$/);
}

/** The language panel on the course's page, as the partner admin sees it. */
async function languagePanel(page: Page, slug: string): Promise<Locator> {
  await page.goto(`/en/content/courses/${slug}`);
  const panel = page.getByRole("region", { name: en.courseManager.languageReady.title }).filter({ visible: true });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  return panel;
}

/** A browser of its own, signed in as `who`. */
async function as(browser: Browser, who: Person): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await signIn(context, who.sessionToken);
  return { context, page: await context.newPage() };
}

describe("Release 3: German and Greek, switched on per course (D90)", () => {
  test.beforeAll(async () => {
    await removePeople(prisma, Object.values(emails));
    learner = await createPerson(prisma, { email: emails.learner, roles: ["LEARNER"] });
    walker = await createPerson(prisma, { email: emails.walker, roles: ["LEARNER"] });
    paa = await createPerson(prisma, { email: emails.paa, roles: ["PARTNER_ADMIN"], organisation: "A" });
    editor = await createPerson(prisma, { email: emails.editor, roles: ["CONTENT_EDITOR"], organisation: "A" });
    facilitator = await createPerson(prisma, { email: emails.facilitator, roles: ["FACILITATOR"], organisation: "A" });
    reader = await createPerson(prisma, { email: emails.reader, roles: ["LEARNER"] });
    const langId = await seedECourse(prisma, { ...LANG, lessons: langLessons });
    const walkId = await seedECourse(prisma, { ...WALK, lessons: walkLessons });
    // The reader made the scenario's choices in an earlier visit, German not switched on.
    await prisma.courseEnrollment.create({
      data: {
        userId: reader.userId,
        courseId: walkId,
        stagesCompleted: [],
        sectionsCompleted: [walkLessons[0].id, walkLessons[1].id],
        scenarioRoot: "c1",
        scenarioFollowup: "f1",
      },
      select: { id: true },
    });
    // The learner has started the course, so it is their dashboard's hero.
    await prisma.courseEnrollment.create({
      data: { userId: learner.userId, courseId: langId, stagesCompleted: [] },
      select: { id: true },
    });
  });

  test.afterAll(async () => {
    const ids = [learner, walker, paa, editor, facilitator, reader].filter(Boolean).map((p) => p.userId);
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: [LANG.slug, WALK.slug] } }] } });
    await removePeople(prisma, Object.values(emails));
    await removeECourse(prisma, LANG.slug);
    await removeECourse(prisma, WALK.slug);
    await prisma.$disconnect();
  });

  test("E-E1: a German learner reads a course not switched on in English, marked so, and in German once it is", async ({
    page,
    context,
    browser,
  }) => {
    await setReady(prisma, LANG.slug, []);
    await signIn(context, learner.sessionToken);

    // The dashboard: the card and the hero, in English, marked, with "Auf Englisch".
    await page.goto("/de/learner");
    const tile = card(page, LANG.slug);
    await expect(tile, "the card names the course in English").toContainText(LANG.title.en, { timeout: 15_000 });
    await expect(page.getByRole("main")).not.toContainText(LANG.title.de);
    await expect(tile.locator("p.font-semibold")).toHaveAttribute("lang", "en");
    await expect(tile.getByText(de.dashboard.inEnglish, { exact: true })).toBeVisible();
    await expect(heroTitle(page)).toHaveText(LANG.title.en);
    await expect(heroTitle(page)).toHaveAttribute("lang", "en");
    // The hero's step names, in "Deine Reise" beside it, are the course's text too.
    const step = page.getByRole("main").getByText("First steps", { exact: true }).last();
    await expect(step).toBeVisible();
    expect(await step.evaluate((s) => s.closest("[lang]")?.getAttribute("lang") ?? null), "the step name is marked").toBe(
      "en"
    );

    // The player: the note, the course text marked, the interface not.
    await page.goto(`/de/learner/course/${LANG.slug}`);
    const note = page.getByRole("note").filter({ hasText: de.coursePlayer.languageFallback });
    await expect(note).toBeVisible({ timeout: 15_000 });
    await expect(courseTitle(page)).toHaveText(LANG.title.en);
    await expect(courseTitle(page)).toHaveAttribute("lang", "en");
    const heading = page.getByRole("main").getByRole("heading", { name: "The situation" });
    await expect(heading).toHaveAttribute("lang", "en");
    await expect(page.getByText("E2E: the English text.").filter({ visible: true })).toBeVisible();
    await expect(page.getByText("E2E: der deutsche Text.")).toHaveCount(0);
    const go = continueButton(page, de.common.continue);
    await expect(go).toBeVisible();
    expect(await go.evaluate((b) => b.closest("[lang]")?.getAttribute("lang") ?? null), "the interface isn't marked").toBe(
      "de"
    );
    // The note comes before the lessons' step bar, so it is read first.
    const noteFirst = await note.evaluate((n) => {
      const nav = document.querySelector("nav");
      return !!nav && !!(n.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(noteFirst, "the note is above the step bar").toBe(true);

    // They finish the first lesson; the Comp Card names the course as they played it.
    await continueTo(page, 2, de.common.continue);
    await compCardFromPlayer(page);
    await expect(page.getByRole("main")).toContainText(LANG.title.en, { timeout: 15_000 });
    await expect(page.getByRole("main")).not.toContainText(LANG.title.de);

    // The partner admin switches German on in the course page's panel.
    const staff = await as(browser, paa);
    try {
      const panel = await languagePanel(staff.page, LANG.slug);
      const german = panel.getByRole("switch", { name: "German for learners" });
      await expect(german).toHaveAttribute("aria-checked", "false");
      await expect(panel).toContainText("Not live: learners using German get this course in English.");
      // By keyboard. Fully written: no question asked, and focus stays on
      // the switch while it saves, so its new state is read out.
      await german.focus();
      await staff.page.keyboard.press("Space");
      await expect(german).toHaveAttribute("aria-checked", "true");
      await expect(panel).toContainText("Live: learners using German get this course in German.");
      await expect(german).toBeFocused();
      await expect.poll(() => readyOf(prisma, LANG.slug)).toEqual(["de"]);

      // Manage courses says it in a word on the course's German chip, not by a mark alone.
      await staff.page.goto("/en/content/courses");
      // The card as shown: while the page streams in, React may hold the
      // server's copy of it hidden for a moment.
      const gridCard = staff.page.locator(`article[aria-labelledby="course-${LANG.slug}-title"]`).filter({ visible: true });
      await expect(gridCard).toBeVisible({ timeout: 15_000 });
      await expect(gridCard.getByText(en.courseManager.languageReady.liveMark, { exact: true })).toHaveCount(1);
      await expect(gridCard.getByText(en.courseManager.languageReady.liveMark, { exact: true })).toBeVisible();
    } finally {
      await staff.context.close();
    }

    // Now German, nothing marked, no note.
    await page.goto("/de/learner");
    await expect(card(page, LANG.slug)).toContainText(LANG.title.de, { timeout: 15_000 });
    await expect(card(page, LANG.slug).locator("p.font-semibold")).not.toHaveAttribute("lang", /.*/);
    await expect(card(page, LANG.slug).getByText(de.dashboard.inEnglish, { exact: true })).toHaveCount(0);
    await expect(heroTitle(page)).toHaveText(LANG.title.de);
    await page.goto(`/de/learner/course/${LANG.slug}`);
    await expect(courseTitle(page)).toHaveText(LANG.title.de, { timeout: 15_000 });
    await expect(courseTitle(page)).not.toHaveAttribute("lang", /.*/);
    await expect(
      page.getByRole("main").getByRole("heading", { name: /^(Die Situation|Was sich geändert hat)$/ })
    ).toBeVisible();
    await expect(page.getByRole("note").filter({ hasText: de.coursePlayer.languageFallback })).toHaveCount(0);
  });

  test("E-E2: an editor's preview shows the German, and says learners get English until it is switched on", async ({
    page,
    context,
  }) => {
    await setReady(prisma, LANG.slug, []);
    await signIn(context, editor.sessionToken);

    await page.goto(`/de/learner/course/${LANG.slug}?preview=1&ui=en`);
    await expect(courseTitle(page)).toHaveText(LANG.title.de, { timeout: 15_000 });
    await expect(page.getByRole("main").getByRole("heading", { name: "Die Situation" })).toBeVisible();
    const banner = page.getByRole("status").filter({ hasText: "Vorschau" });
    await expect(banner).toContainText("Lernende mit Deutsch bekommen Englisch, bis Deutsch freigeschaltet ist.");
    // The preview is the German, so no note says it is English.
    await expect(page.getByRole("note").filter({ hasText: de.coursePlayer.languageFallback })).toHaveCount(0);

    // In Greek the language's name is lower case mid-sentence.
    await page.goto(`/el/learner/course/${LANG.slug}?preview=1&ui=en`);
    await expect(courseTitle(page)).toHaveText(LANG.title.el, { timeout: 15_000 });
    await expect(page.getByRole("status").filter({ hasText: "Προεπισκόπηση" })).toContainText(
      "Οι εκπαιδευόμενοι που χρησιμοποιούν ελληνικά βλέπουν αγγλικά μέχρι να ενεργοποιηθούν τα ελληνικά."
    );

    // Switched on, the banner says nothing more.
    await setReady(prisma, LANG.slug, ["de"]);
    await page.goto(`/de/learner/course/${LANG.slug}?preview=1&ui=en`);
    await expect(courseTitle(page)).toHaveText(LANG.title.de, { timeout: 15_000 });
    await expect(page.getByText("freigeschaltet ist")).toHaveCount(0);
  });

  test("E-E3: switching a language is asked, logged and refused to anyone who may not", async ({ page, context, request }) => {
    await setReady(prisma, LANG.slug, []);
    // The course's switches logged before this test (E-E1 switches German
    // on moments earlier): only rows written after these count.
    const earlier = (
      await prisma.auditLog.findMany({
        where: { projectId: PROJECT, entityId: LANG.slug, action: { startsWith: "course.language_" } },
        select: { id: true },
      })
    ).map((row) => row.id);
    await signIn(context, paa.sessionToken);

    // Greek has no lessons written: switching it on asks first.
    const panel = await languagePanel(page, LANG.slug);
    const greek = panel.getByRole("switch", { name: "Greek for learners" });
    await greek.click();
    const ask = panel.getByRole("group", { name: "Switch Greek on for learners?" });
    await expect(ask).toBeVisible();
    await expect(ask).toContainText("Learners using Greek will see English wherever text is missing.");
    await expect(ask).toContainText(en.courseManager.languageReady.notChecked);
    await expect(page.locator(":focus")).toHaveText("Switch Greek on for learners?");
    await ask.getByRole("button", { name: "Cancel" }).click();
    await expect(ask).toHaveCount(0);
    await expect(greek).toBeFocused();
    await expect(greek).toHaveAttribute("aria-checked", "false");
    expect(await readyOf(prisma, LANG.slug)).toEqual([]);

    await greek.click();
    await panel.getByRole("button", { name: "Switch Greek on", exact: true }).click();
    await expect(greek).toHaveAttribute("aria-checked", "true");
    await expect(panel).toContainText("Greek is live, but some text is missing in it now");
    await expect.poll(() => readyOf(prisma, LANG.slug)).toEqual(["el"]);
    const logged = await prisma.auditLog.findMany({
      where: {
        projectId: PROJECT,
        entityId: LANG.slug,
        action: { startsWith: "course.language_" },
        id: { notIn: earlier },
      },
      select: { action: true, actorId: true, metadata: true },
    });
    expect(logged).toEqual([{ action: "course.language_ready", actorId: paa.userId, metadata: { locale: "el" } }]);

    // A facilitator and an editor calling it directly are refused; nothing changes or is logged.
    for (const who of [facilitator, editor]) {
      const answer = await callAction(request, {
        as: who,
        page: `/en/content/courses/${LANG.slug}`,
        file: COURSE,
        name: "setCourseLanguageReady",
        args: [LANG.slug, "de", true],
      });
      expect(answer.result, who.email).toEqual({ ok: false, error: "forbidden" });
    }
    expect(await readyOf(prisma, LANG.slug)).toEqual(["el"]);
    expect(
      await prisma.auditLog.count({ where: { entityId: LANG.slug, actorId: { in: [facilitator.userId, editor.userId] } } })
    ).toBe(0);

    // A built-in course is in every language: no switch.
    const builtIn = await callAction(request, {
      as: paa,
      page: `/en/content/courses/${LANG.slug}`,
      file: COURSE,
      name: "setCourseLanguageReady",
      args: ["workplace-conflict", "de", true],
    });
    expect(builtIn.result).toEqual({ ok: false, error: "built-in" });
  });

  test("E-E8: a German learner halfway through in English carries on in German once it is switched on, and keeps it all when it goes off", async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(120_000);
    await setReady(prisma, WALK.slug, []);
    await signIn(context, walker.sessionToken);
    const [one, two, , four] = walkLessons.map((l) => l.id);
    const enrolment = () =>
      prisma.courseEnrollment.findFirst({
        where: { userId: walker.userId, course: { projectId: PROJECT, slug: WALK.slug } },
        select: {
          stagesCompleted: true,
          sectionsCompleted: true,
          completedAt: true,
          scenarioRoot: true,
          scenarioFollowup: true,
        },
      });

    // Two lessons in English.
    await page.goto(`/de/learner/course/${WALK.slug}`);
    await expect(page.getByRole("note").filter({ hasText: de.coursePlayer.languageFallback })).toBeVisible({
      timeout: 15_000,
    });
    await expect(counter(page)).toHaveText("1 / 4 · One");
    await expect(page.getByRole("main").getByRole("heading", { name: "Lesson one" })).toHaveAttribute("lang", "en");
    await continueTo(page, 2, de.common.continue);
    await continueTo(page, 3, de.common.continue);
    await expect.poll(async () => (await enrolment())?.sectionsCompleted ?? [], { timeout: 15_000 }).toEqual(
      expect.arrayContaining([one, two])
    );

    // The partner admin switches German on.
    const on = await callAction(request, {
      as: paa,
      page: `/en/content/courses/${WALK.slug}`,
      file: COURSE,
      name: "setCourseLanguageReady",
      args: [WALK.slug, "de", true],
    });
    expect(on.result).toMatchObject({ ok: true });

    // They come back at lesson 3, in German.
    await page.goto(`/de/learner/course/${WALK.slug}`);
    await expect(counter(page)).toHaveText("3 / 4 · Der Moment", { timeout: 15_000 });
    await expect(courseTitle(page)).toHaveText(WALK.title.de);
    await expect(page.getByRole("note").filter({ hasText: de.coursePlayer.languageFallback })).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("heading", { name: "Der große Moment" })).toBeVisible();
    await page.getByRole("button", { name: "Bitte ausreden lassen" }).click();
    await page.getByRole("button", { name: "Dich bedanken" }).click();
    await expect(page.getByText("Das kommt gut an.").filter({ visible: true })).toBeVisible();
    await continueTo(page, 4, de.common.continue);
    await expect(page.getByRole("main").getByRole("heading", { name: "Lektion vier" })).toBeVisible();
    await expect(async () => {
      await continueButton(page, de.common.continue).click({ timeout: 2000 });
      await expect(page.getByText(de.coursePlayer.courseComplete).filter({ visible: true }).first()).toBeVisible({
        timeout: 3000,
      });
    }).toPass({ timeout: 20_000 });

    // Finished, with the badge.
    await expect.poll(async () => (await enrolment())?.completedAt ?? null, { timeout: 15_000 }).not.toBeNull();
    await expect
      .poll(() => prisma.userBadge.count({ where: { userId: walker.userId, badge: { slug: { startsWith: WALK.slug } } } }), {
        timeout: 15_000,
      })
      .toBe(1);
    const done = await enrolment();
    expect(done?.sectionsCompleted).toEqual(expect.arrayContaining([one, two, four]));
    expect({ root: done?.scenarioRoot, followup: done?.scenarioFollowup }).toEqual({ root: "c1", followup: "f1" });

    // The Comp Card: the course and the choices, in German as played.
    await page.getByRole("main").locator('a[href="/de/learner/comp-card"]').first().click();
    await expect(page).toHaveURL(/\/de\/learner\/comp-card$/);
    const main = page.getByRole("main");
    await expect(main).toContainText(WALK.title.de, { timeout: 15_000 });
    await expect(main).toContainText("Bitte ausreden lassen → Dich bedanken");

    // German switched off again: no progress changes.
    const off = await callAction(request, {
      as: paa,
      page: `/en/content/courses/${WALK.slug}`,
      file: COURSE,
      name: "setCourseLanguageReady",
      args: [WALK.slug, "de", false],
    });
    expect(off.result).toMatchObject({ ok: true });
    await page.goto("/de/learner");
    const tile = card(page, WALK.slug);
    await expect(tile).toContainText(WALK.title.en, { timeout: 15_000 });
    await expect(tile.getByText(de.dashboard.completed, { exact: true }).first()).toBeVisible();
    await page.goto(`/de/learner/course/${WALK.slug}`);
    await expect(courseTitle(page)).toHaveText(WALK.title.en, { timeout: 15_000 });
    // A finished course opens on its completion screen: the course's English, marked.
    const complete = page.getByRole("heading", { name: "Course complete", exact: true });
    await expect(complete).toBeVisible();
    await expect(complete).toHaveAttribute("lang", "en");
    expect(await enrolment()).toEqual(done);
    expect(
      await prisma.userBadge.count({ where: { userId: walker.userId, badge: { slug: { startsWith: WALK.slug } } } })
    ).toBe(1);
  });

  /*
   * E-E8, a later visit: the Comp Card names the course and the scenario
   * choices as the learner plays the course, English while German isn't
   * switched on, and marks them. In a new visit the choices come from the
   * server, by loadCourseProgress (src/app/actions/learner.ts), which reads
   * the course in the learner's content language (learnerContentLocale,
   * spec 9.3) and says which; the Comp Card
   * (src/components/comp-card/CompCard.tsx) marks the title and the
   * choices with it.
   */
  test("E-E8: in a later visit, the Comp Card has a course not switched on and its choices in English, marked", async ({
    page,
    context,
  }) => {
    await setReady(prisma, WALK.slug, []);
    await signIn(context, reader.sessionToken);
    await page.goto(`/de/learner/course/${WALK.slug}`);
    await expect(courseTitle(page)).toHaveText(WALK.title.en, { timeout: 15_000 });
    await expect(counter(page)).toHaveText("3 / 4 · The moment");
    await page.waitForLoadState("networkidle");

    await compCardFromPlayer(page);
    const main = page.getByRole("main");
    await expect(main).toContainText(WALK.title.en, { timeout: 15_000 });
    await expect(main).toContainText("Ask to finish → Thank them");
    await expect(main).not.toContainText("Bitte ausreden lassen");
    // The card and its print view each hold the title and the choices, marked.
    for (const text of [WALK.title.en, "Ask to finish → Thank them"]) {
      const shown = main.getByText(text, { exact: true });
      await expect(shown).toHaveCount(2);
      for (const element of await shown.all()) await expect(element, text).toHaveAttribute("lang", "en");
    }
  });
});

