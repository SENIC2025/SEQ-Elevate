import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient, type Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * "Your workspaces" (D26): after sign-in, staff land on a hub of the
 * workspaces their REAL roles allow, and can switch between them from the
 * header; learners skip the hub. Also covers the self-healing ADMIN_EMAILS
 * grant — the exact case where a consortium admin was on the list but only
 * saw the learner view.
 *
 * Requires a real database — gated on E2E_DB=1, like db-backed-progress.
 * The bootstrap test relies on playwright.config setting ADMIN_EMAILS for
 * the test server.
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
const STAFF = "e2e-hub-staff@example.com";
const LEARNER = "e2e-hub-learner@example.com";
const BOOTSTRAP = "e2e-bootstrap-admin@example.com"; // listed in ADMIN_EMAILS
const EMAILS = [STAFF, LEARNER, BOOTSTRAP];

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Create a user holding `roles`, plus a live session; returns its token. */
async function signedInUser(email: string, roles: Role[]) {
  const user = await prisma.user.create({
    data: { email, emailVerified: new Date() },
  });
  for (const role of roles) {
    await prisma.membership.create({
      data: { userId: user.id, projectId: PROJECT, role },
    });
  }
  const sessionToken = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await prisma.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 86_400_000),
    },
  });
  return { userId: user.id, sessionToken };
}

async function useSession(
  context: import("@playwright/test").BrowserContext,
  sessionToken: string
) {
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

describe("Workspace hub", () => {
  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
  });

  test("staff land on their workspaces and can switch from the header", async ({
    page,
    context,
  }) => {
    const { sessionToken } = await signedInUser(STAFF, [
      "ADMIN",
      "CONTENT_EDITOR",
    ]);
    await useSession(context, sessionToken);

    await page.goto("/en");
    await expect(
      page.getByRole("heading", { name: "Welcome back" })
    ).toBeVisible();
    for (const name of [
      "Create courses",
      "Manage people",
      "Support learners",
      "Statistics",
      "My learning",
    ]) {
      await expect(page.getByRole("link", { name })).toBeVisible();
    }

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);

    // Into course creation from the hub…
    await page.getByRole("link", { name: "Create courses" }).click();
    await expect(page).toHaveURL(/\/en\/content$/);

    // …and across to people management via the header switcher.
    const switcher = page.locator("header summary");
    await expect(switcher).toContainText("Create courses");
    await switcher.click();
    await page.getByRole("link", { name: "Manage people" }).click();
    await expect(page).toHaveURL(/\/en\/admin$/);
  });

  test("a learner skips the hub and goes straight to their courses", async ({
    page,
    context,
  }) => {
    const { sessionToken } = await signedInUser(LEARNER, ["LEARNER"]);
    await useSession(context, sessionToken);

    await page.goto("/en");
    await expect(page).toHaveURL(/\/en\/learner$/);
    // No workspace switcher for someone with a single workspace.
    await expect(page.locator("header summary")).toHaveCount(0);
  });

  test("an ADMIN_EMAILS address gets admin on the next page load — no re-sign-in", async ({
    page,
    context,
  }) => {
    // Signed in BEFORE being granted anything (the reported bug).
    const { userId, sessionToken } = await signedInUser(BOOTSTRAP, []);
    await useSession(context, sessionToken);

    await page.goto("/en");
    await expect(page.getByRole("link", { name: "Create courses" })).toBeVisible();

    const roles = (
      await prisma.membership.findMany({
        where: { userId, projectId: PROJECT },
      })
    ).map((m) => m.role);
    expect(roles).toEqual(expect.arrayContaining(["ADMIN", "CONTENT_EDITOR"]));
  });
});
