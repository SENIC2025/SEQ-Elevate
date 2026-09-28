import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient, type Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Invitation emails (D27): an admin adds someone and they receive a one-click
 * join link. Covers the whole path — sent + audited + shown as invited,
 * resending, the security gate (nobody outside the admin screen can trigger
 * an invitation, while ordinary sign-in keeps working), the link signing the
 * invitee in, and "already has an account" needing no invitation.
 *
 * DB-backed (E2E_DB=1). The join-link test mints a token the way Auth.js
 * stores it — sha256(token + AUTH_SECRET) — so it needs AUTH_SECRET in the
 * test process (set in CI; pass it on the command line locally). The test
 * server runs with a placeholder Resend key (playwright.config), so nothing
 * is ever really emailed.
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
// Unique per run, so the per-address invitation rate limit never carries
// over from a previous run.
const RUN = Date.now().toString(36);
const ADMIN = `e2e-inv-admin-${RUN}@example.com`;
const INVITEE = `e2e-inv-trainer-${RUN}@example.com`;
const MEMBER = `e2e-inv-member-${RUN}@example.com`;
const STRANGER = `e2e-inv-stranger-${RUN}@example.com`;
const EMAILS = [ADMIN, INVITEE, MEMBER, STRANGER];

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

let adminSession = "";

async function makeUser(email: string, roles: Role[], withSession: boolean) {
  const user = await prisma.user.create({
    data: { email, emailVerified: new Date() },
  });
  for (const role of roles) {
    await prisma.membership.create({
      data: { userId: user.id, projectId: PROJECT, role },
    });
  }
  if (!withSession) return "";
  const sessionToken = `e2e-${RUN}-${Math.random().toString(36).slice(2)}`;
  await prisma.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 86_400_000),
    },
  });
  return sessionToken;
}

function sessionCookie(value: string) {
  return {
    name: "authjs.session-token",
    value,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    sameSite: "Lax" as const,
  };
}

const tokensFor = (email: string) =>
  prisma.verificationToken.count({ where: { identifier: email } });

async function cleanUp() {
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
  await prisma.verificationToken.deleteMany({
    where: { identifier: { in: EMAILS } },
  });
}

describe("Invitation emails", () => {
  test.beforeAll(async () => {
    await cleanUp();
    adminSession = await makeUser(ADMIN, ["ADMIN"], true);
    await makeUser(MEMBER, ["LEARNER"], false); // has signed in before
  });

  test.afterAll(cleanUp);

  test("an admin invites a new trainer: sent, audited, shown as invited", async ({
    page,
    context,
  }) => {
    await context.addCookies([sessionCookie(adminSession)]);
    await page.goto("/en/admin/people");

    await page.getByLabel(/^email$/i).first().fill(INVITEE);
    await page.getByLabel(/name \(optional\)/i).first().fill("Maria Invitee");
    await page.getByLabel(/^role$/i).first().selectOption("FACILITATOR");
    await expect(page.getByLabel(/send them an invitation email/i).first()).toBeChecked();
    await page.getByLabel("Invitation language").first().selectOption("de");
    await page.getByRole("button", { name: /^add$/i }).first().click();

    await expect(
      page.getByText(/sent them an invitation email/i).first()
    ).toBeVisible();

    // A 7-day one-click link exists for them, and the send was audited.
    const user = await prisma.user.findUnique({ where: { email: INVITEE } });
    expect(user?.emailVerified).toBeNull();
    const token = await prisma.verificationToken.findFirst({
      where: { identifier: INVITEE },
    });
    expect(token, "invitation link created").toBeTruthy();
    const days = (token!.expires.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect(
      await prisma.auditLog.count({
        where: { action: "member.invited", entityId: user!.id },
      })
    ).toBe(1);

    // The list shows them as invited, with a way to resend.
    const row = page.locator("tr", { hasText: INVITEE }).first();
    await expect(row).toContainText(/Invited \d{4}-\d{2}-\d{2}/);
    await expect(
      row.getByRole("button", { name: `Resend invitation to ${INVITEE}` })
    ).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
  });

  test("resending creates a fresh link", async ({ page, context }) => {
    await context.addCookies([sessionCookie(adminSession)]);
    await page.goto("/en/admin/people");
    const before = await tokensFor(INVITEE);

    await page
      .getByRole("button", { name: `Resend invitation to ${INVITEE}` })
      .first()
      .click();
    await expect(
      page.getByText(`Invitation sent to ${INVITEE}.`).first()
    ).toBeVisible();
    expect(await tokensFor(INVITEE)).toBe(before + 1);
  });

  test("nobody outside the admin screen can trigger an invitation — ordinary sign-in still works", async ({
    request,
  }) => {
    const { csrfToken } = await (await request.get("/api/auth/csrf")).json();

    // Auth.js serves every provider publicly; the invitation one must refuse
    // — for a pending invitee and for a stranger alike — and create nothing.
    for (const email of [INVITEE, STRANGER]) {
      const before = await tokensFor(email);
      const res = await request.post("/api/auth/signin/invite", {
        form: { email, csrfToken, callbackUrl: "/en" },
        maxRedirects: 0,
      });
      expect(res.status(), `status for ${email}`).toBeGreaterThanOrEqual(300);
      expect(res.status()).toBeLessThan(400);
      expect(res.headers()["location"]).toMatch(/error/i);
      expect(await tokensFor(email), `no link for ${email}`).toBe(before);
    }

    // The ordinary sign-in link is untouched by the gate: it goes on to the
    // "check your email" step (Auth.js's verify-request, which then shows our
    // check-email page) and a link is created.
    const res = await request.post("/api/auth/signin/resend", {
      form: { email: STRANGER, csrfToken, callbackUrl: "/en" },
      maxRedirects: 0,
    });
    expect(res.headers()["location"]).toMatch(/verify-request/);
    expect(res.headers()["location"]).not.toMatch(/error/i);
    expect(await tokensFor(STRANGER)).toBe(1);
  });

  test("the invitation link signs the trainer in and opens their workspaces", async ({
    page,
  }) => {
    const secret = process.env.AUTH_SECRET;
    test.skip(!secret, "needs AUTH_SECRET to mint a link the way Auth.js stores it");

    const raw = randomBytes(32).toString("hex");
    await prisma.verificationToken.create({
      data: {
        identifier: INVITEE,
        token: createHash("sha256").update(`${raw}${secret}`).digest("hex"),
        expires: new Date(Date.now() + 7 * 86_400_000),
      },
    });

    await page.goto(
      `/api/auth/callback/invite?${new URLSearchParams({
        callbackUrl: "/en",
        token: raw,
        email: INVITEE,
      })}`
    );
    await expect(page).toHaveURL(/\/en$/);
    await expect(
      page.getByRole("heading", { name: "Welcome back" }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Support learners" }).first()
    ).toBeVisible();

    const user = await prisma.user.findUnique({ where: { email: INVITEE } });
    expect(user?.emailVerified, "marked as joined").not.toBeNull();
  });

  test("the admin then sees them as joined", async ({ page, context }) => {
    test.skip(!process.env.AUTH_SECRET, "depends on the join-link test");
    await context.addCookies([sessionCookie(adminSession)]);
    await page.goto("/en/admin/people");
    const row = page.locator("tr", { hasText: INVITEE }).first();
    await expect(row).toContainText("Joined");
    await expect(row.getByRole("button", { name: /invitation/i })).toHaveCount(0);
  });

  test("adding someone who already has an account sends no invitation", async ({
    page,
    context,
  }) => {
    await context.addCookies([sessionCookie(adminSession)]);
    await page.goto("/en/admin/people");

    await page.getByLabel(/^email$/i).first().fill(MEMBER);
    await page.getByLabel(/^role$/i).first().selectOption("CONTENT_EDITOR");
    await page.getByRole("button", { name: /^add$/i }).first().click();

    await expect(page.getByText(/already have an account/i).first()).toBeVisible();
    expect(await tokensFor(MEMBER)).toBe(0);
    const member = await prisma.user.findUnique({
      where: { email: MEMBER },
      include: { memberships: true },
    });
    expect(member?.memberships.map((m) => m.role)).toContain("CONTENT_EDITOR");
  });
});
