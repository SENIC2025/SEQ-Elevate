import { test, expect, type BrowserContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * The signed-in header fits a 320px phone (WCAG 1.4.10 Reflow) in every
 * language: a learner's, and a staff member's with the workspace menu. A
 * long address used to push a learner's page 2px sideways, and a staff
 * header 7–10px.
 *
 * Requires a real database — gated on E2E_DB=1, like db-backed-progress.
 * Everything it creates is unique to this run and removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;

const PROJECT = "seq-elevate";
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// Long on purpose: the account control must not grow with the address.
const LEARNER = `e2e-header-reflow-learner-${RUN}@example.com`;
const STAFF = `e2e-header-reflow-staff-${RUN}@example.com`;
const EMAILS = [LEARNER, STAFF];

async function signedInUser(
  email: string,
  roles: ("LEARNER" | "ADMIN" | "CONTENT_EDITOR" | "FACILITATOR")[]
) {
  const user = await prisma.user.create({
    data: { email, emailVerified: new Date() },
  });
  for (const role of roles) {
    await prisma.membership.create({
      data: { userId: user.id, projectId: PROJECT, role },
    });
  }
  const sessionToken = `e2e-header-${RUN}-${Math.random().toString(36).slice(2)}`;
  await prisma.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 86_400_000),
    },
  });
  return sessionToken;
}

async function signIn(context: BrowserContext, sessionToken: string) {
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

describe("the signed-in header on a 320px phone", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  let learnerSession: string;
  let staffSession: string;

  test.beforeAll(async () => {
    learnerSession = await signedInUser(LEARNER, ["LEARNER"]);
    // Several workspaces: the header shows the workspace menu too.
    staffSession = await signedInUser(STAFF, [
      "ADMIN",
      "CONTENT_EDITOR",
      "FACILITATOR",
    ]);
  });

  test.afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { actor: { is: { email: { in: EMAILS } } } },
    });
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.$disconnect();
  });

  for (const [who, path] of [
    ["learner", "/learner"],
    ["staff", "/facilitator"],
  ] as const) {
    test(`a ${who}'s page doesn't scroll sideways, in English, German and Greek`, async ({
      page,
      context,
    }) => {
      await signIn(context, who === "learner" ? learnerSession : staffSession);
      for (const locale of ["en", "de", "el"]) {
        await page.goto(`/${locale}${path}`);
        // Signed in: the account control is there.
        await expect(page.locator('header a[href$="/account"]')).toBeVisible({
          timeout: 15000,
        });
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        );
        expect(overflow, `${locale}: no horizontal scrolling`).toBeLessThanOrEqual(0);
      }
    });
  }
});
