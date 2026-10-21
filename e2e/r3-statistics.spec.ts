import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  createPerson,
  createWorld,
  removePeople,
  removeWorld,
  runId,
  signIn,
  type Person,
  type World,
} from "./fixtures/people";

/**
 * Release 3 (spec 7, 4.5; 18.2: C-E1 to C-E4): who the statistics count,
 * and what the facilitator's roster and learner detail say.
 *
 *   C-E1  a former staff member (roles removed, now playing a course as a
 *         learner), a marked test account and a learner who started
 *         before STATS_FROM are not in the statistics; a real learner is
 *         (D83, D84, D85)
 *   C-E2  the admin overview's Learners figure leaves out the same former
 *         staff member and test account; it counts accounts, not
 *         activity, so the early starter is in it (spec 7.4; guard)
 *   C-E3  the roster still lists the test account and the former staff
 *         member, each with its label (spec 7.4)
 *   C-E4  the learner detail: "Nothing shared with you." for a card that
 *         isn't, the count of cards shared with the viewer, and the
 *         scenario choice under Activity, not in the Comp Card (D80-D82)
 *
 * The people are the world of e2e/fixtures/people.ts (organisations of its
 * own, A, B and DIESIS), and four more learners in A, each with a marker
 * of their own in their name and email. This server counts from
 * STATS_FROM=2020-01-01 (playwright.config.ts), so "before STATS_FROM" is
 * 2019.
 *
 * C-E2 is a guard: it reads a partner admin's overview, whose counts are
 * exactly organisation A's (an ADMIN's would count every spec's learners);
 * on the old build there is no partner admin, so it fails there for that
 * reason only.
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
// In order, in one worker, each test on its own: a failure doesn't skip the
// rest (each says what it found on the old build too).
test.describe.configure({ mode: "default" });

const RUN = runId();

/** The four learners of A this spec adds to the world. */
const EXTRA = {
  /** A learner who started a course since STATS_FROM: counted. */
  LR: "real learner",
  /** Held FACILITATOR, had it removed, and plays a course as a learner now. */
  LF: "former staff",
  /** Marked as a test account by an ADMIN. */
  LT: "test account",
  /** Started a course before STATS_FROM, and nothing since. */
  LO: "early starter",
} as const;
type ExtraKey = keyof typeof EXTRA;
const EXTRA_KEYS = Object.keys(EXTRA) as ExtraKey[];
const marker = (key: ExtraKey) => `mk-${key.toLowerCase()}-${RUN}`;
const emailOf = (key: ExtraKey) => `e2e-${marker(key)}@example.com`;

/** STATS_FROM on this server is 2020-01-01: a start in 2019 is before it. */
const BEFORE_STATS_FROM = new Date("2019-06-01T09:00:00Z");

/**
 * Everything `path` sends `person`: the HTML (with the payload it carries
 * inline) and the React Server Components payload a client navigation
 * fetches.
 */
async function payload(request: APIRequestContext, person: Person, path: string): Promise<string> {
  const cookie = { Cookie: `authjs.session-token=${person.sessionToken}` };
  const html = await request.get(path, { headers: cookie, maxRedirects: 0 });
  expect(html.status(), `${path} as ${person.email}`).toBe(200);
  const rsc = await request.get(path, { headers: { ...cookie, RSC: "1" }, maxRedirects: 0 });
  expect(rsc.status(), `${path}'s payload as ${person.email}`).toBe(200);
  return `${await html.text()}\n${await rsc.text()}`;
}

/**
 * A learner's row on the roster. (The visible one: while the page streams
 * in, the server's copy can sit in a hidden block for a moment.)
 */
const rosterRow = (page: Page, text: string) => page.locator("li", { hasText: text }).filter({ visible: true });

/** The heading of the learner detail of the learner whose name holds `text`. */
const detailHeading = (page: Page, text: string) => page.getByRole("heading", { level: 2, name: new RegExp(text) });

/**
 * Opens the detail of the learner whose name holds `text`, from the roster
 * on screen, with `press` (a click by default). A press before the page has
 * hydrated does nothing, so it is pressed again until the detail opens.
 */
async function openLearner(page: Page, text: string, press?: (button: Locator) => Promise<void>) {
  const button = rosterRow(page, text).getByRole("button", { name: /open learner/i });
  const heading = detailHeading(page, text);
  await expect(async () => {
    if (!(await heading.isVisible())) await (press ? press(button) : button.click({ timeout: 5_000 }));
    await expect(heading).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

describe("Release 3 statistics: who is counted, and what the roster says", () => {
  let world: World;
  const extra = {} as Record<ExtraKey, Person>;
  const seen = (text: string) => EXTRA_KEYS.filter((k) => text.includes(marker(k)));

  test.beforeAll(async () => {
    await removePeople(prisma, EXTRA_KEYS.map(emailOf));
    world = await createWorld(prisma, { run: RUN });
    const A = { id: world.organisations.A.id };
    for (const key of EXTRA_KEYS) {
      extra[key] = await createPerson(prisma, {
        email: emailOf(key),
        name: `${key} ${marker(key)}`,
        // The former staff member is made as staff: the role's grant is what
        // Release 3 records as staff history (StaffHistory, by its trigger).
        roles: key === "LF" ? ["FACILITATOR"] : ["LEARNER"],
        organisation: A,
        testAccount: key === "LT",
      });
    }
    // The former staff member's role is removed, and they become a learner,
    // as their next page makes them (learner.ts, D53).
    await prisma.membership.deleteMany({ where: { userId: extra.LF.userId } });
    await prisma.membership.create({
      data: { userId: extra.LF.userId, projectId: "seq-elevate", role: "LEARNER" },
      select: { id: true },
    });
    // Each starts the world's course; the early starter before STATS_FROM.
    for (const key of EXTRA_KEYS) {
      await prisma.courseEnrollment.create({
        data: {
          userId: extra[key].userId,
          courseId: world.course.id,
          stagesCompleted: [],
          ...(key === "LO" ? { enrolledAt: BEFORE_STATS_FROM } : {}),
        },
        select: { id: true },
      });
    }
    // The real learner also took the built-in course's applied scenario.
    const builtIn = await prisma.course.findFirstOrThrow({
      where: { projectId: "seq-elevate", slug: "workplace-conflict" },
      select: { id: true },
    });
    await prisma.courseEnrollment.create({
      data: {
        userId: extra.LR.userId,
        courseId: builtIn.id,
        stagesCompleted: ["CONTEXT", "CONCEPT", "BEHAVIOUR", "SIMULATION", "SCENARIO"],
        scenarioRoot: "private",
        scenarioFollowup: "privateBoundary",
      },
      select: { id: true },
    });
  });

  test.afterAll(async () => {
    const ids = EXTRA_KEYS.map((k) => extra[k]?.userId).filter(Boolean);
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] } });
    await removePeople(prisma, EXTRA_KEYS.map(emailOf));
    if (world) await removeWorld(prisma, world);
  });

  test("C-E1: former staff, a test account and a start before STATS_FROM aren't counted; a real learner is", async ({
    request,
  }) => {
    // ?live=1: a test copy shows the real figures however few learners started.
    const admin = await payload(request, world.people.AS, "/en/analytics?live=1");
    expect(seen(admin), "an ADMIN's statistics").toEqual(["LR"]);
    // The world's own learners started since STATS_FROM too: counted.
    expect(admin).toContain(world.marker("LA1"));
    // The same for the organisation's own facilitator.
    expect(seen(await payload(request, world.people.FA, "/en/analytics?live=1")), "FA's statistics").toEqual(["LR"]);
  });

  test("C-E2 (guard): the admin Learners figure leaves out the former staff member and the test account", async ({
    page,
    context,
  }) => {
    await signIn(context, world.people.PAA.sessionToken);
    await page.goto("/en/admin");
    // The visible figure: while the page streams in, the server's copy can
    // sit in a hidden block for a moment.
    const learners = page
      .locator("p", { hasText: /^Learners\b/ })
      .locator("xpath=following-sibling::p")
      .filter({ visible: true });
    // A's learners: LA1 and LA2 of the world, the real learner and the early
    // starter (an account count, without a date); not LF, not LT.
    await expect(learners).toHaveText("4");
  });

  test("C-E3: the roster lists the test account and the former staff member, with their labels", async ({
    page,
    context,
  }) => {
    await signIn(context, world.people.FA.sessionToken);
    await page.goto("/en/facilitator");
    const marked = rosterRow(page, marker("LT"));
    const former = rosterRow(page, marker("LF"));
    const real = rosterRow(page, marker("LR"));
    await expect(real).toBeVisible();
    await expect(marked).toContainText("Test account");
    await expect(marked).not.toContainText("Former staff");
    await expect(former).toContainText("Former staff");
    await expect(former).not.toContainText("Test account");
    await expect(real).not.toContainText(/Test account|Former staff/);
  });

  test("C-E4: the learner detail shows only what is shared with you, and the scenario under Activity", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await signIn(context, world.people.FA.sessionToken);
    await page.goto("/en/facilitator");
    // A's six learners; LA1's card is shared with A, LA2's is "Only me".
    // (Soft: each part of this test says on its own what it found. The
    // visible figure: while the page streams in, the server's copy can sit
    // in a hidden block for a moment.)
    const shared = page
      .getByText("Comp Cards shared with you", { exact: true })
      .locator("xpath=following-sibling::p")
      .filter({ visible: true });
    await expect.soft(shared).toHaveText("1/6");

    const open = async (text: string) => {
      await page.goto("/en/facilitator");
      await openLearner(page, text);
    };
    const card = () =>
      page.getByRole("heading", { name: "Comp Card", level: 3 }).locator("xpath=following-sibling::*[1]");
    const activity = () => page.getByText("Activity & performance", { exact: true }).locator("xpath=..");

    // LA2 kept the card to themselves: nothing of it, and it says so.
    await open(world.marker("LA2"));
    await expect.soft(card()).toHaveText("Nothing shared with you.");
    await expect.soft(page.getByRole("main")).not.toContainText(world.cardMarker("LA2"));

    // LA1 shared it with A: its text.
    await open(world.marker("LA1"));
    await expect(card()).toContainText(`${world.cardMarker("LA1")} went well`);

    // The real learner's scenario choice is progress, under Activity; they
    // shared no card.
    await open(marker("LR"));
    await expect(activity()).toContainText("Applied scenario:");
    await expect(activity()).toContainText(/talk to Sam privately → Tell Sam it.s fine/);
    await expect(card()).toHaveText("Nothing shared with you.");
  });
});
