import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient, type Country } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PROJECT, createPerson, hasProfiles, removePeople, runId, signIn, type Person } from "./fixtures/people";
import { completeProfileStep } from "./fixtures/profile-step";
import { rscPath } from "./fixtures/rsc";

/**
 * Release 3 integration, I-E2 (spec 18.5): the partner story, end to end,
 * on the screens each person uses.
 *
 *  1. An ADMIN maps Germany to organisation A and Cyprus to organisation B
 *     (Organisations & cohorts), and adds A's partner admin with an
 *     invitation (Manage people).
 *  2. The partner admin joins through the invitation, does the profile
 *     step, and invites a facilitator, who joins A.
 *  3. A learner signs up with a sign-in link, picks Germany at the profile
 *     step and lands in A; starts a course; shares the Comp Card with A.
 *  4. A's facilitator reads the card; B's facilitator doesn't see the
 *     learner at all. A's statistics count the learner; B's don't.
 *  5. The ADMIN moves the learner to Cyprus (Change details): the learner
 *     is B's now, and the card is "Only me" again: A's facilitator no
 *     longer reads it, and B's sees the learner but not the card.
 *
 * It sets the project's country mapping for Germany and Cyprus to two
 * organisations of its own, which other specs' sign-ups read, so it runs
 * in the `last` project (playwright.config.ts), after every other project;
 * the mapping is put back afterwards. Red on Release 2, which has no
 * country mapping, partner admin or profile step: it stops at step 1.
 *
 * Requires a real database (E2E_DB=1) and AUTH_SECRET in the test process,
 * to mint sign-in links the way Auth.js stores them.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  : (null as unknown as PrismaClient);
const describe = DB ? test.describe : test.describe.skip;

const RUN = runId();
const email = (who: string) => `e2e-story-${who}-${RUN}@example.com`;
const EMAILS = {
  admin: email("admin"),
  paa: email("partner-admin"),
  fa: email("facilitator-a"),
  fb: email("facilitator-b"),
  learner: email("learner"),
};
const LEARNER_NAME = `Story learner ${RUN}`;
const MARKER = `story-card-${RUN}`;

/** Everything `path` sends `person`: the HTML and the React Server Components payload. */
async function payload(request: APIRequestContext, person: Pick<Person, "email" | "sessionToken">, path: string) {
  const cookie = { Cookie: `authjs.session-token=${person.sessionToken}` };
  const html = await request.get(path, { headers: cookie, maxRedirects: 0 });
  expect(html.status(), `${path} as ${person.email}`).toBe(200);
  const rsc = await request.get(rscPath(path), { headers: { ...cookie, RSC: "1" }, maxRedirects: 0 });
  expect(rsc.status(), `${path}'s payload as ${person.email}`).toBe(200);
  return `${await html.text()}\n${await rsc.text()}`;
}

/** A sign-in link for `address` through `provider`, minted as Auth.js stores one, opened in `page`. */
async function followLink(page: Page, provider: "invite" | "resend", address: string) {
  const secret = process.env.AUTH_SECRET!;
  const raw = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: address,
      token: createHash("sha256").update(`${raw}${secret}`).digest("hex"),
      expires: new Date(Date.now() + 86_400_000),
    },
  });
  await page.goto(`/api/auth/callback/${provider}?${new URLSearchParams({ callbackUrl: "/en", token: raw, email: address })}`);
}

/** The session the browser holds now, as a person the payload helper can use. */
async function sessionOf(context: BrowserContext, address: string) {
  const token = (await context.cookies()).find((c) => c.name === "authjs.session-token")?.value;
  expect(token, `${address} is signed in`).toBeTruthy();
  return { email: address, sessionToken: token! };
}

/** Someone's own browser. */
async function browserOf(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

describe("Release 3 integration: the partner story (I-E2)", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1280, height: 900 } });

  let A: { id: string; name: string };
  let B: { id: string; name: string };
  let mappingBefore: { country: Country; organisationId: string }[] = [];
  /** Release 3's schema (profiles, the mapping); the old build's has neither, and the story stops at its first step there. */
  let r3 = true;

  test.beforeAll(async () => {
    test.skip(!process.env.AUTH_SECRET, "needs AUTH_SECRET to mint sign-in links the way Auth.js stores them");
    await removePeople(prisma, Object.values(EMAILS));
    r3 = await hasProfiles(prisma);
    mappingBefore = r3
      ? await prisma.countryMapping.findMany({
          where: { projectId: PROJECT, country: { in: ["DE", "CY"] } },
          select: { country: true, organisationId: true },
        })
      : [];
    A = await prisma.organisation.create({
      data: { projectId: PROJECT, name: `Story Org A ${RUN}`, shortName: `StoryA ${RUN}` },
      select: { id: true, name: true },
    });
    B = await prisma.organisation.create({
      data: { projectId: PROJECT, name: `Story Org B ${RUN}`, shortName: `StoryB ${RUN}` },
      select: { id: true, name: true },
    });
  });

  test.afterAll(async () => {
    // The mapping as it was, before the organisations it names go.
    for (const m of mappingBefore) {
      await prisma.countryMapping.update({
        where: { projectId_country: { projectId: PROJECT, country: m.country } },
        data: { organisationId: m.organisationId },
      });
    }
    const users = await prisma.user.findMany({ where: { email: { in: Object.values(EMAILS) } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const profiles = r3 ? await prisma.projectProfile.findMany({ where: { userId: { in: ids } }, select: { id: true } }) : [];
    const cards = await prisma.compCard.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: ids } },
          { entityId: { in: [...ids, ...profiles.map((p) => p.id), ...cards.map((c) => c.id)] } },
          { entityId: { in: [A?.id, B?.id].filter(Boolean) as string[] } },
        ],
      },
    });
    await removePeople(prisma, Object.values(EMAILS));
    await prisma.verificationToken.deleteMany({ where: { identifier: { in: Object.values(EMAILS) } } });
    await prisma.organisation.deleteMany({ where: { id: { in: [A?.id, B?.id].filter(Boolean) as string[] } } });
    await prisma.$disconnect();
  });

  test("I-E2: mapping and invitations; a German learner lands in A and shares; A sees the card, B doesn't; statistics; moved to Cyprus, the card is unshared", async ({
    page,
    context,
    browser,
    request,
  }) => {
    test.setTimeout(240_000);
    const admin = await createPerson(prisma, { email: EMAILS.admin, name: `Story admin ${RUN}`, roles: ["ADMIN"] });
    const fb = await createPerson(prisma, {
      email: EMAILS.fb,
      name: `Story facilitator B ${RUN}`,
      roles: ["FACILITATOR"],
      organisation: { id: B.id },
    });

    // 1. The ADMIN maps Germany to A and Cyprus to B.
    await signIn(context, admin.sessionToken);
    await page.goto("/en/admin/cohorts");
    const mapping = page.getByRole("heading", { name: "Country mapping" }).locator("xpath=..");
    for (const [country, org] of [
      ["Germany", A],
      ["Cyprus", B],
    ] as const) {
      await expect(async () => {
        await mapping.getByLabel(country, { exact: true }).selectOption({ label: org.name });
        await mapping.getByRole("button", { name: `Save the organisation for ${country}` }).click({ timeout: 2000 });
        await expect(mapping.getByText(`${country}: learners join ${org.name}.`)).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 30_000 });
    }
    const mapped = await prisma.countryMapping.findMany({
      where: { projectId: PROJECT, country: { in: ["DE", "CY"] } },
      select: { country: true, organisationId: true },
    });
    expect(Object.fromEntries(mapped.map((m) => [m.country, m.organisationId]))).toEqual({ DE: A.id, CY: B.id });

    // ... and adds A's partner admin, with an invitation.
    await page.goto("/en/admin/people");
    const main = page.getByRole("main");
    await expect(async () => {
      await main.getByLabel(/^email$/i).first().fill(EMAILS.paa);
      await main.getByLabel(/name \(optional\)/i).first().fill(`Story partner admin ${RUN}`);
      await main.getByLabel(/^role$/i).first().selectOption("PARTNER_ADMIN");
      await main.getByLabel(/^organisation$/i).first().selectOption({ label: A.name });
      await expect(main.getByLabel(/send them an invitation email/i).first()).toBeChecked({ timeout: 2000 });
      await main.getByRole("button", { name: /^add$/i }).first().click({ timeout: 2000 });
      await expect(main.getByText(/sent them an invitation email/i).first()).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30_000 });
    const paaUser = await prisma.user.findUniqueOrThrow({ where: { email: EMAILS.paa }, select: { id: true } });
    expect(
      (await prisma.membership.findMany({ where: { userId: paaUser.id, projectId: PROJECT }, select: { role: true } })).map(
        (m) => m.role
      )
    ).toEqual(["PARTNER_ADMIN"]);

    // 2. The partner admin joins through the link, does the profile step,
    // and invites a facilitator.
    const paaBrowser = await browserOf(browser);
    await followLink(paaBrowser.page, "invite", EMAILS.paa);
    await completeProfileStep(paaBrowser.page, { name: `Story partner admin ${RUN}`, country: "Germany" });
    const paa = await sessionOf(paaBrowser.context, EMAILS.paa);
    expect(
      await prisma.projectProfile.findUnique({
        where: { userId_projectId: { userId: paaUser.id, projectId: PROJECT } },
        select: { organisationId: true, profileCompletedAt: true },
      })
    ).toMatchObject({ organisationId: A.id, profileCompletedAt: expect.any(Date) });

    const paaMain = paaBrowser.page.getByRole("main");
    await paaBrowser.page.goto("/en/admin/people");
    await expect(paaMain.getByText(`Add someone to ${A.name}`).first()).toBeVisible();
    await expect(async () => {
      await paaMain.getByLabel(/^email$/i).first().fill(EMAILS.fa);
      await paaMain.getByLabel(/name \(optional\)/i).first().fill(`Story facilitator A ${RUN}`);
      await paaMain.getByLabel(/^role$/i).first().selectOption("FACILITATOR");
      await paaMain.getByRole("button", { name: /^add$/i }).first().click({ timeout: 2000 });
      await expect(paaMain.getByText(/sent them an invitation email/i).first()).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30_000 });

    const faBrowser = await browserOf(browser);
    await followLink(faBrowser.page, "invite", EMAILS.fa);
    await completeProfileStep(faBrowser.page, { name: `Story facilitator A ${RUN}`, country: "Germany" });
    const fa = await sessionOf(faBrowser.context, EMAILS.fa);
    const faUser = await prisma.user.findUniqueOrThrow({ where: { email: EMAILS.fa }, select: { id: true } });
    expect(
      await prisma.projectProfile.findUnique({
        where: { userId_projectId: { userId: faUser.id, projectId: PROJECT } },
        select: { organisationId: true, organisationSource: true },
      })
    ).toEqual({ organisationId: A.id, organisationSource: "partner-admin" });

    // 3. A learner signs up, picks Germany, and lands in A.
    const learnerBrowser = await browserOf(browser);
    const lp = learnerBrowser.page;
    await followLink(lp, "resend", EMAILS.learner);
    await completeProfileStep(lp, { name: LEARNER_NAME, country: "Germany" });
    await expect(lp).toHaveURL(/\/en\/learner$/);
    const learnerUser = await prisma.user.findUniqueOrThrow({ where: { email: EMAILS.learner }, select: { id: true } });
    const learnerProfile = () =>
      prisma.projectProfile.findUnique({
        where: { userId_projectId: { userId: learnerUser.id, projectId: PROJECT } },
        select: { country: true, organisationId: true, organisationSource: true },
      });
    expect(await learnerProfile()).toEqual({ country: "DE", organisationId: A.id, organisationSource: "country" });

    // Starts a course: two lessons of the built-in one.
    await lp.goto("/en/learner/course/workplace-conflict");
    const step = lp.locator("[aria-current=step]").filter({ visible: true });
    const next = () => lp.getByRole("button", { name: /^continue$/i }).first();
    await expect(async () => {
      if ((await step.textContent())?.trim().startsWith("1")) await next().click();
      await expect(step).toContainText("2", { timeout: 3000 });
    }).toPass({ timeout: 20_000 });
    await next().click();
    await expect(step).toContainText("3");
    await expect
      .poll(
        async () =>
          (
            await prisma.courseEnrollment.findFirst({
              where: { userId: learnerUser.id, course: { slug: "workplace-conflict" } },
              select: { stagesCompleted: true },
            })
          )?.stagesCompleted ?? [],
        { timeout: 15_000 }
      )
      .toEqual(expect.arrayContaining(["CONTEXT", "CONCEPT"]));

    // Shares the Comp Card with A, after the question.
    await lp.goto("/en/learner/comp-card");
    const card = lp.getByRole("main");
    const onlyMe = card.getByRole("button", { name: "Only me" });
    await expect(onlyMe).not.toHaveAttribute("aria-disabled", "true", { timeout: 15_000 });
    await card.getByPlaceholder("Even small wins count.", { exact: true }).fill(`${MARKER} went well`);
    const cardRow = () =>
      prisma.compCard.findUnique({
        where: { userId_projectId: { userId: learnerUser.id, projectId: PROJECT } },
        select: { wentWell: true, privacy: true, sharedAt: true, sharedWithOrganisationId: true },
      });
    await expect.poll(async () => (await cardRow())?.wentWell, { timeout: 15_000 }).toBe(`${MARKER} went well`);
    const share = card.getByRole("button", { name: `Me and the facilitators at ${A.name}` });
    await share.click();
    await card.getByRole("button", { name: "Share", exact: true }).click();
    await expect(share).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => {
        const row = await cardRow();
        return { privacy: row?.privacy, with: row?.sharedWithOrganisationId, shared: !!row?.sharedAt };
      })
      .toEqual({ privacy: "FACILITATOR", with: A.id, shared: true });

    // 4. A's facilitator reads it; B's doesn't see the learner at all.
    const aRoster = await payload(request, fa, "/en/facilitator");
    expect(aRoster, "A's facilitator lists the learner").toContain(EMAILS.learner);
    expect(aRoster, "and reads the shared card").toContain(MARKER);
    const bRoster = await payload(request, fb, "/en/facilitator");
    expect(bRoster, "B's facilitator doesn't list the learner").not.toContain(EMAILS.learner);
    expect(bRoster).not.toContain(MARKER);
    // The facilitator's own screen shows it too.
    await faBrowser.page.goto("/en/facilitator");
    await expect(faBrowser.page.getByRole("main").getByText(LEARNER_NAME).first()).toBeVisible();

    // A's statistics count the learner (?live=1: the figures however few
    // learners started); B's don't.
    expect(await payload(request, paa, "/en/analytics?live=1"), "A's statistics").toContain(LEARNER_NAME);
    expect(await payload(request, fa, "/en/analytics?live=1"), "A's facilitator's statistics").toContain(LEARNER_NAME);
    expect(await payload(request, fb, "/en/analytics?live=1"), "B's statistics").not.toContain(LEARNER_NAME);

    // 5. The ADMIN moves the learner to Cyprus: B's now, and the card is
    // "Only me" again.
    await page.goto("/en/admin/people");
    const row = main.locator("tr", { hasText: EMAILS.learner }).first();
    await expect(async () => {
      await row.getByRole("button", { name: `Change details of ${EMAILS.learner}` }).click({ timeout: 2000 });
      await expect(main.getByRole("group", { name: `Change details of ${LEARNER_NAME}` })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    const form = main.getByRole("group", { name: `Change details of ${LEARNER_NAME}` });
    await form.getByLabel("Country").selectOption("CY");
    await expect(form.getByLabel("Organisation"), "Cyprus brings B").toHaveValue(B.id);
    await form.getByRole("button", { name: "Save" }).click();
    await expect(main.getByText(`Saved the details of ${EMAILS.learner}.`)).toBeVisible();
    expect(await learnerProfile()).toMatchObject({ country: "CY", organisationId: B.id });
    expect(await cardRow()).toMatchObject({ privacy: "SELF", sharedAt: null, sharedWithOrganisationId: null });
    expect(await payload(request, fa, "/en/facilitator"), "A's facilitator: gone").not.toContain(EMAILS.learner);
    const bAfter = await payload(request, fb, "/en/facilitator");
    expect(bAfter, "B's facilitator lists the learner").toContain(EMAILS.learner);
    expect(bAfter, "but not the card").not.toContain(MARKER);
    // The learner's own card says so.
    await lp.goto("/en/learner/comp-card");
    await expect(lp.getByRole("main").getByRole("button", { name: "Only me" })).toHaveAttribute("aria-pressed", "true");

    for (const b of [paaBrowser, faBrowser, learnerBrowser]) await b.context.close();
  });
});
