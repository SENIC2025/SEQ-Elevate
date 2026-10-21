import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson, removePeople, runId, signIn, type Person } from "./fixtures/people";
import { narrative, ownLessonId, parts, removeR2Course, seedR2Course } from "./fixtures/r2-course";
import { callAction } from "./fixtures/server-action";
import { LIVE } from "./fixtures/r3-deltas";

/**
 * Release 3 (D93, spec 11; 18.2: F-E2, F-E4): safeguarding contacts.
 *
 *   F-E2  /help lists every country's contacts and 112, for anyone; an
 *         ADMIN saves contacts per country on /admin/safeguarding (an
 *         organisation contact and a help line), and learners then see
 *         them, the organisation's first and their own country first; a
 *         save with mistakes lists them and saves nothing; the footer's
 *         "Need help?" link is on every page, prerendered legal pages
 *         included; a partner admin's direct save is refused (a role
 *         guard: no partner admin exists on the old build, and the action
 *         doesn't either).
 *         Two parts are placed by other streams and run once their change
 *         is in this tree: the box after </main> on learner pages (Stream
 *         B places it in the layouts) and the line beside reflections
 *         (Stream E places it; the recorded walk's R3-D1 says it is in).
 *   F-E4  /help and /admin/safeguarding pass axe, in English, German and
 *         Greek; /help reflows at 320 px.
 *
 * The contacts are the project's one setting: this spec empties it first,
 * runs in order in one worker, and puts back what was there. Requires a real database
 * (gated on E2E_DB=1); everything else it makes is unique to the run and
 * removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  : (null as unknown as PrismaClient);
const describe = DB ? test.describe : test.describe.skip;
// In order, in one worker (the contacts are one setting), each test on its
// own: a failure doesn't skip the rest (each says what it found on the old
// build too).
test.describe.configure({ mode: "default" });

const RUN = runId();
const ROOT = path.resolve(__dirname, "..");
const source = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
type Locale = "en" | "de" | "el";
const messages = (locale: Locale) =>
  JSON.parse(source(`src/messages/${locale}.json`)) as {
    safeguarding: Record<
      "title" | "emergency" | "helpline" | "allContacts" | "fallback" | "hintReflection" | "footerLink" | "helpTitle",
      string
    >;
  };
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** "Contact for …:" per country, in each language (the ICU select of safeguarding.contactFor). */
const CONTACT_FOR: Record<Locale, Record<"DE" | "CY" | "BE" | "GR" | "OTHER", string>> = {
  en: {
    DE: "Contact for Germany:",
    CY: "Contact for Cyprus:",
    BE: "Contact for Belgium:",
    GR: "Contact for Greece:",
    OTHER: "Contact for other countries:",
  },
  de: {
    DE: "Ansprechstelle für Deutschland:",
    CY: "Ansprechstelle für Zypern:",
    BE: "Ansprechstelle für Belgien:",
    GR: "Ansprechstelle für Griechenland:",
    OTHER: "Ansprechstelle für andere Länder:",
  },
  el: {
    DE: "Επαφή (Γερμανία):",
    CY: "Επαφή (Κύπρος):",
    BE: "Επαφή (Βέλγιο):",
    GR: "Επαφή (Ελλάδα):",
    OTHER: "Επαφή (άλλες χώρες):",
  },
};

const EMAILS = {
  admin: `e2e-r3-safe-admin-${RUN}@example.com`,
  partner: `e2e-r3-safe-partner-${RUN}@example.com`,
  de: `e2e-r3-safe-de-${RUN}@example.com`,
  gr: `e2e-r3-safe-gr-${RUN}@example.com`,
};
const ORG_NAME = `E2E Org ${RUN}`;
const LINE_NAME = `E2E Line ${RUN}`;
const ORG_EMAIL = `e2e-safe-${RUN}@example.org`;
const COURSE = `e2e-r3-safe-${RUN}`;
const REFLECT = ownLessonId();

/** Whether the database has Release 3's setting (the old build's has no column). */
async function hasSetting(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'Project' AND column_name = 'safeguarding'`;
  return rows[0].n > 0;
}
async function readSetting(): Promise<unknown> {
  if (!(await hasSetting())) return null;
  const [row] = await prisma.$queryRaw<{ s: unknown }[]>`SELECT "safeguarding" AS s FROM "Project" WHERE "id" = 'seq-elevate'`;
  return row?.s ?? null;
}
async function writeSetting(value: unknown) {
  if (!(await hasSetting())) return;
  await prisma.$executeRaw`UPDATE "Project" SET "safeguarding" = ${value === null ? null : JSON.stringify(value)}::jsonb WHERE "id" = 'seq-elevate'`;
}

/** The contacts this spec saves for Germany, as the admin screen saves them. */
const SAVED = {
  v: 1,
  contacts: {
    DE: [
      { kind: "helpline", organisation: LINE_NAME, phone: "116 111", hours: { en: "Every day, 8 to 20" } },
      { kind: "organisation", organisation: ORG_NAME, role: "Safeguarding lead", email: ORG_EMAIL },
    ],
  },
  updatedAt: new Date().toISOString(),
};

const main = (page: Page) => page.locator("main#main-content").filter({ visible: true });
const footerHelp = (page: Page, locale: Locale) =>
  page.getByRole("contentinfo").getByRole("link", { name: messages(locale).safeguarding.footerLink, exact: true });

async function axeClean(page: Page, where: string) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad, `${where}: ${JSON.stringify(bad.map((v) => [v.id, v.nodes.map((n) => n.target)]))}`).toEqual([]);
}

/** A country's section on /help: its heading, and what follows it up to the next. */
const helpSection = (page: Page, heading: string): Locator =>
  main(page).locator("section").filter({ has: page.getByRole("heading", { level: 2, name: heading, exact: true }) });

describe("Release 3 — safeguarding (F-E2, F-E4)", () => {
  let before: unknown = null;
  const people: Partial<Record<keyof typeof EMAILS, Person>> = {};

  test.beforeAll(async () => {
    before = await readSetting();
    await writeSetting(null);
    await removePeople(prisma, Object.values(EMAILS));
    people.admin = await createPerson(prisma, { email: EMAILS.admin, roles: ["ADMIN"], organisation: null, country: "OTHER" });
    people.partner = await createPerson(prisma, { email: EMAILS.partner, roles: ["PARTNER_ADMIN"], organisation: "A" });
    people.de = await createPerson(prisma, { email: EMAILS.de, roles: ["LEARNER"], organisation: "A", country: "DE" });
    people.gr = await createPerson(prisma, { email: EMAILS.gr, roles: ["LEARNER"], organisation: null, country: "GR" });
  });

  test.afterAll(async () => {
    await writeSetting(before);
    const users = await prisma.user.findMany({ where: { email: { in: Object.values(EMAILS) } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users.map((u) => u.id) } } });
    await removePeople(prisma, Object.values(EMAILS));
    await removeR2Course(prisma, COURSE);
    await prisma.$disconnect();
  });

  test("F-E2: /help lists every country and 112, for anyone, before any contact is saved", async ({ page }) => {
    for (const locale of ["en", "de", "el"] as const) {
      const words = messages(locale).safeguarding;
      const response = await page.goto(`/${locale}/help`);
      expect(response?.status(), `/${locale}/help`).toBe(200);
      await expect(main(page).getByRole("heading", { level: 1 })).toHaveText(words.helpTitle);
      await expect(main(page).getByText(words.emergency)).toBeVisible();
      const headings = main(page).getByRole("heading", { level: 2 });
      await expect(headings).toHaveText(Object.values(CONTACT_FOR[locale]));
      // With nothing saved, whom to talk to instead, under every country.
      await expect(main(page).getByText(words.fallback)).toHaveCount(5);
    }
  });

  test("F-E2: an ADMIN saves an organisation contact and a help line on /admin/safeguarding; /help lists them, the organisation first, the learner's country first", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await signIn(context, people.admin!.sessionToken);
    await page.goto("/en/admin/safeguarding");
    await expect(main(page).getByRole("heading", { level: 1, name: "Safeguarding contacts" })).toBeVisible();
    const germany = main(page).getByRole("group", { name: "Germany", exact: true });
    // The help line first, then the organisation: the page orders them.
    await germany.getByRole("button", { name: "Add a contact for Germany" }).click();
    const first = germany.getByRole("group", { name: "Contact 1 for Germany" });
    await first.getByLabel("Kind").selectOption("helpline");
    await first.getByLabel("Organisation or service").fill(LINE_NAME);
    await first.getByLabel("Phone").fill("116 111");
    await first.getByRole("group", { name: "Hours (optional)" }).getByLabel("English").fill("Every day, 8 to 20");
    await germany.getByRole("button", { name: "Add a contact for Germany" }).click();
    const second = germany.getByRole("group", { name: "Contact 2 for Germany" });
    await expect(second.getByLabel("Kind")).toHaveValue("organisation");
    await second.getByLabel("Organisation or service").fill(ORG_NAME);
    await second.getByLabel("Role").fill("Safeguarding lead");
    await second.getByLabel("Email").fill(ORG_EMAIL);
    await main(page).getByRole("button", { name: "Save contacts" }).click();
    await expect(main(page).getByRole("status")).toContainText("Saved: Germany.");

    // Saved, and logged with the country only.
    const stored = (await readSetting()) as { contacts: Record<string, { organisation: string }[]> };
    expect(stored.contacts.DE.map((c) => c.organisation)).toEqual([LINE_NAME, ORG_NAME]);
    const rows = await prisma.auditLog.findMany({
      where: { actorId: people.admin!.userId, action: "safeguarding.saved" },
      select: { metadata: true, entity: true },
    });
    expect(rows).toEqual([{ entity: "Project", metadata: { countries: ["DE"] } }]);

    // A learner in Germany: Germany first, its organisation before its help line.
    await signIn(context, people.de!.sessionToken);
    await page.goto("/en/help");
    await expect(main(page).getByRole("heading", { level: 2 }).first()).toHaveText(CONTACT_FOR.en.DE);
    const de = helpSection(page, CONTACT_FOR.en.DE);
    const text = await de.innerText();
    expect(text.indexOf(ORG_NAME), "the organisation's contact first").toBeLessThan(text.indexOf(LINE_NAME));
    await expect(de.getByText(`${messages("en").safeguarding.helpline} ${LINE_NAME}`)).toBeVisible();
    await expect(de.getByRole("link", { name: "116 111" })).toHaveAttribute("href", "tel:116111");
    await expect(de.getByRole("link", { name: ORG_EMAIL })).toHaveAttribute("href", `mailto:${ORG_EMAIL}`);
    await expect(de.getByText("Every day, 8 to 20")).toBeVisible();
    await expect(de.getByText(messages("en").safeguarding.fallback)).toHaveCount(0);

    // A learner in Greece: Greece first (nothing saved: the fallback), Germany's contacts further down.
    await signIn(context, people.gr!.sessionToken);
    await page.goto("/en/help");
    await expect(main(page).getByRole("heading", { level: 2 }).first()).toHaveText(CONTACT_FOR.en.GR);
    await expect(helpSection(page, CONTACT_FOR.en.GR).getByText(messages("en").safeguarding.fallback)).toBeVisible();
    await expect(helpSection(page, CONTACT_FOR.en.DE).getByText(ORG_NAME)).toBeVisible();

    // In German, the hours (written in English only) are marked as English.
    await page.goto("/de/help");
    await expect(helpSection(page, CONTACT_FOR.de.DE).getByText("Every day, 8 to 20")).toHaveAttribute("lang", "en");
  });

  test("F-E2: a save with mistakes lists them, marks the fields and saves nothing", async ({ page, context }) => {
    const stored = await readSetting();
    await signIn(context, people.admin!.sessionToken);
    await page.goto("/en/admin/safeguarding");
    await expect(main(page).getByRole("heading", { level: 1, name: "Safeguarding contacts" })).toBeVisible();
    const cyprus = main(page).getByRole("group", { name: "Cyprus", exact: true });
    await cyprus.getByRole("button", { name: "Add a contact for Cyprus" }).click();
    const entry = cyprus.getByRole("group", { name: "Contact 1 for Cyprus" });
    await entry.getByLabel("Phone").fill("call us");
    await main(page).getByRole("button", { name: "Save contacts" }).click();
    const summary = main(page).getByRole("alert");
    await expect(summary).toContainText("Nothing was saved.");
    await expect(summary.getByRole("link", { name: "Cyprus, contact 1: enter the organisation or service." })).toBeVisible();
    await expect(summary.getByRole("link", { name: /^Cyprus, contact 1: write the phone number in digits/ })).toBeVisible();
    await expect(summary).toBeFocused();
    await expect(entry.getByLabel("Organisation or service")).toHaveAttribute("aria-invalid", "true");
    await expect(entry.getByLabel("Phone")).toHaveAttribute("aria-invalid", "true");
    expect(await readSetting()).toEqual(stored);
    await axeClean(page, "/en/admin/safeguarding with mistakes");
  });

  test("F-E4: on /admin/safeguarding, focus stays near what the keyboard pressed: Add, Remove and Save (WCAG 2.4.3)", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const stored = await readSetting();
    // Each place is checked softly, so a run reports every one that drops the focus, and where it went.
    const focusOn = async (target: Locator, when: string) => {
      const elsewhere = await expect(target)
        .toBeFocused({ timeout: 5000 })
        .then(
          () => null,
          () => page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80) ?? "nothing")
        );
      expect.soft(elsewhere, `${when}: the focus is elsewhere`).toBeNull();
    };
    try {
      await writeSetting(null);
      await signIn(context, people.admin!.sessionToken);
      await page.goto("/en/admin/safeguarding");
      const country = (name: string) => main(page).getByRole("group", { name, exact: true });
      const add = (name: string) => country(name).getByRole("button", { name: `Add a contact for ${name}` });
      const entry = (name: string, n: number) => country(name).getByRole("group", { name: `Contact ${n} for ${name}` });

      // Add, three times: the new contact's first field takes the focus, the third time too (its Add button goes).
      for (const n of [1, 2, 3]) {
        await add("Belgium").focus();
        await page.keyboard.press("Enter");
        await expect(entry("Belgium", n)).toBeVisible();
        await focusOn(entry("Belgium", n).getByLabel("Kind"), `after adding contact ${n}`);
      }
      await expect(add("Belgium")).toHaveCount(0);

      // Remove the second: the contact after it (now the second) takes the focus.
      await entry("Belgium", 3).getByLabel("Organisation or service").fill(`E2E third ${RUN}`);
      await country("Belgium").getByRole("button", { name: "Remove contact 2 for Belgium" }).focus();
      await page.keyboard.press("Enter");
      await expect(entry("Belgium", 2).getByLabel("Organisation or service")).toHaveValue(`E2E third ${RUN}`);
      await focusOn(entry("Belgium", 2).getByLabel("Kind"), "after removing contact 2");
      // Remove the last: no contact after it, so its country's Add button.
      await country("Belgium").getByRole("button", { name: "Remove contact 2 for Belgium" }).focus();
      await page.keyboard.press("Enter");
      await expect(entry("Belgium", 2)).toHaveCount(0);
      await focusOn(add("Belgium"), "after removing the last contact");

      // Save from the button: it keeps the focus while it saves, and after.
      await entry("Belgium", 1).getByLabel("Organisation or service").fill(`E2E focus ${RUN}`);
      await entry("Belgium", 1).getByLabel("Phone").fill("116 000");
      const save = main(page).getByRole("button", { name: "Save contacts" });
      await save.focus();
      await page.keyboard.press("Enter");
      await expect(main(page).getByRole("status")).toContainText("Saved: Belgium.");
      await focusOn(save, "after Save");

      // Save with Enter in a field of a contact added on this page: the field keeps the focus.
      await add("Cyprus").focus();
      await page.keyboard.press("Enter");
      const field = entry("Cyprus", 1).getByLabel("Organisation or service");
      await field.fill(`E2E line ${RUN}`);
      await entry("Cyprus", 1).getByLabel("Phone").fill("116 111");
      await field.focus();
      await page.keyboard.press("Enter");
      await expect(main(page).getByRole("status")).toContainText("Saved: Cyprus.");
      await focusOn(field, "after Enter in a field");
      await expect(field).toHaveValue(`E2E line ${RUN}`);
    } finally {
      await writeSetting(stored);
    }
  });

  test("F-E2: the footer's help link is on every page, prerendered legal pages included, first in the footer", async ({
    page,
    context,
  }) => {
    for (const [path, locale] of [
      ["/en", "en"],
      ["/de/legal/privacy", "de"],
      ["/el/legal/terms", "el"],
      ["/en/signin", "en"],
      ["/en/learner", "en"],
      ["/de/help", "de"],
    ] as const) {
      await page.goto(path);
      const link = footerHelp(page, locale);
      await expect(link, path).toHaveAttribute("href", `/${locale}/help`);
      const first = page.getByRole("contentinfo").getByRole("link").first();
      await expect(first, `${path}: the help link comes first`).toHaveAttribute("href", `/${locale}/help`);
    }
    // A signed-in learner's pages too.
    await signIn(context, people.de!.sessionToken);
    await page.goto("/en/account");
    await expect(footerHelp(page, "en")).toHaveAttribute("href", "/en/help");
  });

  // Stream B places the box after </main> in the learner and account
  // layouts (spec 11.3); until then there is no box on them to check.
  const boxPlaced = /SafeguardingBox/.test(source("src/app/[locale]/learner/layout.tsx"));

  test("F-E2: the box after </main> on learner pages shows 112 with nothing saved, then the learner's country's contacts, the organisation first", async ({
    page,
    context,
  }) => {
    test.fixme(!boxPlaced, "Stream B places SafeguardingBox in the learner layout (spec 11.3)");
    const words = messages("en").safeguarding;
    const stored = await readSetting();
    try {
      await writeSetting(null);
      await signIn(context, people.de!.sessionToken);
      await page.goto("/en/learner");
      const box = page.getByRole("complementary", { name: words.title });
      await expect(box).toBeVisible();
      await expect(box).toContainText(words.emergency);
      await expect(box).toContainText(words.fallback);
      await expect(box.getByRole("link", { name: words.allContacts })).toHaveAttribute("href", "/en/help");
      // After the main area, never inside it.
      await expect(page.locator("main").getByRole("complementary", { name: words.title })).toHaveCount(0);
      expect(
        await page.evaluate((title) => {
          const m = document.querySelector("main");
          const a = [...document.querySelectorAll("aside")].find((x) => x.querySelector("h2")?.textContent?.trim() === title);
          return !!m && !!a && !!(m.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
        }, words.title)
      ).toBe(true);

      await writeSetting(SAVED);
      for (const path of ["/en/learner", "/en/account"]) {
        await page.goto(path);
        const shown = page.getByRole("complementary", { name: words.title });
        await expect(shown, path).toContainText(CONTACT_FOR.en.DE);
        await expect(shown, path).toContainText(words.emergency);
        const text = await shown.innerText();
        expect(text.indexOf(ORG_NAME), `${path}: the organisation first`).toBeLessThan(text.indexOf(LINE_NAME));
        await expect(shown.getByText(words.fallback), path).toHaveCount(0);
      }
    } finally {
      await writeSetting(stored);
    }
  });

  // Stream E places the line in reflection steps and parts, and adds R3-D1
  // to the recorded walk's differences in the same commit (spec 11.3, 18.4).
  test("F-E2: the line beside a reflection says facilitators don't read it, and links /help", async ({ page, context }) => {
    test.fixme(!LIVE.has("R3-D1"), "Stream E places SafeguardingHint in reflections (R3-D1, spec 11.3)");
    await seedR2Course(prisma, {
      slug: COURSE,
      lessons: [
        {
          id: REFLECT,
          label: { en: "Reflect" },
          narrative: narrative({ en: { title: "E2E safeguarding reflection", text: "E2E." } }),
          parts: [parts.reflection([{ en: "E2E: what happened?" }])],
        },
      ],
    });
    await signIn(context, people.de!.sessionToken);
    await page.goto(`/en/learner/course/${COURSE}`);
    const reflection = main(page).getByRole("region", { name: "Reflection questions", exact: true });
    await expect(reflection).toBeVisible({ timeout: 15000 });
    const [before, link] = /^(.*?)<help>(.*?)<\/help>/.exec(messages("en").safeguarding.hintReflection)!.slice(1);
    await expect(reflection.getByText(before.trim(), { exact: false })).toBeVisible();
    await expect(reflection.getByRole("link", { name: link })).toHaveAttribute("href", "/en/help");
  });

  test("F-E2: a partner admin's direct save is refused, and nothing changes (role guard)", async ({ request }) => {
    const stored = await readSetting();
    const answer = await callAction(request, {
      as: { sessionToken: people.partner!.sessionToken },
      page: "/en/admin/safeguarding",
      file: "src/app/actions/safeguarding.ts",
      name: "saveSafeguardingContacts",
      args: [{ DE: [{ kind: "organisation", organisation: `E2E partner ${RUN}`, email: "partner@example.org" }] }],
    });
    expect(answer.result).toEqual({ ok: false, error: "forbidden" });
    expect(await readSetting()).toEqual(stored);
    expect(
      await prisma.auditLog.count({ where: { actorId: people.partner!.userId, action: { startsWith: "safeguarding" } } })
    ).toBe(0);
  });

  test("F-E4: /help passes axe in en, de and el, with and without contacts, and reflows at 320 px", async ({ page }) => {
    const stored = await readSetting();
    try {
      for (const setting of [null, SAVED]) {
        await writeSetting(setting);
        for (const locale of ["en", "de", "el"] as const) {
          await page.goto(`/${locale}/help`);
          await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();
          await axeClean(page, `/${locale}/help${setting ? " with contacts" : ""}`);
        }
      }
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto("/de/help");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "no sideways scrolling at 320 px").toBeLessThanOrEqual(0);
    } finally {
      await writeSetting(stored);
    }
  });

  test("F-E4: /admin/safeguarding passes axe, empty and with contacts; English, and marked so under /de and /el", async ({
    page,
    context,
  }) => {
    const stored = await readSetting();
    try {
      await signIn(context, people.admin!.sessionToken);
      for (const setting of [null, SAVED]) {
        await writeSetting(setting);
        await page.goto("/en/admin/safeguarding");
        await expect(main(page).getByRole("button", { name: "Save contacts" })).toBeVisible();
        await axeClean(page, `/en/admin/safeguarding${setting ? " with contacts" : ""}`);
      }
      for (const locale of ["de", "el"] as const) {
        await page.goto(`/${locale}/admin/safeguarding`);
        await expect(main(page).locator(":scope > div[lang='en']")).toContainText("Safeguarding contacts");
        await axeClean(page, `/${locale}/admin/safeguarding`);
      }
    } finally {
      await writeSetting(stored);
    }
  });
});
