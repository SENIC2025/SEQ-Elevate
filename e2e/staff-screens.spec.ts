import { test, expect, type BrowserContext, type Page, type Request } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient, type Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Three things the staff guide had to warn about (October 2026):
 * - the bin icons on People and on Organisations & cohorts deleted at once.
 *   They now ask first, in place, as the course page does: the question
 *   takes focus, says what happens, and "Keep" (or Escape) puts focus back
 *   on the bin, with nothing changed;
 * - an admin could switch off their own Admin role. The chip says why it
 *   can't be switched off, and the server refuses it too;
 * - every validation was recorded for Communication & Emotional
 *   Intelligence. It is recorded for the skill area the facilitator
 *   chooses, which starts on the one of the learner's current course.
 *
 * And what their review found (October 2026): on a phone the question
 * opened off screen, "Keep" seemed to keep someone whose removal was
 * already on its way, a failed removal left a spinner, a cohort's people
 * were counted once per role, the question's explanation wasn't read with
 * it, the Skill area was offered for a note alone, and the question said
 * the person leaves the list for good.
 *
 * Requires a real database — gated on E2E_DB=1. Every email and name is
 * unique to the run, and everything the run made is removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;
test.describe.configure({ mode: "serial" });

const PROJECT = "seq-elevate";
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const email = (who: string) => `e2e-staff-${who}-${RUN}@example.com`;
const ADMIN = email("admin");
const OTHER_ADMIN = email("other-admin");
const PERSON = email("person");
const FACILITATOR = email("facilitator");
const LEARNER = email("learner");
const NEWBIE = email("newbie");
const SLOW = email("slow");
const PAIR = email("pair");
const EMAILS = [ADMIN, OTHER_ADMIN, PERSON, FACILITATOR, LEARNER, NEWBIE, SLOW, PAIR];
const LEARNER_NAME = `Staff Learner ${RUN}`;
const NEWBIE_NAME = `Staff Newbie ${RUN}`;
const ORG = `E2E Staff Org ${RUN}`;
const BUSY_ORG = `E2E Staff Busy ${RUN}`;
const COHORT = `E2E Staff Cohort ${RUN}`;
const BUSY_COHORT = `E2E Staff Busy Cohort ${RUN}`;
// The second bundled course: its skill area is Resilience, not Communication.
const COURSE = "receiving-feedback";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function makeUser(address: string, roles: Role[], name?: string) {
  const user = await prisma.user.create({
    data: { email: address, name, emailVerified: new Date() },
  });
  for (const role of roles) {
    await prisma.membership.create({
      data: { userId: user.id, projectId: PROJECT, role },
    });
  }
  const sessionToken = `e2e-staff-${RUN}-${Math.random().toString(36).slice(2)}`;
  await prisma.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 86_400_000),
    },
  });
  return { userId: user.id, sessionToken };
}

async function signInAs(context: BrowserContext, sessionToken: string) {
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

async function noSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical"
  );
  expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
}

/** A server action posted from the People page (the bins' removals). */
const isAction = (req: Request) =>
  req.method() === "POST" && new URL(req.url()).pathname === "/en/admin/people";

const rolesOf = async (userId: string) =>
  (
    await prisma.membership.findMany({
      where: { userId, projectId: PROJECT },
      select: { role: true },
    })
  )
    .map((m) => m.role)
    .sort();

describe("Staff screens", () => {
  let admin: { userId: string; sessionToken: string };
  let otherAdmin: { userId: string; sessionToken: string };
  let person: { userId: string; sessionToken: string };
  let facilitator: { userId: string; sessionToken: string };
  let learner: { userId: string; sessionToken: string };
  let slow: { userId: string; sessionToken: string };
  let pair: { userId: string; sessionToken: string };
  let orgId = "";
  let busyOrgId = "";
  let cohortId = "";

  async function cleanUp() {
    const users = await prisma.user.findMany({
      where: { email: { in: EMAILS } },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: { actorId: { in: users.map((u) => u.id) } },
    });
    // Validations, observations, enrollments, memberships and sessions go
    // with their users.
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    const orgs = await prisma.organisation.findMany({
      where: { name: { in: [ORG, BUSY_ORG] } },
      select: { id: true },
    });
    const ids = orgs.map((o) => o.id);
    await prisma.cohort.deleteMany({ where: { organisationId: { in: ids } } });
    await prisma.organisation.deleteMany({ where: { id: { in: ids } } });
  }

  test.beforeAll(async () => {
    await cleanUp();
    admin = await makeUser(ADMIN, ["ADMIN"]);
    otherAdmin = await makeUser(OTHER_ADMIN, ["ADMIN", "FACILITATOR"]);
    person = await makeUser(PERSON, ["LEARNER", "FACILITATOR"]);
    facilitator = await makeUser(FACILITATOR, ["FACILITATOR"]);
    learner = await makeUser(LEARNER, ["LEARNER"], LEARNER_NAME);
    await makeUser(NEWBIE, ["LEARNER"], NEWBIE_NAME);
    slow = await makeUser(SLOW, ["LEARNER"]);
    pair = await makeUser(PAIR, ["LEARNER", "FACILITATOR"]);

    const org = await prisma.organisation.create({
      data: { projectId: PROJECT, name: ORG, shortName: `Staff ${RUN}` },
    });
    orgId = org.id;
    const cohort = await prisma.cohort.create({
      data: { projectId: PROJECT, organisationId: org.id, name: COHORT },
    });
    cohortId = cohort.id;
    const busy = await prisma.organisation.create({
      data: { projectId: PROJECT, name: BUSY_ORG, shortName: `Busy ${RUN}` },
    });
    busyOrgId = busy.id;
    const busyCohort = await prisma.cohort.create({
      data: { projectId: PROJECT, organisationId: busy.id, name: BUSY_COHORT },
    });
    // One person with two roles (two memberships) in the busy cohort.
    await prisma.membership.updateMany({
      where: { userId: pair.userId, projectId: PROJECT },
      data: { cohortId: busyCohort.id, organisationId: busy.id },
    });
    // The person to remove and the learner are both in the cohort.
    await prisma.membership.updateMany({
      where: { userId: { in: [person.userId, learner.userId] }, projectId: PROJECT },
      data: { cohortId: cohort.id, organisationId: org.id },
    });

    // The learner is on the Resilience course.
    const course = await prisma.course.findFirst({
      where: { projectId: PROJECT, slug: COURSE },
    });
    expect(course, `the seeded course ${COURSE} exists`).toBeTruthy();
    expect(course!.cluster).toBe("resilience");
    await prisma.courseEnrollment.create({
      data: {
        userId: learner.userId,
        courseId: course!.id,
        stagesCompleted: ["CONTEXT", "CONCEPT"],
      },
    });
  });

  test.afterAll(cleanUp);

  test("removing someone asks first, says what happens, and Keep changes nothing", async ({
    page,
    context,
  }) => {
    await signInAs(context, admin.sessionToken);
    await page.goto("/en/admin/people");
    const row = page.locator("tr", { hasText: PERSON }).first();
    const bin = row.getByRole("button", { name: `Remove ${PERSON} from the project` });
    const question = page.getByRole("heading", {
      name: `Remove ${PERSON} from the project?`,
    });
    const confirm = page.getByRole("group", { name: `Remove ${PERSON} from the project?` });

    // Asked, not done: the question takes focus and says what happens.
    await bin.click();
    await expect(question).toBeFocused();
    await expect(confirm).toContainText(/lose their roles and their cohort/i);
    await expect(confirm).toContainText(/account and data stay/i);
    // Not that they leave the list for good: they aren't signed out, and
    // come back on their next page (as a learner, or as an admin named in
    // the server setting).
    await expect(confirm).not.toContainText(/leave this list/i);
    await expect(confirm).toContainText(
      /on their next page they're back on this list as a learner/i
    );
    await expect(confirm).toContainText(/admin and editor/i);
    expect(await rolesOf(person.userId)).toEqual(["FACILITATOR", "LEARNER"]);
    await noSeriousViolations(page);

    // Keep it: the question goes, focus is back on the bin, nothing changed.
    await confirm.getByRole("button", { name: "Keep them" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(bin).toBeFocused();
    // Escape keeps them too.
    await bin.press("Enter");
    await expect(question).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    await expect(bin).toBeFocused();
    expect(await rolesOf(person.userId)).toEqual(["FACILITATOR", "LEARNER"]);

    // Confirmed: their roles and cohort go, their account stays.
    await bin.click();
    await confirm.getByRole("button", { name: "Remove from project" }).click();
    await expect(page.locator("tr", { hasText: PERSON })).toHaveCount(0);
    await expect(page.getByText(`Removed ${PERSON} from the project.`)).toBeVisible();
    expect(await rolesOf(person.userId)).toEqual([]);
    expect(await prisma.user.count({ where: { id: person.userId } })).toBe(1);
    // Focus doesn't drop to the page: it goes to the next person's bin.
    await expect(page.locator(":focus")).toHaveAccessibleName(
      /^Remove .+ from the project$/
    );

    // As the question said: on their next page they're back, as a learner.
    await signInAs(context, person.sessionToken);
    await page.goto("/en");
    await expect.poll(() => rolesOf(person.userId), { timeout: 15000 }).toEqual(["LEARNER"]);
  });

  test("the question's explanation is read with it", async ({ page, context }) => {
    await signInAs(context, admin.sessionToken);
    await page.goto("/en/admin/people");
    await page
      .locator("tr", { hasText: SLOW })
      .first()
      .getByRole("button", { name: `Remove ${SLOW} from the project` })
      .click();
    const confirm = page.getByRole("group", { name: `Remove ${SLOW} from the project?` });
    // Tabbing from the question straight to the action still hears what
    // it does.
    await expect(confirm).toHaveAccessibleDescription(/lose their roles and their cohort/i);
    await expect(
      confirm.getByRole("button", { name: "Remove from project" })
    ).toHaveAccessibleDescription(/lose their roles and their cohort/i);
    await confirm.getByRole("button", { name: "Keep them" }).click();

    await page.goto("/en/admin/cohorts");
    await page
      .getByRole("region", { name: BUSY_ORG })
      .getByRole("button", { name: `Delete ${BUSY_COHORT}` })
      .click();
    const cohortQuestion = page.getByRole("group", {
      name: `Delete the cohort “${BUSY_COHORT}”?`,
    });
    await expect(
      cohortQuestion.getByRole("button", { name: "Delete cohort" })
    ).toHaveAccessibleDescription(/will have no cohort/i);
    await cohortQuestion.getByRole("button", { name: "Keep it" }).click();
  });

  test("on a phone, the question opens on screen, in full", async ({ page, context }) => {
    await signInAs(context, admin.sessionToken);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/en/admin/people");
    const bin = page
      .locator("tr", { hasText: SLOW })
      .first()
      .getByRole("button", { name: `Remove ${SLOW} from the project` });
    const confirm = page.getByRole("group", { name: `Remove ${SLOW} from the project?` });

    // The table scrolls sideways to reach the bin at the end of the row…
    await bin.click();
    await expect(confirm.getByRole("heading")).toBeFocused();
    // …and the question, what happens and both buttons are on screen.
    const what = confirm.getByText(/lose their roles/);
    for (const part of [
      confirm.getByRole("heading"),
      what,
      confirm.getByRole("button", { name: "Remove from project" }),
      confirm.getByRole("button", { name: "Keep them" }),
    ]) {
      await expect(part).toBeInViewport({ ratio: 1 });
    }
    // What happens wraps inside the table's box (WCAG 1.4.10), and the
    // page doesn't scroll sideways.
    const box = (await page.locator("table", { has: confirm }).locator("..").boundingBox())!;
    const text = (await what.boundingBox())!;
    expect(text.x).toBeGreaterThanOrEqual(box.x);
    expect(text.x + text.width).toBeLessThanOrEqual(box.x + box.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await noSeriousViolations(page);

    await confirm.getByRole("button", { name: "Keep them" }).click();
    await expect(bin).toBeFocused();
    expect(await rolesOf(slow.userId)).toEqual(["LEARNER"]);
  });

  test("a removal that fails says so, and can be tried again or kept", async ({
    page,
    context,
  }) => {
    await signInAs(context, admin.sessionToken);
    await page.goto("/en/admin/people");
    const confirm = page.getByRole("group", { name: `Remove ${SLOW} from the project?` });
    const remove = confirm.getByRole("button", { name: "Remove from project" });
    const keep = confirm.getByRole("button", { name: "Keep them" });

    // The server can't be reached.
    await page.route(
      (url) => url.pathname === "/en/admin/people",
      (route) => (isAction(route.request()) ? route.abort("failed") : route.continue())
    );
    await page
      .locator("tr", { hasText: SLOW })
      .first()
      .getByRole("button", { name: `Remove ${SLOW} from the project` })
      .click();
    await remove.click();
    await expect(confirm.getByRole("alert")).toContainText(/no answer from the server/i);
    // Not stuck on a spinner: both buttons work again.
    await expect(remove).not.toHaveAttribute("aria-disabled", "true");
    await expect(keep).not.toHaveAttribute("aria-disabled", "true");
    expect(await rolesOf(slow.userId)).toEqual(["LEARNER"]);
    await keep.click();
    await expect(confirm).toHaveCount(0);
  });

  test("once Remove is pressed, Keep doesn't pretend to keep them", async ({
    page,
    context,
  }) => {
    await signInAs(context, admin.sessionToken);
    await page.goto("/en/admin/people");
    const confirm = page.getByRole("group", { name: `Remove ${SLOW} from the project?` });
    const remove = confirm.getByRole("button", { name: "Remove from project" });
    const keep = confirm.getByRole("button", { name: "Keep them" });

    // The removal is held on its way to a slow server.
    let release = () => {};
    const held = new Promise<void>((done) => (release = done));
    await page.route(
      (url) => url.pathname === "/en/admin/people",
      async (route) => {
        if (isAction(route.request())) await held;
        await route.continue();
      }
    );
    await page
      .locator("tr", { hasText: SLOW })
      .first()
      .getByRole("button", { name: `Remove ${SLOW} from the project` })
      .click();
    await remove.click();
    // It can't be stopped now: Keep and Escape don't close the question
    // as if it were.
    await expect(remove).toHaveAttribute("aria-disabled", "true");
    await expect(keep).toHaveAttribute("aria-disabled", "true");
    await keep.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(confirm).toBeVisible();
    await expect(keep).toBeFocused();

    release();
    await expect(page.locator("tr", { hasText: SLOW })).toHaveCount(0);
    await expect(page.getByText(`Removed ${SLOW} from the project.`)).toBeVisible();
    expect(await rolesOf(slow.userId)).toEqual([]);
  });

  test("a cohort's people are counted once, whatever their roles", async ({
    page,
    context,
  }) => {
    await signInAs(context, admin.sessionToken);
    await page.goto("/en/admin/cohorts");
    const busy = page.getByRole("region", { name: BUSY_ORG });
    // One person, with the Learner and Facilitator roles.
    await expect(
      busy
        .getByRole("listitem")
        .filter({ hasText: BUSY_COHORT })
        .getByText(/^\d+ members?$/)
    ).toHaveText("1 member");
    await busy.getByRole("button", { name: `Delete ${BUSY_COHORT}` }).click();
    const question = page.getByRole("group", {
      name: `Delete the cohort “${BUSY_COHORT}”?`,
    });
    await expect(question).toContainText(/its 1 member will have no cohort/i);
    await question.getByRole("button", { name: "Keep it" }).click();
    expect(await rolesOf(pair.userId)).toEqual(["FACILITATOR", "LEARNER"]);
  });

  test("deleting a cohort or an organisation asks first", async ({ page, context }) => {
    await signInAs(context, admin.sessionToken);
    await page.goto("/en/admin/cohorts");
    const region = page.getByRole("region", { name: ORG });

    // A cohort: asked, kept, then deleted. Its people stay, without it.
    const cohortBin = region.getByRole("button", { name: `Delete ${COHORT}` });
    const cohortQuestion = page.getByRole("group", {
      name: `Delete the cohort “${COHORT}”?`,
    });
    await cohortBin.click();
    await expect(cohortQuestion.getByRole("heading")).toBeFocused();
    await expect(cohortQuestion).toContainText(/its 1 member will have no cohort/i);
    await expect(cohortQuestion).toContainText(/account and data stay/i);
    await noSeriousViolations(page);
    await cohortQuestion.getByRole("button", { name: "Keep it" }).click();
    await expect(cohortQuestion).toHaveCount(0);
    await expect(cohortBin).toBeFocused();
    expect(await prisma.cohort.count({ where: { id: cohortId } })).toBe(1);

    await cohortBin.click();
    await cohortQuestion.getByRole("button", { name: "Delete cohort" }).click();
    await expect(region.getByText(COHORT)).toHaveCount(0);
    expect(await prisma.cohort.count({ where: { id: cohortId } })).toBe(0);
    const kept = await prisma.membership.findFirst({
      where: { userId: learner.userId, projectId: PROJECT },
    });
    expect(kept?.cohortId, "the learner stays, without a cohort").toBeNull();
    // Focus goes to the organisation's next control rather than the page.
    await expect(region.getByLabel(/new cohort/i)).toBeFocused();

    // An organisation that still has cohorts isn't offered for deletion.
    await page
      .getByRole("region", { name: BUSY_ORG })
      .getByRole("button", { name: `Delete ${BUSY_ORG}` })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: /delete the organisation's cohorts first/i })
    ).toBeVisible();
    await expect(page.getByRole("group", { name: /delete the organisation/i })).toHaveCount(0);
    expect(await prisma.organisation.count({ where: { id: busyOrgId } })).toBe(1);

    // An empty one: asked, kept, then deleted.
    const orgBin = region.getByRole("button", { name: `Delete ${ORG}` });
    const orgQuestion = page.getByRole("group", {
      name: `Delete the organisation “${ORG}”?`,
    });
    await orgBin.click();
    await expect(orgQuestion.getByRole("heading")).toBeFocused();
    await orgQuestion.getByRole("button", { name: "Keep it" }).click();
    await expect(orgBin).toBeFocused();
    expect(await prisma.organisation.count({ where: { id: orgId } })).toBe(1);

    await orgBin.click();
    await orgQuestion.getByRole("button", { name: "Delete organisation" }).click();
    await expect(page.getByRole("region", { name: ORG })).toHaveCount(0);
    expect(await prisma.organisation.count({ where: { id: orgId } })).toBe(0);
    // Focus goes to the next organisation's bin (or the first field).
    await expect(page.locator(":focus")).toHaveAccessibleName(/^Delete .+|^Name$/);
  });

  test("an admin can't switch off their own Admin role, and the chip says why", async ({
    page,
    context,
  }) => {
    await signInAs(context, admin.sessionToken);
    await page.goto("/en/admin/people");
    const own = page.locator("tr", { hasText: ADMIN }).first();
    const chip = own.getByRole("button", { name: "Admin", exact: true });
    await expect(chip).toHaveAttribute("aria-disabled", "true");
    await expect(chip).toHaveAccessibleDescription(
      /can't switch off your own admin role/i
    );
    await expect(own).toContainText(/can't switch off your own admin role/i);
    // Pressed anyway (it stays focusable, so it can say why): it says so again.
    await chip.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("alert").filter({ hasText: /can't switch off your own admin role/i })
    ).toBeVisible();
    expect(await rolesOf(admin.userId)).toEqual(["ADMIN"]);

    // Your other roles, and another admin's Admin role, can still change.
    await own.getByRole("button", { name: "Facilitator", exact: true }).click();
    await expect.poll(() => rolesOf(admin.userId)).toEqual(["ADMIN", "FACILITATOR"]);
    const other = page.locator("tr", { hasText: OTHER_ADMIN }).first();
    const otherChip = other.getByRole("button", { name: "Admin", exact: true });
    await expect(otherChip).not.toHaveAttribute("aria-disabled", "true");
    await otherChip.click();
    await expect.poll(() => rolesOf(otherAdmin.userId)).toEqual(["FACILITATOR"]);
  });

  test("a validation is recorded for the skill area of the learner's course", async ({
    page,
    context,
  }) => {
    await signInAs(context, facilitator.sessionToken);
    await page.goto("/en/facilitator");
    await page
      .getByRole("listitem")
      .filter({ hasText: LEARNER_NAME })
      .getByRole("button", { name: /open learner/i })
      .click();

    // A note alone has no skill area: it's asked for with the validation.
    const skill = page.getByLabel(/^skill area$/i);
    await expect(skill).toHaveCount(0);
    await page.getByPlaceholder(/what did you notice/i).fill("Took the feedback calmly.");
    await page.getByLabel(/validate this evidence/i).check();
    // Starts on the course's skill area, Resilience, and says to check it:
    // a saved validation can't be changed on screen.
    await expect(skill).toHaveValue("resilience");
    await expect(skill).toHaveAccessibleDescription(/a saved validation can't be changed here/i);
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });
    await noSeriousViolations(page);

    // Another skill area, chosen after saving: it says that this adds a
    // second validation and the first one stays (it doesn't correct it).
    // The note isn't sent again.
    await skill.selectOption("teamwork");
    await expect(
      page.getByRole("status").filter({ hasText: /adds another validation/i })
    ).toContainText(/the one already saved, for resilience, stays/i);
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });
    const validations = await prisma.validation.findMany({
      where: { validatorId: facilitator.userId, validatedId: learner.userId },
      orderBy: { createdAt: "asc" },
      select: { cluster: true, evidence: true },
    });
    expect(validations).toEqual([
      { cluster: "resilience", evidence: "Took the feedback calmly." },
      { cluster: "teamwork", evidence: "Took the feedback calmly." },
    ]);
    expect(
      await prisma.observation.count({
        where: { observerId: facilitator.userId, observedId: learner.userId },
      })
    ).toBe(1);

    // A learner on no course yet: the facilitator chooses before saving.
    await page.getByRole("button", { name: /^back$/i }).click();
    await page
      .getByRole("listitem")
      .filter({ hasText: NEWBIE_NAME })
      .getByRole("button", { name: /open learner/i })
      .click();
    await expect(skill).toHaveCount(0);
    await page.getByLabel(/validate this evidence/i).check();
    await expect(skill).toHaveValue("");
    const save = page.getByRole("button", { name: /^save$/i });
    await expect(save).toBeDisabled();
    await expect(page.getByText(/choose the skill area you saw/i)).toBeVisible();
    await skill.selectOption("initiative");
    await expect(save).toBeEnabled();
    // Unticked, a note saves without a skill area, and none is asked for.
    await page.getByPlaceholder(/what did you notice/i).fill("Asked who to call.");
    await page.getByLabel(/validate this evidence/i).uncheck();
    await expect(skill).toHaveCount(0);
    await expect(page.getByText(/choose the skill area you saw/i)).toHaveCount(0);
    await expect(save).toBeEnabled();
  });
});
