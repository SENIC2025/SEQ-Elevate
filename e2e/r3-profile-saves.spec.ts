import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PROJECT, createPerson, removePeople, runId, signIn } from "./fixtures/people";
import { callAction } from "./fixtures/server-action";

/**
 * Release 3 (D79; the integrator's decision (c), 24 October): before the
 * profile step is done nothing of the person's learning is saved — by the
 * course save actions and the Comp Card's save action themselves, as by
 * POST /api/progress/beacon, not only because the learner store saves
 * nothing until the profile is done. A page loaded before (a Release 2
 * page from before the deploy, or a page whose person must accept new
 * Terms since it loaded) gets a clear refusal, "profile-incomplete", and
 * the Release 3 page says what to do: finish the profile.
 *
 *   PS-E1  the course save action, Release 1's course save and the Comp
 *          Card's save action write nothing for a person with no profile,
 *          or with Terms accepted in an older version, and answer as the
 *          route does: "profile-incomplete" (403); another account's save
 *          is still "other-account"
 *   PS-E2  the Comp Card open, the Terms changed since it loaded: what the
 *          learner types isn't saved, and the page says to finish the
 *          profile, with the way to it
 *   PS-E3  the same in a course: the reflection isn't saved, and the page
 *          says so
 *
 * All three are red on the build before (77970ed): the save actions wrote
 * for anyone signed in, and the page said nothing.
 *
 * Requires a real database: gated on E2E_DB=1. Everything the run makes
 * is removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  : (null as unknown as PrismaClient);
const describe = DB ? test.describe : test.describe.skip;

const RUN = runId();
const SLUG = "workplace-conflict";
const LEARNER_FILE = "src/app/actions/learner.ts";
const BEACON = "/api/progress/beacon";
const ORIGIN = `http://localhost:${process.env.E2E_PORT ?? "3000"}`;
const NOT_SAVING = "Finish your profile to save your progress.";

const emails: string[] = [];
async function learner(tag: string, profile: "complete" | "none" = "complete") {
  const email = `e2e-r3-ps-${tag}-${RUN}@example.com`;
  emails.push(email);
  await prisma.user.deleteMany({ where: { email } });
  const person = await createPerson(prisma, { email, roles: ["LEARNER"], profile });
  return { userId: person.userId, sessionToken: person.sessionToken! };
}
/** New Terms since the person accepted theirs: their profile step isn't done any more. */
const oldTerms = (userId: string) =>
  prisma.projectProfile.update({
    where: { userId_projectId: { userId, projectId: PROJECT } },
    data: { termsVersion: `e2e-older-${RUN}` },
    select: { userId: true },
  });
const enrolment = (userId: string) =>
  prisma.courseEnrollment.findFirst({ where: { userId, course: { slug: SLUG } }, select: { reflection: true } });
const wentWellOf = async (userId: string) =>
  (await prisma.compCard.findUnique({ where: { userId_projectId: { userId, projectId: PROJECT } }, select: { wentWell: true } }))
    ?.wentWell ?? null;

const LEGACY_PROGRESS = {
  stagesCompleted: ["context"],
  simulation: null,
  scenario: { root: null, followup: null },
  reflection: { p1: `legacy ${RUN}`, p2: "", p3: "" },
  assessment: {},
  completedAt: null,
};

const notSaving = (page: Page) => page.getByRole("status").filter({ hasText: NOT_SAVING });

describe("Release 3: nothing of a person's learning is saved before the profile step (D79)", () => {
  test.afterAll(async () => {
    await removePeople(prisma, emails);
    await prisma.$disconnect();
  });

  test("PS-E1 the save actions write nothing for a person whose profile step isn't done, and answer as the route does", async ({ request }) => {
    test.setTimeout(60_000);
    const none = await learner("none", "none");
    const older = await learner("older");
    await oldTerms(older.userId);
    const other = await learner("other");
    const stored = `stored ps1 ${RUN}`;
    await prisma.compCard.create({ data: { userId: older.userId, projectId: PROJECT, wentWell: stored }, select: { id: true } });
    const patch = { v: 2, completed: ["context"], answers: { "reflection/main": { type: "reflection", text: { p1: `patch ${RUN}` } } } };

    for (const who of [none, older]) {
      const call = (name: string, args: unknown[]) =>
        callAction(request, { as: { sessionToken: who.sessionToken }, page: "/en/learner", file: LEARNER_FILE, name, args });
      const course = await call("saveCourseProgressPatch", [SLUG, patch, who.userId]);
      expect.soft(course.result, "the course save action").toEqual({ ok: false, error: "profile-incomplete" });
      const card = await call("saveCompCard", [{ wentWell: `card ${RUN}`, confidence: 5 }, who.userId]);
      expect.soft(card.result, "the Comp Card's save action").toEqual({ ok: false, error: "profile-incomplete" });
      const legacy = await call("saveCourseProgress", [SLUG, LEGACY_PROGRESS, who.userId]);
      expect.soft(legacy.error, "Release 1's course save answers, and throws nothing").toBeUndefined();
      // Another account's save: whose it is is answered first, as before.
      const others = await call("saveCompCard", [{ wentWell: `card ${RUN}` }, other.userId]);
      expect.soft(others.result, "another account's").toEqual({ ok: false, error: "other-account" });

      // The route answers the same, for a course and a card.
      for (const body of [
        { v: 1, slug: SLUG, forUser: who.userId, patch },
        { v: 1, forUser: who.userId, card: { wentWell: `beacon ${RUN}` } },
      ]) {
        const answer = await request.fetch(BEACON, {
          method: "POST",
          headers: {
            Origin: ORIGIN,
            "Sec-Fetch-Site": "same-origin",
            "Content-Type": "application/json",
            Cookie: `authjs.session-token=${who.sessionToken}`,
          },
          data: JSON.stringify(body),
          failOnStatusCode: false,
        });
        expect.soft(answer.status(), "the route").toBe(403);
        expect.soft(await answer.json(), "the route's answer").toEqual({ ok: false, error: "profile-incomplete" });
      }

      expect(await enrolment(who.userId), "no enrolment written").toBeNull();
      expect(await prisma.userBadge.count({ where: { userId: who.userId } })).toBe(0);
    }
    expect(await wentWellOf(none.userId), "no card made").toBeNull();
    expect(await wentWellOf(older.userId), "the card as it was").toBe(stored);
    expect(await wentWellOf(other.userId), "nothing in another account").toBeNull();
    expect(await prisma.auditLog.count({ where: { actorId: { in: [none.userId, older.userId] } } })).toBe(0);
  });

  async function cardPage(context: BrowserContext, text: string) {
    const page = await context.newPage();
    await page.goto("/en/learner/comp-card");
    const box = page.getByRole("main").getByPlaceholder("Even small wins count.", { exact: true });
    await expect(box).toHaveValue(text, { timeout: 20_000 });
    await expect(page.getByRole("main").getByRole("button", { name: "Only me" })).not.toHaveAttribute("aria-disabled", "true", {
      timeout: 15_000,
    });
    return { page, box };
  }

  test("PS-E2 the Comp Card open, the Terms changed since it loaded: what the learner types isn't saved, and the page says to finish the profile", async ({
    context,
  }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = await learner("card");
    const stored = `stored ps2 ${RUN}`;
    await prisma.compCard.create({ data: { userId, projectId: PROJECT, wentWell: stored }, select: { id: true } });
    await signIn(context, sessionToken);
    const { page, box } = await cardPage(context, stored);
    await expect(notSaving(page)).toHaveCount(0);
    await oldTerms(userId);
    const typed = `typed ps2 ${RUN}`;
    const answered = page.waitForResponse((r) => !!r.request().headers()["next-action"] && (r.request().postData() ?? "").includes(typed));
    await box.fill(typed);
    await answered;
    await expect(notSaving(page), "the page says the profile isn't finished").toBeVisible({ timeout: 10_000 });
    await expect(notSaving(page).getByRole("link", { name: "Finish it now" })).toHaveAttribute("href", /\/welcome$/);
    await expect(box, "what the learner typed stays on the page").toHaveValue(typed);
    await page.waitForTimeout(1000);
    expect(await wentWellOf(userId), "nothing saved").toBe(stored);
  });

  test("PS-E3 a course open, the Terms changed since it loaded: the reflection isn't saved, and the page says so", async ({ context }) => {
    test.setTimeout(90_000);
    const { userId, sessionToken } = await learner("course");
    await signIn(context, sessionToken);
    const page = await context.newPage();
    const loaded = page.waitForResponse((r) => r.request().method() === "POST" && r.request().postData() === JSON.stringify([SLUG, "en"]));
    await page.goto(`/en/learner/course/${SLUG}`);
    await loaded;
    const cont = page.getByRole("button", { name: /^continue$/i });
    await expect(cont).toBeEnabled();
    await page.waitForTimeout(300);
    await oldTerms(userId);
    // Finishing the first lesson is saved at once.
    const answered = page.waitForResponse(
      (r) => !!r.request().headers()["next-action"] && (r.request().postData() ?? "").startsWith(`["${SLUG}",{`)
    );
    await cont.click();
    await answered;
    await expect(notSaving(page), "the page says the profile isn't finished").toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000);
    expect(await enrolment(userId), "nothing saved").toBeNull();
  });
});
