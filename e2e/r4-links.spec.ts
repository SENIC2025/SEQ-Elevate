import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, removePeople, runId, signIn } from "./fixtures/people";
import { ownLessonId, parts, partId, PROJECT } from "./fixtures/r2-course";
import { removeECourse, seedECourse } from "./fixtures/r3-e-course";
import {
  HOSTILE_ADDRESSES,
  HOSTILE_MARKS,
  RENDER_ONLY_MARKS,
  linkedParagraph,
  overLimitDoc,
  paragraphDoc,
  richBlock,
} from "./fixtures/r4-hostile-links";
import { callAction } from "./fixtures/server-action";

/**
 * Release 4, Part A (spec 3, 10.2, 10.3): named links in lesson text.
 *
 *   R4-E1  keyboard only: select words, Ctrl+K, an address, Enter, Save; the
 *          learner gets a link that opens in a new tab; stored as version 2,
 *          the mark holding its address only, the text naming it.
 *   R4-E2  an http address: the warning is announced once, "Will open: …"
 *          describes the field (not a live region); the learner's link opens
 *          http under Release 3's headers.
 *   R4-E3  the form refuses what can't be a link, by name; focus; Escape; a
 *          bare email address and host are completed, never blocked; the
 *          "Link: …" line.
 *   R4-E5  email links keep target="_blank" (their screen-reader words change
 *          in L2, with QuickLink).
 *   R4-E6  (guard) every hostile address and mark sent straight to
 *          saveLessonNarrative and savePartText is refused by name (extra
 *          attributes: stored without them), and nothing changes.
 *   R4-E7  (guard) hostile links written straight into the database: no page
 *          draws an href outside https, http and mailto, the text of every
 *          refused link shows, and the editor opens them safely.
 *   R4-E7b editing a link's text into another address: named at once, Save
 *          refused by name, nothing stored without the link.
 *   R4-E8  international and percent-encoded addresses: the same href from
 *          the server and after hydration, no hydration warning.
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
const HOSTILE_SHAPES = [...HOSTILE_MARKS, ...RENDER_ONLY_MARKS].map((row, i) =>
  richBlock(row.rich, `Shape ${i}`)
);

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
        { id: HOSTILE, narrative: narrative("R4 hostile links", [...HOSTILE_BLOCKS, ...HOSTILE_SHAPES]) },
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
    }
    // Text that shows another address: refused under the text.
    await text.fill("https://bank.example");
    await address.fill("https://evil.example/");
    await form.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(text).toBeFocused();
    await expect(await errorOf(text)).toContainText([
      "The text shows a different address than the link opens. Show the real address, or use a few words.",
    ]);

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
    for (const row of HOSTILE_ADDRESSES) {
      const expected =
        row.name === "1,000,000 characters"
          ? /^(?:Content 2: )?Block 1 \(Paragraph\) is too long/
          : (why[row.reason] ?? /: the link “the guide” can't be used\. Use an address starting with https:\/\/ or http:\/\/, or an email address\./);
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
      "two link marks on one text": /Block 1 \(Paragraph\): the link “the guide” can't be used\./,
      "a label that shows another address":
        /Block 1 \(Paragraph\): the link text “https:\/\/bank\.example\/login” shows a different address than the link opens\./,
      "two touching links that together show another address":
        /Block 1 \(Paragraph\): the link text “https:\/\/bank\.example” shows a different address than the link opens\./,
    };
    for (const row of HOSTILE_MARKS.filter((r) => r.save === "refused")) {
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

    await region.getByRole("button", { name: /^save english$/i }).click();
    await expect(
      region.getByText(
        "Block 1 (Paragraph): the link text “the https://bank.example guide” shows a different address than the link opens. Show the real address, or use a few words."
      )
    ).toBeVisible({ timeout: 15_000 });
    expect(await storedBlocks(EDITED)).toEqual((stored as { en: { blocks: unknown[] } }).en.blocks);
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
    await setNarrative(
      EDITED,
      narrative(
        "R4 links lesson",
        ADDRESSES.map(([label, href]) =>
          richBlock(paragraphDoc([{ type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }]), label)
        )
      )
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
    expect(warnings).toEqual([]);
  });
});
