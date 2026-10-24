import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, removePeople, runId, signIn, type Person } from "./fixtures/people";
import { PROJECT, ownLessonId, para } from "./fixtures/r2-course";
import { ae1Lessons } from "./fixtures/r2-ae1-course";
import { removeECourse, seedECourse } from "./fixtures/r3-e-course";
import { r4Tables, removeR4Course, seedR4Course, R4_LINKS } from "./fixtures/r4-course";
import { WORD_LINKS, WORD_LINKS_TEXT } from "./fixtures/paste/hand-written";
import de from "../src/messages/de.json";
import en from "../src/messages/en.json";

/**
 * Release 4 integration (spec 10.6): Part A and Part B together, on `r4`
 * once both are merged (the checkpoint merge of spec 1.3).
 *
 *   R4-I1  The partner story. A partner admin (PAA) writes a lesson's
 *          German text with a link named in the Link form (Ctrl+K) and links
 *          pasted from Word; adds two further-reading links, one for German
 *          learners only, and shows that one; and writes the course's
 *          references list in English, with a link. A German learner, on a
 *          course whose German is switched on, then finishes the course:
 *          every named link shows the site it opens in its box and says what
 *          it opens in the page's words, German (lesson text, further reading
 *          and the references list); links Word's paste couldn't keep are
 *          their words; the draft link reaches neither the page nor its data;
 *          the references open from the player's top bar (a new tab, "close
 *          this tab") and the completion screen (the same tab, "back to the
 *          course"), the English list marked English. Their progress,
 *          completion and badge equal those of a German learner who walked
 *          the course before any of it was added.
 *   R4-I2  (guard) Release 2's recorded walk and Release 3's deltas stay as
 *          they are, Release 4 adding no delta: the courses the walk takes
 *          hold no references list, no further reading and no email link,
 *          and the built-in course's player draws none of them. The walk
 *          itself is e2e/r2-learner-walk.spec.ts, run unchanged.
 *   R4-I3  Skew and rollback, on the build Release 4 rolls back to (run
 *          only there, named by E2E_R4_ROLLBACK_BUILD=1, as R4-F1 is), on a
 *          database holding Release 4's migration and rows (spec 2.5, 2.7
 *          step 3, 7.2): the learner's page draws a version-2 paragraph from
 *          its text, "label (address)" with the address a quick link, no
 *          further reading, and every published document in every
 *          language; the references page isn't there; the lesson editor
 *          opens the paragraph as plain text and a save keeps it as text;
 *          a lesson's deletion takes its further-reading links with it.
 *          The deputy repeats it on the rehearsal's Neon branch with the
 *          Release 3 build that will be rolled back to (spec 2.7).
 *
 * R4-I1 is red on Release 3's build, which has no Link form: it stops at
 * the partner admin's first link. R4-I2 is a guard: it holds on both.
 *
 * Requires a real database (E2E_DB=1). Everything the run makes is unique
 * to it and removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const ROLLBACK_BUILD = process.env.E2E_R4_ROLLBACK_BUILD === "1";
const prisma = DB
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  : (null as unknown as PrismaClient);
const describe = DB && !ROLLBACK_BUILD ? test.describe : test.describe.skip;
const describeRollback = DB && ROLLBACK_BUILD ? test.describe : test.describe.skip;

const RUN = runId();
const SLUG = `e2e-r4i-${RUN}`;
const BUILT_IN = "workplace-conflict";

/* ------------------------------------------------------------ helpers --- */

/** The visible match only: a streamed page can hold a hidden copy of what it shows for a moment. */
const visible = (l: Locator) => l.filter({ visible: true });
const main = (page: Page) => visible(page.getByRole("main"));
const counter = (page: Page) => visible(page.getByText(/^\d+ \/ \d+ · /));
/** The end of the text, by keyboard: ⌘↓ on a Mac, Ctrl+End elsewhere. */
const TEXT_END = process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End";

/** A browser of its own, signed in as `who`, whose pages never leave the machine for a linked site. */
async function as(browser: Browser, who: Person): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/^https?:\/\/(?:[a-z0-9-]+\.)*(?:example\.org|bpb\.de|doi\.org)\//, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Elsewhere</title><p>Another site</p>" })
  );
  await signIn(context, who.sessionToken);
  return { context, page: await context.newPage() };
}

/** The page as the server sends it to `who`: its HTML and the data the player gets (the RSC payload). */
async function served(request: APIRequestContext, who: Person, path: string) {
  const headers = { Cookie: `authjs.session-token=${who.sessionToken}` };
  const html = await request.get(path, { headers, maxRedirects: 0 });
  expect(html.status(), path).toBe(200);
  const rsc = await request.get(path, { headers: { ...headers, RSC: "1" }, maxRedirects: 0 });
  return `${await html.text()}\n${await rsc.text()}`;
}

/** Open a paragraph's editor from its preview, by keyboard (retried: a key before hydration does nothing). */
async function openParagraph(page: Page, block: Locator) {
  const textbox = block.getByRole("textbox", { name: /^paragraph text$/i });
  const preview = block.getByRole("button", { name: /^edit paragraph$/i });
  await expect(async () => {
    if (await preview.isVisible()) {
      await preview.focus();
      await page.keyboard.press("Enter");
    }
    await expect(textbox).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30_000 });
  await expect(textbox).toBeFocused();
  return textbox;
}

/** Select `count` characters ending `fromEnd` before the end of the text, by keyboard, at a person's pace. */
async function selectBeforeEnd(page: Page, fromEnd: number, count: number) {
  const press = async (key: string) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(40);
  };
  await press(TEXT_END);
  for (let i = 0; i < fromEnd; i++) await press("ArrowLeft");
  for (let i = 0; i < count; i++) await press("Shift+ArrowLeft");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().length ?? 0)).toBe(count);
}

/** "Add block", then a template (retried against the hydration race). */
async function addBlock(region: Locator, template: RegExp) {
  const picker = region.getByText("Choose what to add:").locator("..");
  await expect(async () => {
    if (!(await picker.isVisible())) await region.getByRole("button", { name: /^add block$/i }).click({ timeout: 2000 });
    await expect(picker).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await picker.getByRole("button", { name: template }).click();
}

/** Paste into an editor as the browser does, with this clipboard data. */
async function paste(target: Locator, data: Record<string, string>) {
  await target.evaluate((el, entries) => {
    const clipboardData = new DataTransfer();
    for (const [type, value] of Object.entries(entries)) clipboardData.setData(type, value);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, data);
}

/** Press a button once the page has taken over (retried until `then` shows). */
async function pressUntil(button: Locator, then: Locator) {
  await expect(async () => {
    if (!(await then.isVisible())) await button.click({ timeout: 2000 });
    await expect(then).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

/** Does `earlier` come before `later` in the page? */
async function follows(earlier: Locator, later: Locator): Promise<boolean> {
  const handle = await later.elementHandle();
  return earlier.evaluate((a, b) => !!b && !!(a.compareDocumentPosition(b as Node) & Node.DOCUMENT_POSITION_FOLLOWING), handle);
}

/* ------------------------------------------------------------ R4-I1 --- */

const ONE = ownLessonId();
const TWO = ownLessonId();
const LABELS = { one: { en: "First steps", de: "Erste Schritte" }, two: { en: "Next steps", de: "Nächste Schritte" } };
/** The German text the partner admin links a word of: "Anleitung", 9 characters before " heute." (7). */
const GERMAN_TEXT = "Lies die Anleitung heute.";
const ANLEITUNG = "https://example.org/anleitung";
/** The links Word's paste keeps (hand-written.ts, as R4-E4 reads them), each with what screen readers hear after it. */
const PASTED_KEPT: [words: string, href: string, opens: string][] = [
  ["the guide", "https://example.org/guide", de.lessonLinks.newTab],
  ["the old site", "http://example.org/old", de.lessonLinks.newTab],
  ["write to us", "mailto:help@example.org", de.lessonLinks.email],
  ["the safe one", "https://example.org/safe", de.lessonLinks.newTab],
  ["our tips", "https://example.org/tips", de.lessonLinks.newTab],
];
/** The links Word's paste doesn't keep: their words stay, as text. */
const PASTED_WORDS_ONLY = ["the handout", "the unsafe one", "the uploaded one"];
const READING = {
  german: { title: "Leitfaden zum Weiterlesen", url: "https://www.bpb.de/e2e-r4-integration", site: "bpb.de" },
  everyone: { title: "Further reading for everyone", url: "https://example.org/r4i-everyone" },
};
const REFERENCE = { words: "Read it online", href: "https://doi.org/10.1000/r4-integration", site: "doi.org" };

/** What a learner's walk leaves: the steps they saw, their row, and their badges. */
type Walked = { steps: string[]; sectionsCompleted: string[]; stagesCompleted: string[]; responses: unknown; completed: boolean; badges: string[] };

async function rowOf(who: Person): Promise<Omit<Walked, "steps">> {
  const row = await prisma.courseEnrollment.findFirstOrThrow({
    where: { userId: who.userId, course: { projectId: PROJECT, slug: SLUG } },
    select: { sectionsCompleted: true, stagesCompleted: true, responses: true, completedAt: true },
  });
  const badges = await prisma.userBadge.findMany({ where: { userId: who.userId }, select: { badge: { select: { slug: true } } } });
  return {
    sectionsCompleted: [...((row.sectionsCompleted as string[] | null) ?? [])].sort(),
    stagesCompleted: [...row.stagesCompleted].sort(),
    responses: row.responses,
    completed: row.completedAt !== null,
    badges: badges.map((b) => b.badge.slug).sort(),
  };
}

/** The completion screen is up: its way to the Comp Card is shown. */
const completionOn = (page: Page) => visible(page.getByRole("link", { name: de.coursePlayer.openCompCard }));
const continueButton = (page: Page) => visible(main(page).getByRole("button", { name: de.common.continue, exact: true }));

/** Continue from step `n - 1` to step `n` (or, with `n` past the last, to the completion screen), retried against the hydration race. */
async function continueTo(page: Page, n: number, of: number) {
  const arrived = n > of ? completionOn(page) : counter(page).filter({ hasText: new RegExp(`^${n} / ${of} · `) });
  await expect(async () => {
    if (!(await arrived.isVisible())) await continueButton(page).click({ timeout: 3000 });
    await expect(arrived).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30_000 });
}

/** Waits for the learner's completion to be saved, then reads what the walk left. */
async function walked(who: Person, steps: string[]): Promise<Walked> {
  await expect
    .poll(
      async () =>
        (
          await prisma.courseEnrollment.findFirst({
            where: { userId: who.userId, course: { projectId: PROJECT, slug: SLUG } },
            select: { completedAt: true },
          })
        )?.completedAt ?? null,
      { timeout: 15_000 }
    )
    .not.toBeNull();
  return { steps, ...(await rowOf(who)) };
}

describe("Release 4 integration: the partner story (R4-I1)", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  const emails = {
    paa: `e2e-r4i-paa-${RUN}@example.com`,
    before: `e2e-r4i-before-${RUN}@example.com`,
    learner: `e2e-r4i-learner-${RUN}@example.com`,
  };
  let paa: Person;
  let before: Person;
  let learner: Person;
  let baseline: Walked;

  test.beforeAll(async () => {
    await removePeople(prisma, Object.values(emails));
    paa = await createPerson(prisma, { email: emails.paa, roles: ["PARTNER_ADMIN"], organisation: "A" });
    before = await createPerson(prisma, { email: emails.before, roles: ["LEARNER"] });
    learner = await createPerson(prisma, { email: emails.learner, roles: ["LEARNER"] });
    // A course created in the CMS, published, German switched on for learners: two lessons of its own, in English and German.
    await seedECourse(prisma, {
      slug: SLUG,
      title: { en: `E2E R4 integration ${RUN}`, de: `E2E R4 Integration ${RUN}` },
      ready: ["de"],
      lessons: [
        {
          id: ONE,
          label: LABELS.one,
          narrative: {
            en: { title: "Links in the text", blocks: [para("Read the guide today.")] },
            de: { title: "Links im Text", blocks: [para(GERMAN_TEXT)] },
          },
        },
        {
          id: TWO,
          label: LABELS.two,
          narrative: {
            en: { title: "Without links", blocks: [para("E2E: plain text.")] },
            de: { title: "Ohne Links", blocks: [para("E2E: nur Text.")] },
          },
        },
      ],
    });
  });

  test.afterAll(async () => {
    const ids = [paa, before, learner].filter(Boolean).map((p) => p.userId);
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: SLUG }, { entityId: { startsWith: `${SLUG}:` } }] } });
    await removeECourse(prisma, SLUG);
    await removePeople(prisma, Object.values(emails));
  });

  test("R4-I1, before: a German learner walks the course as it was, with no links, further reading or references", async ({ browser }) => {
    const { context, page } = await as(browser, before);
    try {
      await page.goto(`/de/learner/course/${SLUG}`);
      await expect(counter(page)).toHaveText(`1 / 2 · ${LABELS.one.de}`, { timeout: 20_000 });
      const steps = [(await counter(page).textContent())!.trim()];
      await expect(main(page)).toContainText(GERMAN_TEXT);
      await expect(main(page).locator("a.seq-link")).toHaveCount(0);
      await expect(visible(page.getByRole("region", { name: de.furtherReading.title, exact: true }))).toHaveCount(0);
      await expect(page.getByRole("link", { name: new RegExp(`^${de.courseReferences.title}`) })).toHaveCount(0);
      await continueTo(page, 2, 2);
      steps.push((await counter(page).textContent())!.trim());
      await continueTo(page, 3, 2);
      baseline = await walked(before, steps);
      expect(baseline.completed).toBe(true);
      expect(baseline.badges, "the course's badge").toHaveLength(1);
    } finally {
      await context.close();
    }
  });

  test("R4-I1, the partner admin: German text with a named link and links pasted from Word, two further-reading links (one shown, for German learners), the English references with a link", async ({
    browser,
  }) => {
    const { context, page } = await as(browser, paa);
    try {
      // The lesson's German text, in the course page's editor (its menus English).
      await page.goto(`/en/content/courses/${SLUG}?lesson=${ONE}&lang=de`);
      const lesson = visible(page.locator(`#lesson-${ONE}`));
      const region = lesson.getByRole("region", { name: /lesson text/i });
      await expect(region).toBeVisible({ timeout: 20_000 });
      const blocks = region.getByRole("group", { name: /^block \d+ of \d+/i });
      const first = await openParagraph(page, blocks.nth(0));
      await expect(first).toHaveAttribute("lang", "de");

      // A word linked in the Link form, by keyboard: select it, Ctrl+K, the address, Enter.
      await selectBeforeEnd(page, 7, 9);
      await page.keyboard.press("ControlOrMeta+k");
      const form = blocks.nth(0).getByRole("group", { name: "Link", exact: true });
      await expect(form, "the Link form").toBeVisible();
      await expect(form.getByLabel("Address")).toBeFocused();
      await expect(form.getByLabel("Text to show")).toHaveValue("Anleitung");
      await page.keyboard.type(ANLEITUNG);
      await page.keyboard.press("Enter");
      await expect(form).toHaveCount(0);
      await expect(first.locator("a")).toHaveText("Anleitung");
      await expect(first.locator("a")).toHaveAttribute("href", ANLEITUNG);

      // A paragraph pasted from Word: web and email links kept, the rest their words, and the editor says so.
      await addBlock(region, /^paragraph$/i);
      const pasted = blocks.nth(1).getByRole("textbox", { name: /^paragraph text$/i });
      await expect(pasted).toBeFocused({ timeout: 15_000 });
      await paste(pasted, { "text/html": WORD_LINKS, "text/plain": WORD_LINKS_TEXT });
      await expect(pasted.locator("a")).toHaveText(PASTED_KEPT.map(([words]) => words));
      for (const [i, [, href]] of PASTED_KEPT.entries()) await expect(pasted.locator("a").nth(i)).toHaveAttribute("href", href);
      for (const words of PASTED_WORDS_ONLY) await expect(pasted).toContainText(words);
      const status = blocks.nth(1).getByRole("status").last();
      await expect(status).toContainText("2 links weren't kept: only web and email links can be used.");
      await expect(status).toContainText("1 link wasn't kept because its text shows a different address.");

      await region.getByRole("button", { name: /^save german$/i }).click();
      await expect(region.getByText(/^saved$/i)).toBeVisible({ timeout: 15_000 });
      // Stored as version 2, each link holding its address only; the English text as it was.
      const stored = (await prisma.lesson.findFirstOrThrow({
        where: { projectId: PROJECT, courseSlug: SLUG, stageKey: ONE },
        select: { narrative: true },
      })).narrative as Record<string, { blocks: { kind: string; text: string; rich?: { v: number; doc: unknown } }[] }>;
      expect(stored.de.blocks.map((b) => b.rich?.v)).toEqual([2, 2]);
      expect(stored.de.blocks[0].text).toBe(`Lies die Anleitung (${ANLEITUNG}) heute.`);
      const marks = JSON.stringify(stored.de.blocks).match(/"type":"link","attrs":\{[^}]*\}/g) ?? [];
      expect(marks.length).toBeGreaterThanOrEqual(1 + PASTED_KEPT.length);
      for (const mark of marks) expect(mark).toMatch(/^"type":"link","attrs":\{"href":"[^"]+"\}$/);
      expect(stored.en.blocks).toEqual([para("Read the guide today.")]);

      // Further reading, in the lesson's document card: a German-only link shown to learners, one for everyone left a draft.
      await expect(lesson.getByRole("heading", { name: "Documents and further reading" })).toBeVisible();
      const addForm = lesson.getByRole("group", { name: "Add a link", exact: true });
      await pressUntil(lesson.getByRole("button", { name: "Add a link", exact: true }), addForm);
      await addForm.getByLabel("Title").fill(READING.german.title);
      await addForm.getByLabel("Web address").fill(READING.german.url);
      await addForm.getByLabel("English").uncheck();
      await addForm.getByLabel("Greek").uncheck();
      await addForm.getByRole("button", { name: "Save", exact: true }).click();
      await expect(lesson.getByText("Added as a draft — learners can't see it until you choose “Show to learners”.")).toBeVisible();
      await lesson.getByRole("button", { name: `Show to learners: ${READING.german.title}` }).click();
      await expect(lesson.getByText(`“${READING.german.title}” is shown to learners.`)).toBeVisible();

      await pressUntil(lesson.getByRole("button", { name: "Add a link", exact: true }), addForm);
      await addForm.getByLabel("Title").fill(READING.everyone.title);
      await addForm.getByLabel("Web address").fill(READING.everyone.url);
      for (const language of ["English", "German", "Greek"]) await addForm.getByLabel(language).check();
      await addForm.getByRole("button", { name: "Save", exact: true }).click();
      const draftRow = lesson.getByRole("listitem").filter({ hasText: READING.everyone.title });
      await expect(draftRow).toContainText("Draft — hidden from learners");
      const links = await prisma.lessonLink.findMany({
        where: { lesson: { projectId: PROJECT, courseSlug: SLUG, stageKey: ONE } },
        select: { title: true, url: true, languages: true, published: true },
        orderBy: { order: "asc" },
      });
      expect(links).toEqual([
        { title: READING.german.title, url: READING.german.url, languages: ["de"], published: true },
        { title: READING.everyone.title, url: READING.everyone.url, languages: [], published: false },
      ]);

      // The course's references list, in English: a title in italics, and words linked in the Link form.
      await page.goto(`/en/content/courses/${SLUG}`);
      const references = page.getByRole("region", { name: en.courseReading.references.heading, exact: true });
      const box = references.getByRole("textbox", { name: en.courseReading.references.heading, exact: true });
      await expect(box).toBeVisible({ timeout: 20_000 });
      await expect(box).toHaveAttribute("lang", "en");
      const toolbar = references.getByRole("toolbar", { name: "References formatting" });
      await box.click();
      await page.keyboard.type("Author, A. A. (2024). ");
      await toolbar.getByRole("button", { name: /^italic$/i }).click();
      await page.keyboard.type("Title of the work");
      await toolbar.getByRole("button", { name: /^italic$/i }).click();
      await page.keyboard.type(`. Publisher. ${REFERENCE.words}`);
      for (let i = 0; i < REFERENCE.words.length; i++) {
        await page.keyboard.press("Shift+ArrowLeft");
        await page.waitForTimeout(40);
      }
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe(REFERENCE.words);
      await page.keyboard.press("ControlOrMeta+k");
      const referenceForm = references.getByRole("group", { name: "Link", exact: true });
      await expect(referenceForm).toBeVisible();
      await expect(referenceForm.getByLabel("Address")).toBeFocused();
      await page.keyboard.type(REFERENCE.href);
      await page.keyboard.press("Enter");
      await expect(referenceForm).toHaveCount(0);
      await expect(box.locator("a")).toHaveText(REFERENCE.words);
      await references.getByRole("button", { name: en.courseReading.references.save }).click();
      await expect(references.locator('span[role="status"]')).toHaveText(en.courseReading.references.saved, { timeout: 15_000 });
      const [bibliography] = await prisma.$queryRaw<{ content: { locales: Record<string, { rich: { v: number }; text: string }> } }[]>`
        SELECT b."content" FROM "CourseBibliography" b JOIN "Course" c ON c."id" = b."courseId"
         WHERE c."projectId" = ${PROJECT} AND c."slug" = ${SLUG}`;
      expect(Object.keys(bibliography.content.locales)).toEqual(["en"]);
      expect(bibliography.content.locales.en.rich.v).toBe(2);
      expect(bibliography.content.locales.en.text).toBe(`Author, A. A. (2024). Title of the work. Publisher. ${REFERENCE.words} (${REFERENCE.href})`);
    } finally {
      await context.close();
    }
  });

  test("R4-I1, the learner: German links with their sites, the German further reading, the references from the top bar and the completion screen; progress, completion and badge as without links", async ({
    browser,
    request,
  }) => {
    const { context, page } = await as(browser, learner);
    try {
      const path = `/de/learner/course/${SLUG}`;
      // The draft link reaches neither the page nor the data the player gets.
      const data = await served(request, learner, path);
      expect(data).toContain(READING.german.url);
      expect(data).not.toContain(READING.everyone.url);
      expect(data).not.toContain(READING.everyone.title);

      await page.goto(path);
      await expect(counter(page)).toHaveText(`1 / 2 · ${LABELS.one.de}`, { timeout: 20_000 });
      const steps = [(await counter(page).textContent())!.trim()];
      const lesson = main(page);

      // Every named link in the lesson text: in a new tab, the site it opens in its box, what it opens said in German.
      for (const [words, href, opens] of [["Anleitung", ANLEITUNG, de.lessonLinks.newTab], ...PASTED_KEPT] as const) {
        const link = lesson.getByRole("link", { name: `${words}, example.org ${opens}`, exact: true });
        await expect(link, words).toHaveCount(1);
        await expect(link).toHaveAttribute("href", href);
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", "noopener noreferrer");
        await expect(link.locator(".seq-link-site")).toHaveText("example.org");
        await expect(link.locator(".sr-only")).toHaveAttribute("lang", "de");
      }
      // What Word's paste didn't keep is words, never a link: no file, no safe link, no file of ours, no other site behind words.
      for (const words of PASTED_WORDS_ONLY) {
        await expect(lesson).toContainText(words);
        await expect(lesson.getByRole("link", { name: new RegExp(`^${words}`) })).toHaveCount(0);
      }
      const hrefs = await lesson.locator("a[href]").evaluateAll((anchors) => anchors.map((a) => a.getAttribute("href") ?? ""));
      for (const href of hrefs) {
        expect(href).toMatch(/^(?:https:\/\/|http:\/\/|mailto:|\/)/);
        expect(href).not.toMatch(/safelinks|blob\.vercel-storage|evil\.example/);
      }

      // Further reading: the German-only link, after the lesson's text and before Continue, with its site; the draft isn't there.
      const reading = visible(page.getByRole("region", { name: de.furtherReading.title, exact: true }));
      const german = reading.getByRole("link", { name: `${READING.german.title}, ${READING.german.site} ${de.lessonLinks.newTab}`, exact: true });
      await expect(german).toHaveAttribute("href", READING.german.url);
      await expect(german).toHaveAttribute("target", "_blank");
      await expect(german.locator(".seq-link-site")).toHaveText(READING.german.site);
      // The course text is German: a German item is read as the course is, unmarked.
      await expect(reading).not.toContainText(de.furtherReading.language.de);
      await expect(reading).not.toContainText(READING.everyone.title);
      expect(await follows(lesson.getByText("our tips").first(), reading), "after the lesson's text").toBe(true);
      expect(await follows(reading, continueButton(page)), "before Continue").toBe(true);

      // The top bar's way to the references: a new tab, which says to close it; the list in English, marked so.
      const top = visible(page.getByRole("link", { name: `${de.courseReferences.title} ${de.lessonLinks.newTab}`, exact: true }));
      await expect(top).toHaveAttribute("href", `/de/learner/course/${SLUG}/references?from=lesson`);
      const [tab] = await Promise.all([context.waitForEvent("page"), top.click()]);
      await tab.waitForLoadState();
      const list = visible(tab.locator(".seq-references"));
      await expect(list).toHaveAttribute("lang", "en", { timeout: 15_000 });
      await expect(visible(tab.getByText(de.courseReferences.shownIn.en))).toBeVisible();
      await expect(visible(tab.getByText(de.courseReferences.closeTab))).toBeVisible();
      await expect(list.locator("em")).toHaveText("Title of the work");
      const reference = list.getByRole("link", { name: `${REFERENCE.words}, ${REFERENCE.site} ${de.lessonLinks.newTab}`, exact: true });
      await expect(reference).toHaveAttribute("href", REFERENCE.href);
      await expect(reference.locator(".seq-link-site")).toHaveText(REFERENCE.site);
      await expect(reference.locator(".sr-only")).toHaveAttribute("lang", "de");
      await tab.close();
      // The lesson's tab is where the learner left it.
      await expect(counter(page)).toHaveText(`1 / 2 · ${LABELS.one.de}`);

      await continueTo(page, 2, 2);
      steps.push((await counter(page).textContent())!.trim());
      await expect(visible(page.getByRole("region", { name: de.furtherReading.title, exact: true }))).toHaveCount(0);
      await continueTo(page, 3, 2);

      // The completion screen's way to the references: the same tab, and back to the course.
      const done = visible(page.getByRole("link", { name: de.courseReferences.title, exact: true }));
      await expect(done).toHaveAttribute("href", `/de/learner/course/${SLUG}/references`);
      await done.click();
      await expect(page).toHaveURL(new RegExp(`/de/learner/course/${SLUG}/references$`));
      await expect(visible(page.locator(".seq-references"))).toContainText("Author, A. A. (2024).", { timeout: 15_000 });
      await visible(page.getByRole("link", { name: de.courseReferences.back })).click();
      await expect(page).toHaveURL(new RegExp(`/de/learner/course/${SLUG}$`));
      await expect(completionOn(page)).toBeVisible({ timeout: 15_000 });

      // The same course, the same walk: progress, completion and badge as the learner's who walked it without links.
      const story = await walked(learner, steps);
      expect(story).toEqual(baseline);
    } finally {
      await context.close();
    }
  });
});

/* ------------------------------------------------------------ R4-I2 --- */

describe("Release 4 integration: Release 2's recorded walk takes nothing Release 4 draws (R4-I2, guard)", () => {
  const emails = { learner: `e2e-r4i-walk-${RUN}@example.com` };
  let learner: Person;

  test.beforeAll(async () => {
    await removePeople(prisma, Object.values(emails));
    learner = await createPerson(prisma, { email: emails.learner, roles: ["LEARNER"] });
  });

  test.afterAll(async () => {
    await removePeople(prisma, Object.values(emails));
  });

  test("R4-I2 (guard): the walk's courses hold no references, no further reading and no email link, so Release 4 adds no delta", async ({
    browser,
  }) => {
    // The course the walk seeds (phase 3, the A-E1 course): no link of any kind, no email address.
    const seeded = JSON.stringify(ae1Lessons({ warmup: "s-warmup01", wrapup: "s-wrapup01", cueId: "cue-1" }));
    expect(seeded).not.toMatch(/"type":"link"/);
    expect(seeded).not.toMatch(/mailto:|@[a-z0-9-]+\.[a-z]/i);

    // The built-in course the walk takes, as the seed leaves it: nothing of Release 4's stored for it.
    const lessons = await prisma.lesson.findMany({ where: { projectId: PROJECT, courseSlug: BUILT_IN }, select: { id: true, narrative: true, parts: true } });
    expect(JSON.stringify(lessons.map((l) => [l.narrative, l.parts]))).not.toMatch(/mailto:|"type":"link"/);
    const tables = await r4Tables(prisma);
    if (tables.links) {
      expect(await prisma.lessonLink.count({ where: { lessonId: { in: lessons.map((l) => l.id) } } })).toBe(0);
    }
    if (tables.bibliography) {
      expect(await prisma.courseBibliography.count({ where: { course: { projectId: PROJECT, slug: BUILT_IN } } })).toBe(0);
    }

    // Its player, in English and German: no further reading, no way to references, no email link.
    const { context, page } = await as(browser, learner);
    try {
      for (const [locale, messages] of [
        ["en", en],
        ["de", de],
      ] as const) {
        await page.goto(`/${locale}/learner/course/${BUILT_IN}`);
        await expect(continueButtonIn(page, messages.common.continue)).toBeVisible({ timeout: 20_000 });
        await expect(visible(page.getByRole("region", { name: messages.furtherReading.title, exact: true }))).toHaveCount(0);
        await expect(page.getByRole("link", { name: new RegExp(`^${messages.courseReferences.title}`) })).toHaveCount(0);
        await expect(main(page).locator('a[href^="mailto:"]')).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  });
});

const continueButtonIn = (page: Page, name: string) => visible(main(page).getByRole("button", { name, exact: true })).first();

/* ------------------------------------------------------------ R4-I3 --- */

describeRollback("Release 4 integration: the build Release 4 rolls back to, on Release 4's database (R4-I3)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  const SKEW = `e2e-r4i-skew-${RUN}`;
  const emails = { editor: `e2e-r4i-skew-editor-${RUN}@example.com`, learner: `e2e-r4i-skew-learner-${RUN}@example.com` };
  let editor: Person;
  let learner: Person;
  let course: Awaited<ReturnType<typeof seedR4Course>>;

  test.beforeAll(async () => {
    await removePeople(prisma, Object.values(emails));
    editor = await createPerson(prisma, { email: emails.editor, roles: ["CONTENT_EDITOR"] });
    learner = await createPerson(prisma, { email: emails.learner, roles: ["LEARNER"] });
    // Release 4's rows, as Release 4 leaves them: a version-2 paragraph, further reading (shown, draft, German and English only),
    // documents for every language and for one, and the references list.
    course = await seedR4Course(prisma, { slug: SKEW });
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [editor, learner].filter(Boolean).map((p) => p.userId) } } });
    await removeR4Course(prisma, SKEW);
    await removePeople(prisma, Object.values(emails));
  });

  test("R4-I3: the database holds Release 4's migration and rows", async () => {
    expect(course.tables).toEqual({ documentLanguages: true, links: true, bibliography: true });
    expect(course.links).not.toBeNull();
    expect(course.references).toBe(true);
  });

  test("R4-I3: learners get the paragraph's text with its address a quick link, no further reading, every document in every language, and no references page", async ({
    browser,
  }) => {
    const { context, page } = await as(browser, learner);
    try {
      for (const [locale, messages] of [
        ["en", en],
        ["de", de],
      ] as const) {
        await page.goto(`/${locale}/learner/course/${SKEW}`);
        const lesson = main(page);
        const paragraph = lesson.getByRole("paragraph").filter({ hasText: "before the next lesson." });
        await expect(paragraph).toBeVisible({ timeout: 20_000 });
        // As learners see it (what only screen readers hear left out): the label, then its address.
        const shown = await paragraph.evaluate((p) => {
          const copy = p.cloneNode(true) as HTMLElement;
          copy.querySelectorAll(".sr-only").forEach((e) => e.remove());
          return copy.textContent;
        });
        expect(shown, locale).toBe(`Read the guide (${R4_LINKS.guide}) before the next lesson.`);
        // The address is a quick link, opening in a new tab; the words "the guide" link nowhere.
        const quick = paragraph.getByRole("link", { name: `${R4_LINKS.guide} ${messages.lessonLinks.newTab}`, exact: true });
        await expect(quick).toHaveAttribute("href", R4_LINKS.guide);
        await expect(quick).toHaveAttribute("target", "_blank");
        await expect(lesson.getByRole("link", { name: /^the guide/ })).toHaveCount(0);
        for (const k of ["shown", "hidden", "de", "en"] as const) await expect(lesson, locale).not.toContainText(course.links![k].title);
        for (const k of ["all", "de", "en"] as const) await expect(lesson, locale).toContainText(course.documents[k].name);
      }
      await page.goto(`/en/learner/course/${SKEW}/references`);
      await expect(visible(page.getByRole("heading", { level: 1, name: en.system.notFoundTitle }))).toBeVisible({ timeout: 15_000 });
    } finally {
      await context.close();
    }
  });

  test("R4-I3: an editor opens the paragraph as plain text, a save keeps it as text, and deleting a lesson takes its further reading with it", async ({
    browser,
  }) => {
    const { context, page } = await as(browser, editor);
    try {
      await page.goto(`/en/content/courses/${SKEW}?lesson=${course.lessons.one}`);
      const region = visible(page.locator(`#lesson-${course.lessons.one}`)).getByRole("region", { name: /lesson text/i });
      await expect(region).toBeVisible({ timeout: 20_000 });
      const blocks = region.getByRole("group", { name: /^block \d+ of \d+/i });
      await expect(blocks.nth(0)).toContainText(`Read the guide (${R4_LINKS.guide}) before the next lesson.`);
      // Another block added and saved: the version-2 paragraph is saved as its text.
      await addBlock(region, /^paragraph$/i);
      const added = blocks.nth(1).getByRole("textbox", { name: /^paragraph text$/i });
      await expect(added).toBeFocused({ timeout: 15_000 });
      await page.keyboard.type("Added on the rollback build.");
      await region.getByRole("button", { name: /^save english$/i }).click();
      await expect(region.getByText(/^saved$/i)).toBeVisible({ timeout: 15_000 });
      const row = await prisma.lesson.findFirstOrThrow({
        where: { projectId: PROJECT, courseSlug: SKEW, stageKey: course.lessons.one },
        select: { id: true, narrative: true },
      });
      const saved = (row.narrative as { en: { blocks: { kind: string; text: string; rich?: { v: number } }[] } }).en.blocks;
      // Its text as it was, the address in it; no link mark, and no version 2.
      expect(saved[0].kind).toBe("paragraph");
      expect(saved[0].text).toBe(`Read the guide (${R4_LINKS.guide}) before the next lesson.`);
      expect(JSON.stringify(saved[0])).not.toContain('"type":"link"');
      if (saved[0].rich) expect(saved[0].rich.v).toBe(1);
      expect(saved[1]).toMatchObject({ kind: "paragraph", text: "Added on the rollback build." });

      // The lesson deleted from the lesson list, on a draft course nobody has started (so nothing asks to hide it
      // instead), named in the list as in its text: its further-reading links go with it.
      const stored = await prisma.course.findFirstOrThrow({ where: { projectId: PROJECT, slug: SKEW }, select: { outline: true } });
      const outline = stored.outline as { sections: { id: string; label?: unknown }[] };
      outline.sections = outline.sections.map((s) => (s.id === course.lessons.one ? { ...s, label: { en: "Lesson with links" } } : s));
      await prisma.course.updateMany({ where: { projectId: PROJECT, slug: SKEW }, data: { status: "draft", outline: outline as object } });
      await prisma.courseEnrollment.deleteMany({ where: { course: { projectId: PROJECT, slug: SKEW } } });
      expect(await prisma.lessonLink.count({ where: { lessonId: row.id } })).toBe(4);
      await page.goto(`/en/content/courses/${SKEW}`);
      const list = visible(page.getByRole("navigation", { name: /^lessons$/i }));
      await expect(list.getByRole("link").first()).toBeVisible({ timeout: 15_000 });
      const toggle = list.getByRole("button", { name: /^Actions for (\d+\. )?Lesson with links$/ });
      await expect(async () => {
        if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 2000 });
      }).toPass({ timeout: 15_000 });
      await list.getByRole("group", { name: /^Actions for (\d+\. )?Lesson with links$/ }).getByRole("button", { name: /^delete$/i }).click();
      await list.getByRole("group", { name: /^Delete “Lesson with links”/ }).getByRole("button", { name: /^delete lesson$/i }).click();
      await expect.poll(() => prisma.lesson.count({ where: { id: row.id } }), { timeout: 15_000 }).toBe(0);
      expect(await prisma.lessonLink.count({ where: { lessonId: row.id } })).toBe(0);
    } finally {
      await context.close();
    }
  });
});
