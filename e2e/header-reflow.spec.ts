import { test, expect, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson } from "./fixtures/people";
import { narrative, removeR2Course, seedR2Course } from "./fixtures/r2-course";

/**
 * Pages fit a 320px phone (WCAG 1.4.10 Reflow) in every language: the home
 * page for a guest, a learner's pages, and a staff member's with the
 * workspace menu. A long address pushed a learner's page 2px sideways and a
 * staff header 7-10px; the guest home page's header 21px in German; a
 * learner with progress pushed "Support learners" 44px in German (its "open"
 * button couldn't wrap); and visually hidden, positioned text escaped the
 * scroll boxes of the people table (364px) and the course step bar (105px).
 *
 * Requires a real database — gated on E2E_DB=1, like db-backed-progress.
 * Everything it creates is unique to this run and removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;

const PROJECT = "seq-elevate";
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// Long on purpose: the account control must not grow with the address.
const LEARNER = `e2e-header-reflow-learner-${RUN}@example.com`;
const STAFF = `e2e-header-reflow-staff-${RUN}@example.com`;
const BIG = `e2e-header-reflow-big-${RUN}@example.com`;
const EMAILS = [LEARNER, STAFF, BIG];
// A created course without guided practice: its editor offers "Add guided practice".
const COURSE = `e2e-header-reflow-${RUN}`;

async function signedInUser(
  email: string,
  roles: ("LEARNER" | "ADMIN" | "CONTENT_EDITOR" | "FACILITATOR")[]
) {
  return (await createPerson(prisma, { email, roles })).sessionToken;
}

async function signIn(context: BrowserContext, sessionToken: string) {
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

describe("pages on a 320px phone", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  let learnerSession: string;
  let staffSession: string;

  test.beforeAll(async () => {
    learnerSession = await signedInUser(LEARNER, ["LEARNER"]);
    // On the roster with progress, beside the button that opens them.
    const learner = await prisma.user.findUniqueOrThrow({ where: { email: LEARNER } });
    const course = await prisma.course.findFirstOrThrow({
      where: { projectId: PROJECT, slug: "workplace-conflict" },
    });
    await prisma.courseEnrollment.create({
      data: {
        userId: learner.id,
        courseId: course.id,
        stagesCompleted: ["CONTEXT", "CONCEPT", "BEHAVIOUR"],
      },
    });
    // Several workspaces: the header shows the workspace menu too.
    staffSession = await signedInUser(STAFF, [
      "ADMIN",
      "CONTENT_EDITOR",
      "FACILITATOR",
    ]);
    await seedR2Course(prisma, {
      slug: COURSE,
      status: "draft",
      title: { en: `E2E reflow ${RUN}`, de: `E2E Umbruch ${RUN}`, el: `E2E αναδίπλωση ${RUN}` },
      lessons: [
        {
          id: "context",
          narrative: narrative({
            en: { title: "Context", text: "E2E context." },
            de: { title: "Kontext", text: "E2E Kontext." },
            el: { title: "Πλαίσιο", text: "E2E πλαίσιο." },
          }),
        },
      ],
    });
  });

  test.afterAll(async () => {
    await removeR2Course(prisma, COURSE);
    await prisma.auditLog.deleteMany({
      where: { actor: { is: { email: { in: EMAILS } } } },
    });
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.$disconnect();
  });

  for (const [who, path] of [
    ["learner", "/learner"],
    // Seven steps in the step bar, which scrolls on its own.
    ["learner", "/learner/course/workplace-conflict"],
    ["staff", "/facilitator"],
    ["staff", "/admin"],
    ["staff", "/admin/people"],
    ["staff", "/analytics"],
    ["staff", "/content/courses"],
    // A created course's own page: its widest labels are the "Add …" buttons.
    ["staff", "/content/courses/<created course>"],
  ] as const) {
    test(`${path} (${who}) doesn't scroll sideways, in English, German and Greek`, async ({
      page,
      context,
    }) => {
      await signIn(context, who === "learner" ? learnerSession : staffSession);
      for (const locale of ["en", "de", "el"]) {
        await page.goto(`/${locale}${path.replace("<created course>", COURSE)}`);
        // Signed in: the account control is there.
        await expect(page.locator('header a[href$="/account"]')).toBeVisible({
          timeout: 15000,
        });
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        );
        expect(overflow, `${locale}: no horizontal scrolling`).toBeLessThanOrEqual(0);
        // Let the page's own requests (the learner's data, settings) finish
        // before moving on: the clean-up afterwards deletes these users.
        await page.waitForLoadState("networkidle");
      }
      await page.goto("about:blank");
    });
  }

  test("the staff workspace menu opens on the screen, not off its edge", async ({
    page,
    context,
  }) => {
    await signIn(context, staffSession);
    await page.goto("/en/facilitator");
    const switcher = page.locator("header summary").first();
    await expect(switcher).toBeVisible({ timeout: 15000 });
    await switcher.click();
    const menu = page.getByRole("navigation", { name: /workspaces/i });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box!.x, "starts on the screen").toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, "ends on the screen").toBeLessThanOrEqual(320);
    await menu.getByRole("link", { name: "Manage people" }).click();
    await expect(page).toHaveURL(/\/en\/admin$/);
    await page.waitForLoadState("networkidle");
    await page.goto("about:blank");
  });

  test("on a phone, controls keep their names, in the page's language", async ({
    page,
    context,
  }) => {
    await signIn(context, learnerSession);
    await page.goto("/de/learner/course/workplace-conflict");
    await expect(page.getByRole("combobox", { name: "Sprache" })).toBeVisible({
      timeout: 15000,
    });
    // The step names don't show at 320px, but still name the buttons.
    const steps = page.getByRole("navigation", { name: "Kursschritte" });
    await expect(steps.getByRole("button", { name: /Kontext/ })).toBeVisible();
    await expect(steps.getByRole("button", { name: /Schnellcheck/ })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.goto("about:blank");
  });

  test("the home page doesn't scroll sideways for a guest, in English, German and Greek", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    for (const locale of ["en", "de", "el"]) {
      await page.goto(`/${locale}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
        timeout: 15000,
      });
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );
      expect(overflow, `${locale}: no horizontal scrolling`).toBeLessThanOrEqual(0);
    }
  });

  test("with the largest text, the skip link stays off the screen until it is focused, in English, German and Greek (WCAG 2.5.8)", async ({
    page,
    context,
  }) => {
    // The profile step: a short page whose header is the first thing on it.
    const big = await createPerson(prisma, { email: BIG, profile: "none", organisation: null, user: { fontSize: "xl" } });
    await signIn(context, big.sessionToken);
    for (const locale of ["en", "de", "el"]) {
      await page.goto(`/${locale}/welcome`);
      await expect(page.locator("html")).toHaveAttribute("data-font-size", "xl", { timeout: 15000 });
      const skip = page.locator("a.skip-link");
      const unfocused = await skip.evaluate((a) => a.getBoundingClientRect().bottom);
      expect(unfocused, `${locale}: the unfocused skip link is above the page`).toBeLessThanOrEqual(0);
      const results = await new AxeBuilder({ page }).withRules(["target-size"]).analyze();
      expect(
        results.violations.flatMap((v) => v.nodes.map((n) => n.target.join(" "))),
        `${locale}: header controls keep their size`
      ).toEqual([]);
      // Focused, it is on the screen, all of it.
      await page.locator("body").focus();
      await page.keyboard.press("Tab");
      await expect(skip).toBeFocused();
      await expect
        .poll(() => skip.evaluate((a) => { const r = a.getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.right <= 320; }))
        .toBe(true);
    }
    await page.goto("about:blank");
  });
});
