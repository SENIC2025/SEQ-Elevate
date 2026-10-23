import { test, expect, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PROJECT, createPerson, hasProfiles, removePeople, runId, signIn, type Person } from "./fixtures/people";
import { callAction } from "./fixtures/server-action";

/**
 * Release 3 integration, I-E3 (spec 18.5): skew. While a deploy runs, and
 * after a rollback, Release 2's code serves on a database Release 3 has
 * migrated (spec 2.7, 17.6). Here a learner with Release 3's profile (as
 * the people fixture makes one wherever the table exists) saves progress
 * through the course player, and a Comp Card through the save Release 2's
 * page sends (privacy "facilitator"); both land, the learner's pages
 * still open, and the card stays unshared for Release 3's reads, which
 * count a card as shared only with sharedAt (D80).
 *
 * A skew check: it is run against the OLD build (Release 2), started on a
 * database migrated by Release 3's migrations — there green is the result
 * (spec 18.5, the integrator's local run; the owner repeats it on the
 * Neon branch, 17.6). On Release 3's own build it runs in the suite, the
 * same calls answered by Release 3's code. The server action is found in
 * the manifest of the build under test (E2E_NEXT_DIR for the old one).
 *
 * Requires a real database — gated on E2E_DB=1.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  : (null as unknown as PrismaClient);
const describe = DB ? test.describe : test.describe.skip;

const RUN = runId();
const LEARNER = `e2e-skew-learner-${RUN}@example.com`;
const MARKER = `skew-card-${RUN}`;
const COURSE = "workplace-conflict";

/** The status and body `path` sends `person`. */
async function get(request: APIRequestContext, person: Person, path: string) {
  const res = await request.get(path, { headers: { Cookie: `authjs.session-token=${person.sessionToken}` }, maxRedirects: 0 });
  return { status: res.status(), body: await res.text() };
}

describe("Release 3 integration: Release 2's pages on Release 3's database (I-E3, skew)", () => {
  test.afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: LEARNER }, select: { id: true } });
    if (user) await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: user.id }, { entityId: user.id }] } });
    await removePeople(prisma, [LEARNER]);
    await prisma.$disconnect();
  });

  test("I-E3: a progress save and a Comp Card save land, the pages open, and the card stays unshared", async ({
    page,
    context,
    request,
  }) => {
    const migrated = await hasProfiles(prisma);
    await removePeople(prisma, [LEARNER]);
    const learner = await createPerson(prisma, { email: LEARNER, name: `Skew learner ${RUN}`, roles: ["LEARNER"] });

    // Progress, as the course player saves it.
    await signIn(context, learner.sessionToken);
    await page.goto(`/en/learner/course/${COURSE}`);
    const step = page.locator("[aria-current=step]").filter({ visible: true });
    const next = () => page.getByRole("button", { name: /^continue$/i }).first();
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
              where: { userId: learner.userId, course: { projectId: PROJECT, slug: COURSE } },
              select: { stagesCompleted: true },
            })
          )?.stagesCompleted ?? [],
        { timeout: 15_000 }
      )
      .toEqual(expect.arrayContaining(["CONTEXT", "CONCEPT"]));

    // The Comp Card, as Release 2's page saves it.
    const answer = await callAction(request, {
      as: learner,
      page: "/en/learner/comp-card",
      file: "src/app/actions/learner.ts",
      name: "saveCompCard",
      args: [
        { wentWell: `${MARKER} went well`, difficult: "", improve: `${MARKER} improve`, behaviour: "", confidence: 4, privacy: "facilitator" },
        learner.userId,
      ],
    });
    expect(answer.status, answer.raw.slice(0, 300)).toBe(200);
    expect(answer.error, answer.raw.slice(0, 300)).toBeUndefined();
    const where = { userId_projectId: { userId: learner.userId, projectId: PROJECT } };
    const card = await prisma.compCard.findUnique({ where, select: { wentWell: true, improve: true, confidence: true } });
    expect(card).toEqual({ wentWell: `${MARKER} went well`, improve: `${MARKER} improve`, confidence: 4 });
    if (migrated) {
      // Release 3 counts a card as shared only with sharedAt, which only
      // Release 3's own sharing action writes.
      const sharing = await prisma.compCard.findUnique({ where, select: { sharedAt: true, sharedWithOrganisationId: true } });
      expect(sharing, "unshared for Release 3's reads").toEqual({ sharedAt: null, sharedWithOrganisationId: null });
    }

    // The learner's pages still open, and show the saved card.
    for (const path of ["/en/learner", `/en/learner/course/${COURSE}`, "/en/learner/comp-card"]) {
      expect((await get(request, learner, path)).status, path).toBe(200);
    }
    await page.goto("/en/learner/comp-card");
    await expect(page.getByRole("main").getByPlaceholder("Even small wins count.", { exact: true })).toHaveValue(
      `${MARKER} went well`,
      { timeout: 15_000 }
    );
  });
});
