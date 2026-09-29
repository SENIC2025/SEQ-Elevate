import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * A signed-in user's reading-help settings (text size, easy-read font, high
 * contrast) are saved on their account — User.fontSize / dyslexic /
 * contrast — and the page never saves over them what it didn't load: a
 * load that finds no session or fails is tried again, a choice made while
 * they load is kept along with the saved settings it didn't change, and a
 * save made for one account never lands in another. A guest's settings stay
 * in this browser and move to their account on first sign-in.
 *
 * Requires a real database — gated on E2E_DB=1, like
 * db-backed-progress.spec.ts. Run: E2E_DB=1 pnpm test:e2e e2e/a11y-prefs.spec.ts
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;

// These tests mutate a shared database — run them one at a time so they
// don't see each other's users or race on cleanup.
test.describe.configure({ mode: "serial" });

type Page = import("@playwright/test").Page;

/** The settings as the User row holds them. */
interface SavedPrefs {
  fontSize: string;
  dyslexic: boolean;
  contrast: boolean;
}

const DEFAULTS: SavedPrefs = { fontSize: "normal", dyslexic: false, contrast: false };
/** Every setting away from its default. */
const ALL_ON: SavedPrefs = { fontSize: "xl", dyslexic: true, contrast: true };

/** This browser's copy of the settings (AccessibilityProvider). */
const MIRROR_KEY = "seq-elevate-a11y-v1";

/**
 * Makes the first `times` reading-help loads (loadA11yPrefs) go wrong as
 * `how` says:
 *
 * - "no session": the load runs without the user's session, the way a
 *   server whose session lookup failed runs it — Auth.js's database session
 *   lookup logs a database error and answers "no session" instead of
 *   failing, so the action sees no one signed in. The Session row is taken
 *   away while it runs and put back before the page gets the answer.
 * - "network error": the page gets no answer, as on a dropped connection.
 *
 * The load is called without arguments, like the learner store's
 * membership and data loads, so it's told apart by its answer: each call
 * without arguments runs as it is first, and the one whose answer holds
 * the reading-help settings is then run again without the session (or
 * failed), and the page gets that instead. Running a load twice changes
 * nothing. They run one at a time (Next sends server actions one at a time
 * anyway), so no other request runs while the session is away.
 */
async function breakReadingHelpLoads(
  page: Page,
  sessionToken: string,
  how: "no session" | "network error",
  times: number
) {
  let broken = 0;
  let queue: Promise<unknown> = Promise.resolve();
  await page.route("**/*", async (route) => {
    const req = route.request();
    const matches =
      req.method() === "POST" &&
      !!(await req.headerValue("next-action")) &&
      req.postData() === "[]";
    if (!matches || broken >= times) return route.continue();
    const turn = queue.then(async () => {
      const answer = await route.fetch();
      if (broken >= times || !(await answer.text()).includes('"dyslexia"')) {
        return answer;
      }
      broken++;
      if (how === "network error") return null;
      const session = await prisma.session.findUniqueOrThrow({
        where: { sessionToken },
      });
      await prisma.session.delete({ where: { sessionToken } });
      try {
        return await route.fetch();
      } finally {
        await prisma.session.create({ data: session });
      }
    });
    queue = turn.catch(() => undefined);
    const response = await turn;
    if (!response) return route.abort("failed");
    await route.fulfill({ response });
  });
  return { broken: () => broken };
}

/**
 * Holds every Next.js server-action POST (they carry a `next-action` header)
 * until `release()`, so the test can act before the settings have loaded:
 * the window a cold server opens by accident, deterministically. (As in
 * db-backed-progress.spec.ts.)
 */
async function holdServerActions(page: Page) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let held = 0;
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.method() === "POST" && (await req.headerValue("next-action"))) {
      held++;
      await released;
    }
    await route.continue();
  });
  return { held: () => held, release };
}

/** The page's answer to its reading-help load. */
function readingHelpLoaded(page: Page) {
  return page.waitForResponse(
    async (r) =>
      r.request().method() === "POST" &&
      r.request().postData() === "[]" &&
      (await r.text()).includes('"dyslexia"')
  );
}

/**
 * Makes the page read its session again now, as it does when another tab
 * signs in or out (next-auth tells the other tabs on this channel). (As in
 * db-backed-progress.spec.ts.)
 */
function recheckSession(page: Page) {
  return page.evaluate(() =>
    new BroadcastChannel("next-auth").postMessage({
      event: "session",
      data: { trigger: "getSession" },
    })
  );
}

/** Opens the reading-help panel from the header. */
async function openReadingHelp(page: Page) {
  await page.getByRole("button", { name: /open reading help/i }).click();
  await expect(page.getByRole("dialog", { name: "Reading help" })).toBeVisible();
}

/** What the page shows: the settings as <html> carries them. */
async function expectShown(page: Page, prefs: SavedPrefs) {
  const html = page.locator("html");
  if (prefs.fontSize === "normal") {
    await expect(html).not.toHaveAttribute("data-font-size");
  } else {
    await expect(html).toHaveAttribute("data-font-size", prefs.fontSize);
  }
  await expect(html).toHaveAttribute("data-dyslexic", String(prefs.dyslexic));
  await expect(html).toHaveAttribute("data-contrast", String(prefs.contrast));
}

describe("reading-help settings kept when a load fails or the session changes hands", () => {
  const emails = {
    noSession: "e2e-a11y-nosession@example.com",
    failed: "e2e-a11y-failed@example.com",
    whileLoading: "e2e-a11y-while-loading@example.com",
    guest: "e2e-a11y-guest@example.com",
    switchFirst: "e2e-a11y-switch-first@example.com",
    switchNext: "e2e-a11y-switch-next@example.com",
    signOutFirst: "e2e-a11y-signout-first@example.com",
    signOutNext: "e2e-a11y-signout-next@example.com",
  };
  const all = Object.values(emails);
  const users: Record<string, { id: string; session: string }> = {};

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: all } } });
    for (const email of all) {
      const user = await prisma.user.create({
        data: { email, emailVerified: new Date() },
      });
      const session = `e2e-a11y-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await prisma.session.create({
        data: {
          sessionToken: session,
          userId: user.id,
          expires: new Date(Date.now() + 86_400_000),
        },
      });
      users[email] = { id: user.id, session };
    }
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: all } } });
    // No $disconnect() here: describes share this module-level client and may
    // run later on the same worker. Prisma releases the pool on worker exit.
  });

  const signIn = (
    context: import("@playwright/test").BrowserContext,
    email: string
  ) =>
    context.addCookies([
      {
        name: "authjs.session-token",
        value: users[email].session,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

  const savePrefs = (userId: string, prefs: SavedPrefs) =>
    prisma.user.update({ where: { id: userId }, data: prefs });

  const savedPrefs = (userId: string) =>
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { fontSize: true, dyslexic: true, contrast: true },
    });

  test("a settings load that finds no session is tried again, not taken for no saved settings", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const { id: userId, session } = users[emails.noSession];
    await savePrefs(userId, ALL_ON);
    await signIn(context, emails.noSession);
    const lost = await breakReadingHelpLoads(page, session, "no session", 1);

    await page.goto("/en/learner");
    await expect.poll(lost.broken, { timeout: 15_000 }).toBe(1);
    // Past a try again (1 s) and the save debounce (600 ms).
    await page.waitForTimeout(2500);

    expect(await savedPrefs(userId)).toEqual(ALL_ON);
    await expectShown(page, ALL_ON);
  });

  test("a settings load that fails is tried again: the saved settings are shown, and a choice is saved", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const { id: userId, session } = users[emails.failed];
    await savePrefs(userId, ALL_ON);
    await signIn(context, emails.failed);
    const failed = await breakReadingHelpLoads(page, session, "network error", 1);

    await page.goto("/en/learner");
    await expect.poll(failed.broken, { timeout: 15_000 }).toBe(1);
    await expectShown(page, ALL_ON);

    // Saving works once a try got through…
    await openReadingHelp(page);
    await page.getByRole("button", { name: "Large", exact: true }).click();
    await expect
      .poll(() => savedPrefs(userId), { timeout: 10_000 })
      .toEqual({ ...ALL_ON, fontSize: "lg" });
    // …and this browser keeps its copy.
    const mirror = await page.evaluate(
      (key) => localStorage.getItem(key) ?? "",
      MIRROR_KEY
    );
    expect(mirror).toContain('"fontSize":"lg"');
  });

  test("a choice made while the settings load wins, is saved, and keeps the saved settings it didn't change", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const { id: userId } = users[emails.whileLoading];
    await savePrefs(userId, ALL_ON);
    await signIn(context, emails.whileLoading);
    const actions = await holdServerActions(page);

    await page.goto("/en/learner");
    await openReadingHelp(page);
    await page.getByRole("button", { name: "Large", exact: true }).click();
    await expect.poll(actions.held).toBeGreaterThan(0);
    actions.release();

    const chosen = { ...ALL_ON, fontSize: "lg" };
    await expect
      .poll(() => savedPrefs(userId), { timeout: 15_000 })
      .toEqual(chosen);
    await expectShown(page, chosen);
  });

  test("a guest's settings stay in this browser, unsaved, and move to their account on first sign-in", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const { id: userId } = users[emails.guest];
    const saves: string[] = [];
    page.on("request", (req) => {
      const body = req.postData() ?? "";
      if (req.method() === "POST" && body.includes("fontSize")) saves.push(body);
    });

    // As a guest: two settings, kept in this browser only.
    await page.goto("/en/learner");
    await openReadingHelp(page);
    await page.getByRole("button", { name: "Extra large" }).click();
    await page.getByText("Easy-read font").click();
    const chosen = { fontSize: "xl", dyslexic: true, contrast: false };
    await page.reload();
    await expectShown(page, chosen);
    expect(saves, "a guest's settings aren't sent anywhere").toEqual([]);

    // Signed in to an account on the defaults: they move to it.
    await signIn(context, emails.guest);
    await page.goto("/en/learner");
    await expect
      .poll(() => savedPrefs(userId), { timeout: 15_000 })
      .toEqual(chosen);
    await expectShown(page, chosen);
  });

  test("a save waiting when another account signs in in another tab isn't saved into that account", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const first = users[emails.switchFirst];
    const next = users[emails.switchNext];
    await signIn(context, emails.switchFirst);
    const loaded = readingHelpLoaded(page);
    await page.goto("/en/learner");
    await loaded;
    const signOut = page.getByRole("button", { name: "Sign out" });
    await expect(signOut).toBeVisible();

    // A choice, its save waiting out the debounce…
    await openReadingHelp(page);
    await page.getByRole("button", { name: "Extra large" }).click();
    // …when another account signs in on this browser, and this tab picks
    // it up.
    await signIn(context, emails.switchNext);
    await recheckSession(page);

    await page.waitForTimeout(2500); // past the save debounce and a load
    expect(await savedPrefs(next.id), "nothing saved into the next account").toEqual(
      DEFAULTS
    );
    expect(await savedPrefs(first.id), "nor, late, into the first").toEqual(
      DEFAULTS
    );
    // The next account's own settings are shown, not the first one's.
    await expectShown(page, DEFAULTS);
  });

  test("after a sign-out in another tab, the next account to sign in doesn't take the first one's settings", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const first = users[emails.signOutFirst];
    const next = users[emails.signOutNext];
    await savePrefs(first.id, ALL_ON);
    await signIn(context, emails.signOutFirst);
    await page.goto("/en/learner");
    await expectShown(page, ALL_ON);

    // They sign out in another tab; this one keeps showing the settings.
    const other = await context.newPage();
    await other.goto("/en/learner");
    await other.getByRole("button", { name: "Sign out" }).click();
    const signOut = page.getByRole("button", { name: "Sign out" });
    await expect(signOut).toBeHidden();
    await expectShown(page, ALL_ON);

    // Someone else signs in on this browser, and this tab picks it up.
    await signIn(context, emails.signOutNext);
    await recheckSession(page);
    await expect(signOut).toBeVisible();
    await page.waitForTimeout(2500); // past a load and the save debounce

    expect(await savedPrefs(next.id)).toEqual(DEFAULTS);
    await expectShown(page, DEFAULTS);
  });
});
