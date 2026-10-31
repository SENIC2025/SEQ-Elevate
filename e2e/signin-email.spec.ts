import { test, expect, type APIRequestContext } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { runId } from "./fixtures/people";

/**
 * Sign-in emails (D116): the address rule and the limits on how many are sent.
 *
 *   SE-E1  the sign-in form refuses an address with a look-alike "@" (the
 *          browser's own check switched off, so the server's is what is
 *          tested), says so, and no link is made or sent
 *   SE-E2  Auth.js's own endpoint refuses such addresses too: its error page,
 *          no link
 *   SE-E3  (guard) an ordinary address, typed with capitals and spaces, gets
 *          its link, made for the address as the rule normalises it
 *   SE-E4  over the per-client limit (SIGNIN_EMAILS_PER_IP_15MIN, default 30
 *          in 15 minutes): Auth.js's endpoint sends the request to the
 *          sign-in page with error=rate-limited, the form says to try again
 *          later in the page's language and stays, and no link is made;
 *          another client is not held up
 *
 * A link "made" is a VerificationToken row: Auth.js stores one with every
 * link it sends (the servers run with the placeholder Resend key, so the
 * link is only logged). SE-E4's client is an IPv6 documentation block of
 * this run's own (x-forwarded-for, which the server reads as the client), so
 * no other spec shares its count.
 *
 * Database-backed (E2E_DB=1). Red on the build before D116 (b33b82a): SE-E1,
 * SE-E2 and SE-E4.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  : (null as unknown as PrismaClient);
const describe = DB ? test.describe : test.describe.skip;

const RUN = runId();
const PER_CLIENT = Number(process.env.SIGNIN_EMAILS_PER_IP_15MIN?.trim() || 30);
const hex16 = () => Math.floor(Math.random() * 0x10000).toString(16);
const CLIENT = `2001:db8:${hex16()}:${hex16()}::5`;
const OTHER_CLIENT = `2001:db8:${hex16()}:${hex16()}::6`;

/** Links made for this run's addresses. */
const links = (fragment = RUN) =>
  prisma.verificationToken.count({ where: { identifier: { contains: fragment, mode: "insensitive" } } });

async function askForLink(request: APIRequestContext, email: string, client?: string) {
  const { csrfToken } = await (await request.get("/api/auth/csrf")).json();
  const res = await request.post("/api/auth/signin/resend", {
    form: { email, csrfToken, callbackUrl: "/en" },
    headers: client ? { "x-forwarded-for": client } : {},
    maxRedirects: 0,
  });
  expect(res.status(), `status for ${email}`).toBe(302);
  return res.headers()["location"] ?? "";
}

describe("sign-in emails (D116)", () => {
  test.describe.configure({ mode: "serial" });

  test.afterAll(async () => {
    await prisma.verificationToken.deleteMany({ where: { identifier: { contains: RUN, mode: "insensitive" } } });
    await prisma.$disconnect();
  });

  test('SE-E1 the sign-in form refuses an address with a look-alike "@", says so, and sends nothing', async ({ page }) => {
    for (const lookalike of [`e2e-se-${RUN}@example.org﹫evil.example`, `e2e-se-${RUN}@example.org＠evil.example`]) {
      await page.goto("/en/signin");
      // The browser's own email check would stop it first; the server's is the one tested.
      await page.locator("form").evaluate((form) => form.setAttribute("novalidate", ""));
      await page.getByLabel("Email").fill(lookalike);
      await page.getByRole("button", { name: "Send me a link" }).click();
      await expect(page.locator("form").getByRole("alert")).toHaveText(
        "Enter a valid email address, such as name@example.org."
      );
      await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
      await expect(page).toHaveURL(/\/en\/signin$/);
      await expect(page.getByRole("button", { name: "Send me a link" })).toBeEnabled();
    }
    expect(await links(), "no link made").toBe(0);
  });

  test("SE-E2 Auth.js's own endpoint refuses such addresses too: its error page, no link", async ({ request }) => {
    for (const email of [
      `e2e-se-${RUN}@example.org﹫evil.example`,
      `e2e-se-${RUN}@example.org＠evil.example`,
      `jörg-${RUN}@example.org`,
      `e2e-se-${RUN}\u0007@example.org`,
    ]) {
      expect(await askForLink(request, email), JSON.stringify(email)).toMatch(/\/api\/auth\/error\?error=Configuration$/);
    }
    expect(await links(), "no link made").toBe(0);
  });

  test("SE-E3 (guard) an ordinary address, typed with capitals and spaces, gets its link for the address as normalised", async ({
    page,
  }) => {
    await page.goto("/en/signin");
    await page.getByLabel("Email").fill(`  E2E-SE-${RUN}-Plain@Example.ORG  `);
    await page.getByRole("button", { name: "Send me a link" }).click();
    await expect(page).toHaveURL(/\/en\/signin\/check-email/);
    const made = await prisma.verificationToken.findMany({
      where: { identifier: { contains: `${RUN}-plain`, mode: "insensitive" } },
      select: { identifier: true },
    });
    expect(made.map((t) => t.identifier)).toEqual([`e2e-se-${RUN}-plain@example.org`.toLowerCase()]);
  });

  test("SE-E4 over the per-client limit: no link, the form says to try again later in the page's language, and another client is not held up", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    for (let i = 0; i < PER_CLIENT; i++) {
      expect(await askForLink(request, `e2e-se-${RUN}-c${i}@example.org`, CLIENT), `link ${i + 1}`).toMatch(/verify-request/);
    }
    expect(await links(`${RUN}-c`)).toBe(PER_CLIENT);

    // The next, through Auth.js's endpoint: sent to the sign-in page, no link.
    expect(await askForLink(request, `e2e-se-${RUN}-over@example.org`, CLIENT)).toMatch(/\/en\/signin\?error=rate-limited$/);

    // Through the form, from the same client, in German.
    await page.setExtraHTTPHeaders({ "x-forwarded-for": CLIENT });
    await page.goto("/de/signin");
    await page.getByLabel("E-Mail").fill(`e2e-se-${RUN}-form@example.org`);
    await page.getByRole("button", { name: "Link senden" }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "Zu viele Anfragen für einen Anmeldelink. Bitte warte ein paar Minuten und versuche es dann noch einmal."
    );
    await expect(page).toHaveURL(/\/de\/signin$/);
    await expect(page.getByRole("button", { name: "Link senden" })).toBeEnabled();
    expect(await links(`${RUN}-over`), "no link over the limit").toBe(0);
    expect(await links(`${RUN}-form`), "no link over the limit").toBe(0);

    // The sign-in page Auth.js sends such a request to says it too.
    await page.goto("/en/signin?error=rate-limited");
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "Too many sign-in link requests. Please wait a few minutes and try again."
    );

    // Another client is not held up.
    expect(await askForLink(request, `e2e-se-${RUN}-other@example.org`, OTHER_CLIENT)).toMatch(/verify-request/);
    expect(await links(`${RUN}-other`)).toBe(1);
  });
});
