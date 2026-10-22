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
import { checkLinkHref, emailAddressOf, type LinkRefusal } from "@/lib/rich-text/link-url";
import { addressProblem } from "@/lib/rich-text/sanitize";

/**
 * Release 4, Part A (spec 3, 10.2, 10.3): named links in lesson text.
 *
 *   R4-E1  keyboard only: select words, Ctrl+K, an address, Enter, Save; the
 *          learner gets a link that opens in a new tab; stored as version 2,
 *          the mark holding its address only, the text naming it.
 *   R4-E2  an http address: the warning is announced once, "Will open: …"
 *          describes the field (not a live region); the learner's link opens
 *          http under Release 3's headers.
 *   R4-E3  the form refuses what can't be a link, by name, announced each
 *          time; focus; Escape; a bare email address and host are
 *          completed, never blocked; the "Link: …" line; Ctrl+K on words
 *          across paragraphs says why it can't link them.
 *   R4-E5  email links keep target="_blank" (their screen-reader words change
 *          in L2, with QuickLink).
 *   R4-E6  (guard) every hostile address and mark sent straight to
 *          saveLessonNarrative and savePartText is refused by name (extra
 *          attributes: stored without them), and nothing changes; so are
 *          links read with the text touching them (WORD_MARKS).
 *   R4-E6c link text with a dot that shows no other site (ACCEPTED_LABELS:
 *          an abbreviation, the link's registrable domain) is saved with
 *          its link, through both actions.
 *   R4-E7  (guard) hostile links written straight into the database: no page
 *          draws an href outside https, http and mailto, nor one whose text
 *          shows another address; the text of every refused link shows; the
 *          editor opens them safely and names the links it left out. The
 *          ACCEPTED_LABELS are drawn as links.
 *   R4-E7b editing a link's text into another address: named at once, Save
 *          refused by name, nothing stored without the link; the words go
 *          to Save beside the text, so an older save keeps them.
 *   R4-E8  international and percent-encoded addresses: the same href from
 *          the server and after hydration, no hydration warning, hosts the
 *          engines read differently never a link; the address check answers
 *          alike in the browser (the Link form) and on the server.
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
const EDITOR = `e2e-r4-links-editor-${RUN}@example.com`;
const LEARNER = `e2e-r4-links-learner-${RUN}@example.com`;
const NEW_TAB = "(opens in a new tab)";
const GUIDE = "https://example.org/guide";
const SAFE_SCHEME = /^(?:https:\/\/|http:\/\/|mailto:)/;
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
const HOSTILE_SHAPES = [...HOSTILE_MARKS, ...RENDER_ONLY_MARKS, ...WORD_MARKS].map((row, i) =>
  richBlock(row.rich, `Shape ${i}`)
);
/** Link text with a dot that shows no other site, each its own paragraph: kept as a link. */
const ACCEPTED_BLOCKS = ACCEPTED_LABELS.map(({ label, href }) => richBlock(linkedParagraph(href, label), `Read ${label} today.`));

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
    editor = await createPerson(prisma, { email: EDITOR, roles: ["CONTENT_EDITOR"] });
    learner = await createPerson(prisma, { email: LEARNER, roles: ["LEARNER"] });
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actor: { is: { email: { in: [EDITOR, LEARNER] } } } } });
    await removeECourse(prisma, SLUG);
    await removeECourse(prisma, SLUG_H);
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
    const link = main(page).getByRole("link", { name: `the guide ${NEW_TAB}`, exact: true });
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
    const link = main(page).getByRole("link", { name: `the old site ${NEW_TAB}`, exact: true });
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
    // A file's name that ends in a top-level domain looks like a web address
    // (refused all the same: it fails safe), and the form says so.
    await text.fill("course-materials.zip");
    await address.fill("https://example.org/files/course-materials");
    await text.press("Enter");
    await expect(form.getByRole("alert")).toHaveText(
      "The text looks like a web address, but the link opens another one. Use a few words instead, or show the real address."
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
    await expect(textbox.locator("a")).toHaveAttribute("href", "mailto:help@verein.de");

    // No selection: focus goes to the text to show; a bare host is completed.
    await page.keyboard.press(TEXT_END);
    await page.keyboard.type(" See ");
    await page.keyboard.press("ControlOrMeta+k");
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

  // The words screen readers hear for email links change with QuickLink in
  // Part A's second half (L2, from Mon 16 Nov: lessonLinks.email, D105).
  test.fixme("R4-E5 (L2): email links say \"(opens your email program)\"", async () => {});

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
      // Names read only by the top-level domain they end in look like a web address.
      "a label that shows another site through look-alike letters":
        /Block 1 \(Paragraph\): the link text “paypal\.соm” looks like a web address, but the link opens another one\./,
      "a label that shows another site as a host wrapped for emphasis":
        /Block 1 \(Paragraph\): the link text “_paypal\.com_” looks like a web address, but the link opens another one\./,
      "a label that shows another site in front of the link's":
        /Block 1 \(Paragraph\): the link text “paypal\.com\.evil\.example” looks like a web address, but the link opens another one\./,
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
    const accepted = ACCEPTED_LABELS.map(({ label, href }) => richBlock(linkedParagraph(href, label), `Read ${label} today.`));
    const textAnswer = await callAction(request, {
      as: editor,
      page,
      file: "src/app/actions/lesson.ts",
      name: "saveLessonNarrative",
      args: [SLUG, SAVES, "en", { title: "R4 direct saves", blocks: accepted }, null],
    });
    expect(textAnswer.result, textAnswer.raw.slice(0, 300)).toMatchObject({ ok: true });
    const kept = await storedBlocks(SAVES);
    expect(kept.map((block) => block.rich)).toEqual(ACCEPTED_LABELS.map(({ label, href }) => linkedParagraph(href, label)));
    for (const [i, { href }] of ACCEPTED_LABELS.entries()) expect(kept[i].text, href).toContain(`(${href})`);
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
    for (const { href } of ACCEPTED_LABELS) expect(JSON.stringify(piece.parts), href).toContain(`"attrs":{"href":"${href}"}`);
  });

  // A reflection lesson's introduction is saved by saveLessonNarrative, which
  // hands its one paragraph to sanitizeNarrativeBlocks as a lesson's blocks;
  // the introduction's wording (sanitizeNarrativeBlocks(…, "reflection-intro"),
  // as its editor's problem line says it) comes when R2 may edit
  // src/app/actions/lesson.ts (Release 3 Stream E's until 13 Nov; spec 9.3).
  test.fixme("R4-E6b (R2): a reflection lesson's introduction over the limit is refused by its name: \"Shorten it.\"", async ({
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
        if (href.startsWith("/") || href.startsWith("#")) continue; // the site's own pages
        expect(href, `${name}: ${href.slice(0, 80)}`).toMatch(SAFE_SCHEME);
        // Every link to evil.example shows another address (or is refused): none is drawn.
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
      // Link text with a dot that shows no other site is drawn as a link.
      for (const { label, href } of ACCEPTED_LABELS) {
        await expect(scope.locator(`a[href="${href}"]`, { hasText: label }).first(), `${name}: ${label}`).toBeVisible();
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
    await setNarrative(
      EDITED,
      narrative("R4 links lesson", [
        ...ADDRESSES.map(([label, href]) =>
          richBlock(paragraphDoc([{ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }]), label)
        ),
        ...DIVERGENT.map(([href], i) =>
          richBlock(paragraphDoc([{ type: "text", text: `Divergent ${i}`, marks: [{ type: "link", attrs: { href } }] }]), `Divergent ${i}`)
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
});
