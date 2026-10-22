import { test, expect, type Locator } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, removePeople, runId, signIn, type Person } from "./fixtures/people";

/**
 * Release 3 (WCAG 3.1.2, D99): the English-only editors inside Manage
 * courses and Create courses — a lesson's video, its documents, its text and
 * content blocks (with the text editor's toolbar), and the Comp Card's
 * wording — stay English under /de and /el, so their words are marked
 * lang="en", as the admin screens' are (70f2c1a). What is written in them is
 * marked with its own language: a lesson's text and the Comp Card's wording
 * with the language being edited; a video's text and a document's name,
 * whose language no one records, keep the page's, as the lesson's read view
 * shows them. The page's own, translated words stay unmarked.
 *
 * Red on the build before (every editor's English unmarked). Reads only:
 * the built-in course's lesson and the shared templates are opened, never
 * saved. Requires a real database — gated on E2E_DB=1.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;

const RUN = runId();

/** The language `locator`'s text is read in: the nearest lang attribute, the page's own included. */
const langOf = (locator: Locator) =>
  locator.evaluate((el) => el.closest("[lang]")?.getAttribute("lang") ?? null);

describe("the English editors of Manage courses and Create courses are marked English (WCAG 3.1.2)", () => {
  let editor: Person;

  test.beforeAll(async () => {
    editor = await createPerson(prisma, { email: `e2e-r3-editor-lang-${RUN}@example.com`, roles: ["CONTENT_EDITOR"] });
  });

  test.afterAll(async () => {
    await removePeople(prisma, [editor?.email].filter(Boolean) as string[]);
  });

  test("a lesson's video, documents and text: their words English, the text written in them in its own language", async ({
    page,
    context,
  }) => {
    await signIn(context, editor.sessionToken);
    // German menus, Greek content.
    await page.goto("/de/content/courses/workplace-conflict?lang=el&lesson=concept");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    // The lesson as shown. While the page streams in, React may render it
    // itself and leave the server's copy for a moment in a hidden <div> at
    // the end of the page (5a6b7a1): only the copy shown counts, and there
    // is one, with one video editor in it. The editors' words below are read
    // without .first(), so a second editor shown would fail them.
    const lesson = page.locator("#lesson-concept").filter({ visible: true });
    await expect(lesson).toHaveCount(1);
    const video = lesson.getByRole("heading", { name: "Interactive video" });
    await expect(video).toHaveCount(1);

    // The editors' own words: English, marked.
    expect(await langOf(video), "the video editor").toBe("en");
    expect(await langOf(lesson.getByRole("button", { name: "Upload file" })), "the video editor's tabs").toBe("en");
    expect(await langOf(lesson.getByRole("heading", { name: "Lesson documents" })), "the documents").toBe("en");
    const text = lesson.getByRole("heading", { name: "Lesson text (Greek)" });
    expect(await langOf(text), "the lesson text editor").toBe("en");
    expect(await langOf(lesson.getByRole("button", { name: "Add block", exact: true })), "the content blocks").toBe("en");

    // The page's own words, translated: unmarked (the page's language).
    expect(await langOf(lesson.getByRole("link", { name: "Vorschau dieser Lektion" })), "the page's words").toBe("de");

    // What is written in them: the lesson's text in the language being
    // edited; the video's text in the page's (no one records its language).
    expect(await langOf(lesson.getByLabel("Lesson title")), "the lesson's title").toBe("el");
    const block = lesson.locator('[role="button"][data-block-field]').first();
    expect(await langOf(block.locator("[id$='-text']")), "a block's text").toBe("el");
    expect(await langOf(lesson.getByLabel("Title", { exact: true })), "the video's title").toBe("de");
    expect(await langOf(lesson.locator('option[value="de"]').first()), "a language's name").toBe("de");

    // A block opened in the text editor: its text Greek, the toolbar English.
    await block.click();
    const box = lesson.locator('[contenteditable="true"]').first();
    await expect(box).toBeVisible();
    expect(await langOf(box), "the text being written").toBe("el");
    const toolbar = lesson.getByRole("toolbar").first();
    expect(await langOf(toolbar), "the text editor's toolbar").toBe("en");
    expect(await langOf(lesson.getByText(/^Tip: paste from Word/).first()), "the text editor's tip").toBe("en");
  });

  test("the Comp Card's wording: its words English, the wording in the language picked", async ({ page, context }) => {
    await signIn(context, editor.sessionToken);
    await page.goto("/de/content");
    const panel = page.getByRole("region", { name: "Comp Card wording" });
    await expect(panel).toBeVisible();
    expect(await langOf(panel), "the panel").toBe("en");
    expect(await langOf(page.getByRole("heading", { name: "Gemeinsame Vorlagen" })), "the page's words").toBe("de");

    const firstQuestion = panel.getByLabel("Question").first();
    await expect(firstQuestion).toBeVisible();
    expect(await langOf(firstQuestion), "English wording").toBe("en");
    expect(await langOf(panel.locator('option[value="el"]')), "a language's name").toBe("el");

    await panel.getByRole("combobox", { name: "Comp Card language" }).selectOption("de");
    await expect.poll(() => langOf(panel.getByLabel("Question").first())).toBe("de");
    expect(await langOf(panel.getByLabel("Hint shown in the box").first()), "German wording").toBe("de");
  });
});
