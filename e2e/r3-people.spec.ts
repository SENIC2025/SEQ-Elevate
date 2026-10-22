import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient, type Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PROJECT,
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
import { completeProfileStep, fillProfileStep } from "./fixtures/profile-step";
import { currentTermsVersion } from "../src/lib/profile";

/**
 * Release 3 (spec 6, 18.2, A-E1 to A-E12): people and organisations. Who
 * may change whom is proven by calling the actions directly
 * (e2e/fixtures/server-action.ts), never only through what a screen
 * offers; what a screen shows a viewer is read from the page.
 *
 * The world (e2e/fixtures/people.ts) uses the seeded organisations here,
 * whose default country mapping is DE → A (Pro Arbeit) and CY → B
 * (Synthesis). People a test changes are its own, made for it, so the
 * tests don't lean on each other.
 *
 * Guards can't be shown red on the old build: it has no partner admin
 * (the world's partner admins hold no role there). Each test that is a
 * guard says so; the others fail on the old build for the reason the spec
 * names.
 *
 * The steps of A-E9, A-E11 and A-E12 that happen on the profile step
 * (Stream B's /welcome and completeProfile) are walked as the person would.
 *
 * Requires a real database — gated on E2E_DB=1. A-E5 mints an invitation
 * link the way Auth.js stores it, so it needs AUTH_SECRET in the test
 * process. Everything the run makes is unique to it and removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;
// In order, in one worker, each test on its own: a failure doesn't skip the
// rest (each says what it found on the old build too).
test.describe.configure({ mode: "default" });

const RUN = runId();
const ADMIN_FILE = "src/app/actions/admin.ts";
const PEOPLE_PAGE = "/en/admin/people";
const COHORTS_PAGE = "/en/admin/cohorts";

/** Everything `path` sends `person`: the HTML and the React Server Components payload. */
async function payload(request: APIRequestContext, person: Person, path: string): Promise<string> {
  const cookie = { Cookie: `authjs.session-token=${person.sessionToken}` };
  const html = await request.get(path, { headers: cookie, maxRedirects: 0 });
  expect(html.status(), `${path} as ${person.email}`).toBe(200);
  const rsc = await request.get(path, { headers: { ...cookie, RSC: "1" }, maxRedirects: 0 });
  expect(rsc.status(), `${path}'s payload as ${person.email}`).toBe(200);
  return `${await html.text()}\n${await rsc.text()}`;
}

/** No serious or critical axe violation on the page (WCAG 2.2 AA). */
async function noSeriousViolations(page: Page, what: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, `${what}: ${JSON.stringify(serious.map((v) => v.id))}`).toEqual([]);
}

describe("Release 3 people and organisations", () => {
  let world: World;
  /** Every address a test made outside the world, removed at the end. */
  const made: string[] = [];
  /** Cohorts and organisations a test made outside the world. */
  const madeCohorts: string[] = [];
  const madeOrganisations: string[] = [];
  let profiles = true;

  const address = (who: string) => {
    const email = `e2e-people-${who}-${RUN}@example.com`;
    made.push(email);
    return email;
  };

  /** Calls an action of admin.ts as `as`. */
  const call = (request: APIRequestContext, as: Person, name: string, args: unknown[], page = PEOPLE_PAGE) =>
    callAction(request, { as, page, file: ADMIN_FILE, name, args });

  const rolesOf = async (userId: string) =>
    (await prisma.membership.findMany({ where: { userId, projectId: PROJECT }, select: { role: true } }))
      .map((m) => m.role)
      .sort();
  const nameOf = async (userId: string) =>
    (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name;
  const profileOf = (userId: string) =>
    prisma.projectProfile.findUnique({ where: { userId_projectId: { userId, projectId: PROJECT } } });
  const cardOf = (userId: string) =>
    prisma.compCard.findUnique({
      where: { userId_projectId: { userId, projectId: PROJECT } },
      select: { privacy: true, sharedAt: true, sharedWithOrganisationId: true },
    });

  /** A learner of `organisation` whose Comp Card (text: its marker) is shared with it. */
  async function learnerWithSharedCard(who: string, organisation: "A" | "B") {
    const person = await createPerson(prisma, {
      email: address(who),
      name: `${who} ${RUN}`,
      roles: ["LEARNER"],
      organisation: { id: world.organisations[organisation].id },
      country: organisation === "A" ? "DE" : "CY",
    });
    const marker = `card-${who}-${RUN}`;
    await prisma.compCard.create({
      data: {
        userId: person.userId,
        projectId: PROJECT,
        wentWell: `${marker} went well`,
        improve: `${marker} to improve`,
        privacy: "FACILITATOR",
        ...(profiles
          ? { sharedAt: new Date(), sharedWithOrganisationId: world.organisations[organisation].id, sharingVersion: "e2e" }
          : {}),
      },
      select: { id: true },
    });
    return { person, marker };
  }

  test.beforeAll(async () => {
    profiles = await hasProfiles(prisma);
    world = await createWorld(prisma, { run: RUN, organisations: "seeded" });
  });

  test.afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { in: made } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    // The profile step's rows (profile.*) name the profile and its owner.
    const profileIds = profiles
      ? (await prisma.projectProfile.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((p) => p.id)
      : [];
    await prisma.auditLog.deleteMany({
      where: { OR: [{ entityId: { in: [...ids, ...profileIds] } }, { actorId: { in: ids }, action: { startsWith: "profile." } }] },
    });
    await removePeople(prisma, made);
    if (world) await removeWorld(prisma, world);
    await prisma.cohort.deleteMany({ where: { id: { in: madeCohorts } } });
    await prisma.organisation.deleteMany({ where: { id: { in: madeOrganisations } } });
  });

  test("A-E1 (SC5, guard): a partner admin can't add, or rename, another organisation's learner", async ({
    request,
  }) => {
    const lb1 = world.people.LB1;
    const answer = await call(request, world.people.PAA, "addMember", [lb1.email, "LEARNER", `Renamed ${RUN}`]);
    expect(answer.result, answer.raw.slice(0, 300)).toEqual({ ok: false, error: "out-of-scope" });
    expect(await nameOf(lb1.userId)).toBe(lb1.name);
    expect(await rolesOf(lb1.userId)).toEqual(["LEARNER"]);
    // The refusal is logged, without the address.
    const refused = await prisma.auditLog.findFirst({
      where: { actorId: world.people.PAA.userId, action: "member.add_refused" },
      select: { entityId: true, metadata: true },
    });
    expect(refused).toMatchObject({ entityId: null, metadata: { reason: "out-of-scope" } });
    expect(JSON.stringify(refused)).not.toContain(lb1.email);
  });

  test("A-E1: an ADMIN adding someone who completed the profile step adds the role and doesn't rename them", async ({
    request,
  }) => {
    const learner = await createPerson(prisma, {
      email: address("named"),
      name: `Named ${RUN}`,
      roles: ["LEARNER"],
    });
    const answer = await call(request, world.people.AS, "addMember", [learner.email, "FACILITATOR", `Renamed ${RUN}`]);
    expect(await nameOf(learner.userId), "the name they gave stays").toBe(`Named ${RUN}`);
    expect(answer.result).toMatchObject({ ok: true, id: learner.userId });
    expect(await rolesOf(learner.userId)).toEqual(["FACILITATOR", "LEARNER"]);
  });

  test("A-E1 (guard): a partner admin can't add an ADMIN_EMAILS address, not even one with no account yet", async ({
    request,
  }) => {
    // On the test servers' ADMIN_EMAILS (playwright.config.ts). The
    // workspace-hub spec signs it in, so it may have an account meanwhile;
    // either way the partner admin is refused and sets nothing of it.
    const boss = "e2e-bootstrap-admin@example.com";
    const paa = world.people.PAA;
    const before = await prisma.user.findUnique({ where: { email: boss }, select: { id: true } });
    const addedByPaa = async (userId: string) =>
      prisma.auditLog.count({ where: { actorId: paa.userId, action: "member.added", entityId: userId } });
    try {
      const answer = await call(request, paa, "addMember", [boss, "LEARNER", `Boss ${RUN}`]);
      expect(answer.result, answer.raw.slice(0, 300)).toEqual({ ok: false, error: "out-of-scope" });
      const after = await prisma.user.findUnique({
        where: { email: boss },
        select: { id: true, name: true, profiles: { select: { organisationSource: true } } },
      });
      if (after) {
        expect(await addedByPaa(after.id), "added by the partner admin").toBe(0);
        expect(after.name).not.toBe(`Boss ${RUN}`);
        expect(after.profiles.map((p) => p.organisationSource)).not.toContain("partner-admin");
      }
    } finally {
      // A build that lets it through made the account: it goes again, so
      // the workspace-hub spec still finds the address unused.
      const made = before ? null : await prisma.user.findUnique({ where: { email: boss }, select: { id: true } });
      if (made && (await addedByPaa(made.id)) > 0) {
        await prisma.auditLog.deleteMany({ where: { entityId: made.id } });
        await prisma.user.delete({ where: { id: made.id } });
      }
    }
  });

  test("A-E2 (SC6, guard): a partner admin changes the roles of its own learners only, and only to what it may grant", async ({
    request,
  }) => {
    const paa = world.people.PAA;
    const refusals: [keyof World["people"], Role[], string][] = [
      ["AD", ["LEARNER"], "not-found"], // an ADMIN: never in its scope
      ["FA", ["ADMIN"], "not-grantable"], // a role it can't grant
      ["PAA2", ["LEARNER"], "not-grantable"], // another partner admin of A
      ["EA", ["LEARNER"], "not-grantable"], // an editor of A
    ];
    for (const [key, roles, error] of refusals) {
      const target = world.people[key];
      const before = await rolesOf(target.userId);
      const answer = await call(request, paa, "setMemberRoles", [target.userId, roles]);
      expect(answer.result, `${key}: ${answer.raw.slice(0, 200)}`).toEqual({ ok: false, error });
      expect(await rolesOf(target.userId), key).toEqual(before);
    }
    // The positive control: its own learner becomes a facilitator.
    const own = await createPerson(prisma, { email: address("own-learner"), roles: ["LEARNER"] });
    const answer = await call(request, paa, "setMemberRoles", [own.userId, ["LEARNER", "FACILITATOR"]]);
    expect(answer.result).toMatchObject({ ok: true });
    expect(await rolesOf(own.userId)).toEqual(["FACILITATOR", "LEARNER"]);
  });

  test("A-E3 (SC7): a cohort is only one of the person's own organisation, and never moves them", async ({
    request,
  }) => {
    const learner = await createPerson(prisma, { email: address("cohort"), roles: ["LEARNER"] });
    const membershipOrganisations = async () =>
      (
        await prisma.membership.findMany({
          where: { userId: learner.userId, projectId: PROJECT },
          select: { organisationId: true },
        })
      ).map((m) => m.organisationId);
    const cohortB = world.organisations.B.cohortId;

    // An ADMIN can't put them in another organisation's cohort either.
    const admin = await call(request, world.people.AS, "assignCohort", [learner.userId, cohortB]);
    expect(await membershipOrganisations(), "no organisation from the cohort").toEqual([null]);
    expect(admin.result).toEqual({ ok: false, error: "cohort-other-organisation" });

    // A second cohort of their own organisation: assigned, organisation unchanged.
    const cohortA2 = await prisma.cohort.create({
      data: { projectId: PROJECT, organisationId: world.organisations.A.id, name: `E2E cohort A2 ${RUN}` },
      select: { id: true },
    });
    madeCohorts.push(cohortA2.id);
    const own = await call(request, world.people.AS, "assignCohort", [learner.userId, cohortA2.id]);
    expect(own.result).toMatchObject({ ok: true });
    const rows = await prisma.membership.findMany({
      where: { userId: learner.userId, projectId: PROJECT },
      select: { cohortId: true, organisationId: true },
    });
    expect(rows).toEqual([{ cohortId: cohortA2.id, organisationId: null }]);
    expect((await profileOf(learner.userId))?.organisationId).toBe(world.organisations.A.id);

    // Guard: the partner admin of A can't use B's cohort at all.
    const paa = await call(request, world.people.PAA, "assignCohort", [learner.userId, cohortB]);
    expect(paa.result).toEqual({ ok: false, error: "unknown-cohort" });
    expect((await prisma.membership.findFirst({ where: { userId: learner.userId } }))?.cohortId).toBe(cohortA2.id);
  });

  test("A-E3 (guard): a partner admin deletes its organisation's cohort only when it is shown everyone in it", async ({
    request,
  }) => {
    const cohortOf = async (name: string) => {
      const cohort = await prisma.cohort.create({
        data: { projectId: PROJECT, organisationId: world.organisations.A.id, name: `${name} ${RUN}` },
        select: { id: true },
      });
      madeCohorts.push(cohort.id);
      return cohort.id;
    };
    const join = (userId: string, cohortId: string) =>
      prisma.membership.updateMany({ where: { userId, projectId: PROJECT }, data: { cohortId } });
    const exists = async (id: string) => (await prisma.cohort.count({ where: { id } })) === 1;

    // An ADMIN of A in it: the partner admin isn't shown them, and its
    // question would count only the learner, so it can't delete it.
    const mixed = await cohortOf("E2E mixed cohort");
    const learner = await createPerson(prisma, { email: address("cohort-learner"), roles: ["LEARNER"] });
    const adminOfA = await createPerson(prisma, {
      email: address("cohort-admin"),
      roles: ["ADMIN"],
      organisation: { id: world.organisations.A.id },
    });
    await join(learner.userId, mixed);
    await join(adminOfA.userId, mixed);
    const refused = await call(request, world.people.PAA, "deleteCohort", [mixed], COHORTS_PAGE);
    expect(refused.result).toEqual({ ok: false, error: "has-others" });
    expect(await exists(mixed)).toBe(true);
    expect((await prisma.membership.findFirst({ where: { userId: adminOfA.userId } }))?.cohortId).toBe(mixed);

    // Only its own people in it: deleted, and they keep their accounts.
    const own = await cohortOf("E2E own cohort");
    const second = await createPerson(prisma, { email: address("cohort-learner-2"), roles: ["LEARNER"] });
    await join(second.userId, own);
    const deleted = await call(request, world.people.PAA, "deleteCohort", [own], COHORTS_PAGE);
    expect(deleted.result).toMatchObject({ ok: true });
    expect(await exists(own)).toBe(false);
    expect((await prisma.membership.findFirst({ where: { userId: second.userId } }))?.cohortId).toBeNull();

    // An ADMIN, shown everyone, deletes the mixed one.
    const byAdmin = await call(request, world.people.AS, "deleteCohort", [mixed], COHORTS_PAGE);
    expect(byAdmin.result).toMatchObject({ ok: true });
    expect(await exists(mixed)).toBe(false);
  });

  test("A-E4 (SC8–SC10, guard): a partner admin can't remove, invite or change another organisation's people and cohorts, or its own partner admins and editors", async ({
    request,
  }) => {
    const paa = world.people.PAA;
    const { LB1, PAA2, EA } = world.people;
    const cohortB = world.organisations.B.cohortId;
    const cohortName = async () => (await prisma.cohort.findUnique({ where: { id: cohortB } }))?.name;
    const before = await cohortName();
    const tries: [string, unknown[], string, string?][] = [
      ["removeMember", [LB1.userId], "not-found"],
      ["resendInvitation", [LB1.userId, "en"], "not-found"],
      ["updateCohort", [cohortB, { name: `Taken ${RUN}` }], "unknown-cohort", COHORTS_PAGE],
      ["deleteCohort", [cohortB], "unknown-cohort", COHORTS_PAGE],
      ["removeMember", [PAA2.userId], "not-grantable"],
      ["removeMember", [EA.userId], "not-grantable"],
    ];
    for (const [name, args, error, page] of tries) {
      const answer = await call(request, paa, name, args, page);
      expect(answer.result, `${name}(${JSON.stringify(args)}): ${answer.raw.slice(0, 200)}`).toEqual({ ok: false, error });
    }
    expect(await rolesOf(LB1.userId)).toEqual(["LEARNER"]);
    expect(await rolesOf(PAA2.userId)).toEqual(["PARTNER_ADMIN"]);
    expect(await rolesOf(EA.userId)).toEqual(["CONTENT_EDITOR"]);
    expect(await cohortName()).toBe(before);
    expect(await prisma.verificationToken.count({ where: { identifier: LB1.email } })).toBe(0);
  });

  test("A-E5 (guard): a partner admin invites a facilitator, who joins its organisation and sees its learners", async ({
    page,
    context,
    request,
  }) => {
    const secret = process.env.AUTH_SECRET;
    test.skip(!secret, "needs AUTH_SECRET to mint a link the way Auth.js stores it");
    const invitee = address("invitee");
    await signIn(context, world.people.PAA.sessionToken);
    await page.goto(PEOPLE_PAGE);
    await expect(page.getByText(`Add someone to ${world.organisations.A.name}`).first()).toBeVisible();
    // A partner admin is offered the roles it may grant, and no organisation to pick.
    await expect(page.getByLabel(/^role$/i).first().locator("option")).toHaveText(["Learner", "Facilitator"]);
    await expect(page.getByLabel(/^organisation$/i)).toHaveCount(0);
    await page.getByLabel(/^email$/i).first().fill(invitee);
    await page.getByLabel(/name \(optional\)/i).first().fill(`Invitee ${RUN}`);
    await page.getByLabel(/^role$/i).first().selectOption("FACILITATOR");
    await expect(page.getByLabel(/send them an invitation email/i).first()).toBeChecked();
    await page.getByRole("button", { name: /^add$/i }).first().click();
    await expect(page.getByText(/sent them an invitation email/i).first()).toBeVisible();

    const user = await prisma.user.findUniqueOrThrow({ where: { email: invitee } });
    expect(await rolesOf(user.id)).toEqual(["FACILITATOR"]);
    expect(await profileOf(user.id)).toMatchObject({
      organisationId: world.organisations.A.id,
      organisationSource: "partner-admin",
    });
    expect(await prisma.verificationToken.count({ where: { identifier: invitee } })).toBe(1);

    // The link signs them in (minted as Auth.js stores one).
    const raw = randomBytes(32).toString("hex");
    await prisma.verificationToken.create({
      data: {
        identifier: invitee,
        token: createHash("sha256").update(`${raw}${secret}`).digest("hex"),
        expires: new Date(Date.now() + 86_400_000),
      },
    });
    await context.clearCookies();
    await page.goto(`/api/auth/callback/invite?${new URLSearchParams({ callbackUrl: "/en/account", token: raw, email: invitee })}`);
    await expect(page).toHaveURL(/\/en\/account$/);
    // Their profile step done (Stream B's screen; here as it leaves the profile).
    const now = new Date();
    await prisma.projectProfile.update({
      where: { userId_projectId: { userId: user.id, projectId: PROJECT } },
      data: {
        country: "DE",
        termsVersion: currentTermsVersion(),
        termsAcceptedAt: now,
        ageRule: "SELF_MIN_AGE",
        ageConfirmedAt: now,
        profileCompletedAt: now,
      },
    });
    await page.goto("/en");
    for (const workspace of ["Support learners", "Statistics", "My learning"]) {
      await expect(page.getByRole("link", { name: workspace }).first(), workspace).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Manage people" })).toHaveCount(0);
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === "authjs.session-token")?.value ?? "";
    const roster = await payload(request, { ...world.people.FA, sessionToken: session }, "/en/facilitator");
    expect(roster).toContain(world.marker("LA1"));
    expect(roster).not.toContain(world.marker("LB1"));
  });

  test("A-E6: an ADMIN changes a learner's country; they move to its organisation and their card is no longer shared", async ({
    page,
    context,
    request,
  }) => {
    const { person, marker } = await learnerWithSharedCard("mover", "A");
    // Before: A's facilitator reads the shared card.
    expect(await payload(request, world.people.FA, "/en/facilitator")).toContain(marker);

    await signIn(context, world.people.AS.sessionToken);
    await page.goto(PEOPLE_PAGE);
    const row = page.locator("tr", { hasText: person.email }).first();
    await row.getByRole("button", { name: `Change details of ${person.email}` }).click();
    const form = page.getByRole("group", { name: `Change details of ${person.name}` });
    await expect(form.getByRole("heading")).toBeFocused();
    await form.getByLabel("Country").selectOption("CY");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(`Saved the details of ${person.email}.`)).toBeVisible();
    await expect(page.locator("tr", { hasText: person.email }).first()).toContainText(world.organisations.B.name);

    expect(await profileOf(person.userId)).toMatchObject({ country: "CY", organisationId: world.organisations.B.id });
    expect(await cardOf(person.userId)).toEqual({ privacy: "SELF", sharedAt: null, sharedWithOrganisationId: null });
    expect(await payload(request, world.people.FA, "/en/facilitator")).not.toContain(marker);
    const b = await payload(request, world.people.FB, "/en/facilitator");
    expect(b, "B's facilitator sees the learner").toContain(person.email);
    expect(b, "but not the card").not.toContain(marker);
    const profile = await profileOf(person.userId);
    const logged = await prisma.auditLog.findMany({
      where: { entityId: profile!.id, actorId: world.people.AS.userId },
      select: { action: true },
    });
    expect(logged.map((l) => l.action).sort()).toEqual(["person.country_changed", "person.organisation_changed"]);
  });

  test("A-E6: the form shows the organisation a new country brings, and keeps one picked after it (the card stays shared)", async ({
    page,
    context,
    request,
  }) => {
    // A learner of A who moves to Cyprus but keeps working with A.
    const { person, marker } = await learnerWithSharedCard("stays", "A");
    const { A, B } = world.organisations;
    await signIn(context, world.people.AS.sessionToken);
    await page.goto(PEOPLE_PAGE);
    await page
      .locator("tr", { hasText: person.email })
      .first()
      .getByRole("button", { name: `Change details of ${person.email}` })
      .click();
    const form = page.getByRole("group", { name: `Change details of ${person.name}` });
    const organisation = form.getByLabel("Organisation");
    await expect(organisation).toHaveValue(A.id);
    await form.getByLabel("Country").selectOption("CY");
    // What saving would do, on screen before it is done.
    await expect(organisation, "the organisation Cyprus brings").toHaveValue(B.id);
    await expect(form.getByRole("status")).toHaveText(`Cyprus: learners join ${B.name}.`);
    await organisation.selectOption(A.id);
    await form.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(`Saved the details of ${person.email}.`)).toBeVisible();

    expect(await profileOf(person.userId)).toMatchObject({ country: "CY", organisationId: A.id });
    expect(await cardOf(person.userId)).toMatchObject({ privacy: "FACILITATOR", sharedWithOrganisationId: A.id });
    expect(await payload(request, world.people.FA, "/en/facilitator"), "A's facilitator still reads it").toContain(marker);
  });

  test("A-E7: an ADMIN maps a country on screen; a partner admin's direct call is refused", async ({
    page,
    context,
    request,
  }) => {
    const mappingOf = async (country: "GR") =>
      (await prisma.countryMapping.findUnique({ where: { projectId_country: { projectId: PROJECT, country } } }))
        ?.organisationId ?? null;
    await signIn(context, world.people.AS.sessionToken);
    await page.goto(COHORTS_PAGE);
    const heading = page.getByRole("heading", { name: "Country mapping" });
    await expect(heading).toBeVisible();
    const panel = heading.locator("xpath=..");
    const before = await mappingOf("GR");
    try {
      await panel.getByLabel("Greece", { exact: true }).selectOption({ label: world.organisations.B.name });
      await panel.getByRole("button", { name: "Save the organisation for Greece" }).click();
      await expect(panel.getByText(`Greece: learners join ${world.organisations.B.name}.`)).toBeVisible();
      expect(await mappingOf("GR")).toBe(world.organisations.B.id);
      expect(
        await prisma.auditLog.count({
          where: { actorId: world.people.AS.userId, action: "org.country_mapped", entityId: "GR" },
        })
      ).toBe(1);

      // Guard: a partner admin can't, whatever it sends.
      const answer = await call(request, world.people.PAA, "setCountryMapping", ["GR", world.organisations.A.id, { assignUnplaced: true }], COHORTS_PAGE);
      expect(answer.result).toEqual({ ok: false, error: "forbidden" });
      expect(await mappingOf("GR")).toBe(world.organisations.B.id);
    } finally {
      if (before) {
        await prisma.countryMapping.update({
          where: { projectId_country: { projectId: PROJECT, country: "GR" } },
          data: { organisationId: before },
        });
      }
    }
  });

  test("A-E7: a saved mapping shows from the save's own answer, not a reload of the page", async ({ page, context }) => {
    // A router refresh of the page can be lost or come back with what was
    // there before (Next's router, around the server action it follows).
    // Here every reload of the page answers with Greece's mapping as it
    // was before the save, so only the panel's own reading of the save's
    // answer can show the new one.
    const mappingOf = async () =>
      (await prisma.countryMapping.findUnique({ where: { projectId_country: { projectId: PROJECT, country: "GR" } } }))
        ?.organisationId ?? null;
    const before = await mappingOf();
    const { A, B } = world.organisations;
    const target = before === B.id ? A : B;
    await page.route(/\/en\/admin\/cohorts\?_rsc=/, async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replaceAll(
        `{"country":"GR","organisationId":"${target.id}"}`,
        `{"country":"GR","organisationId":"${before ?? ""}"}`
      );
      const headers = { ...response.headers() };
      delete headers["content-encoding"];
      delete headers["content-length"];
      await route.fulfill({ status: response.status(), headers, body });
    });
    await signIn(context, world.people.AS.sessionToken);
    await page.goto(COHORTS_PAGE);
    const panel = page.getByRole("heading", { name: "Country mapping" }).locator("xpath=..");
    const greece = panel.getByLabel("Greece", { exact: true });
    try {
      await expect(async () => {
        await greece.selectOption({ label: target.name });
        await panel.getByRole("button", { name: "Save the organisation for Greece" }).click({ timeout: 2000 });
        await expect(panel.getByText(`Greece: learners join ${target.name}.`)).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 20_000 });
      expect(await mappingOf()).toBe(target.id);
      // Long enough for the refresh that follows the save to have landed.
      await page.waitForLoadState("networkidle");
      await expect(greece, "the panel shows what the save answered").toHaveValue(target.id);
      await expect(panel.getByRole("button", { name: "Save the organisation for Greece" })).toBeDisabled();
    } finally {
      if (before) {
        await prisma.countryMapping.update({
          where: { projectId_country: { projectId: PROJECT, country: "GR" } },
          data: { organisationId: before },
        });
      }
    }
  });

  test("A-E8: an organisation people belong to can't be deleted", async ({ page, context, request }) => {
    const org = await prisma.organisation.create({
      data: { projectId: PROJECT, name: `E2E People Org ${RUN}`, shortName: `People ${RUN}` },
      select: { id: true, name: true },
    });
    madeOrganisations.push(org.id);
    const member = await createPerson(prisma, {
      email: address("member"),
      roles: ["LEARNER"],
      organisation: { id: org.id },
    });
    // Where the old build kept a person's organisation, too.
    await prisma.membership.updateMany({ where: { userId: member.userId }, data: { organisationId: org.id } });

    const answer = await call(request, world.people.AS, "deleteOrganisation", [org.id], COHORTS_PAGE);
    expect(await prisma.organisation.count({ where: { id: org.id } }), "the organisation is still there").toBe(1);
    expect(answer.result).toEqual({ ok: false, error: "has-people" });
    expect((await prisma.membership.findFirst({ where: { userId: member.userId } }))?.organisationId).toBe(org.id);
    expect((await profileOf(member.userId))?.organisationId).toBe(org.id);

    // The screen says so instead of asking.
    await signIn(context, world.people.AS.sessionToken);
    await page.goto(COHORTS_PAGE);
    await page.getByRole("region", { name: org.name }).getByRole("button", { name: `Delete ${org.name}` }).click();
    await expect(page.getByRole("alert").filter({ hasText: /people belong to this organisation/i })).toBeVisible();
    await expect(page.getByRole("group", { name: /delete the organisation/i })).toHaveCount(0);
  });

  test("A-E9 (guard): a partner admin adds a learner with a guardian's permission, and can take back the sharing part", async ({
    page,
    context,
  }) => {
    const young = address("young");
    await signIn(context, world.people.PAA.sessionToken);
    await page.goto(PEOPLE_PAGE);
    await expect(page.getByText(`Add someone to ${world.organisations.A.name}`).first()).toBeVisible();
    await page.getByLabel(/^email$/i).first().fill(young);
    await page.getByLabel(/^role$/i).first().selectOption("LEARNER");
    await page.getByLabel(/send them an invitation email/i).first().uncheck();
    await page.getByLabel(/our organisation holds a parent's or guardian's permission/i).first().check();
    await page.getByLabel(/that permission also covers sharing their comp card/i).first().check();
    await page.getByRole("button", { name: /^add$/i }).first().click();
    await expect(page.getByText(`Added ${young}.`, { exact: false }).first()).toBeVisible();

    const user = await prisma.user.findUniqueOrThrow({ where: { email: young } });
    const profile = await profileOf(user.id);
    expect(profile).toMatchObject({ organisationId: world.organisations.A.id, profileCompletedAt: null });
    expect(profile?.guardianConsentRecordedAt).toBeInstanceOf(Date);
    expect(profile?.guardianSharingConsentAt).toBeInstanceOf(Date);
    const recorded = await prisma.auditLog.findFirst({
      where: { action: "member.guardian_consent_recorded", entityId: profile!.id },
      select: { metadata: true },
    });
    expect(recorded?.metadata).toMatchObject({ sharing: true, scope: world.organisations.A.id });

    // Their row says so; the sharing part can be taken back, after a
    // question that says what that does to the card (WCAG 3.3.4). Shared
    // with A, as the permission allows.
    await prisma.compCard.create({
      data: {
        userId: user.id,
        projectId: PROJECT,
        wentWell: `young ${RUN}`,
        privacy: "FACILITATOR",
        sharedAt: new Date(),
        sharedWithOrganisationId: world.organisations.A.id,
        sharingVersion: "e2e",
      },
      select: { id: true },
    });
    const row = page.locator("tr", { hasText: young }).first();
    await expect(row).toContainText(/guardian's permission recorded/);
    const tick = row.getByLabel(/^the guardian's permission also covers sharing their comp card/i);
    const question = page.getByRole("group", { name: /take back the guardian's permission/i });
    await tick.uncheck();
    await expect(question).toBeVisible();
    await expect(question).toContainText(/goes back to “Only me”/);
    expect((await profileOf(user.id))?.guardianSharingConsentAt, "nothing changes before the answer").toBeInstanceOf(Date);
    // Kept: the tick is back on, and nothing changed.
    await question.getByRole("button", { name: "Keep it" }).click();
    await expect(question).toHaveCount(0);
    await expect(tick).toBeChecked();
    expect((await profileOf(user.id))?.guardianSharingConsentAt).toBeInstanceOf(Date);
    // Taken back: the permission and the card's sharing go.
    await tick.uncheck();
    await question.getByRole("button", { name: "Take back the permission" }).click();
    await expect(question).toHaveCount(0);
    await expect.poll(async () => (await profileOf(user.id))?.guardianSharingConsentAt ?? null).toBeNull();
    expect((await profileOf(user.id))?.guardianConsentRecordedAt).toBeInstanceOf(Date);
    expect(await cardOf(user.id)).toEqual({ privacy: "SELF", sharedAt: null, sharedWithOrganisationId: null });
  });

  test("A-E9 (guard): that learner's profile step offers the invited statement; a self-registered learner can't send it", async ({
    page,
    context,
    request,
  }) => {
    const invited = address("invited");
    const answer = await call(request, world.people.PAA, "addMember", [invited, "LEARNER", undefined, { guardianConsent: true }]);
    expect(answer.result, answer.raw.slice(0, 200)).toMatchObject({ ok: true });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: invited } });
    // They sign in, as their invitation link would let them.
    await signIn(context, await createSession(prisma, user.id));
    await page.goto("/en");
    await expect(page).toHaveURL(/\/en\/welcome$/);
    const main = page.getByRole("main");
    await expect(main.getByText(`Your account was set up by ${world.organisations.A.name}.`)).toBeVisible();
    await expect(
      main.getByRole("checkbox", { name: `${world.organisations.A.name} invited me and has my parent's or guardian's permission.` })
    ).toBeVisible();
    await expect(main.getByText(/or older/)).toHaveCount(0);

    // Someone who signed up on their own can't send it, whatever they send.
    const self = await createPerson(prisma, { email: address("self-invited"), profile: "none", organisation: null });
    const refused = await callAction(request, {
      as: self,
      page: "/en/welcome",
      file: "src/app/actions/profile.ts",
      name: "completeProfile",
      args: [{ name: `Self ${RUN}`, country: "DE", termsAccepted: true, age: "invited" }],
    });
    expect(refused.result).toEqual({ ok: false, errors: { age: "not-invited" } });
    expect((await profileOf(self.userId))?.profileCompletedAt ?? null).toBeNull();
    expect(await rolesOf(self.userId)).toEqual([]);
  });

  test("A-E10: moved to another organisation and back, a learner's card stays \"Only me\"; the same when the organisation is changed by hand in the database", async ({
    page,
    context,
    request,
  }) => {
    const { person, marker } = await learnerWithSharedCard("back-and-forth", "A");
    expect(await payload(request, world.people.FA, "/en/facilitator")).toContain(marker);
    const as = world.people.AS;
    for (const organisationId of [world.organisations.B.id, world.organisations.A.id]) {
      const answer = await call(request, as, "updatePersonProfile", [person.userId, { organisationId }]);
      expect(answer.result, answer.raw.slice(0, 200)).toMatchObject({ ok: true });
    }
    expect((await profileOf(person.userId))?.organisationId).toBe(world.organisations.A.id);
    expect(await cardOf(person.userId)).toEqual({ privacy: "SELF", sharedAt: null, sharedWithOrganisationId: null });
    expect(await payload(request, world.people.FA, "/en/facilitator")).not.toContain(marker);
    // Their own screen says "Only me".
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner/comp-card");
    await expect(page.getByRole("button", { name: "Only me", pressed: true })).toBeVisible();

    // Shared again, then moved away and back by hand: the database's own
    // trigger unshares it.
    await prisma.compCard.update({
      where: { userId_projectId: { userId: person.userId, projectId: PROJECT } },
      data: { privacy: "FACILITATOR", sharedAt: new Date(), sharedWithOrganisationId: world.organisations.A.id },
    });
    expect(await payload(request, world.people.FA, "/en/facilitator")).toContain(marker);
    for (const organisationId of [world.organisations.B.id, world.organisations.A.id]) {
      await prisma.$executeRaw`UPDATE "ProjectProfile" SET "organisationId" = ${organisationId} WHERE "userId" = ${person.userId} AND "projectId" = ${PROJECT}`;
    }
    expect(await cardOf(person.userId)).toEqual({ privacy: "SELF", sharedAt: null, sharedWithOrganisationId: null });
    expect(await payload(request, world.people.FA, "/en/facilitator")).not.toContain(marker);
  });

  test("A-E11 (guard): a partner admin claims an account that holds nothing yet, with a guardian's permission; one with learner data or another organisation it can't", async ({
    request,
  }) => {
    const paa = world.people.PAA;
    // Signed up on their own, stopped at the age box: an account, no profile done, nothing else.
    const younger = await createPerson(prisma, { email: address("younger"), profile: "none", organisation: null });
    const answer = await call(request, paa, "addMember", [younger.email, "LEARNER", undefined, { guardianConsent: true }]);
    expect(answer.result, answer.raw.slice(0, 300)).toMatchObject({ ok: true, id: younger.userId });
    expect(await rolesOf(younger.userId)).toEqual(["LEARNER"]);
    const claimed = await profileOf(younger.userId);
    expect(claimed).toMatchObject({ organisationId: world.organisations.A.id, organisationSource: "partner-admin" });
    expect(claimed?.guardianConsentRecordedAt).toBeInstanceOf(Date);

    // Learner data (a course started) or another organisation: not claimable.
    const started = await createPerson(prisma, { email: address("started"), profile: "none", organisation: null });
    await prisma.courseEnrollment.create({
      data: { userId: started.userId, courseId: world.course.id, stagesCompleted: [] },
      select: { id: true },
    });
    const elsewhere = await createPerson(prisma, { email: address("elsewhere"), profile: "none", organisation: "B" });
    for (const person of [started, elsewhere]) {
      const refused = await call(request, paa, "addMember", [person.email, "LEARNER", `Mine ${RUN}`, { guardianConsent: true }]);
      expect(refused.result, person.email).toEqual({ ok: false, error: "out-of-scope" });
      expect(await rolesOf(person.userId)).toEqual([]);
      expect(await nameOf(person.userId)).toBeNull();
    }
    expect((await profileOf(started.userId))?.organisationId ?? null).toBeNull();
    expect((await profileOf(elsewhere.userId))?.organisationId).toBe(world.organisations.B.id);
  });

  test("A-E11 (guard): a claim at the moment the person finishes the profile step leaves the organisation the profile step set", async ({
    request,
  }) => {
    // Signed up on their own, no profile row yet: claimable when checked.
    const person = await createPerson(prisma, { email: address("racing"), profile: "none", organisation: null });
    const { A, B } = world.organisations;
    // Their profile step (as Stream B's writes it at the first completion):
    // the row made with B, the organisation Cyprus brings, and held open
    // while the partner admin's claim comes in.
    let inserted!: () => void;
    const rowMade = new Promise<void>((resolve) => (inserted = resolve));
    const profileStep = prisma.$transaction(
      async (tx) => {
        const now = new Date();
        await tx.projectProfile.create({
          data: {
            userId: person.userId,
            projectId: PROJECT,
            country: "CY",
            organisationId: B.id,
            organisationSource: "country",
            termsVersion: currentTermsVersion(),
            termsAcceptedAt: now,
            ageRule: "SELF_MIN_AGE",
            ageConfirmedAt: now,
            profileCompletedAt: now,
          },
          select: { id: true },
        });
        inserted();
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      },
      { maxWait: 10_000, timeout: 30_000 }
    );
    await rowMade;
    const claim = call(request, world.people.PAA, "addMember", [person.email, "LEARNER", `Mine ${RUN}`]);
    await profileStep;
    const answer = await claim;
    // "changed" when the claim waited for the profile step's row, or
    // "out-of-scope" when that row was there before the claim was checked.
    expect(answer.result, answer.raw.slice(0, 300)).toEqual({
      ok: false,
      error: expect.stringMatching(/^(changed|out-of-scope)$/),
    });
    expect(await profileOf(person.userId)).toMatchObject({ organisationId: B.id, organisationSource: "country" });
    expect((await profileOf(person.userId))?.organisationId).not.toBe(A.id);
    expect(await rolesOf(person.userId)).toEqual([]);
    expect(await nameOf(person.userId)).toBeNull();
  });

  test("A-E11 (guard): a self-registered under-16 is stopped at the age box; after a partner admin's claim they complete the profile with the invited statement and land in its organisation", async ({
    page,
    context,
    request,
  }) => {
    const younger = await createPerson(prisma, { email: address("under16"), profile: "none", organisation: null });
    await signIn(context, younger.sessionToken);
    await page.goto("/en");
    await expect(page).toHaveURL(/\/en\/welcome$/);
    const main = page.getByRole("main");
    // Everything but the age box.
    await expect(async () => {
      await fillProfileStep(page, { name: `Young ${RUN}`, country: "Germany" });
      await main.getByRole("checkbox", { name: /or older/ }).uncheck();
      await main.getByRole("button", { name: "Continue" }).click();
      await expect(main.getByRole("heading", { name: "Please check:" })).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });
    await expect(main.getByText("Younger than 16? You can join if a partner organisation invites you.", { exact: false })).toBeVisible();
    // Stopped there: nothing kept, so the account is still one a partner admin may claim.
    expect((await profileOf(younger.userId))?.organisationId ?? null).toBeNull();
    expect(await rolesOf(younger.userId)).toEqual([]);

    const claim = await call(request, world.people.PAA, "addMember", [younger.email, "LEARNER", undefined, { guardianConsent: true }]);
    expect(claim.result, claim.raw.slice(0, 300)).toMatchObject({ ok: true, id: younger.userId });

    await page.goto("/en/welcome");
    await expect(main.getByText(`Your account was set up by ${world.organisations.A.name}.`)).toBeVisible();
    await completeProfileStep(page, { name: `Young ${RUN}`, country: "Germany", invited: true });
    await expect(page).toHaveURL(/\/en\/learner$/);
    expect(await profileOf(younger.userId)).toMatchObject({
      organisationId: world.organisations.A.id,
      organisationSource: "partner-admin",
      country: "DE",
      ageRule: "INVITED_WITH_GUARDIAN_CONSENT",
    });
    expect(await rolesOf(younger.userId)).toEqual(["LEARNER"]);
  });

  test("A-E12 (guard): a partner admin's addition, released by the profile step, is listed for an ADMIN; no ADMIN changes their own organisation", async ({
    page,
    context,
    request,
  }) => {
    const added = address("added");
    const answer = await call(request, world.people.PAA, "addMember", [added, "LEARNER"]);
    expect(answer.result).toMatchObject({ ok: true });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: added } });
    expect(await profileOf(user.id)).toMatchObject({
      organisationId: world.organisations.A.id,
      organisationSource: "partner-admin",
    });

    // Not yet signed in: on the ADMIN's list of a partner admin's additions.
    await signIn(context, world.people.AS.sessionToken);
    await page.goto(PEOPLE_PAGE);
    await page.getByLabel("Show", { exact: true }).first().selectOption("partner-pending");
    await expect(page.locator("tr", { hasText: added })).toHaveCount(1);
    await expect(page.locator("tr", { hasText: world.people.LA1.email })).toHaveCount(0);

    // Released, as Stream B's profile step leaves someone who picked
    // Cyprus: on the ADMIN's list of countries that don't match.
    await prisma.$executeRaw`UPDATE "ProjectProfile" SET "organisationId" = NULL, "organisationSource" = 'released', "country" = 'CY', "profileCompletedAt" = now() WHERE "userId" = ${user.id} AND "projectId" = ${PROJECT}`;
    await page.reload();
    await page.getByLabel("Show", { exact: true }).first().selectOption("mismatch");
    const row = page.locator("tr", { hasText: added }).first();
    await expect(row).toContainText("Country doesn't match organisation");
    await expect(row).toContainText("No organisation");

    // No ADMIN sets their own organisation (D81): neither way.
    const ad = world.people.AD;
    const own = await call(request, ad, "updatePersonProfile", [ad.userId, { organisationId: world.organisations.B.id }]);
    expect(own.result).toEqual({ ok: false, error: "self" });
    const ownAdd = await call(request, ad, "addMember", [ad.email, "LEARNER", undefined, { organisationId: world.organisations.B.id }]);
    expect(ownAdd.result).toEqual({ ok: false, error: "self" });
    expect((await profileOf(ad.userId))?.organisationId).toBe(world.organisations.DIESIS.id);
    expect(await rolesOf(ad.userId)).toEqual(["ADMIN"]);
  });

  test("A-E12 (guard): a partner admin can't change the country or organisation of its own learner, called directly", async ({
    request,
  }) => {
    const paa = world.people.PAA;
    const { A, B } = world.organisations;
    const learner = await createPerson(prisma, {
      email: address("own-country"),
      name: `Own ${RUN}`,
      roles: ["LEARNER"],
      organisation: "A",
      country: "DE",
    });
    for (const changes of [{ organisationId: B.id }, { organisationId: null }, { country: "CY" }, { country: "CY", organisationId: A.id }]) {
      const answer = await call(request, paa, "updatePersonProfile", [learner.userId, changes]);
      expect(answer.result, `${JSON.stringify(changes)}: ${answer.raw.slice(0, 200)}`).toEqual({ ok: false, error: "forbidden" });
    }
    const profile = await profileOf(learner.userId);
    expect(profile).toMatchObject({ country: "DE", organisationId: A.id });
    const logged = await prisma.auditLog.count({
      where: { actorId: paa.userId, action: { startsWith: "person." }, entityId: { in: [learner.userId, profile!.id] } },
    });
    expect(logged, "no person.* change by the partner admin").toBe(0);
    // The control: its learner's name it may change.
    const renamed = await call(request, paa, "updatePersonProfile", [learner.userId, { name: `Renamed ${RUN}` }]);
    expect(renamed.result).toMatchObject({ ok: true });
    expect(await nameOf(learner.userId)).toBe(`Renamed ${RUN}`);
  });

  test("Organisations & cohorts fit a 320px phone, for an ADMIN and a partner admin (WCAG 1.4.10; guard: the people count is new)", async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const [who, heading] of [
      ["AS", "Organisations & cohorts"],
      ["PAA", "Cohorts"],
    ] as const) {
      await signIn(context, world.people[who].sessionToken);
      await page.goto(COHORTS_PAGE);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      // Each organisation's name, counts and bin wrap onto the screen.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `${who}: no horizontal scrolling`).toBeLessThanOrEqual(0);
    }
  });

  test("a partner admin's counts are of the people it is shown: never an ADMIN or someone with no role (guard)", async ({
    page,
    context,
  }) => {
    // An organisation of its own, so the counts are exactly this test's.
    const org = await prisma.organisation.create({
      data: { projectId: PROJECT, name: `E2E Counted Org ${RUN}`, shortName: `Counted ${RUN}` },
      select: { id: true, name: true },
    });
    madeOrganisations.push(org.id);
    const cohort = await prisma.cohort.create({
      data: { projectId: PROJECT, organisationId: org.id, name: `E2E counted cohort ${RUN}` },
      select: { id: true, name: true },
    });
    madeCohorts.push(cohort.id);
    const own = { organisation: { id: org.id } };
    const partnerAdmin = await createPerson(prisma, { email: address("counted-pa"), roles: ["PARTNER_ADMIN"], ...own });
    const learner = await createPerson(prisma, { email: address("counted-learner"), roles: ["LEARNER"], ...own });
    const admin = await createPerson(prisma, { email: address("counted-admin"), roles: ["ADMIN"], ...own });
    await createPerson(prisma, { email: address("counted-removed"), roles: [], ...own });
    await prisma.membership.updateMany({
      where: { userId: { in: [learner.userId, admin.userId] }, projectId: PROJECT },
      data: { cohortId: cohort.id },
    });

    await signIn(context, partnerAdmin.sessionToken);
    await page.goto(PEOPLE_PAGE);
    // The rows on screen (while the page streams in, the server's copy can
    // sit in a hidden block for a moment).
    const shown = page.locator("tbody tr").filter({ visible: true });
    await expect(shown.filter({ hasText: learner.email })).toHaveCount(1);
    await page.waitForLoadState("networkidle");
    const rows = await shown.count();
    expect(rows, "the partner admin and its learner").toBe(2);

    await page.goto(COHORTS_PAGE);
    const region = page.getByRole("region", { name: org.name });
    await expect(region).toContainText(`${rows} people`);
    await expect(region.locator("li", { hasText: cohort.name })).toContainText("1 member");
  });

  test("a partner admin's screens, and an ADMIN's country mapping and change form, have no serious accessibility violations (guard)", async ({
    page,
    context,
  }) => {
    await signIn(context, world.people.PAA.sessionToken);
    for (const path of ["/en/admin", PEOPLE_PAGE, COHORTS_PAGE]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await noSeriousViolations(page, `${path} as a partner admin`);
    }
    // A partner admin's learner's "Change details" form, open.
    const learner = world.people.LA2;
    await page.goto(PEOPLE_PAGE);
    await page
      .locator("tr", { hasText: learner.email })
      .first()
      .getByRole("button", { name: `Change details of ${learner.email}` })
      .click();
    await expect(page.getByRole("group", { name: `Change details of ${learner.name}` })).toBeVisible();
    await noSeriousViolations(page, "Change details as a partner admin");

    await signIn(context, world.people.AS.sessionToken);
    await page.goto(COHORTS_PAGE);
    await expect(page.getByRole("heading", { name: "Country mapping" })).toBeVisible();
    await noSeriousViolations(page, "the country mapping");
    await page.goto(PEOPLE_PAGE);
    await page
      .locator("tr", { hasText: learner.email })
      .first()
      .getByRole("button", { name: `Change details of ${learner.email}` })
      .click();
    await expect(page.getByRole("group", { name: `Change details of ${learner.name}` }).getByLabel("Country")).toBeVisible();
    await noSeriousViolations(page, "Change details as an ADMIN");
  });

  test("A-E12 (guard): a partner admin's addition who picks another country is told the partner's name first; their organisation is released, audited and listed for an ADMIN", async ({
    page,
    context,
    request,
  }) => {
    const added = address("picks-cyprus");
    const answer = await call(request, world.people.PAA, "addMember", [added, "LEARNER"]);
    expect(answer.result, answer.raw.slice(0, 200)).toMatchObject({ ok: true });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: added } });
    await signIn(context, await createSession(prisma, user.id));
    await page.goto("/en");
    await expect(page).toHaveURL(/\/en\/welcome$/);
    const main = page.getByRole("main");
    const setUpBy = main.getByText(`Your account was set up by ${world.organisations.A.name}.`);
    await expect(setUpBy).toBeVisible();
    await expect(async () => {
      await fillProfileStep(page, { name: `Picks ${RUN}`, country: "Cyprus" });
      await expect(
        main.getByText(
          `${world.organisations.A.name} supports learners in another country. If you continue with Cyprus, DIESIS will check which organisation supports you`,
          { exact: false }
        )
      ).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });
    await completeProfileStep(page, { name: `Picks ${RUN}`, country: "Cyprus" });

    const profile = await profileOf(user.id);
    expect(profile).toMatchObject({ country: "CY", organisationId: null, organisationSource: "released" });
    expect(await prisma.auditLog.count({ where: { action: "profile.organisation_released", entityId: profile!.id } })).toBe(1);
    // On the ADMIN's list of countries that don't match.
    await signIn(context, world.people.AS.sessionToken);
    await page.goto(PEOPLE_PAGE);
    await page.getByLabel("Show", { exact: true }).first().selectOption("mismatch");
    await expect(page.locator("tr", { hasText: added }).first()).toContainText("Country doesn't match organisation");
  });
});
