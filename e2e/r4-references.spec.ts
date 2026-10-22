import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  createPerson,
  createWorld,
  removePeople,
  removeWorld,
  runId,
  signIn,
  type Person,
  type World,
} from "./fixtures/people";
import { narrative, ownLessonId } from "./fixtures/r2-course";
import { removeECourse, seedECourse } from "./fixtures/r3-e-course";
import { R4_LINKS, r4Tables, removeR4Course, seedR4Course, type R4Course } from "./fixtures/r4-course";
import {
  HOSTILE_ADDRESSES,
  HOSTILE_MARKS,
  RENDER_ONLY_MARKS,
  linkedParagraph,
  overLimitDoc,
} from "./fixtures/r4-hostile-links";
import * as sanitize from "../src/lib/rich-text/sanitize";
import { richTextForSave } from "../src/lib/rich-text/narrative";
import { callAction, type ActionAnswer, type ActionCaller } from "./fixtures/server-action";
import { rows as referenceRows } from "./fixtures/r3-action-table/r4r";
import {
  guardLabel,
  matches,
  otherOrganisationOf,
  snapshot,
  targetOf,
  type CallRow,
  type Ctx,
  type Persona,
} from "./fixtures/r3-action-table/kit";
import en from "../src/messages/en.json";
import de from "../src/messages/de.json";

/**
 * Release 4, Stream R part 1 on r4r (spec 5, D109, D110; R4-E12's parts
 * that need no file of Release 3's streams; spec 10.5's rows for
 * course-references.ts): a created course's references and bibliography.
 *
 *   R4-E12  a learner reads a course's list on its own page, opened by its
 *           address: set as a reference list (a hanging indent), with "Back
 *           to the course", or "Close this tab" when opened from a lesson;
 *           a German learner gets the English list marked lang="en", with
 *           a note; a draft's page is not found for a learner and its tab
 *           title names no course, while its editors read it; a course
 *           without a list and a built-in course have no page; an editor
 *           writes an English list with italics and a link on the course
 *           page, and learners get it at once; switching the content
 *           language with an unsaved list asks first; a colleague's save
 *           in between is never overwritten (in the editor, and two saves
 *           sent at once); a built-in course has no editor, and a direct
 *           save is refused; the editor advises shortening a list over a
 *           limit, and offers no indent, which the list's layout sets
 *   10.5    every export of course-references.ts refuses the non-editors
 *           and changes nothing (the references row included); bad
 *           arguments are refused for editors and partner admins; editors,
 *           partner admins and ADMINs can save (positive controls)
 *   R4-E7   (guard) hostile lists written straight into the database, in
 *           version 2 and as version-1 copies: no unsafe link on the page or
 *           in the editor, and the page renders
 *   R4-E6   (guard) the hostile links sent through saveCourseReferences, in
 *           version 2 and as version-1 copies: refused by name (or, version
 *           1 on a branch that can't save links yet, stored without any
 *           link), nothing stored with a link; a control row (a valid link
 *           in version 2) shows the version-2 rows are refused for their
 *           links, and they run only where links can be saved
 *
 * The guards' meaning depends on whether this branch saves links (Part A,
 * D104): without it every version-2 list is refused for its version, so
 * the version-2 rows can't tell a hostile link from a safe one, and spec
 * 10.4's negative control is run on the branch that merges both.
 *
 * Each R4-E12 test is red on the old build (Release 3), which has no
 * references page, editor or action: the page answers "not found" and the
 * action has no id. The player's link and the completion screen's link
 * (R2) are in other specs.
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
// In order, in one worker, each test on its own: a failure doesn't skip the rest.
test.describe.configure({ mode: "default" });

const RUN = runId();
const FILE = "src/app/actions/course-references.ts";
const BUILT_IN = "workplace-conflict";
const HEADING = en.courseReading.references.heading;
/** The status line's words once a list is saved: learners get it at once, or not yet. */
const SAVED_LIVE = en.courseReading.references.saved;
const SAVED = en.lessonBlocks.textEditor.saved;

/**
 * Whether this branch saves links in rich text (Part A, D104), told by its
 * code (the sanitizer names a refused link by its words), not by what a
 * save does: R4-E6's control row then checks that a valid link is saved
 * exactly here, by richTextForSave and by the server, so a branch whose
 * link saving breaks fails the control rather than skipping the rows.
 */
const LINKS_SAVED = "linkProblemMessage" in sanitize;
const VALID_LINK = linkedParagraph("https://example.org/guide");

/* ------------------------------------------------------------ helpers --- */

/** A list as the editor sends it: one paragraph per entry, version 1. */
const listOf = (...entries: string[]) => ({
  rich: {
    v: 1,
    doc: { type: "doc", content: entries.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) },
  },
});

/** What the references row holds for a course; "absent" where the database has no such table. */
async function bibliographyOf(courseId: string): Promise<unknown> {
  if (!(await r4Tables(prisma)).bibliography) return "absent";
  const [row] = await prisma.$queryRaw<{ content: unknown }[]>`
    SELECT "content" FROM "CourseBibliography" WHERE "courseId" = ${courseId}`;
  return row?.content ?? null;
}

/** A count and checksum of the references rows of these courses (or "absent"). */
async function bibliographySum(courseIds: string[]): Promise<unknown> {
  if (!(await r4Tables(prisma)).bibliography) return "absent";
  const [row] = await prisma.$queryRaw<{ n: number; sum: string }[]>`
    SELECT count(*)::int AS n, coalesce(md5(string_agg(md5(b::text), ',' ORDER BY md5(b::text))), '') AS sum
      FROM "CourseBibliography" b WHERE "courseId" = ANY(${courseIds}::text[])`;
  return row;
}

async function courseIdOf(slug: string): Promise<string | null> {
  const row = await prisma.course.findFirst({ where: { projectId: "seq-elevate", slug }, select: { id: true } });
  return row?.id ?? null;
}

/**
 * saveCourseReferences, called directly as `as`, posted to the page of the
 * course it names (where the editor is: a page serves the actions its own
 * components import).
 */
const save = (request: APIRequestContext, as: ActionCaller | null, args: unknown[], page = `/en/content/courses/${args[0]}`) =>
  callAction(request, { as, page, file: FILE, name: "saveCourseReferences", args });

/** A browser of its own, signed in as `who`. */
async function as(browser: Browser, who: Person): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await signIn(context, who.sessionToken);
  return { context, page: await context.newPage() };
}

/** The references editor on a course's page, once its list has loaded. */
async function referencesEditor(page: Page, slug: string): Promise<{ region: Locator; box: Locator }> {
  await page.goto(`/en/content/courses/${slug}`);
  const region = page.getByRole("region", { name: HEADING, exact: true });
  const box = region.getByRole("textbox", { name: HEADING, exact: true });
  await expect(box).toBeVisible({ timeout: 20_000 });
  return { region, box };
}

/**
 * The visible match only: a page under [locale]/loading.tsx streams, and
 * for a moment holds its content twice (the streamed copy, hidden, before
 * it replaces the fallback).
 */
const visible = (l: Locator) => l.filter({ visible: true });
/** The references list on the learner's page. */
const listOn = (p: Page) => visible(p.locator(".seq-references"));
/** The editor's own status line (the text box has one of its own, for paste notes). */
const statusOf = (region: Locator) => region.locator('span[role="status"]');
/**
 * The page answered "not found" (notFound(): streamed below the [locale]
 * loading boundary, so its HTTP status is the shell's).
 */
const notFoundOn = (p: Page) => visible(p.getByRole("heading", { level: 1, name: en.system.notFoundTitle }));

/** Every href in a page's markup and its RSC payload (escaped inside its scripts). */
function hrefsIn(html: string): string[] {
  const attrs = [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1]);
  const payload = [...html.matchAll(/\\"href\\":\\"((?:[^"\\]|\\\\.)*)\\"/g)].map((m) => m[1]);
  return [...attrs, ...payload];
}
/** A link's address a page may hold: content links (https, http, mailto) and the app's own (a path or an anchor). */
const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#)/i;

/** The computed hanging indent of an entry, in multiples of its font size. */
async function hanging(entry: Locator) {
  return entry.evaluate((el) => {
    const s = getComputedStyle(el);
    const size = parseFloat(s.fontSize);
    return {
      indent: Math.round((parseFloat(s.textIndent) / size) * 100) / 100,
      padding: Math.round((parseFloat(s.paddingInlineStart) / size) * 100) / 100,
    };
  });
}

/**
 * Where an entry's lines start, in px from its list's content edge: its
 * first line, and the leftmost of its other lines (null: one line only),
 * with the entry's font size (1em).
 */
async function lineStarts(entry: Locator): Promise<{ first: number; rest: number | null; em: number }> {
  return entry.evaluate((el) => {
    const list = el.parentElement!;
    const ls = getComputedStyle(list);
    const edge = list.getBoundingClientRect().left + parseFloat(ls.borderLeftWidth) + parseFloat(ls.paddingLeft);
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    const em = parseFloat(getComputedStyle(el).fontSize);
    const top = Math.min(...rects.map((r) => r.top));
    const first = rects.filter((r) => r.top < top + em / 2);
    const rest = rects.filter((r) => r.top >= top + em / 2);
    return {
      first: Math.round(Math.min(...first.map((r) => r.left)) - edge),
      rest: rest.length ? Math.round(Math.min(...rest.map((r) => r.left)) - edge) : null,
      em,
    };
  });
}

/** Every entry of a list is set alike: its first line at the list's edge, its other lines 2em in. */
async function expectHangingEntries(list: Locator, where: string) {
  const entries = list.locator(":scope > p");
  const count = await entries.count();
  expect(count, `${where}: entries`).toBeGreaterThan(1);
  for (let i = 0; i < count; i++) {
    const { first, rest, em } = await lineStarts(entries.nth(i));
    expect(Math.abs(first), `${where}, entry ${i + 1}: its first line starts at the list's edge (${first} px)`).toBeLessThanOrEqual(1);
    expect(rest, `${where}, entry ${i + 1}: it wraps`).not.toBeNull();
    expect(Math.abs(rest! - 2 * em), `${where}, entry ${i + 1}: its other lines start 2em in (${rest} px)`).toBeLessThanOrEqual(1);
  }
}

/** Keyboard focus is inside `region`, not fallen to the page. */
const focusIn = (region: Locator) => region.evaluate((el) => el.contains(document.activeElement));

/** Paste into an editor as the browser would, with this clipboard data. */
async function paste(target: Locator, data: Record<string, string>) {
  await target.evaluate((el, entries) => {
    const clipboardData = new DataTransfer();
    for (const [type, value] of Object.entries(entries)) clipboardData.setData(type, value);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, data);
}

/**
 * A reference list copied from Word, as its clipboard holds it: Word's
 * Bibliography style, which sets each entry's hanging indent with a
 * half-inch left margin (APA's own layout). Long enough entries to wrap.
 */
const WORD_ENTRIES = [
  "Author, A. A., &amp; Author, B. B. (2020). <i>Title of the work: A subtitle long enough to carry this entry onto a second line of the list</i>. Publisher Name. https://doi.org/10.1000/r4-word-1",
  "Second, C. (2021). Title of an article in a journal whose name is also rather long. <i>Journal of Long Reference Entries, 12</i>(3), 45–67. https://doi.org/10.1000/r4-word-2",
  "Third, D. D. (2019). <i>A book whose title is long enough to wrap on every screen the course page is read on</i> (2nd ed.). Another Publisher.",
];
const WORD_BIBLIOGRAPHY =
  `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">` +
  `<head><meta name=ProgId content=Word.Document><meta name=Generator content="Microsoft Word 15">` +
  `<style><!--p.MsoBibliography{margin:0in 0in 0in .5in;text-indent:-.5in;font-size:12.0pt;font-family:"Calibri",sans-serif;}--></style></head>` +
  `<body lang=EN-US><!--StartFragment-->` +
  WORD_ENTRIES.map((e) => `<p class=MsoBibliography style='margin-left:.5in;text-indent:-.5in'><span lang=EN-US>${e}</span></p>`).join("") +
  `<!--EndFragment--></body></html>`;

/* ------------------------------------------------------------- courses --- */

const SLUGS = {
  published: `e2e-r4r-pub-${RUN}`,
  draft: `e2e-r4r-draft-${RUN}`,
  german: `e2e-r4r-de-${RUN}`,
  none: `e2e-r4r-none-${RUN}`,
  write: `e2e-r4r-write-${RUN}`,
  unsaved: `e2e-r4r-unsaved-${RUN}`,
  stale: `e2e-r4r-stale-${RUN}`,
  race: `e2e-r4r-race-${RUN}`,
  hostile: `e2e-r4r-hostile-${RUN}`,
  hostileV1: `e2e-r4r-hostile1-${RUN}`,
  word: `e2e-r4r-word-${RUN}`,
  notLive: `e2e-r4r-notlive-${RUN}`,
  draftWrite: `e2e-r4r-draftw-${RUN}`,
  limits: `e2e-r4r-limits-${RUN}`,
};
/** Published unless said otherwise; German and Greek not switched on. */
const PLAIN = [
  SLUGS.none,
  SLUGS.write,
  SLUGS.unsaved,
  SLUGS.stale,
  SLUGS.race,
  SLUGS.hostile,
  SLUGS.hostileV1,
  SLUGS.word,
  SLUGS.notLive,
  SLUGS.draftWrite,
  SLUGS.limits,
];
/** A created course with one lesson of its own and no list. */
const plainCourse = (slug: string) =>
  seedECourse(prisma, {
    slug,
    title: { en: `E2E R4 ${slug}`, de: `E2E R4 ${slug} (de)` },
    status: slug === SLUGS.draftWrite ? "draft" : "published",
    lessons: [{ id: ownLessonId(), label: { en: "One" }, narrative: narrative({ en: { title: "One", text: "E2E: one." } }) }],
  });

const emails = {
  learner: `e2e-r4r-learner-${RUN}@example.com`,
  editor: `e2e-r4r-editor-${RUN}@example.com`,
};
let learner: Person;
let editor: Person;
let published: R4Course;
let draft: R4Course;
let german: R4Course;

describe("Release 4: references & bibliography, part 1 (spec 5, D109)", () => {
  test.beforeAll(async () => {
    await removePeople(prisma, Object.values(emails));
    learner = await createPerson(prisma, { email: emails.learner, roles: ["LEARNER"] });
    editor = await createPerson(prisma, { email: emails.editor, roles: ["CONTENT_EDITOR"], organisation: "A" });
    published = await seedR4Course(prisma, { slug: SLUGS.published });
    draft = await seedR4Course(prisma, { slug: SLUGS.draft, status: "draft" });
    german = await seedR4Course(prisma, { slug: SLUGS.german, ready: ["de"] });
    for (const slug of PLAIN) await plainCourse(slug);
  });

  test.afterAll(async () => {
    const ids = [learner, editor].filter(Boolean).map((p) => p.userId);
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: Object.values(SLUGS) } }] } });
    await removePeople(prisma, Object.values(emails));
    for (const slug of [SLUGS.published, SLUGS.draft, SLUGS.german]) await removeR4Course(prisma, slug);
    for (const slug of PLAIN) await removeECourse(prisma, slug);
    await prisma.$disconnect();
  });

  test("R4-E12: a learner reads a course's list on its own page, set as a reference list, with the way back", async ({
    page,
    context,
  }) => {
    expect(published.references, "the database has the references table").toBe(true);
    await signIn(context, learner.sessionToken);
    const address = `/en/learner/course/${published.slug}/references`;
    await page.goto(address);
    await expect(visible(page.getByRole("heading", { level: 1 }))).toHaveText(en.courseReferences.title);
    await expect(visible(page.getByText(`E2E R4 ${published.slug}`, { exact: true }))).toBeVisible();
    await expect(page).toHaveTitle(`${en.courseReferences.metaTitle.replace("{course}", `E2E R4 ${published.slug}`)} · SEQ Elevate`);

    // The list: its entry, its address a link opening in a new tab.
    const list = listOn(page);
    await expect(list).toContainText("Author, A. A. (2020).");
    const doi = list.getByRole("link", { name: new RegExp(R4_LINKS.reference.replace(/[.]/g, "\\.")) });
    await expect(doi).toHaveAttribute("href", R4_LINKS.reference);
    await expect(doi).toHaveAttribute("target", "_blank");
    await expect(list).not.toHaveAttribute("lang", /.*/);
    // Set as reference lists are: each entry's first line hangs 2em.
    expect(await hanging(list.locator(":scope > p").first())).toEqual({ indent: -2, padding: 2 });

    // Opened by its address: back to the course.
    await expect(visible(page.getByText(en.courseReferences.closeTab))).toHaveCount(0);
    await visible(page.getByRole("link", { name: en.courseReferences.back })).click();
    await expect(page).toHaveURL(new RegExp(`/en/learner/course/${published.slug}$`));

    // Opened from a lesson (a new tab): close it to return, no link back.
    await page.goto(`${address}?from=lesson`);
    await expect(visible(page.getByText(en.courseReferences.closeTab))).toBeVisible();
    await expect(visible(page.getByRole("link", { name: en.courseReferences.back }))).toHaveCount(0);
  });

  test("R4-E12: a German learner gets the English list of a course, marked lang=\"en\", with a note", async ({ page, context }) => {
    await signIn(context, learner.sessionToken);
    // German not switched on: the whole course is English, its title marked.
    await page.goto(`/de/learner/course/${published.slug}/references`);
    const list = listOn(page);
    await expect(list).toHaveAttribute("lang", "en", { timeout: 15_000 });
    await expect(visible(page.getByText(de.courseReferences.shownIn.en))).toBeVisible();
    await expect(visible(page.getByRole("heading", { level: 1 }))).toHaveText(de.courseReferences.title);
    await expect(visible(page.getByText(`E2E R4 ${published.slug}`, { exact: true }))).toHaveAttribute("lang", "en");

    // German switched on, the list written in English only: the course is German, the list English, marked.
    await page.goto(`/de/learner/course/${german.slug}/references`);
    await expect(listOn(page)).toHaveAttribute("lang", "en", { timeout: 15_000 });
    await expect(visible(page.getByText(de.courseReferences.shownIn.en))).toBeVisible();
    const title = visible(page.getByText(`E2E R4 ${german.slug} (de)`, { exact: true }));
    await expect(title).toBeVisible();
    await expect(title).not.toHaveAttribute("lang", /.*/);
    await expect(visible(page.getByRole("link", { name: de.courseReferences.back }))).toHaveAttribute(
      "href",
      `/de/learner/course/${german.slug}`
    );
  });

  test("R4-E12: a draft's list is for its editors: a learner gets not found and a tab title naming no course", async ({
    page,
    context,
    browser,
  }) => {
    const address = `/en/learner/course/${draft.slug}/references`;
    await signIn(context, learner.sessionToken);
    await page.goto(address);
    await expect(notFoundOn(page)).toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveTitle(new RegExp(draft.slug));
    await expect(page.getByText("Author, A. A. (2020).")).toHaveCount(0);
    // A course without a list, and a built-in course, have none.
    for (const slug of [SLUGS.none, BUILT_IN]) {
      await page.goto(`/en/learner/course/${slug}/references`);
      await expect(notFoundOn(page), slug).toBeVisible({ timeout: 15_000 });
      await expect(page).not.toHaveTitle(new RegExp(slug));
    }

    // The course's editors read it, in preview, under its name.
    const staff = await as(browser, editor);
    try {
      await staff.page.goto(address);
      await expect(listOn(staff.page)).toContainText("Author, A. A. (2020).", { timeout: 15_000 });
      await expect(notFoundOn(staff.page)).toHaveCount(0);
      await expect(staff.page).toHaveTitle(new RegExp(`E2E R4 ${draft.slug}`));
    } finally {
      await staff.context.close();
    }
  });

  test("R4-E12: an editor writes an English list with italics and a link; learners get it at once", async ({
    page,
    context,
    browser,
  }) => {
    await signIn(context, editor.sessionToken);
    const { region, box } = await referencesEditor(page, SLUGS.write);
    await expect(region.getByText(en.courseReading.references.empty)).toBeVisible();
    await expect(region).toContainText(en.courseReading.references.hint);
    await expect(region).toContainText(en.courseReading.references.languageNote);
    // The text box carries the language being written; the box is set as learners see it.
    await expect(box).toHaveAttribute("lang", "en");
    await expect(box).toHaveClass(/\bseq-references\b/);

    const toolbar = region.getByRole("toolbar", { name: "References formatting" });
    await box.click();
    await page.keyboard.type("Author, A. A. (2020). ");
    await toolbar.getByRole("button", { name: /^italic$/i }).click();
    await page.keyboard.type("Title of the work");
    await toolbar.getByRole("button", { name: /^italic$/i }).click();
    await page.keyboard.type(". Publisher. https://doi.org/10.1000/r4-write");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second, B. (2021). Another work.");
    await expect(box.locator("em")).toHaveText("Title of the work");
    await expect(statusOf(region)).toHaveText(en.lessonBlocks.textEditor.unsaved);
    // The editor sets each entry as the learner's page does.
    expect(await hanging(box.locator(":scope > p").first())).toEqual({ indent: -2, padding: 2 });

    // Saved from the keyboard: Save goes disabled with nothing left to save, and focus stays in the editor.
    await region.getByRole("button", { name: en.courseReading.references.save }).focus();
    await page.keyboard.press("Enter");
    await expect(statusOf(region)).toHaveText(SAVED_LIVE);
    await expect.poll(() => focusIn(region), "focus stays in the editor after Save").toBe(true);
    await expect(region.getByText(en.courseReading.references.empty)).toHaveCount(0);

    // Stored: the English list, version 1, its text derived on the server.
    const courseId = (await courseIdOf(SLUGS.write))!;
    const stored = (await bibliographyOf(courseId)) as { v: number; locales: Record<string, { text: string; rich: unknown }> };
    expect(stored.v).toBe(1);
    expect(Object.keys(stored.locales)).toEqual(["en"]);
    expect(stored.locales.en.text).toBe(
      "Author, A. A. (2020). Title of the work. Publisher. https://doi.org/10.1000/r4-write\n\nSecond, B. (2021). Another work."
    );
    expect(JSON.stringify(stored.locales.en.rich)).toContain('"marks":[{"type":"italic"}]');
    const audit = await prisma.auditLog.findMany({
      where: { entityId: SLUGS.write, action: "course.references_saved" },
      select: { actorId: true, entity: true, metadata: true },
    });
    expect(audit).toEqual([{ actorId: editor.userId, entity: "Course", metadata: { locale: "en" } }]);

    // A learner reads it at once: two entries, the title in italics, the address a link.
    const reader = await as(browser, learner);
    try {
      await reader.page.goto(`/en/learner/course/${SLUGS.write}/references`);
      const list = listOn(reader.page);
      await expect(list.locator(":scope > p")).toHaveCount(2, { timeout: 15_000 });
      await expect(list.locator("em")).toHaveText("Title of the work");
      await expect(list.getByRole("link", { name: /doi\.org\/10\.1000\/r4-write/ })).toHaveAttribute(
        "href",
        "https://doi.org/10.1000/r4-write"
      );
    } finally {
      await reader.context.close();
    }
  });

  test("R4-E12: a list pasted from Word is set as a reference list, every entry alike, in the editor and for learners", async ({
    page,
    context,
    browser,
  }) => {
    await signIn(context, editor.sessionToken);
    const { region, box } = await referencesEditor(page, SLUGS.word);
    await box.click();
    await paste(box, {
      "text/html": WORD_BIBLIOGRAPHY,
      "text/plain": WORD_ENTRIES.map((e) => e.replace(/<[^>]+>/g, "").replace("&amp;", "&")).join("\n"),
    });
    await expect(box.locator(":scope > p")).toHaveCount(WORD_ENTRIES.length);
    await expectHangingEntries(box, "the editor");

    await region.getByRole("button", { name: en.courseReading.references.save }).click();
    await expect(statusOf(region)).toHaveText(SAVED_LIVE);
    // Word's half-inch margin isn't kept as an indent step: the list's layout hangs every entry alike.
    const stored = (await bibliographyOf((await courseIdOf(SLUGS.word))!)) as {
      locales: { en: { rich: { doc: { content: { attrs?: { indent?: number } }[] } } } };
    };
    const indents = stored.locales.en.rich.doc.content.map((b) => b.attrs?.indent ?? 0);
    expect(indents, "no indent step is kept from the paste").toEqual(WORD_ENTRIES.map(() => 0));

    const reader = await as(browser, learner);
    try {
      await reader.page.goto(`/en/learner/course/${SLUGS.word}/references`);
      const list = listOn(reader.page);
      await expect(list.locator(":scope > p")).toHaveCount(WORD_ENTRIES.length, { timeout: 15_000 });
      await expectHangingEntries(list, "the learner's page");
    } finally {
      await reader.context.close();
    }
  });

  test("R4-E12: the list's editor offers no indent: every entry hangs alike, by the list's layout", async ({ page, context }) => {
    await signIn(context, editor.sessionToken);
    const { region, box } = await referencesEditor(page, SLUGS.limits);
    const toolbar = region.getByRole("toolbar", { name: "References formatting" });
    await expect(toolbar.getByRole("button", { name: /^italic$/i })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: /^bulleted list$/i })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: /indent/i })).toHaveCount(0);
    // Nor by its shortcut: Ctrl+] (⌘] on a Mac) leaves an entry as it is.
    await box.click();
    await page.keyboard.type("Author, A. A. (2020). Title of the work. Publisher.");
    await page.keyboard.press("ControlOrMeta+]");
    await page.keyboard.press("End");
    await page.keyboard.type(" Indented?");
    await expect(box.locator(":scope > p")).toHaveCount(1);
    await expect(box.locator(":scope > p").first()).toHaveText("Author, A. A. (2020). Title of the work. Publisher. Indented?");
    await expect(box.locator(":scope > p").first()).not.toHaveAttribute("style", /padding/);
    expect(await hanging(box.locator(":scope > p").first())).toEqual({ indent: -2, padding: 2 });
  });

  test("R4-E12: the list's editor advises shortening a list over a limit, as the list's save does", async ({ page, context }) => {
    await signIn(context, editor.sessionToken);
    const { region, box } = await referencesEditor(page, SLUGS.limits);
    await box.click();
    await page.keyboard.insertText(`Author, A. A. (2020). ${"x".repeat(10_000)}`);
    const problem = region.getByRole("alert");
    await expect(problem).toHaveText("The references list is too long — at most 10,000 characters. Shorten the list.");
    await expect(problem).not.toContainText("block");
  });

  test("R4-E12: the editor says when learners get a saved list: not before its language is switched on, nor on a draft", async ({
    page,
    context,
    browser,
  }) => {
    await signIn(context, editor.sessionToken);
    const notLive = (messages: typeof en, language: string) =>
      messages.courseManager.languageReady.notLive.replaceAll("{language}", language);
    const { region, box } = await referencesEditor(page, SLUGS.notLive);
    // English, on a published course: learners get it as soon as it is saved.
    await expect(region).not.toContainText(notLive(en, "German"));
    await box.click();
    await page.keyboard.type("Author, A. A. (2020). In English.");
    await region.getByRole("button", { name: en.courseReading.references.save }).click();
    await expect(statusOf(region)).toHaveText(SAVED_LIVE);

    // German, not switched on for this course: its learners get English until it is, and the screen says so.
    const languages = page.getByRole("group", { name: en.courseManager.page.contentLanguage });
    await languages.getByRole("button", { name: /^german/i }).click();
    const germanBox = region.getByRole("textbox", { name: HEADING, exact: true });
    await expect(germanBox).toHaveAttribute("lang", "de", { timeout: 15_000 });
    await expect(region).toContainText(notLive(en, "German"));
    await germanBox.click();
    await page.keyboard.type("Autorin, A. (2021). Auf Deutsch.");
    await region.getByRole("button", { name: en.courseReading.references.save }).click();
    await expect(statusOf(region)).toHaveText(SAVED);

    // As said: a German learner gets the English list.
    const reader = await as(browser, learner);
    try {
      await reader.page.goto(`/de/learner/course/${SLUGS.notLive}/references`);
      const list = listOn(reader.page);
      await expect(list).toHaveAttribute("lang", "en", { timeout: 15_000 });
      await expect(list).toContainText("In English.");
      await expect(reader.page.getByText("Auf Deutsch.")).toHaveCount(0);
    } finally {
      await reader.context.close();
    }
    // The editor's preview of the German list says the same.
    await page.goto(`/de/learner/course/${SLUGS.notLive}/references?preview=1`);
    await expect(listOn(page)).toContainText("Auf Deutsch.", { timeout: 15_000 });
    await expect(visible(page.getByText(de.coursePlayer.languageNotLive.replaceAll("{language}", "Deutsch")))).toBeVisible();

    // A draft: saved, and nobody but its editors sees it until it is published.
    const draftEditor = await referencesEditor(page, SLUGS.draftWrite);
    await draftEditor.box.click();
    await page.keyboard.type("Draft, D. (2022).");
    await draftEditor.region.getByRole("button", { name: en.courseReading.references.save }).click();
    await expect(statusOf(draftEditor.region)).toHaveText(SAVED);
  });

  test("R4-E12: switching the content language with an unsaved list asks first, and Cancel keeps it", async ({
    page,
    context,
  }) => {
    await signIn(context, editor.sessionToken);
    const { region, box } = await referencesEditor(page, SLUGS.unsaved);
    await box.click();
    await page.keyboard.type("Unsaved, U. (2020).");
    await expect(statusOf(region)).toHaveText(en.lessonBlocks.textEditor.unsaved);

    let asked = "";
    page.once("dialog", (dialog) => {
      asked = dialog.message();
      void dialog.dismiss();
    });
    const languages = page.getByRole("group", { name: en.courseManager.page.contentLanguage });
    await languages.getByRole("button", { name: /^german/i }).click();
    await expect.poll(() => asked).toBe(en.courseManager.page.unsavedSwitch.replace("{list}", HEADING));
    await expect(languages.getByRole("button", { name: /^english/i })).toHaveAttribute("aria-pressed", "true");
    await expect(box).toHaveText("Unsaved, U. (2020).");

    // Leaving asks too.
    asked = "";
    page.once("dialog", (dialog) => {
      asked = dialog.message();
      void dialog.dismiss();
    });
    await page.getByRole("link", { name: /^all courses$/i }).click();
    await expect.poll(() => asked).toBe(en.courseManager.page.unsavedLeave.replace("{list}", HEADING));

    // Saying yes: German, with nothing written in it, marked German.
    page.once("dialog", (dialog) => void dialog.accept());
    await languages.getByRole("button", { name: /^german/i }).click();
    await expect(languages.getByRole("button", { name: /^german/i })).toHaveAttribute("aria-pressed", "true");
    const germanBox = region.getByRole("textbox", { name: HEADING, exact: true });
    await expect(germanBox).toHaveAttribute("lang", "de", { timeout: 15_000 });
    await expect(germanBox).not.toContainText("Unsaved");
    await expect(region.getByText(en.courseReading.references.empty)).toBeVisible();
    expect(await bibliographyOf((await courseIdOf(SLUGS.unsaved))!), "nothing was written").toBeNull();

    // Discard changes, from the keyboard: it asks first, the box is as stored, and focus stays in the editor.
    await germanBox.click();
    await page.keyboard.type("Zu verwerfen (2020).");
    await expect(statusOf(region)).toHaveText(en.lessonBlocks.textEditor.unsaved);
    asked = "";
    page.once("dialog", (dialog) => {
      asked = dialog.message();
      void dialog.accept();
    });
    await region.getByRole("button", { name: en.courseReading.references.discard }).focus();
    await page.keyboard.press("Enter");
    await expect(statusOf(region)).toHaveText(en.lessonBlocks.textEditor.discarded);
    expect(asked).toBe(en.lessonBlocks.textEditor.discardConfirm);
    await expect(region.getByRole("textbox", { name: HEADING, exact: true })).not.toContainText("Zu verwerfen");
    await expect.poll(() => focusIn(region), "focus stays in the editor after Discard changes").toBe(true);
  });

  test("R4-E12: a colleague's save in between is never overwritten: the editor offers their version", async ({
    context,
  }) => {
    await signIn(context, editor.sessionToken);
    const mine = await context.newPage();
    const theirs = await context.newPage();
    const a = await referencesEditor(theirs, SLUGS.stale);
    const b = await referencesEditor(mine, SLUGS.stale);

    await a.box.click();
    await theirs.keyboard.type("Theirs, T. (2020).");
    await a.region.getByRole("button", { name: en.courseReading.references.save }).click();
    await expect(statusOf(a.region)).toHaveText(en.courseReading.references.saved);

    await b.box.click();
    await mine.keyboard.type("Mine, M. (2021).");
    await b.region.getByRole("button", { name: en.courseReading.references.save }).focus();
    await mine.keyboard.press("Enter");
    const conflict = b.region.getByRole("alert").filter({ hasText: en.courseReading.references.changedElsewhere });
    await expect(conflict).toBeVisible();
    await expect.poll(() => focusIn(b.region), "focus stays in the editor when the save is refused").toBe(true);
    // Nothing of mine was written; my words are still on screen.
    const courseId = (await courseIdOf(SLUGS.stale))!;
    expect(((await bibliographyOf(courseId)) as { locales: { en: { text: string } } }).locales.en.text).toBe(
      "Theirs, T. (2020)."
    );
    await expect(b.box).toHaveText("Mine, M. (2021).");

    // Load their version (my unsaved words: it asks first), then my change goes on top.
    mine.once("dialog", (dialog) => void dialog.accept());
    await conflict.getByRole("button", { name: en.courseReading.references.reload }).focus();
    await mine.keyboard.press("Enter");
    await expect(statusOf(b.region)).toHaveText(en.lessonBlocks.textEditor.reloaded);
    const box = b.region.getByRole("textbox", { name: HEADING, exact: true });
    await expect(box).toHaveText("Theirs, T. (2020).");
    await expect(conflict).toHaveCount(0);
    // "Load their version" went with the alert: focus stays in the editor.
    await expect.poll(() => focusIn(b.region), "focus stays in the editor after Load their version").toBe(true);
    await box.click();
    await mine.keyboard.press("ControlOrMeta+a");
    await mine.keyboard.type("Theirs, T. (2020).");
    await mine.keyboard.press("Enter");
    await mine.keyboard.type("Mine, M. (2021).");
    await b.region.getByRole("button", { name: en.courseReading.references.save }).click();
    await expect(statusOf(b.region)).toHaveText(en.courseReading.references.saved);
    expect(((await bibliographyOf(courseId)) as { locales: { en: { text: string } } }).locales.en.text).toBe(
      "Theirs, T. (2020).\n\nMine, M. (2021)."
    );
  });

  test("R4-E12: two saves sent at once from the same base: one is saved, the other refused, every time", async ({
    request,
  }) => {
    const courseId = (await courseIdOf(SLUGS.race))!;
    let base: string | null = null;
    for (const round of [1, 2, 3]) {
      const answers: ActionAnswer[] = await Promise.all([
        save(request, editor, [SLUGS.race, "en", listOf(`First ${round} (2020).`), base]),
        save(request, editor, [SLUGS.race, "en", listOf(`Second ${round} (2020).`), base]),
      ]);
      for (const a of answers) expect(a.error, `round ${round}: ${a.raw.slice(0, 300)}`).toBeUndefined();
      const results = answers.map((r) => r.result as { ok: boolean; error?: string; base?: string | null });
      expect(results.map((r) => r.ok).sort(), `round ${round}: ${JSON.stringify(results)}`).toEqual([false, true]);
      const won = results.findIndex((r) => r.ok);
      expect(results[1 - won]).toEqual({ ok: false, error: "changed-elsewhere" });
      const text = ((await bibliographyOf(courseId)) as { locales: { en: { text: string } } }).locales.en.text;
      expect(text).toBe(`${won === 0 ? "First" : "Second"} ${round} (2020).`);
      base = results[won].base ?? null;
    }
  });

  test("R4-E12: a built-in course has no references editor, and a direct save is refused", async ({ page, context, request }) => {
    await signIn(context, editor.sessionToken);
    await page.goto(`/en/content/courses/${BUILT_IN}`);
    await expect(page.getByRole("region", { name: en.courseManager.page.copyRegion })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("region", { name: HEADING, exact: true })).toHaveCount(0);

    const builtInId = await courseIdOf(BUILT_IN);
    const before = builtInId ? await bibliographyOf(builtInId) : null;
    const answer = await save(request, editor, [BUILT_IN, "en", listOf("Built-in (2020)."), null], `/en/content/courses/${BUILT_IN}`);
    expect(answer.error, answer.raw.slice(0, 200)).toBeUndefined();
    expect(answer.result).toEqual({ ok: false, error: "built-in" });
    if (builtInId) expect(await bibliographyOf(builtInId)).toEqual(before);
  });

  test("R4-E7 (guard): hostile lists written straight into the database draw no unsafe link, and every page renders", async ({
    page,
    context,
    browser,
    request,
  }) => {
    expect((await r4Tables(prisma)).bibliography, "the database has the references table").toBe(true);
    const million = HOSTILE_ADDRESSES.find((r) => r.name === "1,000,000 characters")!;
    // Postgres's jsonb can't hold a NUL character: no database row can carry that address.
    const storable = HOSTILE_ADDRESSES.filter((r) => r !== million && !(typeof r.href === "string" && r.href.includes("\u0000")));
    const paragraphs = [
      ...storable.map((r) => linkedParagraph(r.href)),
      ...HOSTILE_MARKS.map((m) => m.rich),
      ...RENDER_ONLY_MARKS.map((m) => m.rich),
    ].flatMap((d) => d.doc.content);
    const over = overLimitDoc();
    /**
     * Each course's lists, and the words each language's list still shows.
     * Version 2 as the format stores links; and version-1 copies of the same
     * rows, the shape that reaches the mark filter on a branch that can't
     * save links yet (an older reader drops every link mark from it).
     */
    const lists: { slug: string; content: unknown; words: Partial<Record<"en" | "de" | "el", string>> }[] = [
      {
        slug: SLUGS.hostile,
        content: {
          v: 1,
          locales: {
            en: { text: "Read the guide today. Hostile in English.", rich: { v: 2, doc: { type: "doc", content: paragraphs } } },
            de: { text: over.text, rich: over.rich },
            el: { text: "Read the guide today. Hostile in Greek.", rich: linkedParagraph(million.href) },
          },
        },
        words: { en: "the guide", de: over.text, el: "the guide" },
      },
      {
        slug: SLUGS.hostileV1,
        content: {
          v: 1,
          locales: {
            en: { text: "Read the guide today. Version 1.", rich: { v: 1, doc: { type: "doc", content: paragraphs } } },
            el: { text: "Read the guide today. Version 1, Greek.", rich: { ...linkedParagraph(million.href), v: 1 } },
          },
        },
        words: { en: "the guide", el: "the guide" },
      },
    ];
    for (const { slug, content } of lists) {
      await prisma.$executeRaw`
        INSERT INTO "CourseBibliography" ("courseId", "content", "updatedAt")
        VALUES (${(await courseIdOf(slug))!}, ${JSON.stringify(content)}::jsonb, now())
        ON CONFLICT ("courseId") DO UPDATE SET "content" = EXCLUDED."content", "updatedAt" = now()`;
    }

    // The learner's page and an editor's preview in each language: it renders, the
    // text shows, and no href but a content link or the app's own.
    await signIn(context, learner.sessionToken);
    const check = async (p: Page, address: string, cookie: string, words: string) => {
      await p.goto(address);
      await expect(listOn(p), address).toContainText(words, { timeout: 15_000 });
      await expect(notFoundOn(p)).toHaveCount(0);
      for (const href of await p.locator(".seq-references a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
        expect(href, `${address}: a link in the list`).toMatch(/^(https?:\/\/|mailto:)/i);
      }
      const raw = await (
        await request.get(address, { headers: { Cookie: `authjs.session-token=${cookie}` }, failOnStatusCode: false })
      ).text();
      for (const href of hrefsIn(raw)) expect(href, `${address}: an href in the HTML or its payload`).toMatch(SAFE_HREF);
      expect(raw).not.toMatch(/javascript:alert|vbscript:|data:text\/html/i);
    };
    const staff = await as(browser, editor);
    try {
      for (const { slug, words } of lists) {
        await check(page, `/en/learner/course/${slug}/references`, learner.sessionToken, words.en!);
        for (const [locale, shown] of Object.entries(words)) {
          await check(staff.page, `/${locale}/learner/course/${slug}/references?preview=1`, editor.sessionToken, shown);
        }
        // The references editor: each language opens without an unsafe link in its box.
        const { region } = await referencesEditor(staff.page, slug);
        const languages = staff.page.getByRole("group", { name: en.courseManager.page.contentLanguage });
        for (const [locale, name] of [["en", /^english/i], ["de", /^german/i], ["el", /^greek/i]] as const) {
          const shown = words[locale];
          if (!shown) continue;
          await languages.getByRole("button", { name }).click();
          const box = region.getByRole("textbox", { name: HEADING, exact: true });
          await expect(box).toHaveAttribute("lang", locale, { timeout: 15_000 });
          await expect(box, `${slug}, ${locale}`).toContainText(shown);
          for (const href of await region.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")))) {
            if (href !== null) expect(href, `${slug}, ${locale}: a link in the editor`).toMatch(/^(https?:\/\/|mailto:)/i);
          }
        }
      }
    } finally {
      await staff.context.close();
    }
  });
});

/* ------------------------------------------------- the action table rows --- */

describe("Release 4: the references actions refuse who they must, and change nothing (spec 10.5)", () => {
  let world: World;
  let r4: R4Course;
  const R4_SLUG = `e2e-r4r-table-${RUN}`;

  test.beforeAll(async () => {
    world = await createWorld(prisma);
    r4 = await seedR4Course(prisma, { slug: R4_SLUG });
  });

  test.afterAll(async () => {
    if (world) await removeWorld(prisma, world);
    await removeR4Course(prisma, R4_SLUG);
  });

  const ctx = (who: Persona): Ctx => ({
    world,
    as: who,
    target: world.people[targetOf(who)],
    other: world.organisations[otherOrganisationOf(who)],
    run: world.run,
  });
  const caller = (who: Persona) => (who === "anonymous" ? null : world.people[who]);
  /** What a refused call must leave as it was: the kit's tables, and the references rows. */
  const state = async (row: CallRow) => ({
    tables: await snapshot(prisma, world, row.tables),
    references: await bibliographySum([world.course.id, world.draftCourse.id, r4.courseId]),
  });

  for (const row of referenceRows.filter((r): r is CallRow => r.kind === "call")) {
    for (const who of row.refuse) {
      test(`${row.name} refuses ${who}${guardLabel(row, who)}`, async ({ request }) => {
        const c = ctx(who);
        const before = await state(row);
        const answer = await callAction(request, {
          as: caller(who),
          page: typeof row.page === "string" ? row.page : row.page(c),
          file: row.file,
          name: row.name,
          args: row.args(c),
        });
        const outcome = row.outcome(who);
        const { ok, got } = matches(answer, outcome);
        expect.soft(ok, `${row.name} as ${who}: answered ${JSON.stringify(got)}, wanted ${JSON.stringify(outcome)}`).toBe(true);
        expect(await state(row), `${row.name} as ${who} changed nothing`).toEqual(before);
      });
    }
    if (row.control) {
      const control = row.control;
      test(`${row.name} answers ${control.as} (control)`, async ({ request }) => {
        const c = ctx(control.as);
        const answer = await callAction(request, {
          as: caller(control.as),
          page: typeof row.page === "string" ? row.page : row.page(c),
          file: row.file,
          name: row.name,
          args: row.args(c),
        });
        expect(answer.error, answer.raw.slice(0, 200)).toBeUndefined();
        expect(control.answer(answer.result), `reads ${control.what}: ${JSON.stringify(answer.result)}`).toBe(true);
      });
    }
  }

  test("an editor's and a partner admin's bad arguments are refused, and change nothing", async ({ request }) => {
    const page = `/en/content/courses/${R4_SLUG}`;
    // A list to be stale against.
    const first = await save(request, world.people.EA, [R4_SLUG, "de", listOf("Autorin, A. (2021)."), null], page);
    expect(first.result).toMatchObject({ ok: true });
    for (const who of ["EA", "PAA"] as const) {
      const person = world.people[who];
      const cases: [string, unknown[], unknown][] = [
        ["a built-in course", [BUILT_IN, "en", listOf("x"), null], { ok: false, error: "built-in" }],
        ["an unknown course", [`e2e-r4r-nothing-${RUN}`, "en", listOf("x"), null], { ok: false, error: "not-found" }],
        ["an unknown language", [R4_SLUG, "fr", listOf("x"), null], { ok: false, error: "bad-input" }],
        ["a slug that can't be one", ["../x", "en", listOf("x"), null], { ok: false, error: "bad-input" }],
        ["no list at all", [R4_SLUG, "en", "x", null], { ok: false, error: "bad-input" }],
        ["a stale base", [R4_SLUG, "de", listOf("Mine (2021)."), "stale"], { ok: false, error: "changed-elsewhere" }],
        ["a list from nothing over a stored one", [R4_SLUG, "de", listOf("Mine (2021)."), null], { ok: false, error: "changed-elsewhere" }],
      ];
      for (const [name, args, wanted] of cases) {
        const before = await bibliographySum([r4.courseId]);
        const answer = await save(request, person, args, page);
        expect(answer.error, `${who}, ${name}: ${answer.raw.slice(0, 200)}`).toBeUndefined();
        expect(answer.result, `${who}, ${name}`).toEqual(wanted);
        expect(await bibliographySum([r4.courseId]), `${who}, ${name}: nothing changed`).toEqual(before);
      }
    }
  });

  /** The current base of the R4 course's English list, as its editor would send it. */
  async function englishBase(request: APIRequestContext, page: string): Promise<string | null> {
    const loaded = await callAction(request, { as: world.people.EA, page, file: FILE, name: "loadCourseReferencesForEditor", args: [R4_SLUG] });
    return (loaded.result as { locales: { en?: { base: string } } }).locales.en?.base ?? null;
  }

  /** The hostile rows, as a version-2 list (as the format stores links) or as version-1 copies. */
  const hostileRows = (version: 1 | 2) =>
    [
      ...HOSTILE_ADDRESSES.map((r) => ({ name: r.name, rich: linkedParagraph(r.href), save: "refused" as const })),
      ...HOSTILE_MARKS.map((m) => ({ name: m.name, rich: m.rich, save: m.save })),
    ].map((row) => ({ ...row, rich: { ...row.rich, v: version } }));

  /** The refusal names the link by its words, or, for an address too long to look at, the list's length. */
  const NAMED = (name: string) =>
    name === "1,000,000 characters" ? /^The references list is too long/ : /^The references list: the link (text )?“[^”]+”/;

  /**
   * Sends each row as EA and checks what is stored. `links`: whether links
   * can be saved here; without them (version 1 only) a row may be stored,
   * but never with a link.
   */
  async function sendHostile(request: APIRequestContext, rows: ReturnType<typeof hostileRows>, links: boolean) {
    const page = `/en/content/courses/${R4_SLUG}`;
    let base = await englishBase(request, page);
    for (const row of rows) {
      const before = await bibliographySum([r4.courseId]);
      const started = Date.now();
      const answer = await save(request, world.people.EA, [R4_SLUG, "en", { rich: row.rich }, base], page);
      expect(answer.error, `${row.name}: ${answer.raw.slice(0, 200)}`).toBeUndefined();
      const result = answer.result as { ok: boolean; error?: string; issues?: string[]; base?: string | null };
      expect(Date.now() - started, `${row.name}: answered in the action's normal time`).toBeLessThan(10_000);
      if (result.ok) {
        base = result.base ?? null;
        const rich = ((await bibliographyOf(r4.courseId)) as { locales: { en: { rich: unknown } } }).locales.en.rich;
        const stored = JSON.stringify(rich);
        // Outside the words: a label may name a host as text ("paypal.com.evil.example").
        const outsideWords = JSON.stringify(rich, (key, value) => (key === "text" ? undefined : value));
        expect(outsideWords, `${row.name}: no hostile address or attribute is stored`).not.toMatch(
          /javascript|vbscript|data:|file:|evil|onclick|style|_self|opener|safelinks|blob\.vercel/i
        );
        if (links) {
          // Only extra attributes may be saved, and then without them: the link holds its href only.
          expect(row.save, `${row.name} was saved`).toBe("attributes-dropped");
          expect(stored).toContain('"attrs":{"href":"https://example.org/guide"}');
        } else {
          // A branch that can't save links stores the words without any link.
          expect(stored, `${row.name}: stored without a link`).not.toContain('"type":"link"');
          expect(row.rich.v, `${row.name}: only version 1 is stored without links`).toBe(1);
        }
        continue;
      }
      expect(result.error, row.name).toBe("invalid");
      if (links) expect(result.issues?.[0], `${row.name}: the refusal names the link`).toMatch(NAMED(row.name));
      else expect(result.issues?.[0], `${row.name}: the refusal names the list`).toMatch(/^The references list/);
      expect(await bibliographySum([r4.courseId]), `${row.name}: nothing stored`).toEqual(before);
    }
  }

  test("R4-E6 (guard): a valid link in a version-2 list is saved exactly where links can be saved (the guard's control)", async ({
    request,
  }) => {
    const page = `/en/content/courses/${R4_SLUG}`;
    expect(richTextForSave(VALID_LINK, "The references list").ok, "this branch's own save agrees").toBe(LINKS_SAVED);
    const base = await englishBase(request, page);
    const answer = await save(request, world.people.EA, [R4_SLUG, "en", { rich: VALID_LINK }, base], page);
    expect(answer.error, answer.raw.slice(0, 200)).toBeUndefined();
    const result = answer.result as { ok: boolean; error?: string; base?: string | null };
    if (LINKS_SAVED) {
      // So the version-2 hostile rows below are refused for their links, not for their version.
      expect(result, "a valid link is saved").toMatchObject({ ok: true });
      const stored = (await bibliographyOf(r4.courseId)) as { locales: { en: { rich: unknown } } };
      expect(JSON.stringify(stored.locales.en.rich)).toContain('"attrs":{"href":"https://example.org/guide"}');
    } else {
      // Every version-2 list is refused for its version here, links or none: the version-2 rows are skipped.
      expect(result, "version 2 is refused for its version").toMatchObject({ ok: false, error: "invalid" });
    }
  });

  test("R4-E6 (guard): the hostile links in a version-2 list are refused by name through saveCourseReferences, and nothing is stored", async ({
    request,
  }) => {
    test.skip(!LINKS_SAVED, "Without links in rich text (Part A) every version-2 list is refused for its version: these rows would check nothing about links.");
    await sendHostile(request, hostileRows(2), true);
  });

  test("R4-E6 (guard): version-1 copies of the hostile links never store a link: refused by name, or (where links can't be saved) stored without one", async ({
    request,
  }) => {
    await sendHostile(request, hostileRows(1), LINKS_SAVED);
  });

  test("editors, partner admins and ADMINs save and clear a course's list (positive controls), each audited", async ({
    request,
  }) => {
    const page = `/en/content/courses/${R4_SLUG}`;
    for (const who of ["EA", "PAA", "AD", "AS"] as const) {
      const person = world.people[who];
      const loaded = await callAction(request, { as: person, page, file: FILE, name: "loadCourseReferencesForEditor", args: [R4_SLUG] });
      const base = (loaded.result as { locales: { el?: { base: string } } } | null)?.locales.el?.base ?? null;
      const saved = await save(request, person, [R4_SLUG, "el", listOf(`${who} (2022).`), base], page);
      expect(saved.result, who).toMatchObject({ ok: true, saved: { text: `${who} (2022).` } });
      const stored = (await bibliographyOf(r4.courseId)) as { locales: { el: { text: string } } };
      expect(stored.locales.el.text).toBe(`${who} (2022).`);
      const cleared = await save(request, person, [R4_SLUG, "el", null, (saved.result as { base: string }).base], page);
      expect(cleared.result, who).toEqual({ ok: true, base: null, saved: null });
      const audit = await prisma.auditLog.findMany({
        where: { actorId: person.userId, entityId: R4_SLUG },
        orderBy: { createdAt: "asc" },
        select: { action: true, metadata: true },
      });
      expect(
        audit.filter((r) => (r.metadata as { locale?: string } | null)?.locale === "el"),
        who
      ).toEqual([
        { action: "course.references_saved", metadata: { locale: "el" } },
        { action: "course.references_cleared", metadata: { locale: "el" } },
      ]);
    }
  });
});
