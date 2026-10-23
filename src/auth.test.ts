import { describe, it, expect, vi, beforeAll } from "vitest";

/*
 * Release 3 (D97, spec 3.1): what the session carries. Auth.js hands the
 * session callback the session row with the whole user row in it; the
 * callback answers only the user's id, email and name, and when the
 * session expires. Roles and organisation are never in it: they are read
 * from the database on every request.
 *
 * NextAuth is replaced by a stand-in that keeps the configuration auth.ts
 * gives it, so the real callback is the one tested.
 */

type Config = {
  adapter: { getSessionAndUser: (sessionToken: string) => Promise<unknown> };
  callbacks: {
    session: (params: Record<string, unknown>) => Promise<unknown> | unknown;
  };
  events: { signIn: (params: Record<string, unknown>) => Promise<void> };
};
const captured: { config?: Config } = {};

vi.mock("next-auth", () => ({
  default: (config: Config) => {
    captured.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/resend", () => ({ default: (options: unknown) => options }));
vi.mock("server-only", () => ({}));
// The database's adapter finds every session it is asked for.
const findSession = vi.fn(async (sessionToken: string) => ({
  session: { sessionToken, userId: "user-1", expires: new Date(Date.now() + 86_400_000) },
  user: { id: "user-1", email: "learner@example.com", emailVerified: null, name: "Lea" },
}));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({ getSessionAndUser: findSession }) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const ensureProjectRoles = vi.fn();
vi.mock("@/lib/role-grants", () => ({ ensureProjectRoles: (...a: unknown[]) => ensureProjectRoles(...a) }));

beforeAll(async () => {
  await import("./auth");
});

const expires = new Date("2026-12-01T10:00:00.000Z");
const userRow = {
  id: "user-1",
  email: "learner@example.com",
  emailVerified: new Date("2026-11-20T09:00:00.000Z"),
  name: "Lea",
  image: "https://example.com/me.png",
  fontSize: "lg",
  dyslexic: true,
  contrast: false,
  lastProjectId: "seq-elevate",
  createdAt: new Date("2026-11-20T09:00:00.000Z"),
  updatedAt: new Date("2026-11-20T09:00:00.000Z"),
};
const sessionRow = { id: "session-1", sessionToken: "secret-token-value", userId: "user-1", expires };

/** What Auth.js passes for a database session (@auth/core lib/actions/session.js). */
const callbackParams = (user = userRow) => ({
  session: { ...sessionRow, user },
  user,
  newSession: undefined,
});

describe("the session callback", () => {
  it("answers exactly { user: { id, email, name }, expires }", async () => {
    const session = await captured.config!.callbacks.session(callbackParams());
    expect(session).toEqual({
      user: { id: "user-1", email: "learner@example.com", name: "Lea" },
      expires,
    });
    expect(Object.keys(session as object).sort()).toEqual(["expires", "user"]);
    expect(Object.keys((session as { user: object }).user).sort()).toEqual(["email", "id", "name"]);
  });

  it("never carries the session token or any other column, even nested", async () => {
    const json = JSON.stringify(await captured.config!.callbacks.session(callbackParams()));
    for (const leak of ["secret-token-value", "sessionToken", "session-1", "fontSize", "lastProjectId", "image", "emailVerified"]) {
      expect(json, leak).not.toContain(leak);
    }
  });

  it("answers a null name as null", async () => {
    const session = await captured.config!.callbacks.session(callbackParams({ ...userRow, name: null as unknown as string }));
    expect(session).toEqual({ user: { id: "user-1", email: "learner@example.com", name: null }, expires });
  });

  it("carries no role or organisation, whatever the user row is given", async () => {
    const withExtras = { ...userRow, roles: ["ADMIN"], organisationId: "org-a", memberships: [{ role: "ADMIN" }] };
    const json = JSON.stringify(await captured.config!.callbacks.session(callbackParams(withExtras)));
    expect(json).not.toMatch(/ADMIN|org-a|roles|memberships|organisation/);
  });
});

describe("the role grant at sign-in", () => {
  it("grants demo profile roles only where demo sign-in is allowed", async () => {
    const grant = async (env: Record<string, string>) => {
      ensureProjectRoles.mockClear();
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      await captured.config!.events.signIn({ user: { id: "u-demo", email: "demo321@seq-elevate.eu" } });
      vi.unstubAllEnvs();
      return [...(ensureProjectRoles.mock.calls[0]?.[2] ?? [])];
    };
    expect(await grant({ DEMO_LOGIN_ENABLED: "true", DEMO_ACCESS_CODE: "a-private-code-1" })).toEqual(["FACILITATOR"]);
    expect(await grant({ DEMO_LOGIN_ENABLED: "", DEMO_ACCESS_CODE: "a-private-code-1" })).toEqual([]);
    expect(
      await grant({ DEMO_LOGIN_ENABLED: "true", DEMO_ACCESS_CODE: "a-private-code-1", VERCEL_ENV: "production" })
    ).toEqual([]);
    // Release 2's switch alone no longer turns it on.
    expect(await grant({ DEMO_LOGIN_DISABLED: "false" })).toEqual([]);
  });
});

describe("the session lookup (SS6)", () => {
  // Release 3 hardening: a demo sign-in's session ("demo-…") resolves to no
  // one wherever demo sign-in isn't allowed, so one left in a database can
  // never act there; every other session is looked up as before.
  const lookUp = async (sessionToken: string, env: Record<string, string>) => {
    findSession.mockClear();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    try {
      return await captured.config!.adapter.getSessionAndUser(sessionToken);
    } finally {
      vi.unstubAllEnvs();
    }
  };
  const ON = { DEMO_LOGIN_ENABLED: "true", DEMO_ACCESS_CODE: "a-private-code-1" };

  it("finds no one for a demo session where demo sign-in is off, or on production", async () => {
    expect(await lookUp("demo-abc", { DEMO_LOGIN_ENABLED: "", DEMO_ACCESS_CODE: "a-private-code-1" })).toBeNull();
    expect(await lookUp("demo-abc", { ...ON, VERCEL_ENV: "production" })).toBeNull();
    expect(findSession).not.toHaveBeenCalled();
  });

  it("finds the person for a demo session where demo sign-in is allowed, and for any other session", async () => {
    expect(await lookUp("demo-abc", ON)).toMatchObject({ user: { id: "user-1" } });
    expect(await lookUp("8c2f5d1e3b4a", { DEMO_LOGIN_ENABLED: "" })).toMatchObject({ user: { id: "user-1" } });
    expect(findSession).toHaveBeenCalledWith("8c2f5d1e3b4a");
  });
});
