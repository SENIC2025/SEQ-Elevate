import { test, expect, type APIRequestContext, type Page, type Request } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PROJECT,
  createPerson,
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
import { completeProfileStep } from "./fixtures/profile-step";
import { slowActions } from "./fixtures/slow-actions";

/**
 * Release 3 (spec 4, 18.2, B-E6 to B-E10): the Comp Card, learner side.
 * A card is "Only me" until the learner shares it, by its own action and
 * after a question; a save never shares it, whatever it sends (a page from
 * before Release 3 sends "facilitator"); a text over 2,000 characters is
 * held back while the others save; a guest's card moves in as "Only me".
 *
 * What a facilitator gets is read from the page's HTML and React Server
 * Components payload (as e2e/r3-scoping.spec.ts does), not from the
 * screen. The people are the world of e2e/fixtures/people.ts (its own
 * organisations); FA is the facilitator of organisation A.
 *
 * The same spec runs on the old build (no ProjectProfile table): there,
 * the profile step and the guest-work prompt (Release 3's only) are passed
 * over, so each test fails where its point lies.
 *
 * Requires a real database — gated on E2E_DB=1. Everything the run makes
 * is removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;
test.describe.configure({ mode: "default" });

const RUN = runId();
const CARD_PAGE = "/en/learner/comp-card";
const LEARNER_FILE = "src/app/actions/learner.ts";
const GUEST_STORE = "seq-elevate-demo-state-v1";

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

/** A Comp Card text box, by the placeholder it shows when empty. */
const field = (page: Page, placeholder: string) => page.getByRole("main").getByPlaceholder(placeholder, { exact: true });

/**
 * Waits until the page has hydrated and the learner's saved data has
 * loaded: the sharing choice is offered only then (on the old build, which
 * has no such wait, until the page has hydrated: its privacy buttons react).
 */
async function cardReady(page: Page) {
  const onlyMe = page.getByRole("main").getByRole("button", { name: "Only me" });
  await expect(onlyMe).toBeVisible({ timeout: 15_000 });
  await expect(onlyMe).not.toHaveAttribute("aria-disabled", "true", { timeout: 15_000 });
}

/** Types into a box once the page is ready (an edit before hydration never reaches React's state). */
async function typeInto(page: Page, placeholder: string, text: string) {
  await cardReady(page);
  await field(page, placeholder).fill(text);
}

/**
 * Holds the first server action whose body contains `marker`, as on a slow
 * connection, until released. Then it goes on to the server and its answer
 * to the page; `lost`: the server gets it (and writes it), and the page gets
 * a dropped connection instead of the answer (`serverStatus`: the server's).
 */
async function holdAction(page: Page, marker: string, answer: "slow" | "lost" = "slow") {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const state: { request: Request | null; serverStatus: number | null } = { request: null, serverStatus: null };
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (!state.request && request.method() === "POST" && (await request.headerValue("next-action")) && (request.postData() ?? "").includes(marker)) {
      state.request = request;
      await held;
      if (answer === "lost") {
        state.serverStatus = (await route.fetch()).status();
        await route.abort("failed").catch(() => undefined);
        return;
      }
    }
    await route.continue().catch(() => undefined);
  });
  return { state, release };
}

describe("Release 3 Comp Card, learner side", () => {
  let world: World;
  let profiles = true;
  const made: string[] = [];
  const address = (who: string) => {
    const email = `e2e-card-${who}-${RUN}@example.com`;
    made.push(email);
    return email;
  };
  /** The learner's card; its sharing columns only where they exist (not on Release 2's schema). */
  const cardOf = async (userId: string) => {
    const where = { userId_projectId: { userId, projectId: PROJECT } };
    const card = await prisma.compCard.findUnique({
      where,
      select: { id: true, wentWell: true, difficult: true, improve: true, behaviour: true, confidence: true, privacy: true },
    });
    const sharing =
      card && profiles
        ? await prisma.compCard.findUnique({ where, select: { sharedAt: true, sharedWithOrganisationId: true } })
        : null;
    return card && { ...card, sharedAt: sharing?.sharedAt ?? null, sharedWithOrganisationId: sharing?.sharedWithOrganisationId ?? null };
  };
  /** A learner of the world's organisation A, with a complete profile. */
  const learnerOfA = (who: string) =>
    createPerson(prisma, {
      email: address(who),
      name: `${who} ${RUN}`,
      roles: ["LEARNER"],
      organisation: { id: world.organisations.A.id },
      country: "DE",
    });

  test.beforeAll(async () => {
    profiles = await hasProfiles(prisma);
    world = await createWorld(prisma, { run: RUN });
  });

  test.afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { in: made } }, select: { id: true } });
    const cards = await prisma.compCard.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { id: true } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: users.map((u) => u.id) } }, { entityId: { in: cards.map((c) => c.id) } }] },
    });
    await removePeople(prisma, made);
    if (world) await removeWorld(prisma, world);
  });

  test("B-E6: a new learner's card is Only me; shared after a question, it says since when and its facilitators get it; Only me takes it back", async ({
    page,
    context,
    request,
  }) => {
    const learner = await learnerOfA("shares");
    const marker = `cardtext-shares-${RUN}`;
    await signIn(context, learner.sessionToken);
    await page.goto(CARD_PAGE);
    const onlyMe = page.getByRole("button", { name: "Only me" });
    const share = page.getByRole("button", { name: `Me and the facilitators at ${world.organisations.A.name}` });
    await expect(onlyMe).toHaveAttribute("aria-pressed", "true");
    await expect(share).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("main")).not.toContainText(/mentor/i);
    await expect(page.getByRole("main")).toContainText(
      `Whatever you choose, the facilitators at ${world.organisations.A.name} and the DIESIS and SENIC staff who run the platform always see`
    );
    await typeInto(page, "Even small wins count.", `${marker} went well`);
    await expect.poll(async () => (await cardOf(learner.userId))?.wentWell, { timeout: 15_000 }).toBe(`${marker} went well`);
    expect(await payload(request, world.people.FA, "/en/facilitator"), "not shared yet").not.toContain(marker);

    // Asked first, in place: the question takes the focus; Cancel returns it.
    await share.click();
    const question = page.getByRole("heading", {
      name: `Share your Comp Card? Facilitators at ${world.organisations.A.name} will see everything on it. You can switch back to “Only me” at any time.`,
    });
    await expect(question).toBeFocused();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(question).toHaveCount(0);
    await expect(share).toBeFocused();
    await expect(share).toHaveAttribute("aria-pressed", "false");
    await share.click();
    await expect(question).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(question).toHaveCount(0);
    await expect(share).toBeFocused();
    expect((await cardOf(learner.userId))?.sharedAt ?? null, "nothing shared on Cancel or Escape").toBeNull();

    await share.click();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(share).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("main").getByText(/^Shared since /)).toBeVisible();
    await expect
      .poll(async () => {
        const card = await cardOf(learner.userId);
        return { privacy: card?.privacy, with: card?.sharedWithOrganisationId, shared: !!card?.sharedAt };
      })
      .toEqual({ privacy: "FACILITATOR", with: world.organisations.A.id, shared: true });
    expect(await payload(request, world.people.FA, "/en/facilitator"), "shared with A's facilitator").toContain(marker);
    expect(await payload(request, world.people.FB, "/en/facilitator"), "not with B's").not.toContain(marker);
    // It holds after a reload.
    await page.reload();
    await expect(share).toHaveAttribute("aria-pressed", "true");

    // Taken back at once, without a question.
    await onlyMe.click();
    await expect(onlyMe).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => {
        const card = await cardOf(learner.userId);
        return { privacy: card?.privacy, sharedAt: card?.sharedAt ?? null };
      })
      .toEqual({ privacy: "SELF", sharedAt: null });
    expect(await payload(request, world.people.FA, "/en/facilitator"), "taken back").not.toContain(marker);
    expect(
      await prisma.auditLog.count({ where: { action: "compcard.sharing_changed", entityId: (await cardOf(learner.userId))!.id } }),
      "each change is logged by the card's id"
    ).toBe(2);
  });

  test("B-E6: a shared card is taken back to \"Only me\" from the account page, also while the profile step waits for new Terms", async ({
    page,
    context,
    request,
  }) => {
    const learner = await learnerOfA("terms-changed");
    const marker = `cardtext-terms-changed-${RUN}`;
    await prisma.compCard.create({
      data: { userId: learner.userId, projectId: PROJECT, wentWell: `${marker} went well` },
      select: { id: true },
    });
    const shared = await callAction(request, {
      as: learner,
      page: CARD_PAGE,
      file: LEARNER_FILE,
      name: "setCompCardSharing",
      args: ["facilitators", learner.userId],
    });
    expect(shared.result, shared.raw.slice(0, 200)).toMatchObject({ ok: true, sharing: "facilitators" });
    expect(await payload(request, world.people.FA, "/en/facilitator")).toContain(marker);
    // A new English Terms version (D78): the one they accepted is older now,
    // so the learner area sends them to the profile step.
    await prisma.projectProfile.update({
      where: { userId_projectId: { userId: learner.userId, projectId: PROJECT } },
      data: { termsVersion: "2020-01-01" },
    });
    await signIn(context, learner.sessionToken);
    await page.goto(CARD_PAGE);
    await expect(page).toHaveURL(/\/en\/welcome$/);

    // The account page stays open (spec 5.3), and takes the card back in one click (D80).
    await page.goto("/en/account");
    const section = page.getByRole("region", { name: "Your Comp Card" });
    await expect(section).toContainText(`Your Comp Card is shared with the facilitators at ${world.organisations.A.name}.`);
    await section.getByRole("button", { name: "Switch to “Only me”" }).click();
    await expect(section.getByRole("status")).toContainText("Your Comp Card is set to “Only me”: only you see it.");
    await expect
      .poll(async () => {
        const card = await cardOf(learner.userId);
        return { privacy: card?.privacy, sharedAt: card?.sharedAt ?? null };
      })
      .toEqual({ privacy: "SELF", sharedAt: null });
    expect(await payload(request, world.people.FA, "/en/facilitator"), "taken back").not.toContain(marker);
    // Not shared: nothing to take back, so the account page says nothing of it.
    await page.reload();
    await expect(page.getByRole("region", { name: "Your Comp Card" })).toHaveCount(0);
  });

  test("B-E6: a shared card says it is shared from the first paint, before the learner's data has loaded", async ({
    page,
    context,
  }) => {
    const learner = await learnerOfA("shared-slow");
    const sharedAt = new Date("2026-11-21T09:00:00Z");
    await prisma.compCard.create({
      data: {
        userId: learner.userId,
        projectId: PROJECT,
        wentWell: `cardtext-shared-slow-${RUN}`,
        privacy: "FACILITATOR",
        // (Release 2's schema has no sharing columns: there "FACILITATOR" alone is shared.)
        ...(profiles ? { sharedAt, sharedWithOrganisationId: world.organisations.A.id } : {}),
      },
      select: { id: true },
    });
    await signIn(context, learner.sessionToken);
    // The learner's data takes seconds to load (a slow connection).
    await slowActions(page, 5_000);
    await page.goto(CARD_PAGE);
    const onlyMe = page.getByRole("button", { name: "Only me" });
    const share = page.getByRole("button", { name: `Me and the facilitators at ${world.organisations.A.name}` });
    await expect(share).toBeVisible();
    // Not loaded yet: the choice can't be changed meanwhile...
    await expect(onlyMe).toHaveAttribute("aria-disabled", "true");
    // ...and it says what the learner chose, not "Only me".
    await expect(share).toHaveAttribute("aria-pressed", "true");
    await expect(onlyMe).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("main").getByText("Shared since November 21, 2026.")).toBeVisible();
    // Loaded, the same.
    await expect(onlyMe).not.toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
    await expect(share).toHaveAttribute("aria-pressed", "true");
  });

  test("B-E7 (SC16): a Comp Card save that sends privacy 'facilitator', as a page from before Release 3 does, saves the text and shares nothing", async ({
    request,
  }) => {
    const learner = await learnerOfA("old-page");
    const marker = `cardtext-old-page-${RUN}`;
    const answer = await callAction(request, {
      as: learner,
      page: "/en/learner",
      file: LEARNER_FILE,
      name: "saveCompCard",
      args: [
        { wentWell: `${marker} went well`, difficult: "", improve: `${marker} improve`, behaviour: "", confidence: 4, privacy: "facilitator" },
        learner.userId,
      ],
    });
    expect(answer.error, answer.raw.slice(0, 200)).toBeUndefined();
    const card = await cardOf(learner.userId);
    expect(card?.wentWell).toBe(`${marker} went well`);
    expect(await payload(request, world.people.FA, "/en/facilitator"), "A's facilitator gets none of it").not.toContain(marker);
    expect({ privacy: card?.privacy, sharedAt: card?.sharedAt ?? null }, "nothing shared").toEqual({ privacy: "SELF", sharedAt: null });
  });

  test("B-E7 (rolling forward): a card shared the Release 3 way, then set to \"Only me\" and back by Release 2's saves, stays unshared", async ({
    request,
  }) => {
    test.skip(!profiles, "Release 3's sharing columns");
    const learner = await learnerOfA("rolled-back");
    const marker = `cardtext-rolled-back-${RUN}`;
    await prisma.compCard.create({
      data: { userId: learner.userId, projectId: PROJECT, wentWell: `${marker} went well` },
      select: { id: true },
    });
    const shared = await callAction(request, {
      as: learner,
      page: CARD_PAGE,
      file: LEARNER_FILE,
      name: "setCompCardSharing",
      args: ["facilitators", learner.userId],
    });
    expect(shared.result, shared.raw.slice(0, 200)).toMatchObject({ ok: true, sharing: "facilitators" });
    expect(await payload(request, world.people.FA, "/en/facilitator")).toContain(marker);
    // What Release 2's Comp Card save writes after a rollback: privacy only
    // (spec 2.7). "Only me", then "facilitator" again from an older tab.
    await prisma.$executeRaw`UPDATE "CompCard" SET "privacy" = 'SELF' WHERE "userId" = ${learner.userId} AND "projectId" = ${PROJECT}`;
    expect(await payload(request, world.people.FA, "/en/facilitator"), "Only me").not.toContain(marker);
    await prisma.$executeRaw`UPDATE "CompCard" SET "privacy" = 'FACILITATOR' WHERE "userId" = ${learner.userId} AND "projectId" = ${PROJECT}`;
    expect(await payload(request, world.people.FA, "/en/facilitator"), "back to facilitator: still not shared").not.toContain(marker);
    const card = await cardOf(learner.userId);
    expect({ sharedAt: card?.sharedAt ?? null, with: card?.sharedWithOrganisationId ?? null }).toEqual({ sharedAt: null, with: null });
  });

  test("B-E8: a text over 2,000 characters is held back with a note, the others save, and its saved text stays; a longer saved text can be saved unchanged", async ({
    page,
    context,
    request,
  }) => {
    const learner = await learnerOfA("long");
    await prisma.compCard.create({
      data: { userId: learner.userId, projectId: PROJECT, difficult: `stored difficult ${RUN}` },
      select: { id: true },
    });
    await signIn(context, learner.sessionToken);
    await page.goto(CARD_PAGE);
    // The card's second field (its label is checked below).
    const difficult = page.getByRole("main").getByRole("textbox").nth(1);
    await expect(difficult).toHaveValue(`stored difficult ${RUN}`);

    await typeInto(page, "Even small wins count.", `went well ${RUN}`);
    await difficult.fill("x".repeat(2001));
    const tooLong = page.getByRole("main").getByText("This is too long to save. Shorten it to 2000 characters.");
    await expect(tooLong).toBeVisible();
    await expect(difficult).toHaveAttribute("aria-invalid", "true");
    await expect(difficult).toHaveAccessibleDescription("This is too long to save. Shorten it to 2000 characters.");
    // The page's own live region says it once.
    await expect(page.locator("[data-player-announcer]")).toHaveText(/This is too long to save/);
    await field(page, "One thing.").fill(`improve ${RUN}`);
    await expect.poll(async () => (await cardOf(learner.userId))?.improve, { timeout: 15_000 }).toBe(`improve ${RUN}`);
    const saved = await cardOf(learner.userId);
    expect(saved?.wentWell).toBe(`went well ${RUN}`);
    expect(saved?.difficult, "the held-back field keeps its saved text").toBe(`stored difficult ${RUN}`);
    // Near the limit: how many are left.
    await difficult.fill("y".repeat(1900));
    await expect(page.getByRole("main").getByText("100 characters left")).toBeVisible();
    await expect(difficult).toHaveAccessibleName("What was difficult");
    await expect.poll(async () => (await cardOf(learner.userId))?.difficult, { timeout: 15_000 }).toBe("y".repeat(1900));

    // A text saved before the limit, longer than it, saves unchanged.
    const older = `${"z".repeat(2400)} ${RUN}`;
    await prisma.compCard.update({
      where: { userId_projectId: { userId: learner.userId, projectId: PROJECT } },
      data: { behaviour: older },
    });
    const answer = await callAction(request, {
      as: learner,
      page: "/en/learner",
      file: LEARNER_FILE,
      name: "saveCompCard",
      args: [{ behaviour: older, wentWell: `again ${RUN}` }, learner.userId],
    });
    expect(answer.result).toEqual({ ok: true });
    expect(await cardOf(learner.userId)).toMatchObject({ behaviour: older, wentWell: `again ${RUN}` });
    const grown = await callAction(request, {
      as: learner,
      page: "/en/learner",
      file: LEARNER_FILE,
      name: "saveCompCard",
      args: [{ behaviour: `${older}!` }, learner.userId],
    });
    expect(grown.result).toEqual({ ok: false, error: "too-long", field: "behaviour" });
    expect((await cardOf(learner.userId))?.behaviour).toBe(older);
  });

  test("B-E8 (saves): an answer changed, then changed back while the save of the change is on its way, ends in the account as the page shows it", async ({
    page,
    context,
  }) => {
    const learner = await learnerOfA("back");
    const before = `went well ${RUN}`;
    const changed = `changed ${RUN}`;
    await prisma.compCard.create({ data: { userId: learner.userId, projectId: PROJECT, wentWell: before }, select: { id: true } });
    await signIn(context, learner.sessionToken);
    // The save of the change is held, as on a slow connection, until the change back is past the page's save pause.
    const held = await holdAction(page, changed);
    await page.goto(CARD_PAGE);
    const box = field(page, "Even small wins count.");
    await expect(box).toHaveValue(before);
    try {
      await typeInto(page, "Even small wins count.", changed);
      await expect.poll(() => held.state.request !== null, { timeout: 15_000 }).toBe(true);
      await box.fill(before);
      // Past the save pause (700 ms): the change back is worked out while the server is still known to hold `before`.
      await page.waitForTimeout(2000);
    } finally {
      held.release();
    }
    // The held save reaches the server and is answered; then the account holds what the page shows.
    expect((await held.state.request!.response())?.status()).toBe(200);
    await expect(box).toHaveValue(before);
    await expect
      .poll(async () => (await cardOf(learner.userId))?.wentWell, { timeout: 15_000, message: "the account holds what the page shows" })
      .toBe(before);
    await page.waitForTimeout(1500);
    expect((await cardOf(learner.userId))?.wentWell).toBe(before);
    await expect(box).toHaveValue(before);
  });

  test("B-E8 (saves): the same, with the change's save written by the server and its answer lost to a dropped connection, ends in the account as the page shows it", async ({
    page,
    context,
  }) => {
    const learner = await learnerOfA("lost");
    const before = `went well, lost ${RUN}`;
    const changed = `changed, lost ${RUN}`;
    await prisma.compCard.create({ data: { userId: learner.userId, projectId: PROJECT, wentWell: before }, select: { id: true } });
    await signIn(context, learner.sessionToken);
    // The save of the change is held until the change back is past the page's save pause; then the server writes
    // it, and the page gets a dropped connection instead of the answer.
    const held = await holdAction(page, changed, "lost");
    await page.goto(CARD_PAGE);
    const box = field(page, "Even small wins count.");
    await expect(box).toHaveValue(before);
    try {
      await typeInto(page, "Even small wins count.", changed);
      await expect.poll(() => held.state.request !== null, { timeout: 15_000 }).toBe(true);
      await box.fill(before);
      // Past the save pause (700 ms): the change back is worked out while the server is still known to hold `before`.
      await page.waitForTimeout(2000);
    } finally {
      held.release();
    }
    await expect.poll(() => held.state.serverStatus, { timeout: 15_000, message: "the server got the change" }).toBe(200);
    await expect(box).toHaveValue(before);
    await expect
      .poll(async () => (await cardOf(learner.userId))?.wentWell, { timeout: 20_000, message: "the account holds what the page shows" })
      .toBe(before);
    await page.waitForTimeout(1500);
    expect((await cardOf(learner.userId))?.wentWell).toBe(before);
    await expect(box).toHaveValue(before);
  });

  test("B-E9: a guest's card stored with the mentor choice is Only me once it moves into the account", async ({ page, context }) => {
    const marker = `cardtext-guest-${RUN}`;
    await page.goto("/en");
    // The page writes its own guest store once it has loaded: the card goes
    // in after that, or that write would replace it.
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key) !== null, GUEST_STORE), { timeout: 15_000 })
      .toBe(true);
    await page.evaluate(
      ([key, text]) =>
        localStorage.setItem(
          key,
          JSON.stringify({
            projectId: "seq-elevate",
            role: null,
            badges: [],
            compCard: {
              wentWell: text,
              difficult: "",
              improve: "",
              behaviour: "",
              confidence: 4,
              privacy: "facilitatorAndMentor",
              updatedAt: "2026-11-21T09:00:00.000Z",
            },
          })
        ),
      [GUEST_STORE, marker] as const
    );
    const person = await createPerson(prisma, { email: address("guest"), profile: "none", organisation: null });
    await signIn(context, person.sessionToken);
    await page.goto("/en/learner");
    if (profiles) {
      await completeProfileStep(page);
      const prompt = page.getByRole("region", { name: "Work saved on this browser before you signed in" });
      await expect(prompt).toContainText("No course progress. Comp Card: yes.");
      await prompt.getByRole("button", { name: "Add it to my account" }).click();
    }
    await expect.poll(async () => (await cardOf(person.userId))?.wentWell, { timeout: 15_000 }).toBe(marker);
    const card = await cardOf(person.userId);
    expect({ privacy: card?.privacy, sharedAt: card?.sharedAt ?? null }).toEqual({ privacy: "SELF", sharedAt: null });
    await page.goto(CARD_PAGE);
    await expect(page.getByRole("button", { name: "Only me" })).toHaveAttribute("aria-pressed", "true");
  });

  test("B-E10: the Comp Card page passes axe and fits a 320px screen, in English, German and Greek; a guest's says why it can't be shared", async ({
    page,
    context,
  }) => {
    for (const [locale, title] of [
      ["en", "Comp Card"],
      ["de", "Comp Card"],
      ["el", "Comp Card"],
    ] as const) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/${locale}/learner/comp-card`);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await noSeriousViolations(page, `/${locale}/learner/comp-card as a guest`);
    }
    await expect(page.getByRole("main")).toContainText("Συνδέσου για να μοιραστείς την Comp Card με τους εκπαιδευτές σου.");

    const learner = await learnerOfA("axe");
    await signIn(context, learner.sessionToken);
    for (const locale of ["en", "de", "el"] as const) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/${locale}/learner/comp-card`);
      await expect(page.getByRole("button", { pressed: true }).first()).toBeVisible();
      await noSeriousViolations(page, `/${locale}/learner/comp-card`);
      await page.setViewportSize({ width: 320, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `/${locale}/learner/comp-card: no horizontal scrolling at 320px`).toBeLessThanOrEqual(0);
    }
    // The question, open.
    await page.goto(CARD_PAGE);
    await expect(async () => {
      await page.getByRole("button", { name: `Me and the facilitators at ${world.organisations.A.name}` }).click();
      await expect(page.getByRole("heading", { name: /^Share your Comp Card\?/ })).toBeFocused({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await noSeriousViolations(page, "the sharing question");
  });
});
