import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, removePeople, runId, signIn } from "./fixtures/people";
import { ownLessonId } from "./fixtures/r2-course";
import { removeECourse, seedECourse } from "./fixtures/r3-e-course";
import { linkedParagraph, richBlock } from "./fixtures/r4-hostile-links";
import { callAction } from "./fixtures/server-action";

/**
 * Release 4, R4-F1 (spec 9.1; R4-I3, 10.6): what the build Release 4 rolls
 * back to does with lesson text stored as version 2 (D104, spec 3.3, 7.2).
 * It runs only against that build (r3 until Fri 20 Nov, main after), named
 * by E2E_R4_ROLLBACK_BUILD=1, with E2E_NEXT_DIR its .next folder: on Release
 * 4's own build the same save keeps the link.
 *
 *   1. A direct saveLessonNarrative call with a version-2 paragraph holding
 *      a link: the stored block is { kind, text }, the text as sent, its
 *      address included; nothing of the link mark is stored.
 *   2. A version-2 paragraph written straight into the database: the
 *      learner page draws its text, the address in it a quick link that
 *      opens in a new tab.
 *
 * Requires a real database (E2E_DB=1). Everything the run made is removed.
 */

const RUN_ON_THIS_BUILD = process.env.E2E_DB === "1" && process.env.E2E_R4_ROLLBACK_BUILD === "1";
const describe = RUN_ON_THIS_BUILD ? test.describe : test.describe.skip;
test.describe.configure({ mode: "serial" });

const prisma = RUN_ON_THIS_BUILD
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  : (null as unknown as PrismaClient);

const RUN = runId();
const SLUG = `e2e-r4-f1-${RUN}`;
const EDITOR = `e2e-r4-f1-editor-${RUN}@example.com`;
const LEARNER = `e2e-r4-f1-learner-${RUN}@example.com`;
const GUIDE = "https://example.org/guide";
const TEXT = `Read the guide (${GUIDE}) today.`;
const SHOWN = ownLessonId();
const SAVED = ownLessonId();

describe("R4-F1: version-2 lesson text on the build Release 4 rolls back to", () => {
  let editor: { sessionToken: string };
  let learner: { sessionToken: string };

  test.beforeAll(async () => {
    await removePeople(prisma, [EDITOR, LEARNER]);
    await seedECourse(prisma, {
      slug: SLUG,
      title: { en: `E2E R4-F1 ${RUN}` },
      lessons: [
        // Written straight into the database, as Release 4 stores a paragraph with a link.
        { id: SHOWN, narrative: { en: { title: "R4-F1 shown", blocks: [richBlock(linkedParagraph(GUIDE), TEXT)] } } },
        { id: SAVED },
      ],
    });
    editor = await createPerson(prisma, { email: EDITOR, roles: ["CONTENT_EDITOR"] });
    learner = await createPerson(prisma, { email: LEARNER, roles: ["LEARNER"] });
  });

  test.afterAll(async () => {
    await removeECourse(prisma, SLUG);
    await removePeople(prisma, [EDITOR, LEARNER]);
    await prisma.$disconnect();
  });

  test("a saved version-2 paragraph is stored as its text, the address in it", async ({ request }) => {
    const answer = await callAction(request, {
      as: editor,
      page: `/en/content/courses/${SLUG}`,
      file: "src/app/actions/lesson.ts",
      name: "saveLessonNarrative",
      args: [SLUG, SAVED, "en", { title: "R4-F1 saved", blocks: [richBlock(linkedParagraph(GUIDE), TEXT)] }, null],
    });
    expect(answer.result, answer.raw.slice(0, 300)).toMatchObject({ ok: true });
    const row = await prisma.lesson.findFirstOrThrow({
      where: { projectId: "seq-elevate", courseSlug: SLUG, stageKey: SAVED },
      select: { narrative: true },
    });
    expect((row.narrative as { en: { blocks: unknown[] } }).en.blocks).toEqual([{ kind: "paragraph", text: TEXT }]);
  });

  test("a stored version-2 paragraph is drawn from its text, the address a quick link", async ({ page, context }) => {
    await signIn(context, learner.sessionToken);
    await page.goto(`/en/learner/course/${SLUG}`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 2, name: "R4-F1 shown" })).toBeVisible({ timeout: 15_000 });
    // The text as stored, with only its address linked.
    await expect(main.getByRole("region", { name: "Text" })).toMatchAriaSnapshot(`
      - paragraph:
        - text: Read the guide (
        - link "${GUIDE} (opens in a new tab)":
          - /url: ${GUIDE}
        - text: ) today.
    `);
    const link = main.getByRole("link", { name: `${GUIDE} (opens in a new tab)`, exact: true });
    await expect(link).toHaveAttribute("href", GUIDE);
    await expect(link).toHaveAttribute("target", "_blank");
    // Only the address is a link: no link is named "the guide".
    await expect(main.getByRole("link", { name: /^the guide/ })).toHaveCount(0);
  });
});
