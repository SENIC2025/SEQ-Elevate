import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, removePeople, runId, signIn } from "./fixtures/people";
import { ownLessonId, parts, partId, PROJECT } from "./fixtures/r2-course";
import { removeECourse, seedECourse } from "./fixtures/r3-e-course";
import {
  ACCEPTED_LABELS,
  HOSTILE_ADDRESSES,
  HOSTILE_MARKS,
  RENDER_ONLY_MARKS,
  linkedParagraph,
  overLimitDoc,
  paragraphDoc,
  richBlock,
} from "./fixtures/r4-hostile-links";
import { callAction } from "./fixtures/server-action";
import { LINK_INPUTS } from "@/lib/rich-text/link-fixtures";
import { toLinkInput } from "@/lib/rich-text/link-text";
import { checkLinkHref, emailAddressOf, isEmailAddress, type LinkRefusal } from "@/lib/rich-text/link-url";
import { addressProblem } from "@/lib/rich-text/sanitize";
import de from "../src/messages/de.json";

/**
 * Release 4, Part A (spec 3, 10.2, 10.3): named links in lesson text.
 *
 *   R4-E1  keyboard only: select words, Ctrl+K, an address, Enter, Save; the
 *          learner gets a link that opens in a new tab; stored as version 2,
 *          the mark holding its address only, the text naming it.
 *   R4-E1b a word selected with the space after it, and new words with
 *          blanks around them: the blanks stay in the text, outside the
 *          link, in the editor and stored; the learner's box after the
 *          words is parted from the next word.
 *   R4-E2 an http address: the warning is announced once, "Will open: …"
 *          describes the field (not a live region); the learner's link opens
 *          http under Release 3's headers.
 *   R4-E3  the form refuses what can't be a link, by name, announced each
 *          time; focus; Escape; a bare email address and host are
 *          completed, never blocked; the "Link: …" line; Ctrl+K on words
 *          across paragraphs says why it can't link them.
 *   R4-E3b the form's "Text to show" carries the language the text is
 *          written in, in a reflection lesson's introduction and in a
 *          paragraph; the address and the form's own words keep the
 *          editor's English (WCAG 3.1.2).
 *   R4-E5  email links, named and typed, keep target="_blank" and say
 *          "(opens your email program)"; web links "(opens in a new tab)";
 *          in the interface language, marked with it inside course text in
 *          another language (D105).
 *   R4-E6  (guard) every hostile address and mark sent straight to
 *          saveLessonNarrative and savePartText is refused by name (extra
 *          attributes: stored without them), and nothing changes; so are
 *          links read with the text touching them (WORD_MARKS). Each
 *          misleading label is one D104 refuses as narrowed on 22 October
 *          2026; the box after a link's words covers the rest (R4-E15).
 *   R4-E6c link text with a dot that shows no other site (ACCEPTED_LABELS:
 *          an abbreviation or a title, a Greek word, a person's email
 *          address, the link's registrable domain or its www. host), and
 *          link text D104 no longer refuses (NARROWED_LABELS: a file's name,
 *          a name in capitals), is saved with its link, through both
 *          actions.
 *   R4-E6b a reflection lesson's introduction over the limit is refused by
 *          its name, "The introduction is too long … Shorten it.", as its
 *          editor's problem line says (with R2's saveLessonNarrative).
 *   R4-E7  (guard) hostile links written straight into the database: no page
 *          draws an href outside https, http and mailto, nor one whose text
 *          shows another address; the text of every refused link shows; the
 *          editor opens them safely and names the links it left out. The
 *          ACCEPTED_LABELS and NARROWED_LABELS are drawn as links, the
 *          latter with the site they open.
 *   R4-E7b editing a link's text into another address: named at once, Save
 *          refused by name, nothing stored without the link; the words go
 *          to Save beside the text, so an older save keeps them.
 *   R4-E8  international and percent-encoded addresses: the same href from
 *          the server and after hydration, no hydration warning, hosts the
 *          engines read differently never a link; link text whose name the
 *          engines' URL parsers read differently ("xn--a.paypal.com") is
 *          read alike: no link from the server nor after hydration; the
 *          address check answers alike in the browser (the Link form) and on
 *          the server.
 *   R4-E15 the site each named link opens, in a box after its words and
 *          inside the link: heard as "words, site (opens in a new tab)",
 *          left out only when the words are the link's address, an email
 *          link's its address's domain; on one line beside right-to-left
 *          words and after long ones, never past the edge at 320 px
 *          (zoomed 200 %), in forced colours, with the platform's high
 *          contrast and large text, and with text zoomed 200 %; axe-clean.
 *   R4-E15b (guard) no character in or around a named link moves its box
 *          away from its words: right-to-left marks and letters around
 *          links, one of them wrapping, and runs of blank characters in a
 *          link's words; at 320, 640 and 1,280 px, each link's own box is
 *          the first box after its words begin, beside their last visible
 *          character or on the next line, and no blank opens a gap of more
 *          than a line between its words.
 * R4-E4 (pasting) is in rich-text-editor.spec.ts.
 *
 * Requires a real database (E2E_DB=1). Seeds a course of its own, removed
 * afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  : (null as unknown as PrismaClient);
const describe = DB ? test.describe : test.describe.skip;
test.describe.configure({ mode: "serial", timeout: 120_000 });

const RUN = runId();
const SLUG = `e2e-r4-links-${RUN}`;
// Hostile links stored straight into the database: a course of their own,
// so they are its first lesson, which a learner opens on.
const SLUG_H = `e2e-r4-links-h-${RUN}`;
// German text in the lesson editor, for the Link form's language: a course
// whose reflection lesson's introduction and a lesson's text are German.
const SLUG_L = `e2e-r4-links-l-${RUN}`;
const GERMAN_TEXT = ownLessonId();
const EDITOR = `e2e-r4-links-editor-${RUN}@example.com`;
const LEARNER = `e2e-r4-links-learner-${RUN}@example.com`;
const NEW_TAB = "(opens in a new tab)";
/** What screen readers hear after an email link (D105). */
const EMAIL_PROGRAM = "(opens your email program)";
const GUIDE = "https://example.org/guide";
const SAFE_SCHEME = /^(?:https:\/\/|http:\/\/|mailto:)/;
/**
 * The site's own phone links beside a learner's pages (Release 3, D93): the
 * emergency number and the safeguarding contacts an admin saves, "tel:" and
 * digits. No lesson link is one: the address check takes https, http and
 * mailto only.
 */
const SITE_PHONE = /^tel:\+?\d+$/;
/** The end of the text, by keyboard: ⌘↓ on a Mac, Ctrl+End elsewhere. */
const TEXT_END = process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End";

// The lessons, in learner order.
const EDITED = ownLessonId(); // the one authors link words in
const PIECES = ownLessonId(); // a lesson with an added text piece (savePartText)
const OVER = ownLessonId(); // an over-limit block with hostile links, for the editor
const SAVES = ownLessonId(); // no English text: direct saves start from no base
const PIECE = partId();
const HOSTILE = ownLessonId(); // SLUG_H's first lesson; "context" is its second

type Json = Prisma.InputJsonValue;
const plain = (text: string) => ({ kind: "paragraph" as const, text });
const narrative = (title: string, blocks: unknown[]) => ({ en: { title, blocks } }) as unknown as Json;

/** The hostile link of row `i` as a paragraph: "Row i: <the guide i> today." */
const hostileBlock = (href: unknown, i: number) =>
  richBlock(
    paragraphDoc([
      { type: "text", text: `Row ${i}: ` },
      { type: "text", text: `the guide ${i}`, marks: [{ type: "link", attrs: { href } }] },
      { type: "text", text: " today." },
    ]),
    `Row ${i}: the guide ${i} today.`
  );

/**
 * Every hostile shape the render side is tried with. Not the million-character
 * address (U3's and R4-E6's), nor one holding a NUL: Postgres refuses to
 * store a NUL in JSON, so no row can hold it (R4-E6 sends it).
 */
const HOSTILE_BLOCKS = HOSTILE_ADDRESSES.filter(
  (row) => row.name !== "1,000,000 characters" && !(typeof row.href === "string" && row.href.includes("\u0000"))
)
  .map((row) => row.href)
  .map(hostileBlock);
/**
 * Links read with the text touching them (D104, as learners read the word
 * a link is in): each shows another address than one of its links opens.
 */
const EVIL = "https://evil.example/login";
const WORD_MARKS: readonly { name: string; rich: ReturnType<typeof paragraphDoc>; shown: string }[] = [
  {
    name: "two links with a zero-width space between them",
    rich: paragraphDoc([
      { type: "text", text: "Log in at " },
      { type: "text", text: "https://bank.", marks: [{ type: "link", attrs: { href: "https://evil.example/a" } }] },
      { type: "text", text: "\u200B" },
      { type: "text", text: "example/login", marks: [{ type: "link", attrs: { href: EVIL } }] },
      { type: "text", text: " today." },
    ]),
    shown: "https://bank.\u200Bexample/login",
  },
  {
    name: "an address typed right before a named link",
    rich: paragraphDoc([
      { type: "text", text: "Log in at https://bank.example" },
      { type: "text", text: "/login", marks: [{ type: "link", attrs: { href: EVIL } }] },
      { type: "text", text: " today." },
    ]),
    shown: "https://bank.example/login",
  },
  {
    name: "a named link that typed text continues",
    rich: paragraphDoc([
      { type: "text", text: "Log in at " },
      { type: "text", text: "https://bank", marks: [{ type: "link", attrs: { href: EVIL } }] },
      { type: "text", text: ".example/login today." },
    ]),
    shown: "https://bank.example/login",
  },
];
/**
 * A hostile label that is an email address stays as words when its link is
 * dropped, and typed words that are an email address are a quick link to
 * that address (D55): it shows where it goes.
 */
const OWN_QUICK_LINKS: ReadonlySet<string> = new Set(
  HOSTILE_MARKS.flatMap((row) => row.rich.doc.content[0].content).flatMap((node) =>
    "text" in node && isEmailAddress(node.text) ? [`mailto:${node.text}`] : []
  )
);
const HOSTILE_SHAPES = [...HOSTILE_MARKS, ...RENDER_ONLY_MARKS, ...WORD_MARKS].map((row, i) =>
  richBlock(row.rich, `Shape ${i}`)
);
/**
 * Link text D104 no longer refuses since the owner's decision of 22 October
 * 2026 (the box after its words shows where the link goes): a file's name
 * ending in a top-level domain, a name in capitals, of another site.
 */
const NARROWED_LABELS: readonly { label: string; href: string }[] = [
  { label: "course-materials.zip", href: "https://example.org/files/course-materials.zip" },
  { label: "README.md", href: "https://example.org/project/readme" },
  { label: "ASP.NET Core", href: "https://example.org/aspnet/core" },
];
/** Link text with a dot that shows no other site, each its own paragraph: kept as a link. */
const ACCEPTED_BLOCKS = [...ACCEPTED_LABELS, ...NARROWED_LABELS].map(({ label, href }) => richBlock(linkedParagraph(href, label), `Read ${label} today.`));

async function setNarrative(stageKey: string, value: unknown) {
  await prisma.lesson.updateMany({
    where: { projectId: PROJECT, courseSlug: SLUG, stageKey },
    data: { narrative: value as Json },
  });
}

async function storedBlocks(stageKey: string) {
  const row = await prisma.lesson.findFirstOrThrow({
    where: { projectId: PROJECT, courseSlug: SLUG, stageKey },
    select: { narrative: true },
  });
  return (row.narrative as { en: { blocks: { kind: string; text?: string; rich?: unknown }[] } }).en.blocks;
}

/** The lesson's text editor on the course page (visible only: a streamed copy can stay behind). */
async function openLesson(page: Page, key: string) {
  await page.goto(`/en/content/courses/${SLUG}?lesson=${key}`);
  const region = page
    .locator(`#lesson-${key}`)
    .filter({ visible: true })
    .getByRole("region", { name: /lesson text/i });
  await expect(region).toBeVisible({ timeout: 20_000 });
  return region;
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

const toolbarOf = (block: Locator) => block.getByRole("toolbar", { name: /^paragraph formatting$/i });
const linkForm = (block: Locator) => block.getByRole("group", { name: "Link", exact: true });

/**
 * Select `count` characters ending `fromEnd` characters before the end of
 * the text (keyboard only), at a person's pace: the editor reads each
 * selection change from the page before the next key.
 */
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

async function saveByKeyboard(page: Page, region: Locator) {
  const save = region.getByRole("button", { name: /^save english$/i });
  await save.focus();
  await page.keyboard.press("Enter");
}

/** `text` in a regular expression, as it is. */
const literally = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** The visible main landmark. */
const main = (page: Page) => page.getByRole("main").filter({ visible: true });

/** Every href in a page's server HTML, and in its React payload's elements. */
async function served(request: APIRequestContext, sessionToken: string, path: string) {
  const headers = { Cookie: `authjs.session-token=${sessionToken}` };
  const html = await (await request.get(path, { headers })).text();
  const rsc = await (await request.get(path, { headers: { ...headers, RSC: "1" } })).text();
  const htmlHrefs = [...html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  // An element in the payload: ["$","a",key,{…"href":"…"…}].
  const rscHrefs = [...rsc.matchAll(/\["\$","a",[^,]*,\{[^{}]*?"href":"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
  return { html, rsc, htmlHrefs, rscHrefs };
}

describe("Release 4 — links in lesson text", () => {
  let editor: { userId: string; sessionToken: string };
  let learner: { sessionToken: string };

  test.beforeAll(async () => {
    await removePeople(prisma, [EDITOR, LEARNER]);
    await seedECourse(prisma, {
      slug: SLUG,
      title: { en: `E2E R4 links ${RUN}` },
      lessons: [
        { id: EDITED, narrative: narrative("R4 links lesson", [plain("Read the guide today.")]) },
        {
          id: PIECES,
          narrative: narrative("R4 text piece", [plain("Main text.")]),
          parts: [{ ...parts.text({ de: "Nur Deutsch." }, PIECE) }],
        },
        {
          id: OVER,
          narrative: narrative("R4 over the limit", [
            richBlock(overLimitDoc().rich, overLimitDoc().text),
            richBlock(
              paragraphDoc([
                { type: "text", text: "Within limits " },
                { type: "text", text: "javascript one", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
                { type: "text", text: " and " },
                { type: "text", text: "data one", marks: [{ type: "link", attrs: { href: "data:text/html,<script>alert(1)</script>" } }] },
              ]),
              "Within limits javascript one and data one"
            ),
          ]),
        },
        { id: SAVES, narrative: { de: { title: "Nur Deutsch", blocks: [plain("Nur Deutsch.")] } } as Json },
      ],
    });
    await seedECourse(prisma, {
      slug: SLUG_H,
      title: { en: `E2E R4 hostile links ${RUN}` },
      lessons: [
        { id: HOSTILE, narrative: narrative("R4 hostile links", [...HOSTILE_BLOCKS, ...HOSTILE_SHAPES, ...ACCEPTED_BLOCKS]) },
        // A standard lesson, drawn by the standard path.
        { id: "context", narrative: narrative("R4 hostile standard", HOSTILE_BLOCKS.slice(0, 8)) },
      ],
    });
    await seedECourse(prisma, {
      slug: SLUG_L,
      title: { en: `E2E R4 links German ${RUN}`, de: `E2E R4 Links Deutsch ${RUN}` },
      lessons: [
        { id: GERMAN_TEXT, narrative: { de: { title: "Deutscher Text", blocks: [plain("Lies die Anleitung heute.")] } } as Json },
        { id: "reflection", narrative: { de: { title: "Rückblick", blocks: [plain("Nimm dir einen Moment.")] } } as Json },
      ],
    });
    editor = await createPerson(prisma, { email: EDITOR, roles: ["CONTENT_EDITOR"] });
    learner = await createPerson(prisma, { email: LEARNER, roles: ["LEARNER"] });
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actor: { is: { email: { in: [EDITOR, LEARNER] } } } } });
    await removeECourse(prisma, SLUG);
    await removeECourse(prisma, SLUG_H);
    await removeECourse(prisma, SLUG_L);
    await removePeople(prisma, [EDITOR, LEARNER]);
    await prisma.$disconnect();
  });

  test.beforeEach(async ({ context }) => {
    // Pages the links lead to, answered here: nothing leaves the machine.
    await context.route(/^https?:\/\/(?:[a-z0-9-]+\.)*(?:example\.org|bpb\.de|verein\.de)\//, (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Elsewhere</title><p>Another site</p>" })
    );
  });

  test("R4-E1: keyboard only — select words, Ctrl+K, an address, Enter, Save; the learner's link opens in a new tab", async ({
    page,
    context,
  }) => {
    await setNarrative(EDITED, narrative("R4 links lesson", [plain("Read the guide today.")]));
    await signIn(context, editor.sessionToken);
    const region = await openLesson(page, EDITED);
    const block = region.getByRole("group", { name: /^block 1 of 1/i });
    await openParagraph(page, block);

    // "the guide": 9 characters, ending before " today." (7).
    await selectBeforeEnd(page, 7, 9);
    await page.keyboard.press("ControlOrMeta+k");
    const form = linkForm(block);
    await expect(form).toBeVisible();
    // Text was selected: focus goes to the address, the text is filled in.
    await expect(form.getByLabel("Address")).toBeFocused();
    await expect(form.getByLabel("Text to show")).toHaveValue("the guide");
    await page.keyboard.type(GUIDE);
    await page.keyboard.press("Enter");
    await expect(form).toHaveCount(0);
    // Focus is back in the text, right after the link.
    const textbox = block.getByRole("textbox", { name: /^paragraph text$/i });
    await expect(textbox).toBeFocused();
    await expect(textbox.locator("a")).toHaveText("the guide");
    await expect(textbox.locator("a")).toHaveAttribute("href", GUIDE);
    await expect(toolbarOf(block).getByRole("button", { name: "Link", exact: true })).toBeVisible();

    await saveByKeyboard(page, region);
    await expect(region.getByText(/^saved$/i)).toBeVisible({ timeout: 15_000 });

    const [saved] = await storedBlocks(EDITED);
    expect(saved).toEqual({
      kind: "paragraph",
      text: `Read the guide (${GUIDE}) today.`,
      rich: {
        v: 2,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Read " },
                { type: "text", text: "the guide", marks: [{ type: "link", attrs: { href: GUIDE } }] },
                { type: "text", text: " today." },
              ],
            },
          ],
        },
      },
    });

    await signIn(context, learner.sessionToken);
    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(main(page).getByRole("heading", { level: 2, name: "R4 links lesson" })).toBeVisible({ timeout: 20_000 });
    // The site it opens follows its words, inside the link (R4-E15).
    const link = main(page).getByRole("link", { name: `the guide, example.org ${NEW_TAB}`, exact: true });
    await expect(link).toHaveAttribute("href", GUIDE);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    const opened = context.waitForEvent("page");
    await link.click();
    const tab = await opened;
    await tab.waitForLoadState();
    expect(tab.url()).toBe(GUIDE);
    await tab.close();
  });

  test("R4-E1b: a word linked with the space after it, or new words with blanks around them: the blanks stay in the text, outside the link; the learner's box isn't against the next word", async ({
    page,
    context,
  }) => {
    const FORM = "https://example.org/feedback";
    const GUIDE_TEXT = "Leitfaden";
    await setNarrative(EDITED, narrative("R4 links lesson", [plain("Füllen Sie den Feedbackbogen nach der Sitzung aus. Lesen Sie den")]));
    await signIn(context, editor.sessionToken);
    const region = await openLesson(page, EDITED);
    const block = region.getByRole("group", { name: /^block 1 of 1/i });
    const textbox = await openParagraph(page, block);
    const form = linkForm(block);

    // "Feedbackbogen " with the space after it, as Word and a browser on
    // Windows select a word: 14 characters, before "nach der Sitzung aus.
    // Lesen Sie den" (35).
    await selectBeforeEnd(page, 35, 14);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(form.getByLabel("Text to show")).toHaveValue("Feedbackbogen ");
    await page.keyboard.type(FORM);
    await page.keyboard.press("Enter");
    await expect(form).toHaveCount(0);
    await expect(textbox.locator("a")).toHaveJSProperty("textContent", "Feedbackbogen");

    // New words with blanks around them, at the end of the text (the key
    // again until the editor has read where the cursor is).
    await expect(textbox).toBeFocused();
    const atEnd = () =>
      page.evaluate(() => {
        const selection = window.getSelection();
        const box = selection?.focusNode?.parentElement?.closest("[contenteditable]");
        if (!selection?.focusNode || !box) return false;
        const after = document.createRange();
        after.selectNodeContents(box);
        after.setStart(selection.focusNode, selection.focusOffset);
        return after.toString() === "";
      });
    await expect
      .poll(async () => {
        await page.keyboard.press(TEXT_END);
        await page.waitForTimeout(40);
        return atEnd();
      })
      .toBe(true);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(form.getByLabel("Text to show")).toBeFocused();
    await page.keyboard.type(`  ${GUIDE_TEXT} `);
    await form.getByLabel("Address").fill(GUIDE);
    await page.keyboard.press("Enter");
    await expect(form).toHaveCount(0);
    await expect(textbox.locator("a")).toHaveCount(2);
    await expect(textbox.locator("a").nth(1)).toHaveJSProperty("textContent", GUIDE_TEXT);
    await expect(textbox).toHaveJSProperty("textContent", `Füllen Sie den Feedbackbogen nach der Sitzung aus. Lesen Sie den  ${GUIDE_TEXT} `);

    await saveByKeyboard(page, region);
    await expect(region.getByText(/^saved$/i)).toBeVisible({ timeout: 15_000 });
    const [saved] = await storedBlocks(EDITED);
    expect((saved.rich as { doc: unknown }).doc).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Füllen Sie den " },
            { type: "text", text: "Feedbackbogen", marks: [{ type: "link", attrs: { href: FORM } }] },
            { type: "text", text: " nach der Sitzung aus. Lesen Sie den  " },
            { type: "text", text: GUIDE_TEXT, marks: [{ type: "link", attrs: { href: GUIDE } }] },
            { type: "text", text: " " },
          ],
        },
      ],
    });

    // The learner: the box follows the words, and a space parts it from the next word.
    await signIn(context, learner.sessionToken);
    await page.goto(`/en/learner/course/${SLUG}`);
    const link = main(page).getByRole("link", { name: `Feedbackbogen, example.org ${NEW_TAB}`, exact: true });
    await expect(link).toBeVisible({ timeout: 20_000 });
    const gap = await link.evaluate((a) => {
      const walker = document.createTreeWalker(a.closest("p") ?? document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (a.contains(node) || !(a.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        const at = (node.textContent ?? "").search(/\S/);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + 1);
        return range.getBoundingClientRect().left - a.getBoundingClientRect().right;
      }
      return null;
    });
    expect(gap, "from the box to the next word, px").toBeGreaterThan(1);
  });

  test("R4-E2: an http address — warned once, described not announced; the learner's link opens http under Release 3's headers", async ({
    page,
    context,
  }) => {
    await setNarrative(EDITED, narrative("R4 links lesson", [plain("Read the old site today.")]));
    await signIn(context, editor.sessionToken);
    const region = await openLesson(page, EDITED);
    const block = region.getByRole("group", { name: /^block 1 of 1/i });
    await openParagraph(page, block);
    await selectBeforeEnd(page, 7, 12); // "the old site"
    await toolbarOf(block).getByRole("button", { name: "Link", exact: true }).click();
    const form = linkForm(block);
    const address = form.getByLabel("Address");
    await expect(address).toBeFocused();

    // Count what the status line says while the address is typed, key by key.
    const status = form.getByRole("status");
    await status.evaluate((el) => {
      const w = window as unknown as { said: string[] };
      w.said = [];
      new MutationObserver(() => w.said.push(el.textContent ?? "")).observe(el, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
    await page.keyboard.type("http://example.org/old", { delay: 60 });
    await expect(status).toHaveText("This address isn't secure (http). Use https:// if the site offers it.");
    await page.waitForTimeout(1_500);
    const said = await page.evaluate(() => (window as unknown as { said: string[] }).said.filter(Boolean));
    expect(said).toEqual(["This address isn't secure (http). Use https:// if the site offers it."]);

    // "Will open: …" describes the field, and is not a live region.
    const describedBy = (await address.getAttribute("aria-describedby")) ?? "";
    const description = form.locator(`[id="${describedBy.split(" ")[0]}"]`);
    await expect(description).toHaveText("Will open: http://example.org/old");
    expect(await description.evaluate((el) => el.closest("[aria-live],[role=status],[role=alert],[role=log]") === null)).toBe(true);

    await form.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(form).toHaveCount(0);
    await region.getByRole("button", { name: /^save english$/i }).click();
    await expect(region.getByText(/^saved$/i)).toBeVisible({ timeout: 15_000 });

    await signIn(context, learner.sessionToken);
    const response = await page.goto(`/en/learner/course/${SLUG}`);
    // Release 3's headers: its content security policy, which upgrades only same-origin requests.
    const csp = (await response?.allHeaders())?.["content-security-policy"] ?? "";
    expect(csp).toContain("upgrade-insecure-requests");
    const link = main(page).getByRole("link", { name: `the old site, example.org ${NEW_TAB}`, exact: true });
    await expect(link).toHaveAttribute("href", "http://example.org/old");
    const popup = page.waitForEvent("popup");
    await link.click();
    const tab = await popup;
    await tab.waitForLoadState();
    expect(tab.url()).toMatch(/^http:\/\/example\.org\/old/);
    await tab.close();
  });

  test("R4-E3: the form refuses what can't be a link, by name; focus, Escape, completed addresses, and where a link goes", async ({
    page,
    context,
  }) => {
    await setNarrative(EDITED, narrative("R4 links lesson", [plain("Ask us or read more.")]));
    await signIn(context, editor.sessionToken);
    const region = await openLesson(page, EDITED);
    const block = region.getByRole("group", { name: /^block 1 of 1/i });
    const textbox = await openParagraph(page, block);
    const form = linkForm(block);
    const address = form.getByLabel("Address");
    const text = form.getByLabel("Text to show");
    const errorOf = async (field: Locator) => {
      const ids = ((await field.getAttribute("aria-describedby")) ?? "").split(" ").filter(Boolean);
      return form.locator(ids.map((id) => `[id="${id}"]`).join(", "));
    };

    // "us" (2 characters, before " or read more." — 14).
    await selectBeforeEnd(page, 14, 2);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(address).toBeFocused();

    const refusals: [string, string][] = [
      ["javascript:alert(1)", "Use an address starting with https:// or http://, or an email address."],
      ["https://user:pw@example.org/", "Addresses can't contain a user name or password."],
      // One sentence for each problem.
      ["https://example.org/my file.pdf", "Addresses can't contain spaces or invisible characters. Copy the address from the browser's address bar."],
      [
        "https://intranet/x",
        "This address has no full site name (like example.org), or one that can't be used. Copy the address from the browser's address bar.",
      ],
      ["mailto:help@example.org?cc=boss@example.org", "Email links can only carry a subject (no cc, bcc or message text)."],
      [
        "https://e2e-store.public.blob.vercel-storage.com/handout.pdf",
        "This is a file uploaded to the platform. Add it to the lesson as a document instead.",
      ],
      [
        "https://eur01.safelinks.protection.outlook.com/?url=file%3A%2F%2F%2FC%3A%2FUsers%2Fsomeone%2Fx.docx&data=05%7Csomeone%40example.org",
        "This is an Outlook safe link, which carries the address of the mailbox it was sent to. Use the original address instead.",
      ],
    ];
    for (const [typed, message] of refusals) {
      await address.fill(typed);
      await page.keyboard.press("Enter");
      await expect(form).toBeVisible();
      await expect(address).toBeFocused();
      await expect(address).toHaveAttribute("aria-invalid", "true");
      await expect(await errorOf(address)).toContainText([message]);
      // Focus was on the field already: the refusal is announced, as an alert.
      await expect(form.getByRole("alert")).toHaveText(message);
    }
    // Enter again on the same refusal: announced again.
    await page.keyboard.press("Enter");
    await expect(form.getByRole("alert")).toHaveText(refusals[refusals.length - 1][1]);
    // Text that shows another address: refused under the text.
    await text.fill("https://bank.example");
    await address.fill("https://evil.example/");
    await form.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(text).toBeFocused();
    await expect(await errorOf(text)).toContainText([
      "The text shows a different address than the link opens. Show the real address, or use a few words.",
    ]);
    // Through a zero-width space, too.
    await text.fill("https://bank\u200B.example");
    await text.press("Enter");
    await expect(form.getByRole("alert")).toHaveText(
      "The text shows a different address than the link opens. Show the real address, or use a few words."
    );
    // A bare name of another site, in lower case and ending in a common
    // top-level domain, is an address too (D104): the browser reads it as
    // the server does.
    await text.fill("paypal.com");
    await address.fill("https://example.org/files/course-materials");
    await text.press("Enter");
    await expect(text).toHaveAttribute("aria-invalid", "true");
    await expect(form.getByRole("alert")).toHaveText(
      "The text shows a different address than the link opens. Show the real address, or use a few words."
    );

    // The form, open and refusing, passes axe.
    const axe = await new AxeBuilder({ page })
      .include(`#lesson-${EDITED}`)
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);

    // Escape cancels, back to the text.
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);
    await expect(textbox).toBeFocused();
    await expect(textbox.locator("a")).toHaveCount(0);

    // A bare email address is completed, never blocked by the browser.
    await selectBeforeEnd(page, 14, 2);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(address).toBeFocused();
    await page.keyboard.type("help@verein.de");
    await page.keyboard.press("Enter");
    await expect(form).toHaveCount(0);
    // Applying puts the cursor back in the text, right after the link, a frame later.
    await expect(textbox).toBeFocused();
    await expect(textbox.locator("a")).toHaveAttribute("href", "mailto:help@verein.de");

    // No selection: focus goes to the text to show; a bare host is completed.
    await page.keyboard.press(TEXT_END);
    await page.keyboard.type(" See ");
    await expect(textbox).toContainText("or read more. See");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(form).toBeVisible();
    await expect(text).toBeFocused();
    await page.keyboard.type("the bpb");
    await address.fill("www.bpb.de");
    await expect(form.getByText("Will open: https://www.bpb.de/")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(form).toHaveCount(0);
    await expect(textbox.locator("a").nth(1)).toHaveText("the bpb");
    await expect(textbox.locator("a").nth(1)).toHaveAttribute("href", "https://www.bpb.de/");

    // The cursor in a link: where it goes, under the toolbar, describing Edit link.
    await textbox.locator("a").first().click();
    const editLink = toolbarOf(block).getByRole("button", { name: "Edit link", exact: true });
    await expect(editLink).toBeVisible();
    const line = block.getByText("Link: help@verein.de", { exact: true });
    await expect(line).toBeVisible();
    await expect(editLink).toHaveAttribute("aria-describedby", (await line.getAttribute("id")) ?? "missing");
    // Remove link takes the whole link off.
    await toolbarOf(block).getByRole("button", { name: "Remove link", exact: true }).click();
    await expect(textbox.locator("a")).toHaveCount(1);
    await expect(line).toHaveCount(0);

    // Words across two paragraphs can't be linked: Ctrl+K says so in the
    // status line, until the selection changes.
    await textbox.focus();
    await page.keyboard.press(TEXT_END);
    await page.keyboard.press("Enter");
    await page.keyboard.type("A second paragraph");
    await page.keyboard.press("Shift+ArrowUp");
    // The editor has read the selection from the page: Link can't be used.
    await expect(toolbarOf(block).getByRole("button", { name: "Link", exact: true })).toBeDisabled();
    await page.keyboard.press("ControlOrMeta+k");
    const cantLink = block.getByRole("status").filter({ hasText: "Select words in one paragraph to link them." });
    await expect(cantLink).toHaveCount(1);
    await expect(form).toHaveCount(0);
    await page.keyboard.press("ArrowDown");
    await expect(cantLink).toHaveCount(0);
  });

  test("R4-E3b: the Link form's \"Text to show\" carries the text's language; the address and the form's words keep the editor's English", async ({
    page,
    context,
  }) => {
    await signIn(context, editor.sessionToken);
    /** The language a screen reader reads an element in: its own lang, or the nearest one around it. */
    const langOf = (el: Locator) => el.evaluate((node) => node.closest("[lang]")?.getAttribute("lang") ?? null);
    const expectLanguages = async (form: Locator, words: string) => {
      const text = form.getByLabel("Text to show");
      await expect(text).toHaveValue(words);
      expect(await langOf(text), "the text to show").toBe("de");
      expect(await langOf(form.getByLabel("Address")), "the address").toBe("en");
      expect(await langOf(form.getByText("Text to show", { exact: true })), "the form's own words").toBe("en");
      expect(await langOf(form.getByRole("button", { name: "Apply", exact: true })), "the form's own words").toBe("en");
    };

    // A reflection lesson's introduction, in German: its editor sits outside the lesson's block list.
    await page.goto(`/en/content/courses/${SLUG_L}?lesson=reflection&lang=de`);
    const reflection = page
      .locator("#lesson-reflection")
      .filter({ visible: true })
      .getByRole("region", { name: /reflection text/i });
    await expect(reflection).toBeVisible({ timeout: 20_000 });
    const intro = reflection.getByRole("textbox", { name: /^introduction$/i });
    await expect(intro).toHaveText("Nimm dir einen Moment.", { timeout: 30_000 });
    await expect(intro).toHaveAttribute("lang", "de");
    await expect(async () => {
      await intro.focus();
      await expect(intro).toBeFocused({ timeout: 2000 });
    }).toPass({ timeout: 15_000 });
    // "Moment": 6 characters, before ".".
    await selectBeforeEnd(page, 1, 6);
    await page.keyboard.press("ControlOrMeta+k");
    const introForm = reflection.getByRole("group", { name: "Link", exact: true });
    await expect(introForm).toBeVisible();
    await expectLanguages(introForm, "Moment");
    await page.keyboard.press("Escape");
    await expect(introForm).toHaveCount(0);

    // A paragraph of a lesson's text, in German, the same.
    await page.goto(`/en/content/courses/${SLUG_L}?lesson=${GERMAN_TEXT}&lang=de`);
    const region = page
      .locator(`#lesson-${GERMAN_TEXT}`)
      .filter({ visible: true })
      .getByRole("region", { name: /lesson text/i });
    await expect(region).toBeVisible({ timeout: 20_000 });
    const block = region.getByRole("group", { name: /^block 1 of 1/i });
    const textbox = await openParagraph(page, block);
    await expect(textbox).toHaveAttribute("lang", "de");
    // "Anleitung": 9 characters, before " heute." (7).
    await selectBeforeEnd(page, 7, 9);
    await page.keyboard.press("ControlOrMeta+k");
    const form = linkForm(block);
    await expect(form).toBeVisible();
    await expectLanguages(form, "Anleitung");
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);
  });

  test("R4-E5 (Part A): a named email link keeps target=_blank and opens the email address", async ({ page, context }) => {
    await setNarrative(
      EDITED,
      narrative("R4 links lesson", [
        richBlock(
          paragraphDoc([
            { type: "text", text: "Write to " },
            { type: "text", text: "our team", marks: [{ type: "link", attrs: { href: "mailto:help@example.org?subject=Course" } }] },
            { type: "text", text: " or help@example.org." },
          ]),
          "Write to our team (help@example.org) or help@example.org."
        ),
      ])
    );
    await signIn(context, learner.sessionToken);
    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(main(page).getByRole("heading", { level: 2, name: "R4 links lesson" })).toBeVisible({ timeout: 20_000 });
    const named = main(page).locator("a.seq-link", { hasText: "our team" });
    await expect(named).toHaveAttribute("href", "mailto:help@example.org?subject=Course");
    const typed = main(page).locator("a.seq-link", { hasText: "help@example.org" });
    for (const link of [named, typed]) {
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  test("R4-E5 (L2): email links say \"(opens your email program)\" and web links \"(opens in a new tab)\", in the interface language, marked with it", async ({
    page,
    context,
  }) => {
    const OURS = "mailto:help@example.org?subject=Course";
    await setNarrative(
      EDITED,
      narrative("R4 links lesson", [
        richBlock(
          paragraphDoc([
            { type: "text", text: "Ask help@example.org, write to " },
            { type: "text", text: "our team", marks: [{ type: "link", attrs: { href: OURS } }] },
            { type: "text", text: " or read " },
            { type: "text", text: "the guide", marks: [{ type: "link", attrs: { href: GUIDE } }] },
            { type: "text", text: "." },
          ]),
          `Ask help@example.org, write to our team (help@example.org) or read the guide (${GUIDE}).`
        ),
      ])
    );
    await signIn(context, learner.sessionToken);
    // Each link by what screen readers hear, where it goes, and the language of the words after it.
    const expectLinks = async (rows: [name: string, href: string][], lang: string) => {
      const lesson = main(page);
      for (const [name, href] of rows) {
        const link = lesson.getByRole("link", { name, exact: true });
        await expect(link, name).toHaveCount(1);
        await expect(link).toHaveAttribute("href", href);
        // Still in a new tab, the lesson kept where the learner left it (D105).
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", "noopener noreferrer");
        await expect(link.locator(".sr-only")).toHaveAttribute("lang", lang);
      }
    };

    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(main(page).getByRole("heading", { level: 2, name: "R4 links lesson" })).toBeVisible({ timeout: 20_000 });
    await expectLinks(
      [
        [`help@example.org ${EMAIL_PROGRAM}`, "mailto:help@example.org"], // typed: a quick link
        [`our team, example.org ${EMAIL_PROGRAM}`, OURS], // named, with its site's box
        [`the guide, example.org ${NEW_TAB}`, GUIDE],
      ],
      "en"
    );

    // A German learner on a course shown in English (Release 3): the text is
    // marked lang="en", the words after each link are German, marked so.
    await page.goto(`/de/learner/course/${SLUG}`);
    await expect(main(page).getByRole("heading", { level: 2, name: "R4 links lesson" })).toBeVisible({ timeout: 20_000 });
    await expectLinks(
      [
        [`help@example.org ${de.lessonLinks.email}`, "mailto:help@example.org"],
        [`our team, example.org ${de.lessonLinks.email}`, OURS],
        [`the guide, example.org ${de.lessonLinks.newTab}`, GUIDE],
      ],
      "de"
    );
    const text = main(page).getByRole("link", { name: `our team, example.org ${de.lessonLinks.email}`, exact: true });
    expect(await text.evaluate((a) => a.parentElement?.closest("[lang]")?.getAttribute("lang") ?? null), "the course text").toBe("en");
  });

  test("R4-E6 (guard): hostile links sent straight to saveLessonNarrative and savePartText are refused by name; nothing changes", async ({
    request,
  }) => {
    const page = `/en/content/courses/${SLUG}`;
    const rows = async () =>
      JSON.stringify(
        await prisma.lesson.findMany({
          where: { projectId: PROJECT, courseSlug: SLUG },
          orderBy: { stageKey: "asc" },
          select: { stageKey: true, narrative: true, parts: true },
        })
      );
    const saveNarrative = (rich: unknown) =>
      callAction(request, {
        as: editor,
        page,
        file: "src/app/actions/lesson.ts",
        name: "saveLessonNarrative",
        args: [SLUG, SAVES, "en", { title: "R4 direct saves", blocks: [richBlock(rich)] }, null],
      });
    const savePiece = (rich: unknown) =>
      callAction(request, {
        as: editor,
        page,
        file: "src/app/actions/parts.ts",
        name: "savePartText",
        args: [SLUG, PIECES, PIECE, "en", [richBlock(rich)], null],
      });
    const before = await rows();

    const why: Record<string, RegExp> = {
      "own-file": /: the link “the guide” points to a file uploaded to the platform\./,
      redirect: /: the link “the guide” is an Outlook safe link/,
    };
    // Every other address: refused with the sentence for its problem.
    const refusedFor = (row: (typeof HOSTILE_ADDRESSES)[number]) =>
      new RegExp(`: the link “the guide” can't be used\\. ${literally(addressProblem(row.reason as LinkRefusal, row.href))}$`);
    for (const row of HOSTILE_ADDRESSES) {
      const expected =
        row.name === "1,000,000 characters"
          ? /^(?:Content 2: )?Block 1 \(Paragraph\) is too long/
          : (why[row.reason] ?? refusedFor(row));
      for (const send of [saveNarrative, savePiece]) {
        const started = Date.now();
        const answer = await send(linkedParagraph(row.href));
        expect(answer.result, `${row.name}: ${answer.raw.slice(0, 200)}`).toMatchObject({ ok: false, error: "invalid" });
        const issues = (answer.result as { issues: string[] }).issues;
        expect(issues.length, row.name).toBe(1);
        expect(issues[0], row.name).toMatch(expected);
        expect(issues[0], row.name).toMatch(/Block 1 \(Paragraph\)/);
        if (row.name === "1,000,000 characters") expect(Date.now() - started, row.name).toBeLessThan(10_000);
      }
    }
    const named: Record<string, RegExp> = {
      "two link marks on one text": /Block 1 \(Paragraph\): the link “the guide” can't be used\. Its words hold two links\. Keep one\./,
      "a label that shows another address":
        /Block 1 \(Paragraph\): the link text “https:\/\/bank\.example\/login” shows a different address than the link opens\./,
      "a label that shows another address through a zero-width space":
        /Block 1 \(Paragraph\): the link text “https:\/\/bank\u200B\.example\/login” shows a different address than the link opens\./,
      "a label that shows another address after a user name":
        /Block 1 \(Paragraph\): the link text “https:\/\/login@bank\.example\/” shows a different address than the link opens\./,
      "a label that shows another site as a bare host":
        /Block 1 \(Paragraph\): the link text “bank\.example\/login” shows a different address than the link opens\./,
      "a label that shows another site as a bare host with www.":
        /Block 1 \(Paragraph\): the link text “www\.bank\.example” shows a different address than the link opens\./,
      "two touching links that together show another address":
        /Block 1 \(Paragraph\): the link text “https:\/\/bank\.example” shows a different address than the link opens\./,
      "a label that shows another site through look-alike letters":
        /Block 1 \(Paragraph\): the link text “paypal\.соm” shows a different address than the link opens\./,
      "a label that shows another site as a host wrapped for emphasis":
        /Block 1 \(Paragraph\): the link text “_paypal\.com_” shows a different address than the link opens\./,
      "a label that shows another site after two slashes":
        /Block 1 \(Paragraph\): the link text “\/\/paypal\.com” shows a different address than the link opens\./,
      "a label that shows another site with a raised sign after it":
        /Block 1 \(Paragraph\): the link text “PayPal\.com\u2122” shows a different address than the link opens\./,
      "a label that shows another site through look-alike letters, over its own address":
        /Block 1 \(Paragraph\): the link text “p\u0430ypal\.com” shows a different address than the link opens\./,
      "a label that shows another site through a Roman numeral letter":
        /Block 1 \(Paragraph\): the link text “paypal\.ⅽom” shows a different address than the link opens\./,
      "a label that shows another site through a Roman numeral letter that ends it":
        /Block 1 \(Paragraph\): the link text “rabobank\.n\u217C” shows a different address than the link opens\./,
    };
    for (const row of WORD_MARKS) {
      named[row.name] = new RegExp(
        `Block 1 \\(Paragraph\\): the link text “${literally(row.shown)}” shows a different address than the link opens\\.`
      );
    }
    for (const row of [...HOSTILE_MARKS.filter((r) => r.save === "refused"), ...WORD_MARKS]) {
      for (const send of [saveNarrative, savePiece]) {
        const answer = await send(row.rich);
        expect(answer.result, row.name).toMatchObject({ ok: false, error: "invalid" });
        expect((answer.result as { issues: string[] }).issues.join(" "), row.name).toMatch(named[row.name]);
      }
    }
    expect(await rows(), "nothing changed").toBe(before);

    // Extra attributes on a link: stored without them.
    const extra = HOSTILE_MARKS.find((r) => r.save === "attributes-dropped")!;
    expect((await saveNarrative(extra.rich)).result).toMatchObject({ ok: true });
    const [stored] = await storedBlocks(SAVES);
    expect(JSON.stringify(stored)).not.toMatch(/onclick|style|target|rel"|class|evil/);
    expect(stored.rich).toEqual(linkedParagraph("https://example.org/guide"));
    expect(stored.text).toBe("Read the guide (https://example.org/guide) today.");
    expect((await savePiece(extra.rich)).result).toMatchObject({ ok: true });
  });

  test("R4-E6c: link text with a dot that shows no other site (an abbreviation, the link's registrable domain) is saved with its link", async ({
    request,
  }) => {
    // From no English text, so a save starts from no base.
    await setNarrative(SAVES, { de: { title: "Nur Deutsch", blocks: [plain("Nur Deutsch.")] } });
    await prisma.lesson.updateMany({
      where: { projectId: PROJECT, courseSlug: SLUG, stageKey: PIECES },
      data: { parts: { v: 1, items: [{ id: "main", type: "main" }, parts.text({ de: "Nur Deutsch." }, PIECE)] } as unknown as Json },
    });
    const page = `/en/content/courses/${SLUG}`;
    const labels = [...ACCEPTED_LABELS, ...NARROWED_LABELS];
    const accepted = labels.map(({ label, href }) => richBlock(linkedParagraph(href, label), `Read ${label} today.`));
    const textAnswer = await callAction(request, {
      as: editor,
      page,
      file: "src/app/actions/lesson.ts",
      name: "saveLessonNarrative",
      args: [SLUG, SAVES, "en", { title: "R4 direct saves", blocks: accepted }, null],
    });
    expect(textAnswer.result, textAnswer.raw.slice(0, 300)).toMatchObject({ ok: true });
    const kept = await storedBlocks(SAVES);
    expect(kept.map((block) => block.rich)).toEqual(labels.map(({ label, href }) => linkedParagraph(href, label)));
    for (const [i, { href }] of labels.entries()) expect(kept[i].text, href).toContain(`(${href})`);
    const pieceAnswer = await callAction(request, {
      as: editor,
      page,
      file: "src/app/actions/parts.ts",
      name: "savePartText",
      args: [SLUG, PIECES, PIECE, "en", accepted, null],
    });
    expect(pieceAnswer.result, pieceAnswer.raw.slice(0, 300)).toMatchObject({ ok: true });
    const piece = await prisma.lesson.findFirstOrThrow({
      where: { projectId: PROJECT, courseSlug: SLUG, stageKey: PIECES },
      select: { parts: true },
    });
    for (const { href } of labels) expect(JSON.stringify(piece.parts), href).toContain(`"attrs":{"href":"${href}"}`);
  });

  // A reflection lesson's introduction is saved by saveLessonNarrative, which
  // asks sanitizeNarrativeBlocks(…, "reflection-intro") for it (R2): a save it
  // refuses names the introduction as its editor's problem line does.
  test("R4-E6b (R2): a reflection lesson's introduction over the limit is refused by its name: \"Shorten it.\"", async ({
    request,
  }) => {
    const answer = await callAction(request, {
      as: editor,
      page: `/en/content/courses/${SLUG}`,
      file: "src/app/actions/lesson.ts",
      name: "saveLessonNarrative",
      args: [SLUG, "reflection", "en", { title: "R4 reflection", blocks: [{ kind: "paragraph", text: "x".repeat(10_001) }] }, null],
    });
    expect(answer.result, answer.raw.slice(0, 300)).toEqual({
      ok: false,
      error: "invalid",
      issues: ["The introduction is too long — at most 10,000 characters. Shorten it."],
    });
  });

  test("R4-E7 (guard): hostile links stored straight into the database draw no unsafe href, anywhere", async ({
    page,
    context,
    request,
  }) => {
    const pages: [string, string, string][] = [
      ["the learner page (sectioned)", learner.sessionToken, `/en/learner/course/${SLUG_H}`],
      ["preview (sectioned)", editor.sessionToken, `/en/learner/course/${SLUG_H}?preview=1&lesson=${HOSTILE}`],
      ["preview (standard)", editor.sessionToken, `/en/learner/course/${SLUG_H}?preview=1&lesson=context`],
      ["the course page's read view", editor.sessionToken, `/en/content/courses/${SLUG_H}`],
    ];
    for (const [name, session, path] of pages) {
      const { htmlHrefs, rscHrefs } = await served(request, session, path);
      for (const href of [...htmlHrefs, ...rscHrefs]) {
        if (href.startsWith("/") || href.startsWith("#") || SITE_PHONE.test(href)) continue; // the site's own pages and phone links
        expect(href, `${name}: ${href.slice(0, 80)}`).toMatch(SAFE_SCHEME);
        // Every link to evil.example shows another address (or is refused): none is drawn,
        // but for an email label's own words, a quick link to the address they show.
        if (OWN_QUICK_LINKS.has(href)) continue;
        expect(href, `${name}: ${href.slice(0, 80)}`).not.toContain("evil.example");
      }
    }

    // In the browser: each refused link's text shows, and no page fails.
    await signIn(context, editor.sessionToken);
    for (const [name, path] of [
      ["preview (sectioned)", `/en/learner/course/${SLUG_H}?preview=1&lesson=${HOSTILE}`],
      ["the course page's read view", `/en/content/courses/${SLUG_H}`],
    ]) {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(path);
      const scope = name.startsWith("preview") ? main(page) : page.locator(`#lesson-${HOSTILE}`).filter({ visible: true });
      await expect(scope.getByText("Row 0: the guide 0 today.")).toBeVisible({ timeout: 20_000 });
      for (let i = 0; i < HOSTILE_BLOCKS.length; i++) {
        await expect(scope.getByText(`the guide ${i}`, { exact: false }).first(), `${name}: row ${i}`).toBeVisible();
      }
      // Link text with a dot that shows no other site is drawn as a link, with the site it opens.
      for (const { label, href } of [...ACCEPTED_LABELS, ...NARROWED_LABELS]) {
        await expect(scope.locator(`a[href="${href}"]`, { hasText: label }).first(), `${name}: ${label}`).toBeVisible();
      }
      for (const { label, href } of NARROWED_LABELS) {
        await expect(scope.locator(`a[href="${href}"]`, { hasText: label }).locator(".seq-link-site").first(), `${name}: ${label}`).toHaveText("example.org");
      }
      const hrefs = await scope.locator("a[href]").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
      for (const href of hrefs) {
        if (href.startsWith("/") || href.startsWith("#")) continue;
        expect(href, name).toMatch(SAFE_SCHEME);
      }
      expect(errors, name).toEqual([]);
      page.removeAllListeners("pageerror");
    }

    // The lesson editor: an over-limit block with hostile links opens as its
    // text, with the problem; one within limits opens without them.
    const region = await openLesson(page, OVER);
    const first = region.getByRole("group", { name: /^block 1 of 2/i });
    const over = await (async () => {
      const preview = first.getByRole("button", { name: /^edit paragraph$/i });
      await expect(async () => {
        if (await preview.isVisible()) await preview.click({ timeout: 2000 });
        await expect(first.getByRole("textbox")).toBeVisible({ timeout: 5000 });
      }).toPass({ timeout: 30_000 });
      return first.getByRole("textbox");
    })();
    await expect(over).toHaveText("An over-limit block, opened as its text.");
    await expect(first.getByRole("alert")).toHaveText(
      "This paragraph has too many links or too much formatting to save. Split it into two blocks."
    );
    const second = region.getByRole("group", { name: /^block 2 of 2/i });
    await second.getByRole("button", { name: /^edit paragraph$/i }).click();
    const within = second.getByRole("textbox");
    await expect(within).toHaveText("Within limits javascript one and data one");
    // The links it left out are named once, in the status line.
    await expect(
      second
        .getByRole("status")
        .filter({ hasText: "Links that can't be used were removed, the first “javascript one”. Add them again with the Link button." })
    ).toHaveCount(1);
    for (const editorHref of await region.locator("a[href]").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""))) {
      if (editorHref.startsWith("/") || editorHref.startsWith("#")) continue;
      expect(editorHref).toMatch(SAFE_SCHEME);
    }
    expect(await region.locator("[contenteditable] a[href]").count()).toBe(0);
  });

  test("R4-E7b: editing a link's text into another address is named at once; Save is refused; the link stays stored", async ({
    page,
    context,
  }) => {
    const stored = narrative("R4 links lesson", [richBlock(linkedParagraph(GUIDE), `Read the guide (${GUIDE}) today.`)]);
    await setNarrative(EDITED, stored);
    await signIn(context, editor.sessionToken);
    const region = await openLesson(page, EDITED);
    const block = region.getByRole("group", { name: /^block 1 of 1/i });
    const textbox = await openParagraph(page, block);
    await expect(textbox.locator("a")).toHaveText("the guide");
    // Inside the link, after "the": typed text stays part of it.
    await selectBeforeEnd(page, 7 + 6, 0); // before " guide"
    await page.keyboard.type(" https://bank.example");
    await expect(textbox.locator("a")).toHaveText("the https://bank.example guide");
    await expect(block.getByRole("alert")).toHaveText(
      "The link text “the https://bank.example guide” shows a different address than the link opens. Show the real address, or use a few words."
    );

    const sent = page.waitForRequest(
      (request) => request.method() === "POST" && "next-action" in request.headers() && (request.postData() ?? "").includes("bank.example")
    );
    await region.getByRole("button", { name: /^save english$/i }).click();
    await expect(
      region.getByText(
        "Block 1 (Paragraph): the link text “the https://bank.example guide” shows a different address than the link opens. Show the real address, or use a few words."
      )
    ).toBeVisible({ timeout: 15_000 });
    expect(await storedBlocks(EDITED)).toEqual((stored as { en: { blocks: unknown[] } }).en.blocks);
    // The paragraph's words went to Save beside the version-2 text, so a save
    // that keeps only the text (Release 3's, after a rollback) keeps them.
    expect((await sent).postData()).toContain('"text":"Read the https://bank.example guide today."');
  });

  test("R4-E8: international and percent-encoded addresses: the same href from the server and after hydration", async ({
    page,
    context,
    request,
  }) => {
    const ADDRESSES = [
      ["Bücher", "https://bücher.example/straße", "https://xn--bcher-kva.example/stra%C3%9Fe"],
      ["Άρθρο", "https://ελληνικά.example/άρθρο", "https://xn--hxargifdar.example/%CE%AC%CF%81%CE%B8%CF%81%CE%BF"],
      ["Path", "HTTPS://Example.ORG/Path?q=a b", null],
      ["Query", "https://example.org/a?x=ü&y=%20", "https://example.org/a?x=%C3%BC&y=%20"],
      ["Mail", "mailto:info@bücher.example", "mailto:info@bücher.example"],
    ] as const;
    // Hosts the browser and the server read differently: never a link, named or typed.
    const DIVERGENT = [
      ["https://xn--a.example/", "xn--a.example"],
      ["https://xn--zz.example/", "xn--zz.example"],
      ["https://xn--.example/", "xn--.example"],
      ["https://a\u1806b.example/", "xn--ab-h0o.example"],
      ["https://a.\u0661\u0662/", "a.xn--9hbc"],
    ] as const;
    // Link text over another site whose name the engines' URL parsers read
    // differently (Node refuses the punycode label "xn--a", Chrome keeps it):
    // D104 reads a name without parsing it, so neither the server nor the
    // browser after hydration draws a link.
    const READ_ALIKE = ["xn--a.paypal.com"];
    const OTHER_SITE = "https://evil.example/login";
    await setNarrative(
      EDITED,
      narrative("R4 links lesson", [
        ...ADDRESSES.map(([label, href]) =>
          richBlock(paragraphDoc([{ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }]), label)
        ),
        ...DIVERGENT.map(([href], i) =>
          richBlock(paragraphDoc([{ type: "text", text: `Divergent ${i}`, marks: [{ type: "link", attrs: { href } }] }]), `Divergent ${i}`)
        ),
        ...READ_ALIKE.map((text, i) =>
          richBlock(paragraphDoc([{ type: "text", text: `Alike ${i}: ` }, { type: "text", text, marks: [{ type: "link", attrs: { href: OTHER_SITE } }] }]), `Alike ${i}: ${text}`)
        ),
        plain(`Typed: ${DIVERGENT.map(([href]) => href).join(" and ")} today.`),
      ])
    );
    const { htmlHrefs } = await served(request, learner.sessionToken, `/en/learner/course/${SLUG}`);
    const expected: string[] = ADDRESSES.flatMap(([, , href]) => (href ? [href] : []));
    for (const href of expected) expect(htmlHrefs).toContain(href);

    const warnings: string[] = [];
    page.on("console", (message) => {
      if (/hydrat|did not match|server rendered|mismatch/i.test(message.text())) warnings.push(message.text());
    });
    await signIn(context, learner.sessionToken);
    await page.goto(`/en/learner/course/${SLUG}`);
    await expect(main(page).getByRole("heading", { level: 2, name: "R4 links lesson" })).toBeVisible({ timeout: 20_000 });
    await page.waitForLoadState("networkidle");
    const after = await main(page)
      .locator("a.seq-link")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
    expect(after.filter((href) => expected.includes(href))).toEqual(expected);
    expect(htmlHrefs.filter((href) => expected.includes(href))).toEqual(expected);
    // The address with a space can't be a link: its text shows, unlinked.
    await expect(main(page).getByText("Path", { exact: true })).toBeVisible();
    for (const [, host] of DIVERGENT) {
      for (const href of [...htmlHrefs, ...after]) expect(href, host).not.toContain(host);
    }
    await expect(main(page).getByText("Divergent 4", { exact: true })).toBeVisible();
    // Link text read alike: its words show, without the link, from the server and after hydration.
    for (const [i, text] of READ_ALIKE.entries()) await expect(main(page).getByText(`Alike ${i}: ${text}`, { exact: true })).toBeVisible();
    for (const href of [...htmlHrefs, ...after]) expect(href, "link text read alike").not.toContain("evil.example");
    expect(await main(page).locator('a[href*="evil.example"]').count()).toBe(0);
    expect(warnings).toEqual([]);

    // The address check answers alike in the browser (the Link form's "Will
    // open") and on the server (this test runs in the server's Node):
    // U1's inputs, and the hosts the engines read differently.
    await signIn(context, editor.sessionToken);
    const region = await openLesson(page, EDITED);
    const block = region.getByRole("group", { name: /^block 1 of /i });
    await openParagraph(page, block);
    await page.keyboard.press("ControlOrMeta+k");
    const form = linkForm(block);
    const address = form.getByLabel("Address");
    await expect(form).toBeVisible();
    const willOpen = form.locator('[id$="-will-open"]');
    const rows = [
      ...LINK_INPUTS.filter((row): row is string => typeof row === "string"),
      ...DIVERGENT.map(([href]) => href),
      "https://\u05D1\u05D3\u05D9\u05E7\u05D4.example/",
      "https://a\u3164.example/",
      "https://BÜCHER.example/",
      "mailto:help@example.org?subject=Hi?cc=boss@example.org",
      "www.bpb.de",
      "help@verein.de",
    ];
    const differ: string[] = [];
    for (const row of rows) {
      await address.fill(row);
      const typed = await address.inputValue();
      const check = checkLinkHref(toLinkInput(typed), { ownFileHost: null });
      const server = check.ok && !check.ownFile ? `Will open: ${emailAddressOf(check.href) ?? check.href}` : "";
      const browser = (await willOpen.textContent()) ?? "";
      if (browser !== server) differ.push(`${JSON.stringify(typed.slice(0, 80))}: browser ${JSON.stringify(browser.slice(0, 90))}, server ${JSON.stringify(server.slice(0, 90))}`);
    }
    expect(differ).toEqual([]);
    await page.keyboard.press("Escape");
  });

  test("R4-E15: each named link shows the site it opens, after its words: heard, on one line, at 320 px, in forced colours and zoomed", async ({
    browser,
    baseURL,
  }) => {
    const link = (href: string) => ({ type: "link", attrs: { href } });
    const RTL = "\u05D4\u05DE\u05D3\u05E8\u05D9\u05DA"; // "the guide", in Hebrew
    const LONG_WORDS = "the guide to every step of the application, from the first form to the last interview ".repeat(3).trim();
    // A site longer than a phone's line: the most DNS holds in one label.
    const LONG_SITE = `${"a".repeat(63)}.example`;
    await setNarrative(
      EDITED,
      narrative("R4 links lesson", [
        richBlock(
          paragraphDoc([
            { type: "text", text: "Read " },
            { type: "text", text: "the guide", marks: [link(GUIDE)] },
            { type: "text", text: ", then " },
            { type: "text", text: "example.org/tips", marks: [link("https://example.org/tips")] },
            { type: "text", text: " and " },
            { type: "text", text: "the ministry's page", marks: [link("https://www.minedu.gov.gr/guidance")] },
            { type: "text", text: "." },
          ]),
          "Read the guide, then example.org/tips and the ministry's page."
        ),
        richBlock(
          paragraphDoc([
            { type: "text", text: "In Hebrew: " },
            { type: "text", text: RTL, marks: [link("https://example.org/he")] },
            { type: "text", text: " today." },
          ]),
          `In Hebrew: ${RTL} today.`
        ),
        richBlock(paragraphDoc([{ type: "text", text: LONG_WORDS, marks: [link("https://evil.example/apply")] }]), LONG_WORDS),
        richBlock(
          paragraphDoc([
            { type: "text", text: "A long name: " },
            { type: "text", text: "this one", marks: [link(`https://www.${LONG_SITE}/x`)] },
            { type: "text", text: " or " },
            { type: "text", text: "our team", marks: [link("mailto:help@example.org?subject=Course")] },
            { type: "text", text: "." },
          ]),
          "A long name: this one or our team."
        ),
      ])
    );
    // 320 CSS pixels as a 640-pixel window shows them at 200 % zoom. Reduced
    // motion: a setting switched below takes effect at once, with no
    // colours caught halfway through a transition.
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 320, height: 640 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    try {
      await context.route(/^https?:\/\/(?:[a-z0-9-]+\.)*(?:example\.org|bpb\.de|verein\.de)\//, (route) =>
        route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Elsewhere</title><p>Another site</p>" })
      );
      await signIn(context, learner.sessionToken);
      const page = await context.newPage();
      await page.goto(`/en/learner/course/${SLUG}`);
      await expect(main(page).getByRole("heading", { level: 2, name: "R4 links lesson" })).toBeVisible({ timeout: 20_000 });
      const lesson = main(page);

      // What screen readers hear: the words, the site, then that it opens a new tab.
      const named: [string, string | null][] = [
        ["the guide", "example.org"],
        ["example.org/tips", null], // the words are the address: no box
        ["the ministry's page", "minedu.gov.gr"],
        [RTL, "example.org"],
        [LONG_WORDS, "evil.example"],
        ["this one", LONG_SITE],
        ["our team", "example.org"], // an email link: its address's domain
      ];
      for (const [words, site] of named) {
        // An email link opens the email program (D105).
        const cue = words === "our team" ? EMAIL_PROGRAM : NEW_TAB;
        const name = site ? `${words}, ${site} ${cue}` : `${words} ${cue}`;
        const one = lesson.getByRole("link", { name, exact: true });
        await expect(one, name.slice(0, 60)).toHaveCount(1);
        if (site) await expect(one.locator(".seq-link-site")).toHaveText(site);
        else await expect(one.locator(".seq-link-site")).toHaveCount(0);
      }
      // The browser's own accessibility tree names the link the same way.
      const cdp = await context.newCDPSession(page);
      const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: { role?: { value?: string }; name?: { value?: string } }[] };
      const names = nodes.filter((node) => node.role?.value === "link").map((node) => node.name?.value ?? "");
      expect(names).toContain(`the guide, example.org ${NEW_TAB}`);
      expect(names).toContain(`${RTL}, example.org ${NEW_TAB}`);
      await cdp.detach();

      // Where each box sits, and how it is drawn.
      const layout = () =>
        page.evaluate(() => {
          const shown = (el: Element) => el.getClientRects().length > 0;
          const boxes = [...document.querySelectorAll("main .seq-link-site")].filter(shown).map((box) => {
            const a = box.closest("a")!;
            const words = document.createRange();
            words.setStart(a.firstChild!, 0);
            words.setEndBefore(a.querySelector(".seq-link-sep")!);
            const wordRects = [...words.getClientRects()];
            const last = wordRects[wordRects.length - 1];
            const r = box.getBoundingClientRect();
            const style = getComputedStyle(box);
            const sep = getComputedStyle(a.querySelector(".seq-link-sep")!);
            // The width of the line the box sits in: its paragraph's, less its padding (an indent).
            const block = box.closest("p, li")!;
            const blockStyle = getComputedStyle(block);
            return {
              site: box.textContent ?? "",
              left: r.left,
              right: r.right,
              top: r.top,
              width: r.width,
              height: r.height,
              lineWidth: block.clientWidth - parseFloat(blockStyle.paddingLeft) - parseFloat(blockStyle.paddingRight),
              line: parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 2 * parseFloat(style.borderTopWidth),
              wordsRight: last.right,
              wordsTop: last.top,
              wordsBottom: last.bottom,
              insideLink: a.contains(box),
              bidi: style.unicodeBidi,
              direction: style.direction,
              border: `${style.borderTopStyle} ${parseFloat(style.borderTopWidth) >= 1}`,
              sepHidden: sep.clipPath !== "none" && sep.position === "static",
            };
          });
          const prose = [...document.querySelectorAll("main .seq-prose")].filter(shown);
          return {
            view: document.documentElement.clientWidth,
            scroll: document.scrollingElement!.scrollWidth,
            proseFits: prose.length > 0 && prose.every((el) => el.scrollWidth <= el.clientWidth),
            boxes,
          };
        });
      /** `page`: the whole page has no sideways scroll; else only the lesson's text (text zoomed 200 % on a phone widens the header's controls). */
      const check = async (mode: string, { page: wholePage = true } = {}) => {
        const { view, scroll, proseFits, boxes } = await layout();
        if (wholePage) expect(scroll, `${mode}: no sideways scroll`).toBeLessThanOrEqual(view);
        expect(proseFits, `${mode}: the lesson's text fits its column`).toBe(true);
        expect(boxes.map((box) => box.site).sort(), mode).toEqual(["evil.example", "example.org", "example.org", "example.org", LONG_SITE, "minedu.gov.gr"].sort());
        for (const box of boxes) {
          const what = `${mode}: ${box.site.slice(0, 20)}`;
          expect(box.insideLink, what).toBe(true);
          expect(box.left, what).toBeGreaterThanOrEqual(0);
          expect(box.right, what).toBeLessThanOrEqual(view);
          // On one line, unless the site alone is longer than the line: then it fills the line and wraps inside its box.
          const oneLine = box.height < box.line * 1.5;
          expect(oneLine || box.width >= box.lineWidth - 1, `${what}: ${box.width} of ${box.lineWidth}`).toBe(true);
          if (box.site === LONG_SITE && mode === "320 px") expect(oneLine, what).toBe(false);
          // After the words: beside their last line, or on the next.
          expect(box.left >= box.wordsRight - 1 || box.top >= box.wordsBottom - 1, what).toBe(true);
          expect(box.top, what).toBeGreaterThanOrEqual(box.wordsTop - 2);
          // Right-to-left words never reorder it; it reads left to right.
          expect([box.bidi, box.direction], what).toEqual(["isolate", "ltr"]);
          expect(box.border, what).toBe("solid true");
          expect(box.sepHidden, what).toBe(true);
        }
      };
      const axe = async (mode: string) => {
        const result = await new AxeBuilder({ page })
          .include("main")
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`), mode).toEqual([]);
      };

      await check("320 px");
      await axe("320 px");

      await page.emulateMedia({ forcedColors: "active" });
      await check("forced colours");
      await page.emulateMedia({ forcedColors: "none" });

      // The platform's own high contrast and large text (125 %).
      await page.evaluate(() => {
        document.documentElement.dataset.contrast = "true";
        document.documentElement.dataset.fontSize = "xl";
      });
      await check("high contrast, large text");
      await axe("high contrast, large text");
      await page.evaluate(() => {
        delete document.documentElement.dataset.contrast;
        delete document.documentElement.dataset.fontSize;
      });

      // Text zoomed 200 % as well.
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
      await check("text 200 %", { page: false });
    } finally {
      await context.close();
    }
  });

  test("R4-E15b: no character in or around a named link moves its box away from its words: right-to-left marks and letters, blank characters, at 320, 640 and 1,280 px", async ({
    browser,
    baseURL,
  }) => {
    const EVIL = "https://evil.example/login";
    const PAYPAL = "https://www.paypal.com/signin";
    const RLM = "\u200F"; // right-to-left mark
    const ALM = "\u061C"; // Arabic letter mark
    const SOF_PASUQ = "\u05C3"; // Hebrew punctuation, right to left, drawn like a colon
    const GERESH = "\u05F3"; // Hebrew punctuation, right to left, drawn like an apostrophe
    const LOCK = "\u{1F512}";
    const LONG = "Sign in to your PayPal account to confirm the payment";
    type Run = { type: "text"; text: string; marks?: Record<string, unknown>[] };
    const t = (text: string, href?: string, ...marks: string[]): Run =>
      href ? { type: "text", text, marks: [...marks.map((type) => ({ type })), { type: "link", attrs: { href } }] } : { type: "text", text };
    const scenarios: [string, Run[]][] = [
      ["right-to-left marks", [t("Please "), t(`Sign in to PayPal${RLM}`, EVIL), t(`${RLM}${LOCK}${RLM}`, PAYPAL), t(`${RLM} today.`)]],
      ["Arabic letter marks", [t("Please "), t(`Sign in to PayPal${ALM}`, EVIL), t(`${ALM}\u2192${ALM}`, PAYPAL), t(`${ALM} today.`)]],
      ["right-to-left marks around a wrapping link", [t(`Please read this before you go on${RLM} `), t(`${LONG}${RLM}`, EVIL), t(`${RLM}${LOCK}${RLM}`, PAYPAL), t(`${RLM} today.`)]],
      ["right-to-left punctuation around a wrapping link", [t(`Please read this before you go on${SOF_PASUQ} `), t(LONG, EVIL), t(LOCK, PAYPAL), t(`${GERESH} today.`)]],
      ["Hebrew words", [t("\u05D4\u05EA\u05D7\u05D1\u05E8", EVIL), t(" \u05D5\u05D2\u05DD "), t("\u05E4\u05D9\u05D9\u05E4\u05DC", PAYPAL), t(" \u05D4\u05D9\u05D5\u05DD")]],
      ["spaces", [t(`Sign in to PayPal${" ".repeat(1_500)}`, EVIL), t(" and read on.")]],
      ["em spaces", [t(`Sign in to PayPal${"\u2003".repeat(1_500)}`, EVIL), t(" and read on.")]],
      ["braille blanks", [t(`Sign in to PayPal ${"\u2800".repeat(1_500)}`, EVIL), t(" and read on.")]],
      ["Hangul fillers", [t(`Sign in to PayPal${"\u3164".repeat(1_500)}`, EVIL), t(" and read on.")]],
      ["spaces and zero-width spaces", [t(`Sign in to PayPal${" \u200B".repeat(800)}`, EVIL), t(" and read on.")]],
      ["a box drawn in letters, then em spaces", [t(`Sign in to PayPal \u2595\u1D18\u1D00\u028F\u1D18\u1D00\u029F.\u1D04\u1D0F\u1D0D\u258F${"\u2003".repeat(1_500)}.`, EVIL), t(" and read on.")]],
      ["em spaces in bold and italic parts", [t("Sign in to PayPal", EVIL), ...Array.from({ length: 300 }, (_, i) => t("\u2003", EVIL, i % 2 ? "bold" : "italic")), t(" and read on.")]],
    ];
    await setNarrative(
      EDITED,
      narrative(
        "R4 links lesson",
        scenarios.map(([, content]) => richBlock(paragraphDoc(content), content.map((part) => part.text).join("")))
      )
    );
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    try {
      await signIn(context, learner.sessionToken);
      const page = await context.newPage();
      await page.goto(`/en/learner/course/${SLUG}`);
      await expect(main(page).getByRole("heading", { level: 2, name: "R4 links lesson" })).toBeVisible({ timeout: 20_000 });
      await expect(main(page).locator(".seq-link-site")).toHaveCount(17);

      for (const width of [320, 640, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        const failures = await page.evaluate(() => {
          // What draws nothing: blanks and invisible marks.
          const BLANK = /[\s\u200B-\u200F\u061C\u2060\u2800\u3164\u115F\u1160\uFFA0\u00AD\uFE00-\uFE0F]/u;
          const out: string[] = [];
          for (const paragraph of document.querySelectorAll("main .seq-prose p")) {
            if (!paragraph.getClientRects().length) continue;
            const boxes = [...paragraph.querySelectorAll(".seq-link-site")].map((el) => ({ el, r: el.getBoundingClientRect() }));
            for (const a of paragraph.querySelectorAll("a.seq-link")) {
              const own = a.querySelector(".seq-link-site");
              if (!own) continue;
              const line = parseFloat(getComputedStyle(a).lineHeight);
              const mid = (r: DOMRect) => (r.top + r.bottom) / 2;
              // Reading order on screen: lines top to bottom, each left to right.
              const sameLine = (x: DOMRect, y: DOMRect) => Math.abs(mid(x) - mid(y)) <= line / 2;
              const order = (x: DOMRect, y: DOMRect) => (sameLine(x, y) ? x.left - y.left : mid(x) - mid(y));
              const chars: DOMRect[] = [];
              const walker = document.createTreeWalker(a, NodeFilter.SHOW_TEXT, {
                acceptNode: (n) => (n.parentElement!.closest(".seq-link-sep, .seq-link-site, .sr-only") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
              });
              for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
                let at = 0;
                for (const char of n.data) {
                  if (!BLANK.test(char)) {
                    const range = document.createRange();
                    range.setStart(n, at);
                    range.setEnd(n, at + char.length);
                    chars.push([...range.getClientRects()].find((r) => r.width > 0) ?? range.getBoundingClientRect());
                  }
                  at += char.length;
                }
              }
              const onScreen = chars.sort(order);
              const first = onScreen[0];
              const last = onScreen[onScreen.length - 1];
              const box = own.getBoundingClientRect();
              const name = `${a.getAttribute("href")} (${own.textContent}) in "${paragraph.textContent!.slice(0, 30)}"`;
              // A: the first box at or after the words' first visible character is the link's own.
              const after = boxes.filter((b) => order(b.r, first) >= -1).sort((x, y) => order(x.r, y.r));
              if (after[0]?.el !== own) out.push(`${name}: the first box after its words begin is ${after[0]?.el.textContent ?? "none"}`);
              // B: the box beside the last visible character, or on the next line.
              const beside = sameLine(box, last) && box.left >= last.right - 2;
              const below = mid(box) - mid(last) > line / 2 && mid(box) - mid(last) <= line * 1.5;
              if (!beside && !below) out.push(`${name}: its box is ${Math.round(mid(box) - mid(last))}px from its last visible character`);
              // C: no gap of more than a line between its visible characters.
              for (let i = 1; i < onScreen.length; i++) {
                if (mid(onScreen[i]) - mid(onScreen[i - 1]) > line * 1.5) {
                  out.push(`${name}: its words jump ${Math.round(mid(onScreen[i]) - mid(onScreen[i - 1]))}px`);
                  break;
                }
              }
            }
          }
          return out;
        });
        expect(failures, `${width} px`).toEqual([]);
      }
    } finally {
      await context.close();
    }
  });
});
