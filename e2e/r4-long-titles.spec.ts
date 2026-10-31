import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, removePeople, runId, signIn, type Person } from "./fixtures/people";
import { PROJECT, narrative, ownLessonId } from "./fixtures/r2-course";
import { removeECourse, seedECourse } from "./fixtures/r3-e-course";
import { r4Tables } from "./fixtures/r4-course";
import en from "../src/messages/en.json";

/**
 * After go-live (31 October 2026): a title that is one long word, as a
 * partner pastes a file's name for one (the owner's screenshot), and a
 * document whose file name has no space, on every screen that lists them.
 *
 *   LT-E1  the course page's further-reading row: an editor adds a link
 *          whose title is one 95-character word; at 1280 px and at 320 px,
 *          as a draft and shown, its title's text overlaps none of the
 *          row's badges and buttons and stays inside the row, and the page
 *          doesn't scroll sideways; nor does the status line, the edit form
 *          or the remove question that name it; axe clean
 *   LT-E2  the course page's document row with such a file name: the same,
 *          the full name still the link's name; and the status line
 *   LT-E3  the learner's further reading and documents: the same
 *   LT-E4  the references page and the references editor: an entry that is
 *          the long word, and a link whose words are, stay inside the list
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
// In order, in one worker.
test.describe.configure({ mode: "default", timeout: 90_000 });

const RUN = runId();
/** The title of the owner's screenshot: 95 characters, no space. */
const LONG = "Social_Entrepreneurship_The_Contribution_of_Individual_Entrepreneurs_to_Sustainable_Development";
const DOCUMENT = `${LONG}.pdf`;
const WIDTHS = [1280, 320] as const;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const HEADING = en.courseReading.references.heading;

const SLUG = `e2e-r4-long-${RUN}`;
/** Lesson one: the seeded document and a shown link; lesson two: empty, for the editor to add to. */
const LESSONS = {
  seeded: { id: ownLessonId(), label: { en: "Seeded" } },
  added: { id: ownLessonId(), label: { en: "Added" } },
};
const people = {
  editor: `e2e-r4-long-editor-${RUN}@example.com`,
  learner: `e2e-r4-long-learner-${RUN}@example.com`,
};
let editor: Person;
let learner: Person;

/** The references list: an entry that is the long word, and one whose link's words are. */
function referencesContent() {
  const href = `https://example.org/${RUN}/long`;
  return {
    v: 1,
    locales: {
      en: {
        text: `${LONG}\n${LONG} (${href})`,
        rich: {
          v: 2,
          doc: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: LONG }] },
              { type: "paragraph", content: [{ type: "text", text: LONG, marks: [{ type: "link", attrs: { href } }] }] },
            ],
          },
        },
      },
    },
  };
}

/* ------------------------------------------------------------ helpers --- */

async function as(browser: Browser, who: Person): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await signIn(context, who.sessionToken);
  return { context, page: await context.newPage() };
}

/** The lesson's section on the course page, opened. */
async function openLesson(page: Page, key: string) {
  await page.goto(`/en/content/courses/${SLUG}?lesson=${key}`);
  const lesson = page.locator(`#lesson-${key}`).filter({ visible: true });
  await expect(lesson.getByRole("heading", { name: "Documents and further reading" })).toBeVisible({ timeout: 20_000 });
  await expect(lesson.getByRole("heading", { name: "Further reading", level: 4 })).toBeVisible({ timeout: 20_000 });
  return lesson;
}

/**
 * Where `title`'s text is drawn inside `scope`: each line's rectangle (a
 * Range over each of its text nodes, screen-reader-only text left out),
 * cut to what the ancestors that clip (overflow other than visible) let
 * show, as a truncated name is. Answers how many lines are drawn, which of
 * the scope's controls (`controls`, a selector; the title itself and what
 * holds it never count) any of them overlaps, and how many reach outside
 * the scope's box.
 */
async function drawn(scope: Locator, title: Locator, controls = "") {
  const handle = await title.elementHandle({ timeout: 15_000 });
  return scope.evaluate(
    (scopeEl, [titleEl, selector]) => {
      const t = titleEl as Element;
      type Box = { left: number; right: number; top: number; bottom: number };
      const box = (r: DOMRect): Box => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      const clips: Box[] = [];
      for (let e: Element | null = t; e && e !== scopeEl.parentElement; e = e.parentElement) {
        if (getComputedStyle(e).overflowX !== "visible") clips.push(box(e.getBoundingClientRect()));
      }
      const lines: Box[] = [];
      const walker = document.createTreeWalker(t, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement?.closest(".sr-only")) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) {
          let b = box(r);
          for (const c of clips) {
            b = { left: Math.max(b.left, c.left), right: Math.min(b.right, c.right), top: Math.max(b.top, c.top), bottom: Math.min(b.bottom, c.bottom) };
          }
          if (b.right - b.left > 0.5 && b.bottom - b.top > 0.5) lines.push(b);
        }
      }
      const others = selector
        ? [...scopeEl.querySelectorAll(selector as string)]
            .filter((c) => !c.contains(t) && !t.contains(c) && !c.closest(".sr-only"))
            .map((c) => ({ name: c.getAttribute("aria-label") || (c.textContent ?? "").trim(), ...box(c.getBoundingClientRect()) }))
            .filter((c) => c.right > c.left && c.bottom > c.top)
        : [];
      const overlaps = new Set<string>();
      for (const l of lines) {
        for (const c of others) {
          if (l.left < c.right - 0.5 && c.left < l.right - 0.5 && l.top < c.bottom - 0.5 && c.top < l.bottom - 0.5) overlaps.add(c.name);
        }
      }
      const s = box(scopeEl.getBoundingClientRect());
      const outside = lines.filter((l) => l.left < s.left - 0.5 || l.right > s.right + 0.5).length;
      return { lines: lines.length, controls: others.length, overlaps: [...overlaps], outside };
    },
    [handle, controls] as const,
    { timeout: 15_000 }
  );
}

/**
 * `title`'s text is drawn, inside `scope`, over none of `controls`. Soft,
 * as is the sideways check: a test goes on to its other widths and states,
 * and reports each place that breaks.
 */
async function expectClear(scope: Locator, title: Locator, controls: string, where: string) {
  const d = await drawn(scope, title, controls);
  expect(d.lines, `${where}: the title is drawn`).toBeGreaterThan(0);
  if (controls) expect(d.controls, `${where}: the row has its controls`).toBeGreaterThan(0);
  expect.soft(d.overlaps, `${where}: the title overlaps no control`).toEqual([]);
  expect.soft(d.outside, `${where}: the title stays inside its row`).toBe(0);
}

async function expectNoSidewaysScroll(page: Page, where: string) {
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect.soft(sideways, `${where}: no sideways scroll`).toBeLessThanOrEqual(0);
}

/** axe's WCAG 2.2 AA rules: none broken in `scope`, and nothing serious or critical anywhere on the page. */
async function expectAxeClean(page: Page, scope: string, where: string) {
  const inScope = await new AxeBuilder({ page }).include(scope).withTags(TAGS).analyze();
  expect(inScope.violations.map((v) => [v.id, v.nodes.map((n) => n.target)]), `${where}: ${scope}`).toEqual([]);
  const all = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = all.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => [v.id, v.nodes.map((n) => n.target)]), `${where}: the whole page`).toEqual([]);
}

/** A course page row's controls: its arrows and buttons, badges, number and size. */
const ROW_CONTROLS = "button, span.rounded-full, span.tabular-nums";

describe("After go-live: a long title without a space stays in its place", () => {
  test.beforeAll(async () => {
    await removePeople(prisma, Object.values(people));
    editor = await createPerson(prisma, { email: people.editor, roles: ["CONTENT_EDITOR"], organisation: "A" });
    learner = await createPerson(prisma, { email: people.learner, roles: ["LEARNER"] });
    const courseId = await seedECourse(prisma, {
      slug: SLUG,
      title: { en: `E2E R4 long titles ${RUN}` },
      lessons: [
        {
          ...LESSONS.seeded,
          narrative: narrative({ en: { title: "The seeded lesson", text: "E2E: a lesson with a long-named document and link." } }),
          documents: [{ name: DOCUMENT, url: `https://e2e-store.public.blob.vercel-storage.com/${RUN}-long.pdf` }],
        },
        { ...LESSONS.added, narrative: narrative({ en: { title: "The added lesson", text: "E2E: an editor adds a link here." } }) },
      ],
    });
    const tables = await r4Tables(prisma);
    if (tables.links) {
      const lesson = await prisma.lesson.findFirstOrThrow({
        where: { projectId: PROJECT, courseSlug: SLUG, stageKey: LESSONS.seeded.id },
        select: { id: true },
      });
      await prisma.$executeRaw`
        INSERT INTO "LessonLink" ("id", "lessonId", "title", "url", "languages", "published", "updatedAt")
        VALUES (${`e2e-r4-long-${RUN}`}, ${lesson.id}, ${LONG}, ${`https://example.org/${RUN}/seeded`}, ARRAY[]::text[], true, now())`;
    }
    if (tables.bibliography) {
      await prisma.$executeRaw`
        INSERT INTO "CourseBibliography" ("courseId", "content", "updatedAt")
        VALUES (${courseId}, ${JSON.stringify(referencesContent())}::jsonb, now())`;
    }
  });

  test.afterAll(async () => {
    const ids = [editor, learner].filter(Boolean).map((p) => p.userId);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await removeECourse(prisma, SLUG);
    await removePeople(prisma, Object.values(people));
  });

  test("LT-E1: a further-reading link titled with one long word, added on the course page, overlaps none of its row's controls at 1280 px and 320 px, as a draft and shown; nothing that names it scrolls the page sideways; axe clean", async ({
    browser,
  }) => {
    const { context, page } = await as(browser, editor);
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      const lesson = await openLesson(page, LESSONS.added.id);
      const form = lesson.getByRole("group", { name: "Add a link", exact: true });
      await expect(async () => {
        if (!(await form.isVisible())) await lesson.getByRole("button", { name: "Add a link", exact: true }).click();
        await expect(form).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 20_000 });
      await form.getByLabel("Title").fill(LONG);
      await form.getByLabel("Web address").fill(`https://example.org/${RUN}/added`);
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await expect(lesson.getByText("Added as a draft — learners can't see it until you choose “Show to learners”.")).toBeVisible();

      const link = lesson.getByRole("link", { name: `${LONG} (opens in a new tab)`, exact: true });
      const row = lesson.getByRole("listitem").filter({ has: page.getByRole("link", { name: `${LONG} (opens in a new tab)`, exact: true }) });
      await expect(row).toContainText("Draft — hidden from learners");
      await expectClear(row, link, ROW_CONTROLS, "a draft at 1280 px");
      await expectNoSidewaysScroll(page, "a draft at 1280 px");

      await lesson.getByRole("button", { name: `Show to learners: ${LONG}` }).click();
      const shown = lesson.getByText(`“${LONG}” is shown to learners.`);
      await expect(shown).toBeVisible();
      await expect(row).toContainText("Published");
      await expectClear(row, link, ROW_CONTROLS, "shown at 1280 px");
      await expectClear(lesson, shown, "", "the status line at 1280 px");
      await expectNoSidewaysScroll(page, "shown at 1280 px");
      await expectAxeClean(page, `#lesson-${LESSONS.added.id}`, "the card at 1280 px");

      await page.setViewportSize({ width: 320, height: 800 });
      const narrow = await openLesson(page, LESSONS.added.id);
      const narrowLink = narrow.getByRole("link", { name: `${LONG} (opens in a new tab)`, exact: true });
      const narrowRow = narrow.getByRole("listitem").filter({ has: page.getByRole("link", { name: `${LONG} (opens in a new tab)`, exact: true }) });
      await expect(narrowRow).toContainText("Published");
      await expectClear(narrowRow, narrowLink, ROW_CONTROLS, "shown at 320 px");
      await expectNoSidewaysScroll(page, "shown at 320 px");

      await narrow.getByRole("button", { name: `Hide from learners: ${LONG}` }).click();
      const hidden = narrow.getByText(`“${LONG}” is hidden from learners.`);
      await expect(hidden).toBeVisible();
      await expect(narrowRow).toContainText("Draft — hidden from learners");
      await expectClear(narrowRow, narrowLink, ROW_CONTROLS, "a draft at 320 px");
      await expectClear(narrow, hidden, "", "the status line at 320 px");
      await expectNoSidewaysScroll(page, "a draft at 320 px");
      await expectAxeClean(page, `#lesson-${LESSONS.added.id}`, "the card at 320 px");

      // The edit form and the remove question name it too.
      await narrow.getByRole("button", { name: `Edit: ${LONG}` }).click();
      const edit = narrow.getByRole("group", { name: `Edit “${LONG}”`, exact: true });
      await expect(edit).toBeVisible();
      await expectNoSidewaysScroll(page, "the edit form at 320 px");
      await edit.getByRole("button", { name: "Cancel", exact: true }).click();
      await narrow.getByRole("button", { name: `Remove: ${LONG}` }).click();
      const question = narrow.getByRole("heading", { name: `Remove “${LONG}” from this lesson?` });
      await expect(question).toBeVisible();
      await expectClear(narrow.getByRole("group", { name: `Remove “${LONG}” from this lesson?` }), question, "", "the remove question at 320 px");
      await expectNoSidewaysScroll(page, "the remove question at 320 px");
      await expectAxeClean(page, `#lesson-${LESSONS.added.id}`, "the remove question at 320 px");
      await narrow.getByRole("button", { name: "Keep it", exact: true }).click();
      await expect(narrowLink).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("LT-E2: a document whose file name has no space stays inside its row on the course page, over none of its controls, its full name the link's name, at 1280 px and 320 px, shown and hidden; the status line that names it too", async ({
    browser,
  }) => {
    const { context, page } = await as(browser, editor);
    try {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        const lesson = await openLesson(page, LESSONS.seeded.id);
        const link = lesson.getByRole("link", { name: DOCUMENT, exact: true });
        const row = lesson.getByRole("listitem").filter({ has: page.getByRole("link", { name: DOCUMENT, exact: true }) });
        await expect(row).toContainText("Published");
        await expectClear(row, link, ROW_CONTROLS, `the document at ${width} px`);
        // The seeded further-reading link beside it, shown.
        const reading = lesson.getByRole("link", { name: `${LONG} (opens in a new tab)`, exact: true });
        const readingRow = lesson.getByRole("listitem").filter({ has: page.getByRole("link", { name: `${LONG} (opens in a new tab)`, exact: true }) });
        await expectClear(readingRow, reading, ROW_CONTROLS, `the seeded link at ${width} px`);
        await expectNoSidewaysScroll(page, `the document at ${width} px`);

        await lesson.getByRole("button", { name: `Hide from learners: ${DOCUMENT}` }).click();
        await expect(row).toContainText("Draft — hidden from learners");
        await expectClear(row, link, ROW_CONTROLS, `the hidden document at ${width} px`);
        await expectNoSidewaysScroll(page, `the hidden document at ${width} px`);
        await lesson.getByRole("button", { name: `Show to learners: ${DOCUMENT}` }).click();
        await expect(row).toContainText("Published");

        // Its languages saved as they were: the status line names it.
        await lesson.getByRole("button", { name: `Languages: ${DOCUMENT}` }).click();
        const languages = lesson.getByRole("group", { name: `Languages of “${DOCUMENT}”`, exact: true });
        await languages.getByRole("button", { name: "Save", exact: true }).click();
        const notice = lesson.getByText(`“${DOCUMENT}” is for every language.`);
        await expect(notice).toBeVisible();
        await expectClear(lesson, notice, "", `the document's status line at ${width} px`);
        await expectNoSidewaysScroll(page, `the document's status line at ${width} px`);
        await expectAxeClean(page, `#lesson-${LESSONS.seeded.id}`, `the card at ${width} px`);
      }
    } finally {
      await context.close();
    }
  });

  test("LT-E3: the learner's further reading and documents keep the long title and file name inside their rows, at 1280 px and 320 px; axe clean", async ({
    browser,
  }) => {
    const { context, page } = await as(browser, learner);
    try {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/en/learner/course/${SLUG}`);
        const list = page.getByRole("region", { name: en.furtherReading.title, exact: true }).filter({ visible: true });
        const link = list.getByRole("link", { name: `${LONG}, example.org (opens in a new tab)`, exact: true });
        await expect(link).toBeVisible({ timeout: 15_000 });
        const item = list.getByRole("listitem").filter({ has: page.getByRole("link", { name: `${LONG}, example.org (opens in a new tab)`, exact: true }) });
        await expectClear(item, link.locator("span.font-medium"), ".seq-link-site, span.rounded", `further reading at ${width} px`);
        await expectClear(list, link, "", `further reading's box at ${width} px`);

        const docs = page.getByRole("region", { name: en.lesson.resourcesTitle, exact: true }).filter({ visible: true });
        const name = docs.getByRole("button", { name: DOCUMENT, exact: true });
        await expect(name).toBeVisible();
        const row = docs.getByRole("listitem").filter({ has: page.getByRole("button", { name: DOCUMENT, exact: true }) });
        await expectClear(row, name, "a, span.rounded, span.tabular-nums", `the document at ${width} px`);
        await expect(docs.getByRole("link", { name: `${en.lesson.download} ${DOCUMENT}`, exact: true })).toBeVisible();

        await expectNoSidewaysScroll(page, `the learner's lesson at ${width} px`);
        await expectAxeClean(page, "main", `the learner's lesson at ${width} px`);
      }
    } finally {
      await context.close();
    }
  });

  test("LT-E4: the references page and the references editor keep an entry that is one long word, and a link whose words are, inside the list, at 1280 px and 320 px; axe clean", async ({
    browser,
  }) => {
    const reader = await as(browser, learner);
    const staff = await as(browser, editor);
    try {
      for (const width of WIDTHS) {
        await reader.page.setViewportSize({ width, height: 800 });
        await reader.page.goto(`/en/learner/course/${SLUG}/references`);
        const list = reader.page.locator(".seq-references").filter({ visible: true });
        await expect(list.getByText(LONG, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
        const entries = list.locator(":scope > p");
        await expect(entries).toHaveCount(2);
        for (const entry of await entries.all()) await expectClear(list, entry, "", `a reference at ${width} px`);
        await expectClear(entries.nth(1), entries.nth(1).locator(".seq-link-site"), "", `the reference's site box at ${width} px`);
        await expectNoSidewaysScroll(reader.page, `the references page at ${width} px`);
        await expectAxeClean(reader.page, "main", `the references page at ${width} px`);

        await staff.page.setViewportSize({ width, height: 800 });
        await staff.page.goto(`/en/content/courses/${SLUG}`);
        const region = staff.page.getByRole("region", { name: HEADING, exact: true });
        const box = region.getByRole("textbox", { name: HEADING, exact: true });
        await expect(box.getByText(LONG).first()).toBeVisible({ timeout: 20_000 });
        await expectClear(region, box, "", `the references editor at ${width} px`);
        const inside = await box.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(inside, `the references editor at ${width} px: its text box doesn't scroll sideways`).toBeLessThanOrEqual(0);
        await expectNoSidewaysScroll(staff.page, `the references editor at ${width} px`);
      }
    } finally {
      await reader.context.close();
      await staff.context.close();
    }
  });
});
