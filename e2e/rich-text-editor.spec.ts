import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * The lesson text editor (D36) on the course page: an author formats a
 * paragraph with bold, italic, lists and indent, pastes from Word or plain
 * text, and chooses bullets or numbers for a list block. What is saved is
 * checked in the database; what learners see, in the player.
 *
 * The player assertions (<strong>, nested <ul>, bulleted list blocks) need
 * the learner renderer (RichTextView in NarrativeStage, workstream R3-B).
 *
 * Requires a real database — gated on E2E_DB=1, like course-page.spec.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;
test.describe.configure({ mode: "serial", timeout: 90_000 });

const PROJECT = "seq-elevate";
// Not the addresses rich-text-learner.spec uses: the two files run in
// parallel, and each deletes its own users before and after.
const EDITOR = "e2e-rt-editor-author@example.com";
const LEARNER = "e2e-rt-editor-learner@example.com";
const EMAILS = [EDITOR, LEARNER];
const SLUG = "e2e-rich-text-editor";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** A stored doc node, as far as these checks read it. */
type DocNode = {
  type: string;
  text?: string;
  marks?: { type: string }[];
  attrs?: Record<string, unknown>;
  content?: DocNode[];
};
type SavedBlock = {
  kind: string;
  text?: string;
  rich?: { v: number; doc: DocNode };
  items?: string[];
  listStyle?: string;
};

/**
 * What Word puts on the clipboard for a short list: each point is a
 * paragraph styled `mso-list:l0 levelN`, its bullet drawn by a marker span
 * (`mso-list:Ignore`) between Word's conditional comments.
 */
const WORD_HTML = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><style><!-- p.MsoListParagraph {mso-style-priority:34;} --></style></head>
<body lang=EN-GB style='tab-interval:36.0pt'>
<!--StartFragment-->
<p class=MsoNormal><b>Before you reply:</b><o:p></o:p></p>
<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-fareast-font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Pause<o:p></o:p></p>
<p class=MsoListParagraphCxSpMiddle style='margin-left:72.0pt;mso-add-space:auto;text-indent:-18.0pt;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='font-family:"Courier New"'><span style='mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span></span><![endif]>Breathe <i>slowly</i><o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Ask a question<o:p></o:p></p>
<p class=MsoNormal><span style='color:red;font-size:20.0pt'>Red text</span><o:p>&nbsp;</o:p></p>
<!--EndFragment-->
</body></html>`;

/** Create a user holding `role`, plus a live session; returns both ids. */
async function signedInUser(email: string, role: "CONTENT_EDITOR" | "LEARNER") {
  const user = await prisma.user.create({
    data: { email, emailVerified: new Date() },
  });
  await prisma.membership.create({
    data: { userId: user.id, projectId: PROJECT, role },
  });
  const sessionToken = `e2e-rt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await prisma.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 86_400_000),
    },
  });
  return { userId: user.id, sessionToken };
}

/**
 * Leave every open page before switching users. A page's in-flight
 * /api/auth/session call re-sets the session cookie when it returns, and one
 * returning after the switch would sign the previous user back in.
 */
async function useSession(
  context: import("@playwright/test").BrowserContext,
  sessionToken: string
) {
  for (const open of context.pages()) await open.goto("about:blank");
  await context.clearCookies();
  await context.addCookies([
    {
      name: "authjs.session-token",
      value: sessionToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

const lessonKey = {
  projectId_courseSlug_stageKey: {
    projectId: PROJECT,
    courseSlug: SLUG,
    stageKey: "concept",
  },
};

/** Start a test from these English blocks in the concept lesson. */
async function seedConcept(blocks: unknown[]) {
  const narrative = {
    en: { title: "Rich text lesson", blocks },
  } as Prisma.InputJsonValue;
  await prisma.lesson.upsert({
    where: lessonKey,
    create: {
      projectId: PROJECT,
      courseSlug: SLUG,
      stageKey: "concept",
      narrative,
    },
    update: { narrative },
  });
}

async function savedBlocks(): Promise<SavedBlock[]> {
  const row = await prisma.lesson.findUnique({ where: lessonKey });
  return (
    (row?.narrative as { en?: { blocks?: SavedBlock[] } } | null)?.en
      ?.blocks ?? []
  );
}

/** Text as typed in the browser may carry no-break spaces. */
const plainSpaces = (text: string | undefined) =>
  (text ?? "").replace(/\u00a0/g, " ");

/** The concept lesson's text editor, opened from the course page. */
async function openLesson(page: Page) {
  await page.goto(`/en/content/courses/${SLUG}?lesson=concept`);
  // Visible only: while the page streams, a hidden server copy can linger.
  const region = page
    .locator("#lesson-concept")
    .filter({ visible: true })
    .getByRole("region", { name: /lesson text/i });
  await expect(region).toBeVisible({ timeout: 15000 });
  const blocks = region.getByRole("group", { name: /^block \d+ of \d+/i });
  return { region, blocks };
}

/**
 * Open a paragraph's or key message's editor by selecting its preview.
 * Retried: a click before hydration does nothing.
 */
async function openEditor(block: Locator, kind: "paragraph" | "key message") {
  const textbox = block.getByRole("textbox", {
    name: new RegExp(`^${kind} text$`, "i"),
  });
  const preview = block.getByRole("button", {
    name: new RegExp(`^edit ${kind}$`, "i"),
  });
  await expect(async () => {
    if (await preview.isVisible()) await preview.click({ timeout: 2000 });
    await expect(textbox).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30000 });
  return textbox;
}

/** "Add block", then a template (retried against the hydration race). */
async function addBlock(region: Locator, template: RegExp) {
  const picker = region.getByText("Choose what to add:").locator("..");
  await expect(async () => {
    if (!(await picker.isVisible())) {
      await region
        .getByRole("button", { name: /^add block$/i })
        .click({ timeout: 2000 });
    }
    await expect(picker).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await picker.getByRole("button", { name: template }).click();
}

/** Paste into the editor as the browser would, with this clipboard data. */
async function paste(target: Locator, data: Record<string, string>) {
  await target.evaluate((el, entries) => {
    const clipboardData = new DataTransfer();
    for (const [type, value] of Object.entries(entries)) {
      clipboardData.setData(type, value);
    }
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      })
    );
  }, data);
}

async function save(region: Locator) {
  await region.getByRole("button", { name: /^save english$/i }).click();
  await expect(region.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });
}

/**
 * The concept lesson in the player, as the editor's preview opens it; returns
 * the visible main landmark. Scoped to it: when React client-renders the page
 * while it is still streaming, the server's copy of the first lesson shown —
 * this one — can stay behind in a hidden <div> at the end of <body>.
 */
async function playerConcept(page: Page) {
  await page.goto(`/en/learner/course/${SLUG}?preview=1&lesson=concept`);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { name: "Rich text lesson" })
  ).toBeVisible({ timeout: 15000 });
  return main;
}

describe("Rich text — the lesson text editor", () => {
  let editorId: string;
  let editorSession: string;
  let learnerSession: string;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.lesson.deleteMany({ where: { courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { slug: SLUG } });
    // Published, so a learner sees what editors save.
    await prisma.course.create({
      data: {
        projectId: PROJECT,
        strapiId: `cms-${SLUG}`,
        slug: SLUG,
        cluster: "communication",
        durationMinutes: 15,
        status: "published",
        publishedAt: new Date(),
        meta: {
          en: {
            title: "E2E Rich Text",
            tagline: "format me",
            clusterLabel: "Communication",
          },
        },
      },
    });
    const editor = await signedInUser(EDITOR, "CONTENT_EDITOR");
    editorId = editor.userId;
    editorSession = editor.sessionToken;
    learnerSession = (await signedInUser(LEARNER, "LEARNER")).sessionToken;
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: editorId } });
    // Users first: their enrolments cascade away with them.
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.lesson.deleteMany({ where: { courseSlug: SLUG } });
    await prisma.course.deleteMany({ where: { slug: SLUG } });
  });

  test("an author formats a paragraph; untouched blocks stay plain; learners see the formatting", async ({
    page,
    context,
  }) => {
    await seedConcept([
      { kind: "paragraph", text: "First paragraph." },
      { kind: "paragraph", text: "Second, untouched paragraph." },
      { kind: "callout", text: "Remember this." },
      { kind: "list", items: ["One", "Two"] },
    ]);
    await useSession(context, editorSession);
    const { region, blocks } = await openLesson(page);
    await expect(blocks).toHaveCount(4);

    // Until it's opened, a block shows exactly as learners see it.
    await expect(
      region.getByRole("textbox", { name: /^(paragraph|key message) text$/i })
    ).toHaveCount(0);
    await expect(
      blocks.nth(1).getByRole("button", { name: /^edit paragraph$/i })
    ).toContainText("Second, untouched paragraph.");

    const text = await openEditor(blocks.nth(0), "paragraph");
    await expect(text).toBeFocused();
    await expect(text).toHaveText("First paragraph.");
    const toolbar = blocks
      .nth(0)
      .getByRole("toolbar", { name: /^paragraph formatting$/i });
    const tool = (name: RegExp) => toolbar.getByRole("button", { name });
    await expect(tool(/^undo$/i)).toBeDisabled();
    await expect(
      blocks.nth(0).getByText(/^tip: paste from word or google docs/i)
    ).toBeVisible();

    // Opened with the others as previews: nothing serious for axe.
    const scan = await new AxeBuilder({ page })
      .include("#lesson-concept")
      .withTags(TAGS)
      .analyze();
    const serious = scan.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);

    // Bold from the keyboard…
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.type(" Bold");
    await expect(tool(/^bold$/i)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ControlOrMeta+b");
    await expect(tool(/^bold$/i)).toHaveAttribute("aria-pressed", "false");
    // …italic from the toolbar, which leaves the cursor in the text.
    await tool(/^italic$/i).click();
    await page.keyboard.type(" italic");
    await expect(tool(/^italic$/i)).toHaveAttribute("aria-pressed", "true");
    await tool(/^italic$/i).click();
    await expect(text.locator("strong")).toHaveText(/Bold/);
    await expect(text.locator("em")).toHaveText(/italic/);

    // A bulleted list, and Tab nests a point.
    await page.keyboard.press("Enter");
    await tool(/^bulleted list$/i).click();
    await expect(tool(/^bulleted list$/i)).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await page.keyboard.type("Point one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Nested point");
    await page.keyboard.press("Tab");
    await expect(text.locator("ul ul li")).toHaveText("Nested point");
    await expect(text).toBeFocused();

    // Undo and Redo from the toolbar.
    await tool(/^undo$/i).click();
    await expect(text.locator("ul ul")).toHaveCount(0);
    await tool(/^redo$/i).click();
    await expect(text.locator("ul ul li")).toHaveText("Nested point");

    await save(region);
    const saved = await savedBlocks();
    expect(saved.map((b) => b.kind)).toEqual([
      "paragraph",
      "paragraph",
      "callout",
      "list",
    ]);
    const [first] = saved;
    expect(first.rich?.v).toBe(1);
    const doc = first.rich!.doc.content ?? [];
    expect(doc.map((b) => b.type)).toEqual(["paragraph", "bulletList"]);
    const marked = (doc[0].content ?? []).map((n) => [
      plainSpaces(n.text).trim(),
      (n.marks ?? []).map((m) => m.type).join("+"),
    ]);
    expect(marked).toContainEqual(["Bold", "bold"]);
    expect(marked).toContainEqual(["italic", "italic"]);
    // The plain text beside it is the server's, derived from the doc.
    expect(plainSpaces(first.text)).toBe(
      "First paragraph. Bold italic\n\n• Point one\n• Nested point"
    );
    // Blocks nobody edited are stored exactly as before: plain text.
    expect(saved[1]).toEqual({
      kind: "paragraph",
      text: "Second, untouched paragraph.",
    });
    expect(saved[2]).toEqual({ kind: "callout", text: "Remember this." });
    expect(saved[3]).toEqual({ kind: "list", items: ["One", "Two"] });

    // The course is published: a learner sees the formatting at once.
    await useSession(context, learnerSession);
    await page.goto(`/en/learner/course/${SLUG}`);
    const bold = page.locator(".seq-prose strong", { hasText: "Bold" });
    // context → concept; only click on while the lesson isn't there yet.
    await expect(async () => {
      if (!(await bold.isVisible())) {
        await page
          .getByRole("button", { name: /^continue$/i })
          .first()
          .click({ timeout: 2000 });
      }
      await expect(bold).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 20000 });
    await expect(
      page.locator(".seq-prose em", { hasText: "italic" })
    ).toBeVisible();
    await expect(page.locator(".seq-prose ul ul li")).toHaveText(
      "Nested point"
    );
    await expect(page.getByText("Second, untouched paragraph.")).toBeVisible();
  });

  test("pasting from Word keeps bold, italic and lists; plain text follows the learner rules", async ({
    page,
    context,
  }) => {
    await seedConcept([{ kind: "paragraph", text: "Intro." }]);
    await useSession(context, editorSession);
    const { region, blocks } = await openLesson(page);
    await expect(blocks).toHaveCount(1);

    // A new paragraph opens ready to type in.
    await addBlock(region, /^paragraph$/i);
    await expect(blocks).toHaveCount(2);
    const word = blocks
      .nth(1)
      .getByRole("textbox", { name: /^paragraph text$/i });
    await expect(word).toBeFocused({ timeout: 15000 });
    await paste(word, {
      "text/html": WORD_HTML,
      "text/plain": "Before you reply:\n·\tPause\no\tBreathe slowly",
    });
    // Word's list paragraphs are a real, nested list; its bullet
    // characters, fonts and colours are gone.
    await expect(word.locator(":scope > ul > li")).toHaveCount(2);
    await expect(word.locator("ul > li > ul > li")).toHaveText(
      "Breathe slowly"
    );
    await expect(word.locator("strong")).toHaveText("Before you reply:");
    await expect(word.locator("em")).toHaveText("slowly");
    await expect(word).not.toContainText("·");
    await expect(word.locator("[style*='color']")).toHaveCount(0);
    await expect(word).toContainText("Red text");

    // Plain text with line breaks: "1." and "•" lines become lists, as
    // they always have for learners.
    await addBlock(region, /^paragraph$/i);
    await expect(blocks).toHaveCount(3);
    const plain = blocks
      .nth(2)
      .getByRole("textbox", { name: /^paragraph text$/i });
    await expect(plain).toBeFocused({ timeout: 15000 });
    await paste(plain, {
      "text/plain": "Steps:\n1. Listen\n2. Ask\n\n• Thank them",
    });
    await expect(plain.locator("ol > li")).toHaveText(["Listen", "Ask"]);
    await expect(plain.locator("ul > li")).toHaveText(["Thank them"]);

    await save(region);
    const saved = await savedBlocks();
    expect(saved[0]).toEqual({ kind: "paragraph", text: "Intro." });

    const pasted = saved[1].rich?.doc.content ?? [];
    expect(pasted.map((b) => b.type)).toEqual([
      "paragraph",
      "bulletList",
      "paragraph",
    ]);
    const pause = pasted[1].content?.[0];
    expect(pause?.content?.map((b) => b.type)).toEqual([
      "paragraph",
      "bulletList",
    ]);
    expect(plainSpaces(saved[1].text)).toBe(
      "Before you reply:\n\n• Pause\n• Breathe slowly\n• Ask a question\n\nRed text"
    );

    const typed = saved[2].rich?.doc.content ?? [];
    expect(typed.map((b) => b.type)).toEqual([
      "paragraph",
      "orderedList",
      "bulletList",
    ]);
    expect(saved[2].text).toBe("Steps:\n\n1. Listen\n2. Ask\n\n• Thank them");

    // The player shows the nested list.
    const player = await playerConcept(page);
    await expect(player.locator(".seq-prose ul ul li")).toHaveText(
      "Breathe slowly"
    );
    await expect(player.locator(".seq-prose ol li")).toHaveText([
      "Listen",
      "Ask",
    ]);
  });

  test("a list block shows bullets or numbers; a bulleted list comes from the templates", async ({
    page,
    context,
  }) => {
    await seedConcept([{ kind: "list", items: ["One", "Two"] }]);
    await useSession(context, editorSession);
    const { region, blocks } = await openLesson(page);
    const list = blocks.nth(0);
    // Saved before list styles existed: numbers, as learners saw it.
    await expect(list).toHaveAccessibleName(/: numbered list$/i);
    const style = list.getByRole("group", { name: /^list style$/i });
    const bullets = style.getByRole("button", { name: /^bullets$/i });
    const numbers = style.getByRole("button", { name: /^numbers$/i });
    await expect(numbers).toHaveAttribute("aria-pressed", "true");
    await expect(async () => {
      await bullets.click({ timeout: 2000 });
      await expect(bullets).toHaveAttribute("aria-pressed", "true", {
        timeout: 2000,
      });
    }).toPass({ timeout: 15000 });
    await expect(numbers).toHaveAttribute("aria-pressed", "false");
    await expect(list).toHaveAccessibleName(/: bulleted list$/i);

    await addBlock(region, /^bulleted list$/i);
    await expect(blocks).toHaveCount(2);
    const added = blocks.nth(1);
    await expect(added).toHaveAccessibleName(/^block 2 of 2: bulleted list$/i);
    await added.getByLabel(/^item 1$/i).fill("Alpha");
    await added.getByLabel(/^item 2$/i).fill("Beta");

    await save(region);
    expect(await savedBlocks()).toEqual([
      { kind: "list", items: ["One", "Two"], listStyle: "bullet" },
      { kind: "list", items: ["Alpha", "Beta"], listStyle: "bullet" },
    ]);

    const player = await playerConcept(page);
    await expect(player.locator("ul.list-disc > li")).toHaveText([
      "One",
      "Two",
      "Alpha",
      "Beta",
    ]);
    await expect(player.locator("ol.list-decimal")).toHaveCount(0);
  });

  test("keyboard: the toolbar is one Tab stop, and Tab leaves a list at its deepest level", async ({
    page,
    context,
  }) => {
    await seedConcept([]);
    await useSession(context, editorSession);
    const { region, blocks } = await openLesson(page);
    await addBlock(region, /^paragraph$/i);
    const text = blocks
      .nth(0)
      .getByRole("textbox", { name: /^paragraph text$/i });
    await expect(text).toBeFocused({ timeout: 15000 });
    const toolbar = blocks
      .nth(0)
      .getByRole("toolbar", { name: /^paragraph formatting$/i });
    const tool = (name: RegExp) => toolbar.getByRole("button", { name });

    // "- " starts a bulleted list, as in Word; Tab moves a point in.
    await page.keyboard.type("- One");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Two");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Three");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Four");
    await expect(text.locator("ul ul ul > li")).toHaveText(["Three", "Four"]);
    await expect(tool(/^increase indent$/i)).toBeDisabled();

    // Learners see three levels, so Tab isn't taken at the third: focus
    // moves on and the text is unchanged (no keyboard trap).
    await page.keyboard.press("Tab");
    await expect(text).not.toBeFocused();
    await expect(text.locator("ul ul ul ul")).toHaveCount(0);

    // Escape goes to the toolbar; arrows, Home and End move inside it.
    await text.click();
    await page.keyboard.press("Escape");
    await expect(tool(/^bold$/i)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(tool(/^italic$/i)).toBeFocused();
    await page.keyboard.press("End");
    // Nothing to redo yet, so the last button that works is Undo.
    await expect(tool(/^undo$/i)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(tool(/^bold$/i)).toBeFocused();
    await expect(toolbar.locator('button[tabindex="0"]')).toHaveCount(1);
    // One Tab stop: the next Tab is back in the text.
    await page.keyboard.press("Tab");
    await expect(text).toBeFocused();
  });

  test("text too long to save is flagged as it's pasted, and Save names the block", async ({
    page,
    context,
  }) => {
    await seedConcept([{ kind: "paragraph", text: "Short." }]);
    await useSession(context, editorSession);
    const { region, blocks } = await openLesson(page);
    const text = await openEditor(blocks.nth(0), "paragraph");
    await expect(text).toBeFocused();
    await paste(text, { "text/plain": "x".repeat(10_001) });
    await expect(blocks.nth(0).getByRole("alert")).toHaveText(
      /this paragraph is too long — at most 10,000 characters/i
    );

    await region.getByRole("button", { name: /^save english$/i }).click();
    await expect(
      region.getByRole("alert").filter({ hasText: /not saved/i })
    ).toContainText(/block 1 \(paragraph\) is too long/i, { timeout: 15000 });
    // Nothing was written.
    expect(await savedBlocks()).toEqual([{ kind: "paragraph", text: "Short." }]);
  });
});
