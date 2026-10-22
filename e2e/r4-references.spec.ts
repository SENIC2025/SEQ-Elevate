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
 *           save is refused
 *   10.5    every export of course-references.ts refuses the non-editors
 *           and changes nothing (the references row included); bad
 *           arguments are refused for editors and partner admins; editors,
 *           partner admins and ADMINs can save (positive controls)
 *   R4-E7   (guard) hostile lists written straight into the database: no
 *           unsafe link on the page or in the editor, and the page renders
 *   R4-E6   (guard) the hostile links sent through saveCourseReferences:
 *           refused by name, nothing stored
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
};
/** A created course with one lesson of its own and no list. */
const plainCourse = (slug: string) =>
  seedECourse(prisma, {
    slug,
    title: { en: `E2E R4 ${slug}`, de: `E2E R4 ${slug} (de)` },
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
    for (const slug of [SLUGS.none, SLUGS.write, SLUGS.unsaved, SLUGS.stale, SLUGS.race, SLUGS.hostile]) {
      await plainCourse(slug);
    }
  });

  test.afterAll(async () => {
    const ids = [learner, editor].filter(Boolean).map((p) => p.userId);
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: Object.values(SLUGS) } }] } });
    await removePeople(prisma, Object.values(emails));
    for (const slug of [SLUGS.published, SLUGS.draft, SLUGS.german]) await removeR4Course(prisma, slug);
    for (const slug of [SLUGS.none, SLUGS.write, SLUGS.unsaved, SLUGS.stale, SLUGS.race, SLUGS.hostile]) {
      await removeECourse(prisma, slug);
    }
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

    await region.getByRole("button", { name: en.courseReading.references.save }).click();
    await expect(statusOf(region)).toHaveText(en.courseReading.references.saved);
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
    await b.region.getByRole("button", { name: en.courseReading.references.save }).click();
    const conflict = b.region.getByRole("alert").filter({ hasText: en.courseReading.references.changedElsewhere });
    await expect(conflict).toBeVisible();
    // Nothing of mine was written; my words are still on screen.
    const courseId = (await courseIdOf(SLUGS.stale))!;
    expect(((await bibliographyOf(courseId)) as { locales: { en: { text: string } } }).locales.en.text).toBe(
      "Theirs, T. (2020)."
    );
    await expect(b.box).toHaveText("Mine, M. (2021).");

    // Load their version (my unsaved words: it asks first), then my change goes on top.
    mine.once("dialog", (dialog) => void dialog.accept());
    await conflict.getByRole("button", { name: en.courseReading.references.reload }).click();
    await expect(statusOf(b.region)).toHaveText(en.lessonBlocks.textEditor.reloaded);
    const box = b.region.getByRole("textbox", { name: HEADING, exact: true });
    await expect(box).toHaveText("Theirs, T. (2020).");
    await expect(conflict).toHaveCount(0);
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
    const courseId = (await courseIdOf(SLUGS.hostile))!;
    const million = HOSTILE_ADDRESSES.find((r) => r.name === "1,000,000 characters")!;
    // Postgres's jsonb can't hold a NUL character: no database row can carry that address.
    const storable = HOSTILE_ADDRESSES.filter((r) => r !== million && !(typeof r.href === "string" && r.href.includes("\u0000")));
    const paragraphs = [
      ...storable.map((r) => linkedParagraph(r.href)),
      ...HOSTILE_MARKS.map((m) => m.rich),
      ...RENDER_ONLY_MARKS.map((m) => m.rich),
    ].flatMap((d) => d.doc.content);
    const over = overLimitDoc();
    const content = {
      v: 1,
      locales: {
        en: { text: "Read the guide today. Hostile in English.", rich: { v: 2, doc: { type: "doc", content: paragraphs } } },
        de: { text: over.text, rich: over.rich },
        el: { text: "Read the guide today. Hostile in Greek.", rich: linkedParagraph(million.href) },
      },
    };
    await prisma.$executeRaw`
      INSERT INTO "CourseBibliography" ("courseId", "content", "updatedAt")
      VALUES (${courseId}, ${JSON.stringify(content)}::jsonb, now())
      ON CONFLICT ("courseId") DO UPDATE SET "content" = EXCLUDED."content", "updatedAt" = now()`;

    // The learner's page and an editor's preview in each language: it renders, the
    // text shows, and no href but a content link or the app's own.
    await signIn(context, learner.sessionToken);
    /** What each language's list still shows: its words, links or none. */
    const words: Record<string, string> = { en: "the guide", de: over.text, el: "the guide" };
    const check = async (p: Page, address: string, cookie: string, locale = "en") => {
      await p.goto(address);
      await expect(listOn(p), address).toContainText(words[locale], { timeout: 15_000 });
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
    await check(page, `/en/learner/course/${SLUGS.hostile}/references`, learner.sessionToken);
    const staff = await as(browser, editor);
    try {
      for (const locale of ["en", "de", "el"]) {
        await check(staff.page, `/${locale}/learner/course/${SLUGS.hostile}/references?preview=1`, editor.sessionToken, locale);
      }
      // The references editor: each language opens without an unsafe link in its box.
      const { region } = await referencesEditor(staff.page, SLUGS.hostile);
      const languages = staff.page.getByRole("group", { name: en.courseManager.page.contentLanguage });
      for (const [locale, name] of [["en", /^english/i], ["de", /^german/i], ["el", /^greek/i]] as const) {
        await languages.getByRole("button", { name }).click();
        const box = region.getByRole("textbox", { name: HEADING, exact: true });
        await expect(box).toHaveAttribute("lang", locale, { timeout: 15_000 });
        await expect(box).toContainText(words[locale]);
        for (const href of await region.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")))) {
          if (href !== null) expect(href, "a link in the editor").toMatch(/^(https?:\/\/|mailto:)/i);
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

  test("R4-E6 (guard): the hostile links are refused by name through saveCourseReferences, and nothing is stored", async ({
    request,
  }) => {
    const page = `/en/content/courses/${R4_SLUG}`;
    const loaded = await callAction(request, {
      as: world.people.EA,
      page,
      file: FILE,
      name: "loadCourseReferencesForEditor",
      args: [R4_SLUG],
    });
    let base = (loaded.result as { locales: { en?: { base: string } } }).locales.en?.base ?? null;
    const sent = [
      ...HOSTILE_ADDRESSES.map((r) => ({ name: r.name, rich: linkedParagraph(r.href), save: "refused" as const })),
      ...HOSTILE_MARKS.map((m) => ({ name: m.name, rich: m.rich, save: m.save })),
    ];
    for (const row of sent) {
      const before = await bibliographySum([r4.courseId]);
      const started = Date.now();
      const answer = await save(request, world.people.EA, [R4_SLUG, "en", { rich: row.rich }, base], page);
      expect(answer.error, `${row.name}: ${answer.raw.slice(0, 200)}`).toBeUndefined();
      const result = answer.result as { ok: boolean; error?: string; issues?: string[]; base?: string | null };
      if (result.ok) {
        base = result.base ?? null;
        // Only extra attributes may be saved, and then without them: the link holds its href only.
        expect(row.save, `${row.name} was saved`).toBe("attributes-dropped");
        const stored = (await bibliographyOf(r4.courseId)) as { locales: { en: { rich: unknown } } };
        expect(JSON.stringify(stored.locales.en.rich)).toContain('"attrs":{"href":"https://example.org/guide"}');
        expect(JSON.stringify(stored.locales.en.rich)).not.toMatch(/onclick|style|_self|opener|evil/);
        continue;
      }
      expect(result.error, row.name).toBe("invalid");
      expect(result.issues?.[0], `${row.name}: the refusal names the list`).toMatch(/^The references list/);
      expect(await bibliographySum([r4.courseId]), `${row.name}: nothing stored`).toEqual(before);
      expect(Date.now() - started, `${row.name}: answered in the action's normal time`).toBeLessThan(10_000);
    }
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
