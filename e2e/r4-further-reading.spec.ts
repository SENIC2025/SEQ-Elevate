import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import ts from "typescript";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, createWorld, removePeople, removeWorld, runId, signIn, type Person, type World } from "./fixtures/people";
import { PROJECT, narrative, ownLessonId, type R2LessonSeed } from "./fixtures/r2-course";
import { removeECourse, seedECourse } from "./fixtures/r3-e-course";
import { HOSTILE_ADDRESSES, MISLEADING_TITLES, MISLEADING_TITLE_URL, STORED_LINK_URLS } from "./fixtures/r4-hostile-links";
import { removeOtherCourse, seedOtherProject, type OtherProject } from "./fixtures/other-project";
import { rows as readingRows } from "./fixtures/r3-action-table/r4";
import { guardLabel, matches, otherOrganisationOf, snapshot, targetOf, type CallRow, type Ctx, type Persona } from "./fixtures/r3-action-table/kit";
import { r4Tables, removeR4Course, seedDocuments, seedR4Course, type R4Course, type R4Tables } from "./fixtures/r4-course";
import { builtActionsOf, callAction, type ActionAnswer } from "./fixtures/server-action";
import { LINK_LIMITS, cleanLinkLine, titleMisleads, titleShowsNothing } from "../src/lib/cms/lesson-links";
import { checkLinkHref } from "../src/lib/rich-text/link-url";
import de from "../src/messages/de.json";
import el from "../src/messages/el.json";
import en from "../src/messages/en.json";

/**
 * Release 4, Part B, Stream R part 1 (spec 4, 10.2): further-reading links
 * and a language per document or link, as learners get them.
 *
 *   R4-E9   (its part 1) a hidden further-reading link never reaches the
 *           learner's page, neither its HTML nor the data the player gets;
 *           shown, it does; hidden again, it's gone. Stored addresses the
 *           address check refuses never reach the page (guard).
 *   R4-E9b  a link whose path holds "^", 2,041 characters as the URL
 *           standard writes it (2,081 as Chrome's parser does), stored as
 *           the add action stores it and served to the learner, has its
 *           site in the box in the learner's browser (the owner's decision
 *           of 22 October 2026).
 *   R4-E10  a lesson of the course's own whose only material is further
 *           reading isn't one learners get; a learner's place, progress
 *           and completion are the same before and after links are added
 *           to every lesson
 *   R4-E11  (its part 1) English-only and German-only documents and links:
 *           under /en the English-only items and not the German-only ones;
 *           in /de preview, and for /de learners once German is switched
 *           on for the course, the German-only items and not the
 *           English-only ones; the lessons are the same in en, de and el;
 *           a lesson whose only material is a German-only document reaches
 *           an English learner, the document marked "In German"
 *   R4-E13  (its part 1) deleting a lesson deletes its further reading
 *           with it, and no other lesson's
 *
 * Each is red on Release 3's build because it has no further reading
 * (no LessonLink table) and no languages on documents: it shows every
 * published document in every language, unmarked. The guards say so.
 *
 * Stream R part 2 (spec 9.3, R2), with the screens that place them:
 *
 *   R4-E9   (its part 2) an editor adds a link in the lesson's document
 *           card ("Documents and further reading"): a draft, in neither
 *           the learner's page nor its data; "Show to learners", and it is
 *           there after the lesson's text and before Continue (a lesson
 *           drawn piece by piece) or after the stage (a standard lesson),
 *           opening in a new tab with its site; hidden again, it's gone
 *   R4-E11  (its part 2) a /de learner on a course still shown in English:
 *           the course text in English with the English-only items, and
 *           the German-only items marked "In German" (lang="de"); a
 *           document's languages set on its row
 *   R4-E13  (its part 2) the delete confirmation lists the links, and the
 *           log counts them; a page opened before a link was added can't
 *           delete the lesson unseen (changed-elsewhere)
 *   R4-E14  axe and a 320 px sweep (no sideways scroll), and Release 3's
 *           policy-violation collector, over a lesson with named links and
 *           further reading and the document card with the link form, in
 *           en, de and el; the link list by keyboard keeps its focus
 *   R4-E6   (guard) the hostile addresses and misleading titles sent
 *           through addLessonLink and updateLessonLink are refused by name,
 *           and nothing changes
 *   R4-E6b  a reflection lesson's introduction over the limit is refused
 *           by its name: "Shorten it."
 *   10.5    every export of lesson-reading.ts refuses the non-editors and
 *           changes nothing; bad arguments are refused for editors and
 *           partner admins; editors, partner admins and ADMINs can do each
 *           (positive controls)
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
// In order, in one worker; the seeding and a whole walk through a course take a while.
test.describe.configure({ mode: "default", timeout: 90_000 });

const RUN = runId();
const READING = "src/app/actions/lesson-reading.ts";

const emails = {
  learner: `e2e-r4-fr-learner-${RUN}@example.com`,
  walker: `e2e-r4-fr-walker-${RUN}@example.com`,
  german: `e2e-r4-fr-german-${RUN}@example.com`,
  editor: `e2e-r4-fr-editor-${RUN}@example.com`,
};
let learner: Person;
let walker: Person;
let german: Person;
let editor: Person;

/** The Release 4 course (German not switched on), and the same with German switched on. */
const SLUG = { mixed: `e2e-r4-fr-${RUN}`, german: `e2e-r4-frde-${RUN}`, own: `e2e-r4-own-${RUN}`, del: `e2e-r4-del-${RUN}` };
let mixed: R4Course;
let germanOn: R4Course;
let tables: R4Tables;

/** A course of its own: two text lessons, one whose only material is a German-only document, one with nothing but further reading. */
const OWN = {
  first: { id: ownLessonId(), label: { en: "First steps" } },
  second: { id: ownLessonId(), label: { en: "Second steps" } },
  worksheet: { id: ownLessonId(), label: { en: "Worksheet" } },
  reading: { id: ownLessonId(), label: { en: "Reading only" } },
};
const WORKSHEET = `E2E R4 Arbeitsblatt ${RUN}.pdf`;
/** A course to delete a lesson of: "Keep me" and "Remove me", both with links. */
const DEL = { keep: { id: ownLessonId(), label: { en: "Keep me" } }, remove: { id: ownLessonId(), label: { en: "Remove me" } } };

/* ---------------------------------------------------------- the data --- */

async function lessonRowId(slug: string, stageKey: string) {
  const row = await prisma.lesson.findFirstOrThrow({ where: { projectId: PROJECT, courseSlug: slug, stageKey }, select: { id: true } });
  return row.id;
}

/** A further-reading link stored as an editor's save leaves it (raw SQL: the old build's client has no such model). */
async function addLink(slug: string, stageKey: string, key: string, fields: { url?: string; title?: string; published?: boolean; languages?: string[] } = {}) {
  const lessonId = await lessonRowId(slug, stageKey);
  const id = `e2e-r4-fr-${RUN}-${key}`;
  await prisma.$executeRaw`
    INSERT INTO "LessonLink" ("id", "lessonId", "title", "url", "languages", "published", "updatedAt")
    VALUES (${id}, ${lessonId}, ${fields.title ?? `E2E R4 reading ${key}`}, ${fields.url ?? `https://example.org/${RUN}/${key}`},
            ${fields.languages ?? []}::text[], ${fields.published ?? true}, now())`;
  return id;
}

async function setPublished(linkId: string, published: boolean) {
  await prisma.$executeRaw`UPDATE "LessonLink" SET "published" = ${published} WHERE "id" = ${linkId}`;
}

async function linkCount(slug: string, stageKey: string) {
  const [row] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM "LessonLink" k JOIN "Lesson" l ON l."id" = k."lessonId"
     WHERE l."projectId" = ${PROJECT} AND l."courseSlug" = ${slug} AND l."stageKey" = ${stageKey}`;
  return row.n;
}

/** Release 4's database: the test can't add further reading without its table. */
function needsReading() {
  expect(tables.links, "the database has further-reading links (LessonLink)").toBe(true);
  expect(tables.documentLanguages, "documents have languages (LessonDocument.languages)").toBe(true);
}

/* -------------------------------------------- the box in the browser --- */

/** The site box's functions, as LessonFurtherReading asks them in the learner's browser. */
type LinkModules = {
  linkSite(href: string): string | null;
  textIsSite(text: string, href: string): boolean;
  checkLinkHref(href: string): { ok: boolean };
};
/** link-site.ts and the modules it imports, from this branch's source. */
const LINK_MODULES = ["link-site", "link-url", "link-text", "link-host", "top-level-domains"];

/**
 * Opens, in `page`, a page of the e2e server's origin that holds this
 * branch's link-site.ts and link-url.ts as Chrome runs them: each module
 * transpiled from its source (types removed) and served under
 * /__link-modules/ to this page only, never by the server. Further reading
 * is drawn by LessonFurtherReading, which asks linkSite and textIsSite in
 * the browser; the list's place on the learner's screens comes with R2
 * (spec 4.5, 9.3).
 */
async function openLinkModules(page: Page) {
  await page.route("**/__link-modules/**", async (route) => {
    const name = new URL(route.request().url()).pathname.slice("/__link-modules/".length);
    if (name === "index.html") {
      const load = `import * as site from "./link-site.js"; import * as url from "./link-url.js"; window.linkModules = { ...site, ...url };`;
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><title>Links</title><script type="module">${load}</script>` });
    }
    const file = name.replace(/\.js$/, "");
    if (!LINK_MODULES.includes(file)) return route.fulfill({ status: 404, body: "" });
    const source = readFileSync(path.join(__dirname, "../src/lib/rich-text", `${file}.ts`), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
    return route.fulfill({ contentType: "text/javascript", body: outputText.replace(/ from "\.\/([\w-]+)";/g, ' from "./$1.js";') });
  });
  await page.goto("/__link-modules/index.html");
  await page.waitForFunction(() => "linkModules" in window);
}

/* ------------------------------------------------------- the screens --- */

/** A browser of its own, signed in as `who`. */
async function as(browser: Browser, who: Person): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await signIn(context, who.sessionToken);
  return { context, page: await context.newPage() };
}

/** The page as the server sent it: its HTML and the data the player gets (the RSC payload in it). */
async function served(page: Page, path: string): Promise<string> {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(200);
  return (await response?.text()) ?? "";
}

const counter = (page: Page) => page.getByText(/^\d+ \/ \d+ · /).filter({ visible: true });
const resources = (page: Page, name: string) => page.getByRole("region", { name, exact: true }).filter({ visible: true });

/** Continue to step n (of the counter), retried against the hydration race, never past it. */
async function continueTo(page: Page, n: number) {
  await expect(async () => {
    const at = (await counter(page).textContent())?.trim() ?? "";
    if (at.startsWith(`${n - 1} /`)) {
      await page.getByRole("main").getByRole("button", { name: en.common.continue, exact: true }).filter({ visible: true }).click();
    }
    await expect(counter(page)).toHaveText(new RegExp(`^${n} / `), { timeout: 5000 });
  }).toPass({ timeout: 20_000 });
}

describe("Release 4: further reading and a language per document or link (Stream R, part 1)", () => {
  test.beforeAll(async () => {
    await removePeople(prisma, Object.values(emails));
    learner = await createPerson(prisma, { email: emails.learner, roles: ["LEARNER"] });
    walker = await createPerson(prisma, { email: emails.walker, roles: ["LEARNER"] });
    german = await createPerson(prisma, { email: emails.german, roles: ["LEARNER"] });
    editor = await createPerson(prisma, { email: emails.editor, roles: ["CONTENT_EDITOR"], organisation: "A" });
    tables = await r4Tables(prisma);
    mixed = await seedR4Course(prisma, { slug: SLUG.mixed });
    germanOn = await seedR4Course(prisma, { slug: SLUG.german, ready: ["de"] });

    const text = (title: string) => narrative({ en: { title, text: `E2E: ${title}.` } });
    await seedECourse(prisma, {
      slug: SLUG.own,
      title: { en: `E2E R4 own ${RUN}` },
      lessons: [
        { ...OWN.first, narrative: text("The first lesson") },
        { ...OWN.second, narrative: text("The second lesson") },
        // Its only material: a document (below).
        { ...OWN.worksheet, narrative: { en: { title: "The worksheet lesson" } } },
        // Nothing to show: only further reading (below).
        { ...OWN.reading, narrative: { en: { title: "The reading lesson" } } },
      ] satisfies R2LessonSeed[],
    });
    await seedECourse(prisma, {
      slug: SLUG.del,
      title: { en: `E2E R4 delete ${RUN}` },
      status: "draft",
      lessons: [
        { ...DEL.keep, narrative: text("Kept") },
        { ...DEL.remove, narrative: text("Removed") },
      ],
    });
    // German-only where documents have languages.
    await seedDocuments(prisma, await lessonRowId(SLUG.own, OWN.worksheet.id), [
      {
        id: `e2e-r4-fr-${RUN}-worksheet`,
        name: WORKSHEET,
        url: `https://e2e-store.public.blob.vercel-storage.com/${RUN}-worksheet.pdf`,
        languages: ["de"],
      },
    ]);
    if (tables.links) {
      await addLink(SLUG.own, OWN.reading.id, "reading-1");
      await addLink(SLUG.own, OWN.reading.id, "reading-2", { languages: ["en"] });
      await addLink(SLUG.del, DEL.keep.id, "keep");
      await addLink(SLUG.del, DEL.remove.id, "remove-shown");
      await addLink(SLUG.del, DEL.remove.id, "remove-draft", { published: false });
    }
  });

  test.afterAll(async () => {
    const ids = [learner, walker, german, editor].filter(Boolean).map((p) => p.userId);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    for (const slug of [SLUG.mixed, SLUG.german]) await removeR4Course(prisma, slug);
    for (const slug of [SLUG.own, SLUG.del]) await removeECourse(prisma, slug);
    await removePeople(prisma, Object.values(emails));
    await prisma.$disconnect();
  });

  test("R4-E9: a hidden further-reading link never reaches the learner's page; shown, it does; hidden again, it's gone", async ({
    browser,
  }) => {
    needsReading();
    const links = mixed.links!;
    const { context, page } = await as(browser, learner);
    try {
      const path = `/en/learner/course/${SLUG.mixed}`;
      let html = await served(page, path);
      // What learners get: the shown link, with its address as the check normalised it.
      expect(html).toContain(links.shown.url);
      expect(html).toContain(links.shown.title);
      // A draft isn't in the page, nor in the data the player gets.
      expect(html).not.toContain(links.hidden.url);
      expect(html).not.toContain(links.hidden.title);

      // "Show to learners" (spec 4.3: published), then hidden again.
      await setPublished(links.hidden.id, true);
      html = await served(page, path);
      expect(html).toContain(links.hidden.url);
      await setPublished(links.hidden.id, false);
      html = await served(page, path);
      expect(html).not.toContain(links.hidden.url);
      expect(html).not.toContain(links.hidden.title);
    } finally {
      await setPublished(links.hidden.id, false).catch(() => {});
      await context.close();
    }
  });

  test("R4-E9 (guard): a stored address the check refuses never reaches the page, and the page still renders", async ({ browser }) => {
    test.skip(!tables.links, "Guard: Release 3's build has no further reading to draw (no LessonLink table).");
    const hostile: { id: string; title: string; url: string }[] = [];
    // Every row Postgres can hold (a text column can't hold a NUL).
    const storable = STORED_LINK_URLS.filter((row) => !row.url.includes(String.fromCharCode(0)));
    for (const [i, row] of storable.entries()) {
      const title = `E2E R4 hostile ${RUN} ${i}`;
      const id = await addLink(SLUG.mixed, mixed.lessons.one, `hostile-${i}`, { url: row.url, title });
      hostile.push({ id, title, url: row.url });
    }
    const { context, page } = await as(browser, learner);
    try {
      const html = await served(page, `/en/learner/course/${SLUG.mixed}`);
      for (const h of hostile) expect(html, h.url).not.toContain(h.title);
      expect(html).not.toMatch(/href="\s*(javascript|data|vbscript|file):/i);
      expect(html).not.toContain("javascript:alert(1)");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    } finally {
      await prisma.$executeRaw`DELETE FROM "LessonLink" WHERE "id" = ANY(${hostile.map((h) => h.id)}::text[])`;
      await context.close();
    }
  });

  test("R4-E9b: a link whose path holds ^ near 2,048 characters has its site in the box in the learner's browser, as on the server", async ({
    browser,
  }) => {
    needsReading();
    const title = "PayPal – sign in";
    const address = `https://evil.example/${"a".repeat(2_000)}${"^".repeat(20)}`;
    // As the add action stores it (lesson-reading.ts, readLinkFields): the title cleaned and showing something, the
    // address as the check normalises it, the title no other address than the link opens.
    const cleanTitle = cleanLinkLine(title, LINK_LIMITS.title) ?? "";
    expect(titleShowsNothing(cleanTitle)).toBe(false);
    const check = checkLinkHref(address);
    expect(check).toMatchObject({ ok: true, href: address, ownFile: false });
    expect(titleMisleads(cleanTitle, address)).toBe(false);
    const id = await addLink(SLUG.mixed, mixed.lessons.one, "signs", { title: cleanTitle, url: address });
    const { context, page } = await as(browser, learner);
    try {
      // The learner's page gets it, its address as the check normalised it.
      const html = await served(page, `/en/learner/course/${SLUG.mixed}`);
      expect(html).toContain(address);

      // In the learner's browser: its title link drawn as LessonFurtherReading draws a web link's, its words, then the
      // site's box, left out only when the words are its address.
      await openLinkModules(page);
      const chrome = await page.evaluate(({ url, words }) => {
        const { linkSite, textIsSite, checkLinkHref } = (window as unknown as { linkModules: LinkModules }).linkModules;
        const link = document.createElement("a");
        link.href = url;
        const span = document.createElement("span");
        span.textContent = words;
        link.append(span);
        const site = linkSite(url);
        if (site !== null && !textIsSite(words, url)) {
          const sep = document.createElement("span");
          sep.className = "seq-link-sep";
          sep.textContent = ", ";
          const box = document.createElement("span");
          box.className = "seq-link-site";
          box.textContent = site;
          link.append(sep, box);
        }
        document.body.append(link);
        return { written: new URL(url).href.length, accepted: checkLinkHref(url).ok };
      }, { url: address, words: cleanTitle });
      // Chrome's parser writes the twenty "^" as "%5E": 2,081 characters.
      expect(chrome).toEqual({ written: 2_081, accepted: true });
      await expect(page.getByRole("link", { name: `${title}, evil.example` }).locator(".seq-link-site")).toHaveText("evil.example");
    } finally {
      await prisma.$executeRaw`DELETE FROM "LessonLink" WHERE "id" = ${id}`;
      await context.close();
    }
  });

  test("R4-E11: under /en the English-only documents and links, not the German-only ones; the lessons are the same in en, de and el", async ({
    browser,
  }) => {
    const { context, page } = await as(browser, learner);
    try {
      const html = await served(page, `/en/learner/course/${SLUG.mixed}`);
      const docs = resources(page, en.lesson.resourcesTitle);
      await expect(docs).toContainText(mixed.documents.all.name);
      await expect(docs).toContainText(mixed.documents.en.name);
      await expect(docs).not.toContainText(mixed.documents.de.name);
      // The English item for English: nothing marked.
      await expect(docs.locator("[lang]")).toHaveCount(0);
      await expect(docs).not.toContainText(en.furtherReading.language.en);
      // The data the player gets holds the English-only link and not the German-only one, nor the German document.
      expect(html).not.toContain(`r4-${SLUG.mixed}-de.pdf`);
      needsReading();
      const links = mixed.links!;
      expect(html).toContain(links.en.url);
      expect(html).toContain(links.shown.url);
      expect(html).not.toContain(links.de.url);

      // Languages never change which lessons there are.
      for (const locale of ["en", "de", "el"]) {
        await page.goto(`/${locale}/learner/course/${SLUG.mixed}`);
        await expect(counter(page), locale).toHaveText(/^1 \/ 2 · /, { timeout: 15_000 });
      }
    } finally {
      await context.close();
    }
  });

  test("R4-E11: in /de preview, the German-only items and not the English-only ones", async ({ browser }) => {
    const { context, page } = await as(browser, editor);
    try {
      const html = await served(page, `/de/learner/course/${SLUG.mixed}?preview=1`);
      const docs = resources(page, de.lesson.resourcesTitle);
      await expect(docs).toContainText(mixed.documents.all.name, { timeout: 15_000 });
      await expect(docs).toContainText(mixed.documents.de.name);
      await expect(docs).not.toContainText(mixed.documents.en.name);
      // Shown in German, so the German worksheet isn't marked.
      await expect(docs).not.toContainText(de.furtherReading.language.de);
      needsReading();
      const links = mixed.links!;
      expect(html).toContain(links.de.url);
      expect(html).not.toContain(links.en.url);
      expect(html).not.toContain(links.hidden.url);
    } finally {
      await context.close();
    }
  });

  test("R4-E11: once German is switched on for the course, a /de learner gets the German-only items and not the English-only ones", async ({
    browser,
  }) => {
    const { context, page } = await as(browser, german);
    try {
      const html = await served(page, `/de/learner/course/${SLUG.german}`);
      const docs = resources(page, de.lesson.resourcesTitle);
      await expect(docs).toContainText(germanOn.documents.de.name, { timeout: 15_000 });
      await expect(docs).toContainText(germanOn.documents.all.name);
      await expect(docs).not.toContainText(germanOn.documents.en.name);
      needsReading();
      const links = germanOn.links!;
      expect(html).toContain(links.de.url);
      expect(html).not.toContain(links.en.url);
      await expect(counter(page)).toHaveText(/^1 \/ 2 · /);
    } finally {
      await context.close();
    }
  });

  test("R4-E10 and R4-E11: further reading alone makes no lesson, and no learner's place, progress or completion changes when links are added; a German-only worksheet reaches an English learner, marked", async ({
    browser,
  }) => {
    needsReading();
    const { context, page } = await as(browser, walker);
    try {
      // Three lessons: the one with nothing but further reading isn't one.
      await page.goto(`/en/learner/course/${SLUG.own}`);
      await expect(counter(page)).toHaveText("1 / 3 · First steps", { timeout: 15_000 });
      await expect(page.getByRole("navigation", { name: en.course.stepsNav })).not.toContainText("Reading only");
      await continueTo(page, 2);
      await expect
        .poll(async () =>
          (
            await prisma.courseEnrollment.findFirst({
              where: { userId: walker.userId, course: { slug: SLUG.own } },
              select: { sectionsCompleted: true },
            })
          )?.sectionsCompleted
        )
        .toEqual([OWN.first.id]);
      const before = await prisma.courseEnrollment.findFirstOrThrow({
        where: { userId: walker.userId, course: { slug: SLUG.own } },
        select: { sectionsCompleted: true, stagesCompleted: true, completedAt: true, responses: true },
      });

      // Further reading on every lesson, shown to learners.
      for (const lesson of [OWN.first, OWN.second, OWN.worksheet, OWN.reading]) {
        await addLink(SLUG.own, lesson.id, `all-${lesson.id}`);
        await addLink(SLUG.own, lesson.id, `en-${lesson.id}`, { languages: ["en"] });
      }

      // The same place, the same three lessons, the same progress.
      await page.goto(`/en/learner/course/${SLUG.own}`);
      await expect(counter(page)).toHaveText("2 / 3 · Second steps", { timeout: 15_000 });
      expect(
        await prisma.courseEnrollment.findFirstOrThrow({
          where: { userId: walker.userId, course: { slug: SLUG.own } },
          select: { sectionsCompleted: true, stagesCompleted: true, completedAt: true, responses: true },
        })
      ).toEqual(before);

      // The worksheet lesson: its German-only document, shown to an English learner, marked.
      await continueTo(page, 3);
      await expect(counter(page)).toHaveText("3 / 3 · Worksheet");
      const docs = resources(page, en.lesson.resourcesTitle);
      await expect(docs).toContainText(WORKSHEET);
      await expect(docs.getByText(WORKSHEET, { exact: true })).toHaveAttribute("lang", "de");
      await expect(docs).toContainText(en.furtherReading.language.de);

      // Finishing it finishes the course: three lessons, not four.
      await page.getByRole("main").getByRole("button", { name: en.common.continue, exact: true }).filter({ visible: true }).click();
      await expect
        .poll(
          async () =>
            (
              await prisma.courseEnrollment.findFirst({
                where: { userId: walker.userId, course: { slug: SLUG.own } },
                select: { completedAt: true },
              })
            )?.completedAt ?? null,
          { timeout: 15_000 }
        )
        .not.toBeNull();
      const done = await prisma.courseEnrollment.findFirstOrThrow({
        where: { userId: walker.userId, course: { slug: SLUG.own } },
        select: { sectionsCompleted: true },
      });
      expect([...(done.sectionsCompleted as string[])].sort()).toEqual([OWN.first.id, OWN.second.id, OWN.worksheet.id].sort());
    } finally {
      await context.close();
    }
  });

  test("R4-E11: a Greek learner reaches the worksheet lesson too, its German document marked in Greek", async ({ browser }) => {
    const { context, page } = await as(browser, editor);
    try {
      // The preview plays what learners get (D35); a Greek page, the course in English.
      await page.goto(`/el/learner/course/${SLUG.own}?preview=1&lesson=${OWN.worksheet.id}`);
      const docs = resources(page, el.lesson.resourcesTitle);
      await expect(docs).toContainText(WORKSHEET, { timeout: 15_000 });
      await expect(docs.getByText(WORKSHEET, { exact: true })).toHaveAttribute("lang", "de");
      await expect(docs).toContainText(el.furtherReading.language.de);
    } finally {
      await context.close();
    }
  });

  test("R4-E13: deleting a lesson deletes its further reading with it, and no other lesson's", async ({ browser }) => {
    needsReading();
    expect(await linkCount(SLUG.del, DEL.remove.id)).toBe(2);
    const { context, page } = await as(browser, editor);
    try {
      await page.goto(`/en/content/courses/${SLUG.del}`);
      const list = page.getByRole("navigation", { name: /^lessons$/i }).filter({ visible: true });
      await expect(list.getByRole("link").first()).toBeVisible({ timeout: 15_000 });
      const toggle = list.getByRole("button", { name: /^Actions for (\d+\. )?Remove me$/ });
      await expect(async () => {
        if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 2000 });
      }).toPass({ timeout: 15_000 });
      await list.getByRole("group", { name: /^Actions for (\d+\. )?Remove me$/ }).getByRole("button", { name: /^delete$/i }).click();
      const confirm = list.getByRole("group", { name: "Delete “Remove me” in all languages?" });
      // R2: the confirmation lists the further reading that goes with it, drafts included.
      await expect(confirm).toContainText("2 further-reading links");
      await confirm.getByRole("button", { name: /^delete lesson$/i }).click();
      await expect(page.locator("#workspace-announcements").filter({ visible: true })).toHaveText(/^“Remove me” deleted\./, {
        timeout: 15_000,
      });
      await expect.poll(() => linkCount(SLUG.del, DEL.remove.id)).toBe(0);
      expect(await linkCount(SLUG.del, DEL.keep.id)).toBe(1);
      // R2: the log counts them, and names no address.
      const logged = await prisma.auditLog.findFirst({
        where: { action: "section.deleted", entityId: SLUG.del, actorId: editor.userId },
        select: { metadata: true },
      });
      expect(logged?.metadata).toMatchObject({ sectionId: DEL.remove.id, links: 2 });
      expect(JSON.stringify(logged?.metadata)).not.toContain("example.org");
    } finally {
      await context.close();
    }
  });

  test("every further-reading write is a server action the build has, each with its action-table row (spec 10.5)", () => {
    // They became server actions with their rows and the document card that calls them (R2).
    const exported = readingRows.map((r) => (r.kind === "route" ? "" : r.name)).sort();
    expect(exported).toHaveLength(7);
    expect(builtActionsOf(READING)).toEqual(exported);
  });
});

/* ===================================================== Stream R part 2 === */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Is `later` after `earlier` in the document? */
async function follows(earlier: Locator, later: Locator): Promise<boolean> {
  const handle = await later.elementHandle();
  return earlier.evaluate((a, b) => !!(b && a.compareDocumentPosition(b as Node) & Node.DOCUMENT_POSITION_FOLLOWING), handle);
}

/** Every policy violation the browser reports in `context` (Release 3's collector, F-E3). */
async function collectViolations(context: BrowserContext) {
  const reports: { directive: string; blocked: string; page: string }[] = [];
  await context.exposeBinding("__e2eR4CspViolation", (_source, v: { directive: string; blocked: string; page: string }) => {
    reports.push(v);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __e2eR4CspViolation: (v: unknown) => void }).__e2eR4CspViolation({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        page: location.pathname,
      });
    });
  });
  return reports;
}

/** Nothing scrolls sideways on the page as it is now. */
async function expectNoSidewaysScroll(page: Page, where: string) {
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways, `${where}: no sideways scroll`).toBeLessThanOrEqual(0);
}

/** axe's WCAG 2.2 AA rules: none broken in `scope`, and nothing serious or critical anywhere on the page. */
async function expectAxeClean(page: Page, scope: string, where: string) {
  const inScope = await new AxeBuilder({ page }).include(scope).withTags(TAGS).analyze();
  expect(inScope.violations.map((v) => [v.id, v.nodes.map((n) => n.target)]), `${where}: ${scope}`).toEqual([]);
  const all = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = all.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => [v.id, v.nodes.map((n) => n.target)]), `${where}: the whole page`).toEqual([]);
}

describe("Release 4: further reading on the screens that place it (Stream R, part 2)", () => {
  const R2 = {
    sectioned: `e2e-r4-fr2-${RUN}`,
    standard: `e2e-r4-std-${RUN}`,
    stale: `e2e-r4-stale-${RUN}`,
    reflection: `e2e-r4-refl-${RUN}`,
  };
  const STALE = { stay: { id: ownLessonId(), label: { en: "Stay" } }, go: { id: ownLessonId(), label: { en: "Go" } } };
  let sectioned: R4Course;
  let staffer: Person;
  let reader: Person;
  let deReader: Person;
  let r2Tables: R4Tables;
  const people = {
    staffer: `e2e-r4-fr2-editor-${RUN}@example.com`,
    reader: `e2e-r4-fr2-learner-${RUN}@example.com`,
    deReader: `e2e-r4-fr2-german-${RUN}@example.com`,
  };
  /** Release 4's database: the test can't add further reading without its table. */
  const needsTables = () => {
    expect(r2Tables.links, "the database has further-reading links (LessonLink)").toBe(true);
    expect(r2Tables.documentLanguages, "documents have languages (LessonDocument.languages)").toBe(true);
  };

  test.beforeAll(async () => {
    await removePeople(prisma, Object.values(people));
    r2Tables = await r4Tables(prisma);
    staffer = await createPerson(prisma, { email: people.staffer, roles: ["CONTENT_EDITOR"], organisation: "A" });
    reader = await createPerson(prisma, { email: people.reader, roles: ["LEARNER"] });
    deReader = await createPerson(prisma, { email: people.deReader, roles: ["LEARNER"] });
    // German not switched on: a /de learner gets the course text in English.
    sectioned = await seedR4Course(prisma, { slug: R2.sectioned });
    const text = (title: string) => narrative({ en: { title, text: `E2E: ${title}.` } });
    await seedECourse(prisma, {
      slug: R2.standard,
      title: { en: `E2E R4 standard ${RUN}` },
      lessons: [{ id: "context", narrative: text("The standard lesson") }],
    });
    await seedECourse(prisma, {
      slug: R2.stale,
      title: { en: `E2E R4 stale ${RUN}` },
      status: "draft",
      lessons: [
        { ...STALE.stay, narrative: text("Staying") },
        { ...STALE.go, narrative: text("Going") },
      ],
    });
    await seedECourse(prisma, {
      slug: R2.reflection,
      title: { en: `E2E R4 reflection ${RUN}` },
      status: "draft",
      lessons: [{ id: "context", narrative: text("Context") }, { id: "reflection" }],
    });
    if (r2Tables.links) {
      await addLink(R2.standard, "context", "std", { title: `E2E R4 standard reading ${RUN}`, url: `https://example.org/${RUN}/std` });
    }
  });

  test.afterAll(async () => {
    const ids = [staffer, reader, deReader].filter(Boolean).map((p) => p.userId);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await removeR4Course(prisma, R2.sectioned);
    for (const slug of [R2.standard, R2.stale, R2.reflection]) await removeECourse(prisma, slug);
    await removePeople(prisma, Object.values(people));
  });

  /** The lesson's section on the course page, opened. */
  async function openLesson(page: Page, slug: string, key: string, locale = "en") {
    await page.goto(`/${locale}/content/courses/${slug}?lesson=${key}`);
    const lesson = page.locator(`#lesson-${key}`).filter({ visible: true });
    await expect(lesson.getByRole("heading", { name: "Documents and further reading" })).toBeVisible({ timeout: 20_000 });
    return lesson;
  }

  /** Presses "Add a link" once the page has taken over (the form appears). */
  async function openLinkForm(lesson: Locator) {
    const form = lesson.getByRole("group", { name: "Add a link", exact: true });
    await expect(async () => {
      if (!(await form.isVisible())) await lesson.getByRole("button", { name: "Add a link", exact: true }).click();
      await expect(form).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    return form;
  }

  test("R4-E9 (R2): an editor adds a link in the document card; a draft is in neither the learner's page nor its data; shown, it follows the lesson's text, before Continue; hidden again, it's gone", async ({
    browser,
  }) => {
    needsTables();
    const title = `E2E R4 added ${RUN}`;
    const url = `https://example.org/${RUN}/added`;
    const staff = await as(browser, staffer);
    const learnerSide = await as(browser, reader);
    try {
      const lesson = await openLesson(staff.page, R2.sectioned, sectioned.lessons.one);
      // "Add a link" sits next to "Upload document", and the links follow the documents.
      expect(await follows(lesson.getByText("Upload document", { exact: true }), lesson.getByRole("button", { name: "Add a link", exact: true }))).toBe(true);
      expect(await follows(lesson.getByText(sectioned.documents.all.name).first(), lesson.getByRole("heading", { name: "Further reading", level: 4 }))).toBe(true);

      const form = await openLinkForm(lesson);
      await form.getByLabel("Title").fill(title);
      await form.getByLabel("Web address").fill(url);
      await form.getByRole("button", { name: "Save", exact: true }).click();
      await expect(lesson.getByText("Added as a draft — learners can't see it until you choose “Show to learners”.")).toBeVisible();
      const row = lesson.getByRole("listitem").filter({ has: staff.page.getByRole("link", { name: new RegExp(`^${title}`) }) });
      await expect(row).toContainText("Draft — hidden from learners");

      const path = `/en/learner/course/${R2.sectioned}`;
      let html = await served(learnerSide.page, path);
      expect(html).not.toContain(title);
      expect(html).not.toContain(url);

      await lesson.getByRole("button", { name: `Show to learners: ${title}` }).click();
      await expect(lesson.getByText(`“${title}” is shown to learners.`)).toBeVisible();
      html = await served(learnerSide.page, path);
      expect(html).toContain(url);
      // In the lesson's card: after its text, before Continue, a link that opens a new tab, with its site.
      const page = learnerSide.page;
      const list = page.getByRole("region", { name: en.furtherReading.title, exact: true }).filter({ visible: true });
      const link = list.getByRole("link", { name: `${title}, example.org (opens in a new tab)` });
      await expect(link).toBeVisible({ timeout: 15_000 });
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("href", url);
      const continueButton = page.getByRole("main").getByRole("button", { name: en.common.continue, exact: true }).filter({ visible: true });
      expect(await follows(page.getByText("before the next lesson.").first(), list), "after the lesson's text").toBe(true);
      expect(await follows(list, continueButton), "before Continue").toBe(true);

      await lesson.getByRole("button", { name: `Hide from learners: ${title}` }).click();
      await expect(lesson.getByText(`“${title}” is hidden from learners.`)).toBeVisible();
      html = await served(page, path);
      expect(html).not.toContain(title);
      expect(html).not.toContain(url);
    } finally {
      await staff.context.close();
      await learnerSide.context.close();
    }
  });

  test("R4-E9 (R2): a standard lesson's further reading follows the stage, its Continue included", async ({ browser }) => {
    needsTables();
    const { context, page } = await as(browser, reader);
    try {
      await page.goto(`/en/learner/course/${R2.standard}`);
      const list = page.getByRole("region", { name: en.furtherReading.title, exact: true }).filter({ visible: true });
      await expect(list.getByRole("link", { name: `E2E R4 standard reading ${RUN}, example.org (opens in a new tab)` })).toBeVisible({
        timeout: 15_000,
      });
      const continueButton = page.getByRole("main").getByRole("button", { name: en.common.continue, exact: true }).filter({ visible: true });
      expect(await follows(page.getByText("E2E: The standard lesson.").first(), list)).toBe(true);
      expect(await follows(continueButton, list), "the list is the last thing in the lesson").toBe(true);
    } finally {
      await context.close();
    }
  });

  test("R4-E11 (R2): a /de learner on a course still shown in English gets the English text, the English-only items, and the German-only items marked \"In German\"", async ({
    browser,
  }) => {
    needsTables();
    const { context, page } = await as(browser, deReader);
    try {
      const html = await served(page, `/de/learner/course/${R2.sectioned}`);
      const links = sectioned.links!;
      // The course text is English: its own language's items, and every language's, and the page's language's.
      expect(html).toContain(links.en.url);
      expect(html).toContain(links.shown.url);
      expect(html).toContain(links.de.url);
      expect(html).not.toContain(links.hidden.url);
      const docs = resources(page, de.lesson.resourcesTitle);
      await expect(docs).toContainText(sectioned.documents.en.name, { timeout: 15_000 });
      await expect(docs).toContainText(sectioned.documents.all.name);
      await expect(docs.getByText(sectioned.documents.de.name, { exact: true })).toHaveAttribute("lang", "de");
      await expect(docs).toContainText(de.furtherReading.language.de);
      const list = page.getByRole("region", { name: de.furtherReading.title, exact: true }).filter({ visible: true });
      const german = list.getByRole("listitem").filter({ hasText: "R4 Lektüre auf Deutsch" });
      await expect(german.locator('[lang="de"]').first()).toHaveText("R4 Lektüre auf Deutsch");
      await expect(german).toContainText(de.furtherReading.language.de);
      // The English-only link reads in the course text's language, unmarked.
      const english = list.getByRole("listitem").filter({ hasText: "R4 English reading" });
      await expect(english).not.toContainText(de.furtherReading.language.en);
    } finally {
      await context.close();
    }
  });

  test("R4-E11 (R2): a document's languages are set on its row in the card, and learners follow them", async ({ browser }) => {
    needsTables();
    const staff = await as(browser, staffer);
    const learnerSide = await as(browser, reader);
    const document = sectioned.documents.all;
    try {
      const lesson = await openLesson(staff.page, R2.sectioned, sectioned.lessons.one);
      const control = lesson.getByRole("button", { name: `Languages: ${document.name}` });
      const boxes = lesson.getByRole("group", { name: `Languages of “${document.name}”` });
      await expect(async () => {
        if (!(await boxes.isVisible())) await control.click();
        await expect(boxes).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 20_000 });
      await boxes.getByLabel("English").uncheck();
      await boxes.getByLabel("Greek").uncheck();
      await boxes.getByRole("button", { name: "Save", exact: true }).click();
      await expect(lesson.getByText(`“${document.name}” is for German learners.`)).toBeVisible();
      const row = lesson.getByRole("listitem").filter({ hasText: document.name });
      await expect(row).toContainText("German");
      await expect(control).toBeFocused();
      await expect
        .poll(async () => (await prisma.lessonDocument.findUnique({ where: { id: document.id }, select: { languages: true } }))?.languages)
        .toEqual(["de"]);
      const html = await served(learnerSide.page, `/en/learner/course/${R2.sectioned}`);
      expect(html).not.toContain(document.name);
    } finally {
      await prisma.$executeRaw`UPDATE "LessonDocument" SET "languages" = ARRAY[]::text[] WHERE "id" = ${document.id}`;
      await staff.context.close();
      await learnerSide.context.close();
    }
  });

  test("R4-E13 (R2): a page opened before a further-reading link was added can't delete the lesson unseen", async ({ browser }) => {
    needsTables();
    const { context, page } = await as(browser, staffer);
    try {
      await page.goto(`/en/content/courses/${R2.stale}`);
      const list = page.getByRole("navigation", { name: /^lessons$/i }).filter({ visible: true });
      await expect(list.getByRole("link").first()).toBeVisible({ timeout: 15_000 });
      // A colleague adds a link to "Go" meanwhile.
      await addLink(R2.stale, STALE.go.id, "stale");
      const toggle = list.getByRole("button", { name: /^Actions for (\d+\. )?Go$/ });
      await expect(async () => {
        if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 2000 });
      }).toPass({ timeout: 15_000 });
      await list.getByRole("group", { name: /^Actions for (\d+\. )?Go$/ }).getByRole("button", { name: /^delete$/i }).click();
      const confirm = list.getByRole("group", { name: "Delete “Go” in all languages?" });
      await confirm.getByRole("button", { name: /^delete lesson$/i }).click();
      await expect(page.getByText(en.lessonList.delete.changed).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
      expect(await linkCount(R2.stale, STALE.go.id)).toBe(1);
      expect(await prisma.lesson.count({ where: { projectId: PROJECT, courseSlug: R2.stale, stageKey: STALE.go.id } })).toBe(1);
    } finally {
      await context.close();
    }
  });

  test("R4-E6b: a reflection lesson's introduction over the limit is refused by its name: \"Shorten it.\"", async ({ request }) => {
    const answer = await callAction(request, {
      as: staffer,
      page: `/en/content/courses/${R2.reflection}`,
      file: "src/app/actions/lesson.ts",
      name: "saveLessonNarrative",
      args: [R2.reflection, "reflection", "en", { title: "R4 reflection", blocks: [{ kind: "paragraph", text: "x".repeat(10_001) }] }, null],
    });
    expect(answer.result, answer.raw.slice(0, 300)).toEqual({
      ok: false,
      error: "invalid",
      issues: ["The introduction is too long — at most 10,000 characters. Shorten it."],
    });
  });

  for (const [locale, messages] of [
    ["en", en],
    ["de", de],
    ["el", el],
  ] as const) {
    test(`R4-E14 (${locale}): a lesson with named links and further reading, at 320 px: axe clean, no sideways scroll, no policy violation`, async ({
      browser,
    }) => {
      needsTables();
      const context = await browser.newContext();
      const violations = await collectViolations(context);
      await signIn(context, reader.sessionToken);
      const page = await context.newPage();
      try {
        await page.setViewportSize({ width: 320, height: 640 });
        const response = await page.goto(`/${locale}/learner/course/${R2.sectioned}`);
        expect(response?.headers()["content-security-policy"], "an enforced policy").toBeTruthy();
        const list = page.getByRole("region", { name: messages.furtherReading.title, exact: true }).filter({ visible: true });
        await expect(list).toBeVisible({ timeout: 15_000 });
        await expect(list.locator(".seq-link-site").first()).toBeVisible();
        await expectNoSidewaysScroll(page, `${locale} learner`);
        // Every title link and its site stay on the screen.
        for (const link of await list.getByRole("link").all()) {
          const box = await link.boundingBox();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(320);
        }
        await expectAxeClean(page, "main", `${locale} learner`);
        expect(violations, "no policy violation").toEqual([]);
      } finally {
        await context.close();
      }
    });

    test(`R4-E14 (${locale}): the document card with its link form, at 320 px and on a desktop: axe clean, no sideways scroll, no policy violation`, async ({
      browser,
    }) => {
      needsTables();
      const context = await browser.newContext();
      const violations = await collectViolations(context);
      await signIn(context, staffer.sessionToken);
      const page = await context.newPage();
      try {
        for (const width of [1280, 320]) {
          await page.setViewportSize({ width, height: 800 });
          const lesson = await openLesson(page, R2.sectioned, sectioned.lessons.one, locale);
          await openLinkForm(lesson);
          await expectNoSidewaysScroll(page, `${locale} card at ${width}`);
          await expectAxeClean(page, `#lesson-${sectioned.lessons.one}`, `${locale} card at ${width}`);
        }
        expect(violations, "no policy violation").toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  test("R4-E14: the link list by keyboard: a move and a publish toggle keep the focus on the row, and the status line says where the link went", async ({
    browser,
  }) => {
    needsTables();
    const staff = await as(browser, staffer);
    const ids = [await addLink(R2.sectioned, sectioned.lessons.one, "key-1", { title: `E2E R4 keyboard one ${RUN}`, published: false })];
    try {
      const lesson = await openLesson(staff.page, R2.sectioned, sectioned.lessons.one);
      const down = lesson.getByRole("button", { name: `Move “${sectioned.links!.shown.title}” down` });
      await expect(async () => {
        await down.focus();
        await staff.page.keyboard.press("Enter");
        await expect(lesson.getByText(/^Moved “R4 shown reading” to position 2 of \d+\.$/)).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 20_000 });
      await expect(lesson.getByRole("button", { name: `Move “${sectioned.links!.shown.title}” down` })).toBeFocused();
      const show = lesson.getByRole("button", { name: `Show to learners: E2E R4 keyboard one ${RUN}` });
      await show.focus();
      await staff.page.keyboard.press("Enter");
      await expect(lesson.getByText(`“E2E R4 keyboard one ${RUN}” is shown to learners.`)).toBeVisible();
      await expect(lesson.getByRole("button", { name: `Hide from learners: E2E R4 keyboard one ${RUN}` })).toBeFocused();
      // Each arrow is a 24 × 24 target (WCAG 2.5.8).
      const box = await down.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(24);
      expect(box!.height).toBeGreaterThanOrEqual(24);
    } finally {
      await prisma.$executeRaw`DELETE FROM "LessonLink" WHERE "id" = ANY(${ids}::text[])`;
      await staff.context.close();
    }
  });
});

/* -------------------------------------------- the action table's rows --- */

describe("Release 4: the further-reading actions refuse who they must, and change nothing (spec 10.5, R4-E6)", () => {
  let world: World;
  let r4: R4Course;
  let other: OtherProject;
  const R4_SLUG = `e2e-r4b-table-${RUN}`;
  const OTHER_SLUG = `e2e-r4b-other-${RUN}`;
  const FULL = { id: ownLessonId(), label: { en: "Thirty links" } };

  test.beforeAll(async () => {
    world = await createWorld(prisma);
    r4 = await seedR4Course(prisma, { slug: R4_SLUG });
    other = await seedOtherProject(prisma, { slug: OTHER_SLUG });
  });

  test.afterAll(async () => {
    if (world) await removeWorld(prisma, world);
    await removeR4Course(prisma, R4_SLUG);
    await removeOtherCourse(prisma, OTHER_SLUG);
  });

  const ctx = (who: Persona): Ctx => ({
    world,
    as: who,
    target: world.people[targetOf(who)],
    other: world.organisations[otherOrganisationOf(who)],
    run: world.run,
  });
  const caller = (who: Persona) => (who === "anonymous" ? null : world.people[who]);
  const page = `/en/content/courses/${R4_SLUG}`;

  /** A checksum of every Lesson, LessonLink and LessonDocument row of the R4 course and the other project's course. */
  async function rowsSum(): Promise<string> {
    const [row] = await prisma.$queryRaw<{ sum: string }[]>`
      SELECT coalesce(md5(string_agg(x, ',' ORDER BY x)), '') AS sum FROM (
        SELECT md5(l::text) AS x FROM "Lesson" l WHERE l."courseSlug" IN (${R4_SLUG}, ${OTHER_SLUG})
        UNION ALL SELECT md5(k::text) FROM "LessonLink" k JOIN "Lesson" l ON l."id" = k."lessonId" WHERE l."courseSlug" IN (${R4_SLUG}, ${OTHER_SLUG})
        UNION ALL SELECT md5(d::text) FROM "LessonDocument" d JOIN "Lesson" l ON l."id" = d."lessonId" WHERE l."courseSlug" IN (${R4_SLUG}, ${OTHER_SLUG})
      ) s`;
    return row.sum;
  }

  const call = (request: APIRequestContext, who: Person, name: string, args: unknown[]): Promise<ActionAnswer> =>
    callAction(request, { as: who, page, file: READING, name, args });

  for (const row of readingRows.filter((r): r is CallRow => r.kind === "call")) {
    for (const who of row.refuse) {
      test(`${row.name} refuses ${who}${guardLabel(row, who)}`, async ({ request }) => {
        const c = ctx(who);
        const before = await snapshot(prisma, world, row.tables);
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
        expect(await snapshot(prisma, world, row.tables), `${row.name} as ${who} changed nothing`).toEqual(before);
      });
    }
  }

  test("R4-E6 (guard): every hostile address sent through addLessonLink and updateLessonLink is refused by name, and nothing changes", async ({
    request,
  }) => {
    expect((await r4Tables(prisma)).links, "the database has further-reading links (LessonLink)").toBe(true);
    const EA = world.people.EA;
    const linkId = r4.links!.shown.id;
    for (const h of HOSTILE_ADDRESSES) {
      const wanted =
        typeof h.href === "string" ? { ok: false, error: "invalid", field: "url", reason: h.reason } : { ok: false, error: "bad-input" };
      const before = await rowsSum();
      const started = Date.now();
      const added = await call(request, EA, "addLessonLink", [R4_SLUG, r4.lessons.one, { title: "The guide", url: h.href }]);
      expect(added.result, `addLessonLink: ${h.name}`).toEqual(wanted);
      const updated = await call(request, EA, "updateLessonLink", [
        linkId,
        { title: "The guide", url: h.href, description: "", languages: [] },
      ]);
      expect(updated.result, `updateLessonLink: ${h.name}`).toEqual(wanted);
      expect(Date.now() - started, `${h.name}: answered in the actions' normal time`).toBeLessThan(10_000);
      expect(await rowsSum(), `${h.name}: nothing changed`).toBe(before);
    }
    for (const title of MISLEADING_TITLES) {
      const before = await rowsSum();
      const wanted = { ok: false, error: "invalid", field: "title", reason: "misleading" };
      expect((await call(request, EA, "addLessonLink", [R4_SLUG, r4.lessons.one, { title, url: MISLEADING_TITLE_URL }])).result, title).toEqual(wanted);
      expect(
        (await call(request, EA, "updateLessonLink", [linkId, { title, url: MISLEADING_TITLE_URL, description: "", languages: [] }])).result,
        title
      ).toEqual(wanted);
      expect(await rowsSum(), `${title}: nothing changed`).toBe(before);
    }
  });

  test("an editor's and a partner admin's bad arguments are refused, and change nothing", async ({ request }) => {
    expect((await r4Tables(prisma)).links, "the database has further-reading links (LessonLink)").toBe(true);
    // A lesson of the course's own with 30 links already: the 31st is refused.
    await prisma.$executeRaw`
      UPDATE "Course" SET "outline" = jsonb_set("outline", '{sections}', "outline"->'sections' || ${JSON.stringify([{ id: FULL.id, template: "text" }])}::jsonb)
       WHERE "projectId" = ${PROJECT} AND "slug" = ${R4_SLUG}`;
    await prisma.lesson.create({ data: { projectId: PROJECT, courseSlug: R4_SLUG, stageKey: FULL.id }, select: { id: true } });
    for (let i = 0; i < LINK_LIMITS.perLesson; i++) await addLink(R4_SLUG, FULL.id, `full-${i}`, { published: false });
    const links = r4.links!;
    for (const who of ["EA", "PAA"] as const) {
      const person = world.people[who];
      const cases: [string, string, unknown[], unknown][] = [
        ["a 201-character title", "addLessonLink", [R4_SLUG, r4.lessons.one, { title: "t".repeat(201), url: "https://example.org/x" }], { ok: false, error: "invalid", field: "title", reason: "too-long" }],
        ["a 301-character description", "addLessonLink", [R4_SLUG, r4.lessons.one, { title: "T", url: "https://example.org/x", description: "d".repeat(301) }], { ok: false, error: "invalid", field: "description", reason: "too-long" }],
        ["the 31st link", "addLessonLink", [R4_SLUG, FULL.id, { title: "T", url: "https://example.org/x" }], { ok: false, error: "too-many" }],
        ["a lesson not in the list", "addLessonLink", [R4_SLUG, "s-zzzzzzzz", { title: "T", url: "https://example.org/x" }], { ok: false, error: "not-a-section" }],
        ["a lesson of another project", "addLessonLink", [OTHER_SLUG, other.stageKey, { title: "T", url: "https://example.org/x" }], { ok: false, error: "not-found" }],
        ["a link of another project", "updateLessonLink", [other.linkId, { title: "T", url: "https://example.org/x", description: "", languages: [] }], { ok: false, error: "not-found" }],
        ["a link of another project", "removeLessonLink", [other.linkId], { ok: false, error: "not-found" }],
        ["a link of another project", "setLessonLinkPublished", [other.linkId, false], { ok: false, error: "not-found" }],
        ["an id of another lesson", "setLessonLinkOrder", [R4_SLUG, r4.lessons.two, [links.shown.id]], { ok: false, error: "not-found" }],
        ["a missing id", "setLessonLinkOrder", [R4_SLUG, r4.lessons.one, [links.shown.id, links.hidden.id, links.de.id]], { ok: false, error: "not-found" }],
        ["ids of another project", "setLessonLinkOrder", [OTHER_SLUG, other.stageKey, [other.linkId]], { ok: false, error: "not-found" }],
        ["a language that isn't one", "setLessonDocumentLanguages", [r4.documents.all.id, ["fr"]], { ok: false, error: "bad-input" }],
        ["languages that aren't a list", "setLessonDocumentLanguages", [r4.documents.all.id, "de"], { ok: false, error: "bad-input" }],
        ["a document of another project", "setLessonDocumentLanguages", [other.documentId, ["de"]], { ok: false, error: "not-found" }],
      ];
      for (const [what, name, args, wanted] of cases) {
        const before = await rowsSum();
        const answer = await call(request, person, name, args);
        expect(answer.error, `${who}, ${name}, ${what}: ${answer.raw.slice(0, 200)}`).toBeUndefined();
        expect(answer.result, `${who}, ${name}, ${what}`).toEqual(wanted);
        expect(await rowsSum(), `${who}, ${name}, ${what}: nothing changed`).toBe(before);
      }
      // Reading another project's lesson gives nothing.
      expect((await call(request, person, "getLessonLinks", [OTHER_SLUG, other.stageKey])).result).toEqual({ links: [] });
    }
  });

  test("editors, partner admins and ADMINs add, change, order, show, hide and remove a link, and set a document's languages (positive controls), each audited", async ({
    request,
  }) => {
    expect((await r4Tables(prisma)).links, "the database has further-reading links (LessonLink)").toBe(true);
    for (const who of ["EA", "PAA", "AD", "AS"] as const) {
      const person = world.people[who];
      const added = await call(request, person, "addLessonLink", [R4_SLUG, r4.lessons.two, { title: `${who} reading`, url: `https://example.org/${who}`, languages: ["de"] }]);
      expect(added.result, who).toMatchObject({ ok: true, id: expect.any(String) });
      const id = (added.result as { id: string }).id;
      const row = await prisma.lessonLink.findUniqueOrThrow({ where: { id }, select: { published: true, languages: true } });
      expect(row, `${who}: a draft, for German`).toEqual({ published: false, languages: ["de"] });
      expect((await call(request, person, "updateLessonLink", [id, { title: `${who} reading 2`, url: `https://example.org/${who}/2`, description: "", languages: [] }])).result).toEqual({ ok: true });
      expect((await call(request, person, "setLessonLinkOrder", [R4_SLUG, r4.lessons.two, [id]])).result).toEqual({ ok: true });
      expect((await call(request, person, "setLessonLinkPublished", [id, true])).result).toEqual({ ok: true });
      expect((await call(request, person, "setLessonLinkPublished", [id, false])).result).toEqual({ ok: true });
      const read = (await call(request, person, "getLessonLinks", [R4_SLUG, r4.lessons.two])).result as { links: { id: string; title: string }[] };
      expect(read.links.map((l) => [l.id, l.title])).toEqual([[id, `${who} reading 2`]]);
      expect((await call(request, person, "removeLessonLink", [id])).result).toEqual({ ok: true });
      expect((await call(request, person, "setLessonDocumentLanguages", [r4.documents.all.id, ["el"]])).result).toEqual({ ok: true });
      expect((await call(request, person, "setLessonDocumentLanguages", [r4.documents.all.id, []])).result).toEqual({ ok: true });
      const audit = await prisma.auditLog.findMany({ where: { actorId: person.userId }, orderBy: { createdAt: "asc" }, select: { action: true, metadata: true } });
      expect(audit.map((a) => a.action)).toEqual([
        "link.added",
        "link.updated",
        "link.reordered",
        "link.published",
        "link.unpublished",
        "link.removed",
        "document.languages_changed",
        "document.languages_changed",
      ]);
      // Never a title or an address.
      expect(JSON.stringify(audit)).not.toMatch(/reading|example\.org/);
    }
  });
});
