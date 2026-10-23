import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import ts from "typescript";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, removePeople, runId, signIn, type Person } from "./fixtures/people";
import { PROJECT, narrative, ownLessonId, type R2LessonSeed } from "./fixtures/r2-course";
import { removeECourse, seedECourse } from "./fixtures/r3-e-course";
import { STORED_LINK_URLS } from "./fixtures/r4-hostile-links";
import { r4Tables, removeR4Course, seedDocuments, seedR4Course, type R4Course, type R4Tables } from "./fixtures/r4-course";
import { builtActionsOf } from "./fixtures/server-action";
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
 * The parts that come with the screens that place them (spec 9.3, R2): the
 * list drawn after the lesson's text and in the standard lessons' slot,
 * the link manager in the document card and its direct calls, a /de
 * learner's German-only items on a course still shown in English, and the
 * delete confirmation's count.
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
      await confirm.getByRole("button", { name: /^delete lesson$/i }).click();
      await expect(page.locator("#workspace-announcements").filter({ visible: true })).toHaveText(/^“Remove me” deleted\./, {
        timeout: 15_000,
      });
      await expect.poll(() => linkCount(SLUG.del, DEL.remove.id)).toBe(0);
      expect(await linkCount(SLUG.del, DEL.keep.id)).toBe(1);
    } finally {
      await context.close();
    }
  });

  test("(guard) no request reaches the further-reading writes before their action-table rows exist (D102)", () => {
    // They become server actions with their rows and the screen that calls them.
    expect(builtActionsOf(READING)).toEqual([]);
  });
});
