import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPerson } from "./fixtures/people";

/**
 * Release 3 (spec 18.2): what the server lets each person see. FD-E1: the
 * session the browser can read holds only the user's id, email and name,
 * and when it expires (D97).
 *
 * Requires a real database — gated on E2E_DB=1. Every email is unique to
 * the run, and everything the run made is removed afterwards.
 */

const DB = process.env.E2E_DB === "1";
const prisma = DB
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  : (null as unknown as PrismaClient);

const describe = DB ? test.describe : test.describe.skip;
test.describe.configure({ mode: "serial" });

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const LA1 = `e2e-scoping-la1-${RUN}@example.com`;

describe("Release 3 scoping", () => {
  let sessionToken: string;
  let userId: string;

  test.beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: LA1 } });
    ({ userId, sessionToken } = await createPerson(prisma, {
      email: LA1,
      name: `LA1 ${RUN}`,
      roles: ["LEARNER"],
      user: { fontSize: "lg" },
    }));
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: LA1 } });
  });

  test("FD-E1: the session response holds only id, email and name", async ({ request }) => {
    const response = await request.get("/api/auth/session", {
      headers: { Cookie: `authjs.session-token=${sessionToken}` },
    });
    expect(response.status()).toBe(200);
    const raw = await response.text();
    const body = JSON.parse(raw) as { user?: Record<string, unknown>; expires?: unknown };
    expect(Object.keys(body).sort()).toEqual(["expires", "user"]);
    expect(body.user).toEqual({ id: userId, email: LA1, name: `LA1 ${RUN}` });
    expect(typeof body.expires).toBe("string");
    expect(raw).not.toContain(sessionToken);
    expect(raw).not.toMatch(/sessionToken|fontSize|emailVerified|createdAt/);
  });
});
