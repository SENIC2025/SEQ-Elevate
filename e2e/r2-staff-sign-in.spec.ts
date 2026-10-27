import { test, expect, type Page } from "@playwright/test";
import { PrismaClient, type Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash, randomBytes } from "node:crypto";

/**
 * A staff page's access notice ("Admins only", "Editors only", the
 * facilitator workspace and the statistics "for facilitators and admins")
 * offers a visitor who is signed out the way to sign in: a "Sign in" link
 * to /<locale>/signin with the page's own path as the callbackUrl, so the
 * sign-in link they get by email brings them back to the page. The link is
 * in the notice's language: the page's, or English on the English-only
 * staff notices. Someone signed in without the role sees the notice as
 * before, with no link.
 *
 *   SI-E1  signed out, every staff page in its languages: the notice and its
 *          link, back to the page
 *   SI-E2  the link opens the sign-in page with the page as the way back,
 *          and signing in there lands on the page (database)
 *   SI-E3  a learner signed in without the role: the notice, no link
 *          (database; a guard, as before)
 *
 * SI-E1 and SI-E2 are red on the build before (b883ac5): the notice had no
 * link.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  : (null as unknown as PrismaClient);

const PROJECT = "seq-elevate";
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const LEARNER = `e2e-si-learner-${RUN}@example.com`;
const ADMIN = `e2e-si-admin-${RUN}@example.com`;
const EMAILS = [LEARNER, ADMIN];

/** A staff page, the heading of its notice, and the notice's link in the notice's language. */
type Notice = { path: string; heading: string; link: string };
const SIGN_IN = { en: "Sign in", de: "Anmelden", el: "Σύνδεση" } as const;
const NOTICES: Notice[] = [
  // The admin screens' notices are English-only: their link is English too.
  { path: "/en/admin", heading: "Admins only", link: SIGN_IN.en },
  { path: "/de/admin", heading: "Admins only", link: SIGN_IN.en },
  { path: "/el/admin/people", heading: "Admins only", link: SIGN_IN.en },
  { path: "/en/admin/cohorts", heading: "Admins only", link: SIGN_IN.en },
  { path: "/en/analytics", heading: "Learner statistics", link: SIGN_IN.en },
  // The editors' and facilitators' notices are in the page's language.
  { path: "/en/content", heading: "Editors only", link: SIGN_IN.en },
  { path: "/de/content/courses", heading: "Nur für die Inhalts-Redaktion", link: SIGN_IN.de },
  { path: "/el/content/courses/workplace-conflict", heading: "Μόνο για συντάκτες", link: SIGN_IN.el },
  { path: "/en/facilitator", heading: "Facilitator workspace", link: SIGN_IN.en },
  { path: "/de/facilitator", heading: "Trainer:innen-Arbeitsplatz", link: SIGN_IN.de },
  { path: "/el/content", heading: "Μόνο για συντάκτες", link: SIGN_IN.el },
];

const localeOf = (path: string) => path.split("/")[1];
const signInHref = (path: string) => `/${localeOf(path)}/signin?callbackUrl=${encodeURIComponent(path)}`;
const notice = (page: Page, heading: string) => page.locator("main").getByRole("heading", { level: 1, name: heading, exact: true });
const signInLink = (page: Page, name: string) => page.locator("main").getByRole("link", { name, exact: true });

test.describe("a staff page's access notice, signed out", () => {
  test("SI-E1 every staff page offers a signed-out visitor the way to sign in, back to the page, in the notice's language", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    for (const { path, heading, link } of NOTICES) {
      await page.goto(path);
      await expect(notice(page, heading), path).toBeVisible();
      await expect(signInLink(page, link), path).toHaveAttribute("href", signInHref(path));
    }
  });
});

const describeDb = DB ? test.describe : test.describe.skip;

describeDb("a staff page's access notice, with an account", () => {
  test.describe.configure({ mode: "serial" });

  /** A person holding `roles` in the project (none: no membership), with a live session; its token. */
  async function person(email: string, roles: Role[]) {
    const user = await prisma.user.create({ data: { email, emailVerified: new Date() }, select: { id: true } });
    for (const role of roles) await prisma.membership.create({ data: { userId: user.id, projectId: PROJECT, role } });
    const sessionToken = `e2e-si-${RUN}-${Math.random().toString(36).slice(2)}`;
    await prisma.session.create({ data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 86_400_000) } });
    return { userId: user.id, sessionToken };
  }

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
  });
  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
    await prisma.verificationToken.deleteMany({ where: { identifier: { in: EMAILS } } });
    await prisma.$disconnect();
  });

  test("SI-E2 the link opens the sign-in page with the page as the way back, and the email link lands on the page", async ({
    page,
  }) => {
    const secret = process.env.AUTH_SECRET;
    test.skip(!secret, "needs AUTH_SECRET to make an email link the way Auth.js stores it");
    await person(ADMIN, ["ADMIN"]);

    await page.goto("/en/admin");
    await signInLink(page, SIGN_IN.en).click();
    await expect(page).toHaveURL(/\/en\/signin\?callbackUrl=%2Fen%2Fadmin$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    // The form sends the way back with the address the link goes to.
    const back = await page.locator('form input[name="callbackUrl"]').inputValue();
    expect(back).toBe("/en/admin");

    // The email's link, as Auth.js makes it from the form (sha256(token + secret)).
    const raw = randomBytes(32).toString("hex");
    await prisma.verificationToken.create({
      data: {
        identifier: ADMIN,
        token: createHash("sha256").update(`${raw}${secret}`).digest("hex"),
        expires: new Date(Date.now() + 10 * 60_000),
      },
    });
    await page.goto(`/api/auth/callback/resend?${new URLSearchParams({ callbackUrl: back, token: raw, email: ADMIN })}`);
    await expect(page).toHaveURL(/\/en\/admin$/);
    await expect(page.getByRole("heading", { level: 1, name: "Admin dashboard" })).toBeVisible();
    await expect(signInLink(page, SIGN_IN.en)).toHaveCount(0);
  });

  test("SI-E3 (guard) a learner signed in without the role sees each notice as before, with no way to sign in", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const { sessionToken } = await person(LEARNER, ["LEARNER"]);
    await context.addCookies([
      { name: "authjs.session-token", value: sessionToken, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);
    for (const { path, heading } of NOTICES) {
      await page.goto(path);
      await expect(notice(page, heading), path).toBeVisible();
      for (const name of Object.values(SIGN_IN)) await expect(signInLink(page, name), path).toHaveCount(0);
    }
  });
});
