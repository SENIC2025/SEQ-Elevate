import { test, expect, type BrowserContext, type Page } from "@playwright/test";
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
const EMAILS = [ADMIN, OTHER_ADMIN, PERSON, FACILITATOR, LEARNER, NEWBIE];
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
    await prisma.cohort.create({
      data: { projectId: PROJECT, organisationId: busy.id, name: BUSY_COHORT },
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

    // Starts on the course's skill area: Resilience.
    const skill = page.getByLabel(/^skill area$/i);
    await expect(skill).toHaveValue("resilience");
    await page.getByPlaceholder(/what did you notice/i).fill("Took the feedback calmly.");
    await page.getByLabel(/validate this evidence/i).check();
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/^saved$/i)).toBeVisible({ timeout: 15000 });
    await noSeriousViolations(page);

    // Another skill area, chosen: a validation for it; the note isn't sent again.
    await skill.selectOption("teamwork");
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
    await expect(skill).toHaveValue("");
    await page.getByLabel(/validate this evidence/i).check();
    const save = page.getByRole("button", { name: /^save$/i });
    await expect(save).toBeDisabled();
    await expect(page.getByText(/choose the skill area you saw/i)).toBeVisible();
    await skill.selectOption("initiative");
    await expect(save).toBeEnabled();
  });
});
