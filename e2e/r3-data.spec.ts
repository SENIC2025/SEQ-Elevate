import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  createPerson,
  createSession,
  createWorld,
  hasProfiles,
  removePeople,
  removeWorld,
  runId,
  signIn,
  type Person,
  type World,
} from "./fixtures/people";
import { callAction } from "./fixtures/server-action";

/**
 * Release 3, Stream D (spec 18.2): data rights, read in the database and in
 * what the server sends, never only on screen.
 *
 *   D-E1  "Delete my account" removes the person's activity records, their
 *         sign-in links (also one stored with the address in another case)
 *         and their rate-limit counters; log rows about them lose their id;
 *         the erasure record keeps it; a note they wrote as staff stays,
 *         unsigned (D86, D89)
 *   D-E2  "Download my data" holds the activity, the profile, the Comp
 *         Card's sharing and the sessions (counted, never a token); the
 *         account page says what the file and the deletion hold (D87)
 *   D-E3  the admin export (SC17): an ADMIN with the app's Origin and a
 *         request reference gets the whole file, and it is logged; a
 *         partner admin, a facilitator or another learner gets 403; no
 *         reference, free text, another Origin or a GET: refused, nothing
 *         logged (D88)
 *         On /admin/data itself: the page has its own title; Find says it
 *         needs 3 characters; focus stays on the page after Find, Mark,
 *         Reset, Erase and a review list's mark; the mark buttons are named
 *         by their visible words; nothing scrolls sideways at 320 px; a
 *         refused export keeps the page and says why, and a download shows
 *         in the log at once; the dry run names the roles of the accounts it
 *         erases; the log reads in words and in Brussels time
 *   D-E5  a partner admin calling the test-account actions directly is
 *         refused, even about its own organisation's learner (SC18, role
 *         guard: refused by role)
 *
 * D-E4 (reset) and D-E6 (the clean-up run) act on the whole database and
 * are in r3-data-last.spec.ts, which runs after every other spec.
 *
 * On the old build: D-E1 fails because the rows survive and the note goes
 * with its author; D-E2 because the file and the page lack them; D-E3
 * because the route and the page don't exist (404); D-E5 is a guard (the
 * actions and the role don't exist there).
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
// In order, in one worker; a failure doesn't skip the rest (each test says
// what it found on the old build too).
test.describe.configure({ mode: "default" });

const PROJECT = "seq-elevate";
const RUN = runId();

/**
 * The rate limiter's stored keys for a person, as src/lib/rate-limit.ts
 * makes them (it is server-only, so the rule is restated here): the
 * caller's key, under its prefix, as an HMAC-SHA256 under RATE_LIMIT_SECRET
 * or a key derived from AUTH_SECRET. If the two ever differ, D-E1's
 * precondition says so.
 */
function limiterKey(): Buffer {
  const own = process.env.RATE_LIMIT_SECRET?.trim();
  if (own) return Buffer.from(own, "utf8");
  const auth = process.env.AUTH_SECRET?.trim();
  if (!auth) throw new Error("r3-data.spec: AUTH_SECRET is needed to name the rate limiter's keys");
  return createHmac("sha256", auth).update("seq-elevate rate-limit keys v1").digest();
}
const keyed = (value: string) => createHmac("sha256", limiterKey()).update(value).digest("hex");
const hashKey = (prefix: string, value: string) => `${prefix}:${keyed(value.trim().toLowerCase())}`;
const storedKey = (key: string) => `${key.slice(0, key.indexOf(":"))}:${keyed(key)}`;

describe("D-E1: deleting my account", () => {
  const email = `e2e-data-erase-${RUN}@example.com`;
  const learnerEmail = `e2e-data-erase-subject-${RUN}@example.com`;
  const course = `e2e-data-${RUN}`;
  const cue = `cue-data-${RUN}`;
  let staff: Person;
  let learner: Person;
  const ids = { note: "", validation: "", memberRows: [] as string[], telemetry: [] as string[] };
  let keys: { magicLink: string; upload: string; invite: string };

  test.beforeAll(async () => {
    await removePeople(prisma, [email, learnerEmail]);
    // A facilitator who wrote a note and a validation about a learner, was
    // added and changed on People, played a course, and asked for links.
    staff = await createPerson(prisma, { email, roles: ["FACILITATOR"], organisation: "A" });
    learner = await createPerson(prisma, { email: learnerEmail, roles: ["LEARNER"] });
    ids.note = (
      await prisma.observation.create({
        data: { observerId: staff.userId, observedId: learner.userId, note: `Kept going ${RUN}` },
        select: { id: true },
      })
    ).id;
    ids.validation = (
      await prisma.validation.create({
        data: { validatorId: staff.userId, validatedId: learner.userId, cluster: "communication", evidence: `Spoke up ${RUN}` },
        select: { id: true },
      })
    ).id;
    for (const action of ["member.added", "member.roles_changed"]) {
      const row = await prisma.auditLog.create({
        data: { projectId: PROJECT, actorId: null, action, entity: "User", entityId: staff.userId },
        select: { id: true },
      });
      ids.memberRows.push(row.id);
    }
    for (const [action, entityId, metadata] of [
      ["course.opened", course, { courseSlug: course }],
      ["stage.time", `${course}:CONTEXT`, { courseSlug: course, stage: "CONTEXT", seconds: 40 }],
      ["video.cue_answered", cue, { courseSlug: course, correct: true }],
    ] as const) {
      const row = await prisma.auditLog.create({
        data: { projectId: PROJECT, actorId: staff.userId, action, entity: "Course", entityId, metadata },
        select: { id: true },
      });
      ids.telemetry.push(row.id);
    }
    // A pending link stored with the address as typed, in another case.
    await prisma.verificationToken.create({
      data: { identifier: email.toUpperCase(), token: `e2e-token-upper-${RUN}`, expires: new Date(Date.now() + 86_400_000) },
    });
    // Counters keyed by the id (an upload, invitations sent) and by the address (an invitation received).
    keys = {
      magicLink: storedKey(hashKey("magiclink", email)),
      upload: storedKey(`upload-doc:${staff.userId}`),
      invite: storedKey(hashKey("invite", email)),
    };
    const windowStart = Math.floor(Date.now() / 1000 / 60) * 60;
    for (const key of [keys.upload, keys.invite]) {
      await prisma.rateLimit.create({ data: { key, windowStart, count: 1 } });
    }
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { id: { in: [...ids.memberRows, ...ids.telemetry] } },
    });
    await prisma.auditLog.deleteMany({ where: { entityId: staff?.userId } });
    await prisma.observation.deleteMany({ where: { id: ids.note } });
    await prisma.validation.deleteMany({ where: { id: ids.validation } });
    await prisma.verificationToken.deleteMany({ where: { identifier: { equals: email, mode: "insensitive" } } });
    await prisma.rateLimit.deleteMany({ where: { key: { in: Object.values(keys ?? {}) } } });
    await removePeople(prisma, [email, learnerEmail]);
  });

  test("everything about the person goes, the log keeps one unlinked record, and their notes stay unsigned", async ({
    browser,
  }) => {
    // A real sign-in link: the link and its counter, as the server stores them.
    const guest = await browser.newContext();
    const signInPage = await guest.newPage();
    await signInPage.goto("/en/signin");
    await signInPage.getByLabel("Email").fill(email);
    await signInPage.getByRole("button", { name: "Send me a link" }).click();
    await expect
      .poll(() => prisma.verificationToken.count({ where: { identifier: { equals: email, mode: "insensitive" } } }), {
        message: "two pending links before",
      })
      .toBe(2);
    await guest.close();
    expect.soft(await prisma.rateLimit.count({ where: { key: keys.magicLink } }), "the sign-in link's counter, keyed as the limiter keys it").toBe(1);

    // "Delete my account", as the person.
    const context = await browser.newContext();
    await signIn(context, staff.sessionToken);
    const page = await context.newPage();
    await page.goto("/en/account");
    const main = page.getByRole("main");
    await main.getByRole("button", { name: /delete my account/i }).click();
    await main.getByLabel(/type your email to confirm/i).fill(email);
    await main.getByRole("button", { name: /permanently delete/i }).click();
    await expect.poll(() => prisma.user.count({ where: { id: staff.userId } }), { timeout: 15_000 }).toBe(0);
    await context.close();

    expect.soft(await prisma.auditLog.count({ where: { id: { in: ids.telemetry } } }), "activity records gone").toBe(0);
    expect
      .soft(
        await prisma.verificationToken.count({ where: { identifier: { equals: email, mode: "insensitive" } } }),
        "sign-in links gone, whatever the case"
      )
      .toBe(0);
    expect
      .soft(await prisma.rateLimit.count({ where: { key: { in: Object.values(keys) } } }), "rate-limit counters gone")
      .toBe(0);
    const member = await prisma.auditLog.findMany({ where: { id: { in: ids.memberRows } }, select: { entityId: true } });
    expect.soft(member, "member.* rows stay, without the id").toEqual([{ entityId: null }, { entityId: null }]);
    const record = await prisma.auditLog.findMany({
      where: { action: "account.deleted", entityId: staff.userId },
      select: { actorId: true, metadata: true },
    });
    expect.soft(record, "one erasure record keeps the id, with no address").toEqual([
      { actorId: null, metadata: { selfService: true } },
    ]);
    expect
      .soft(await prisma.observation.findUnique({ where: { id: ids.note }, select: { observerId: true } }), "the note stays, unsigned")
      .toEqual({ observerId: null });
    expect
      .soft(
        await prisma.validation.findUnique({ where: { id: ids.validation }, select: { validatorId: true } }),
        "the validation stays, unsigned"
      )
      .toEqual({ validatorId: null });
  });
});

describe("D-E2: downloading my data", () => {
  const email = `e2e-data-export-${RUN}@example.com`;
  const course = `e2e-data-export-${RUN}`;
  let person: Person;

  test.beforeAll(async () => {
    await removePeople(prisma, [email]);
    person = await createPerson(prisma, { email, roles: ["LEARNER"], organisation: "A" });
    await createSession(prisma, person.userId); // a second device
    const profiles = await hasProfiles(prisma);
    await prisma.compCard.create({
      data: {
        userId: person.userId,
        projectId: PROJECT,
        wentWell: `my words ${RUN}`,
        privacy: "FACILITATOR",
        ...(profiles && person.organisationId
          ? { sharedAt: new Date(), sharedWithOrganisationId: person.organisationId, sharingVersion: "e2e" }
          : {}),
      },
      select: { id: true },
    });
    await prisma.auditLog.createMany({
      data: [
        { projectId: PROJECT, actorId: person.userId, action: "course.opened", entity: "Course", entityId: course, metadata: { courseSlug: course } },
        {
          projectId: PROJECT,
          actorId: person.userId,
          action: "stage.time",
          entity: "Stage",
          entityId: `${course}:CONTEXT`,
          metadata: { courseSlug: course, stage: "CONTEXT", seconds: 75 },
        },
        { projectId: PROJECT, actorId: null, action: "member.added", entity: "User", entityId: person.userId },
      ],
    });
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: person?.userId }, { entityId: person?.userId }] } });
    await removePeople(prisma, [email]);
  });

  test("the file holds the activity, profile, sharing and sessions, and no token", async ({ request }) => {
    const res = await request.get("/api/me/export", { headers: { Cookie: `authjs.session-token=${person.sessionToken}` } });
    expect(res.status()).toBe(200);
    const raw = await res.text();
    const data = JSON.parse(raw);
    expect.soft(data.activity?.coursesOpened, "courses opened").toEqual([{ course, at: expect.any(String) }]);
    expect
      .soft(data.activity?.timeOnLessons, "time on lessons")
      .toEqual([{ course, lesson: "CONTEXT", seconds: 75, since: expect.any(String) }]);
    expect.soft(data.profile, "the profile").toMatchObject({ country: "DE", organisation: expect.any(String) });
    expect
      .soft(data.compCards?.[0], "the Comp Card's sharing as the learner sees it")
      .toMatchObject({ sharing: "facilitators", sharedWith: expect.any(String) });
    expect.soft(data.sessions, "sessions counted").toEqual({ count: 2, expires: [expect.any(String), expect.any(String)] });
    expect.soft(data.logEntriesAboutYou, "log entries about the person").toContainEqual({ action: "member.added", at: expect.any(String) });
    expect.soft(raw, "no session token").not.toContain(person.sessionToken);
    expect.soft(data.notice, "the file says what it holds").toMatch(/activity records.*notes staff wrote about you/);
  });

  test("the account page says what the download and the deletion hold", async ({ page, context }) => {
    await signIn(context, person.sessionToken);
    await page.goto("/en/account");
    const main = page.getByRole("main");
    await expect(
      main.getByText(
        "Download a copy of the data SEQ Elevate holds about you: your account, progress, answers, Comp Card, badges, activity records and the notes staff wrote about you."
      )
    ).toBeVisible();
    await expect(
      main.getByText(
        "Deleting your account removes your account, progress, answers, Comp Card and badges for good. A record that an account was deleted is kept, without your name or email. Backup copies are deleted on their normal schedule."
      )
    ).toBeVisible();
  });
});

describe("D-E3 (SC17): the admin export", () => {
  let world: World;
  const exportsOf = (userId: string) => prisma.auditLog.count({ where: { action: "account.exported", entityId: userId } });

  test.beforeAll(async () => {
    world = await createWorld(prisma, { run: `${RUN}x` });
  });

  test.afterAll(async () => {
    if (world) await removeWorld(prisma, world);
  });

  const exportOf = (userId: string) => `/api/admin/people/${userId}/export`;
  const cookie = (p: Person) => ({ Cookie: `authjs.session-token=${p.sessionToken}` });
  const origin = () => new URL(test.info().project.use.baseURL ?? "http://localhost:3000").origin;

  test("an ADMIN with a request reference gets the whole file, logged with the reference", async ({ request }) => {
    const la1 = world.people.LA1;
    const res = await request.post(exportOf(la1.userId), {
      headers: { ...cookie(world.people.AD), Origin: origin() },
      form: { requestRef: "REQ-2026-901" },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("no-store");
    expect(res.headers()["content-disposition"]).toContain("attachment");
    const body = await res.text();
    expect(body, "the whole Comp Card").toContain(world.cardMarker("LA1"));
    expect(JSON.parse(body).account.email).toBe(la1.email);
    const rows = await prisma.auditLog.findMany({
      where: { action: "account.exported", entityId: la1.userId },
      select: { actorId: true, metadata: true },
    });
    expect(rows).toEqual([{ actorId: world.people.AD.userId, metadata: { byAdmin: true, requestRef: "REQ-2026-901" } }]);
  });

  for (const key of ["PAA", "FA", "LA2"] as const) {
    test(`${key} is refused (403)${key === "PAA" ? " (role guard)" : ""}`, async ({ request }) => {
      const target = world.people.LA2.userId === world.people[key].userId ? world.people.LA1 : world.people.LA2;
      const before = await exportsOf(target.userId);
      const res = await request.post(exportOf(target.userId), {
        headers: { ...cookie(world.people[key]), Origin: origin() },
        form: { requestRef: "REQ-2026-902" },
        maxRedirects: 0,
      });
      expect(res.status()).toBe(403);
      expect(await res.text()).not.toContain(world.marker(target === world.people.LA1 ? "LA1" : "LA2"));
      expect(await exportsOf(target.userId)).toBe(before);
    });
  }

  test("an ADMIN without a reference, with free text, from another Origin, or by GET: refused, nothing logged", async ({
    request,
  }) => {
    const target = world.people.LA2;
    const admin = cookie(world.people.AD);
    const before = await exportsOf(target.userId);
    const cases = [
      ["no reference", { headers: { ...admin, Origin: origin() }, form: { other: "x" } }, 400],
      ["free text", { headers: { ...admin, Origin: origin() }, form: { requestRef: "Ana Smith asked by phone" } }, 400],
      ["another Origin", { headers: { ...admin, Origin: "https://elsewhere.example" }, form: { requestRef: "REQ-2026-903" } }, 403],
      ["no Origin", { headers: { ...admin }, form: { requestRef: "REQ-2026-904" } }, 403],
    ] as const;
    for (const [what, options, status] of cases) {
      const res = await request.post(exportOf(target.userId), { ...options, maxRedirects: 0 });
      expect.soft(res.status(), what).toBe(status);
    }
    const get = await request.get(`${exportOf(target.userId)}?requestRef=REQ-2026-905`, {
      headers: { ...admin, Origin: origin() },
      maxRedirects: 0,
    });
    expect.soft(get.status(), "a GET").toBe(405);
    expect(await exportsOf(target.userId), "nothing logged").toBe(before);
  });

  test("the form on /admin/data downloads the file", async ({ page, context }) => {
    await signIn(context, world.people.AD.sessionToken);
    await page.goto("/en/admin/data");
    const main = page.getByRole("main");
    await main.getByLabel("Email address (or part of it)").fill(world.people.LB1.email);
    await main.getByRole("button", { name: "Find" }).click();
    const found = main.getByRole("list", { name: "People found" }).getByRole("listitem");
    await expect(found).toHaveCount(1);
    await found.getByRole("button", { name: "Export data" }).click();
    await expect(found.getByLabel("Request reference (REQ-YYYY-NNN)"), "the reference takes focus").toBeFocused();
    // The page, with a person found and the export open, has no serious accessibility violation.
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
    await found.getByLabel("Request reference (REQ-YYYY-NNN)").fill("REQ-2026-906");
    const download = page.waitForEvent("download");
    await found.getByRole("button", { name: "Download their data" }).click();
    expect((await download).suggestedFilename()).toBe("seq-elevate-data-REQ-2026-906.json");
    await expect.poll(() => exportsOf(world.people.LB1.userId)).toBe(1);
    // The page stays, and its log shows the export without a reload.
    await expect(page).toHaveURL(/\/en\/admin\/data$/);
    await expect(
      main.getByRole("table").getByRole("row").filter({ hasText: "REQ-2026-906" }),
      "the export is in the log at once"
    ).toContainText(world.people.AD.email);
  });

  test("after a change the page reads its lists and log again itself, not through a reload of the page", async ({
    page,
    context,
  }) => {
    // A router refresh of the page can be lost (Next's router drops one
    // now and then around the server action that runs next to it), and the
    // log then keeps showing what came before the change. Here every reload
    // of the page answers with the log as it was before the export (the
    // reference of the new row changed to one nobody used), so only the
    // page's own reading can show the export.
    await page.route(/\/en\/admin\/data\?_rsc=/, async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replaceAll("REQ-2026-907", "REQ-2026-000");
      const headers = { ...response.headers() };
      delete headers["content-encoding"];
      delete headers["content-length"];
      await route.fulfill({ status: response.status(), headers, body });
    });
    const ld1 = world.people.LD1;
    await signIn(context, world.people.AD.sessionToken);
    await page.goto("/en/admin/data");
    const main = page.getByRole("main");
    await main.getByLabel("Email address (or part of it)").fill(ld1.email);
    await main.getByRole("button", { name: "Find" }).click();
    const found = main.getByRole("list", { name: "People found" }).getByRole("listitem");
    await expect(found).toHaveCount(1);
    await found.getByRole("button", { name: "Export data" }).click();
    await found.getByLabel("Request reference (REQ-YYYY-NNN)").fill("REQ-2026-907");
    const download = page.waitForEvent("download");
    await found.getByRole("button", { name: "Download their data" }).click();
    await download;
    await expect.poll(() => exportsOf(ld1.userId)).toBe(1);
    await expect(
      main.getByRole("table").getByRole("row").filter({ hasText: "REQ-2026-907" }),
      "the export is in the log without a reload of the page"
    ).toContainText(world.people.AD.email);
  });
});

describe("D-E3: /admin/data by keyboard, at 320 px, and when an export is refused", () => {
  const emails = {
    admin: `e2e-data-page-admin-${RUN}@example.com`,
    subject: `e2e-data-page-subject-${RUN}@example.com`,
    staff: `e2e-data-page-staff-${RUN}@example.com`,
    reflow: `e2e-data-page-reflow-subject-with-a-long-address-${RUN}@example.com`,
    gone: `e2e-data-page-gone-${RUN}@example.com`,
  };
  let admin: Person;
  let subject: Person;
  let staff: Person;
  let gone: Person;
  let logRow = "";

  test.beforeAll(async () => {
    await removePeople(prisma, Object.values(emails));
    admin = await createPerson(prisma, { email: emails.admin, roles: ["ADMIN"] });
    subject = await createPerson(prisma, { email: emails.subject, roles: ["LEARNER"] });
    // A facilitator who played: on "Staff who also have learner data".
    staff = await createPerson(prisma, { email: emails.staff, roles: ["FACILITATOR"] });
    await prisma.compCard.create({ data: { userId: staff.userId, projectId: PROJECT, wentWell: "tried it" }, select: { id: true } });
    await createPerson(prisma, { email: emails.reflow, roles: ["LEARNER"] });
    gone = await createPerson(prisma, { email: emails.gone, roles: ["LEARNER"] });
    // A test mark logged at 08:15 UTC on 30 November: 09:15 in Brussels.
    logRow = (
      await prisma.auditLog.create({
        data: {
          projectId: PROJECT,
          actorId: admin.userId,
          action: "account.test_marked",
          entity: "ProjectProfile",
          createdAt: new Date("2026-11-30T08:15:00Z"),
        },
        select: { id: true },
      })
    ).id;
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { OR: [{ id: logRow }, { actorId: admin?.userId }] } });
    await removePeople(prisma, Object.values(emails));
  });

  const open = async (page: Page, context: BrowserContext) => {
    await signIn(context, admin.sessionToken);
    await page.goto("/en/admin/data");
    return page.getByRole("main");
  };
  const find = async (main: Locator, email: string) => {
    await main.getByLabel("Email address (or part of it)").fill(email);
    await main.getByRole("button", { name: "Find" }).click();
    const card = main.getByRole("list", { name: "People found" }).getByRole("listitem");
    await expect(card).toHaveCount(1);
    return card;
  };

  test("the page has a title; Find says what it needs; focus stays on the page after Find, Mark, Reset and Erase", async ({
    page,
    context,
  }) => {
    const main = await open(page, context);
    await expect.soft(page, "the page's own title").toHaveTitle("Data · SEQ Elevate");
    const field = main.getByLabel("Email address (or part of it)");
    await field.fill("ab");
    await field.press("Enter");
    await expect.soft(main.getByRole("alert"), "two characters: told why nothing happens").toContainText("at least 3 characters");

    await field.fill(subject.email);
    const findButton = main.getByRole("button", { name: "Find" });
    await findButton.focus();
    await page.keyboard.press("Enter");
    const card = main.getByRole("list", { name: "People found" }).getByRole("listitem");
    await expect(card).toHaveCount(1);
    await expect.soft(findButton, "focus stays on Find").toBeFocused();
    await expect.soft(card, "roles in words").toContainText("Learner");
    await expect.soft(card).not.toContainText("LEARNER");
    await expect.soft(card, "why there is no Reset").toContainText("Reset is for marked test accounts");

    await card.getByRole("button", { name: "Mark as test account" }).click();
    await expect(card.getByRole("button", { name: "Unmark test account" })).toBeVisible();
    await expect.soft(card.getByRole("button", { name: "Unmark test account" }), "focus stays on the mark button").toBeFocused();

    await card.getByRole("button", { name: "Reset" }).click();
    await card.getByRole("group", { name: `Reset ${subject.email}?` }).getByRole("button", { name: "Reset" }).click();
    await expect(main.getByText(`Reset ${subject.email}: its learner data`)).toBeVisible();
    await expect.soft(card.getByRole("group", { name: `Actions for ${subject.email}` }), "focus on the person's actions").toBeFocused();

    await card.getByRole("button", { name: "Erase" }).click();
    await card.getByLabel("Type their address to confirm").fill(subject.email);
    await card.getByRole("button", { name: "Erase for good" }).click();
    await expect(main.getByText(`Erased ${subject.email}.`)).toBeVisible();
    await expect.soft(field, "focus on the search field").toBeFocused();
    expect.soft(await page.evaluate(() => document.activeElement !== document.body), "focus is somewhere").toBe(true);
    expect(await prisma.user.count({ where: { id: subject.userId } })).toBe(0);
  });

  test("a review list's mark is named by its words and leaves focus on the list; the dry run names the staff role", async ({
    page,
    context,
  }) => {
    const main = await open(page, context);
    const list = main.getByRole("list", { name: "Staff who also have learner data" });
    const item = list.getByRole("listitem").filter({ hasText: staff.email });
    const mark = item.getByRole("button");
    await expect.soft(mark, "visible words first (WCAG 2.5.3)").toHaveAccessibleName(`Mark as test account: ${staff.email}`);
    await expect.soft(main.getByText("Statistics already leave staff out"), "why staff need no mark").toBeVisible();
    await mark.click();
    await expect(item.getByText("Test account")).toBeVisible();
    await expect
      .soft(main.getByRole("heading", { name: /^Staff who also have learner data/ }), "focus on the list's heading")
      .toBeFocused();

    await main.getByRole("button", { name: "Dry run" }).click();
    const toErase = main.getByRole("list", { name: "The accounts to erase" });
    await expect.soft(toErase.getByRole("listitem").filter({ hasText: staff.email }), "shown, with the role").toContainText("Facilitator");
    await expect.soft(main.getByText(/hold(s)? a staff role/).first(), "a warning before the run").toBeVisible();
    // The dry run with its warning has no serious accessibility violation.
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
  });

  test("nothing scrolls sideways at 320 px, with a person found and each panel open", async ({ page, context }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const main = await open(page, context);
    const width = () => page.evaluate(() => document.documentElement.scrollWidth);
    expect.soft(await width(), "the page").toBeLessThanOrEqual(320);
    const card = await find(main, emails.reflow);
    expect.soft(await width(), "a person found").toBeLessThanOrEqual(320);
    await card.getByRole("button", { name: "Export data" }).click();
    expect.soft(await width(), "the export open").toBeLessThanOrEqual(320);
    await card.getByRole("button", { name: "Erase" }).click();
    await expect(card.getByLabel("Type their address to confirm")).toBeVisible();
    expect.soft(await width(), "the erasure open").toBeLessThanOrEqual(320);
    await card.getByRole("button", { name: "Keep" }).click();
    await card.getByRole("button", { name: "Mark as test account" }).click();
    await card.getByRole("button", { name: "Reset" }).click();
    await expect(card.getByRole("group", { name: `Reset ${emails.reflow}?` })).toBeVisible();
    expect.soft(await width(), "the reset open").toBeLessThanOrEqual(320);
    await main.getByRole("button", { name: "Dry run" }).click();
    await expect(main.getByRole("heading", { name: "What a run would delete now" })).toBeVisible();
    expect.soft(await width(), "the dry run").toBeLessThanOrEqual(320);
  });

  test("a refused export keeps the page and says why", async ({ page, context }) => {
    const main = await open(page, context);
    const card = await find(main, gone.email);
    await card.getByRole("button", { name: "Export data" }).click();
    await card.getByLabel("Request reference (REQ-YYYY-NNN)").fill("REQ-2026-908");
    // The person is erased elsewhere before the download.
    await prisma.user.delete({ where: { id: gone.userId } });
    await card.getByRole("button", { name: "Download their data" }).click();
    await expect.soft(main.getByRole("alert").filter({ hasText: "no longer exists" }), "said on the page").toBeVisible();
    await expect.soft(page, "the page stays").toHaveURL(/\/en\/admin\/data$/);
  });

  test("the log reads in words and in Brussels time", async ({ page, context }) => {
    const main = await open(page, context);
    const log = main.getByRole("table");
    await expect.soft(log.getByRole("columnheader", { name: "When (Brussels time)" })).toBeVisible();
    const row = log.getByRole("row").filter({ hasText: emails.admin }).filter({ hasText: "2026-11-30" });
    await expect.soft(row, "09:15 in Brussels").toContainText("2026-11-30 09:15");
    await expect.soft(row, "the action in words").toContainText("Marked as a test account");
    await expect.soft(log.getByRole("cell", { name: "account.test_marked", exact: true }), "never the bare code").toHaveCount(0);
  });
});

describe("D-E5 (SC18): a partner admin can't mark, reset or erase (role guard)", () => {
  let world: World;
  const DATA = "/en/admin/data";
  const FILE = "src/app/actions/admin-data.ts";

  test.beforeAll(async () => {
    world = await createWorld(prisma, { run: `${RUN}y` });
  });

  test.afterAll(async () => {
    if (world) await removeWorld(prisma, world);
  });

  test("each call about a learner of its own organisation is refused, and nothing changes", async ({ request }) => {
    const target = world.people.LA1;
    const state = async () => ({
      user: await prisma.user.count({ where: { id: target.userId } }),
      enrolments: await prisma.courseEnrollment.count({ where: { userId: target.userId } }),
      card: await prisma.compCard.count({ where: { userId: target.userId } }),
      sessions: await prisma.session.count({ where: { userId: target.userId } }),
      marked: (await hasProfiles(prisma))
        ? await prisma.projectProfile.count({ where: { userId: target.userId, testAccountAt: { not: null } } })
        : 0,
    });
    const before = await state();
    expect(before).toMatchObject({ user: 1, enrolments: 1, card: 1, sessions: 1, marked: 0 });
    for (const [name, args] of [
      ["markTestAccount", [target.userId, true]],
      ["resetTestAccount", [target.userId]],
      ["eraseAccountByAdmin", [target.userId, { confirmEmail: target.email, requestRef: "REQ-2026-907" }]],
    ] as const) {
      const answer = await callAction(request, { as: world.people.PAA, page: DATA, file: FILE, name, args: [...args] });
      expect.soft(answer.result, `${name} as the partner admin`).toEqual({ ok: false, error: "forbidden" });
    }
    expect(await state()).toEqual(before);
  });
});
