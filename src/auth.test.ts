import { describe, it, expect, vi, beforeAll } from "vitest";

/*
 * What the session carries. Auth.js hands the session callback the session
 * row with the whole user row in it; the callback answers only the user's
 * id, email and name, and when the session expires. Roles and organisation
 * are never in it: they are read from the database on every request.
 *
 * NextAuth is replaced by a stand-in that keeps the configuration auth.ts
 * gives it, so the real callback is the one tested.
 */

type Config = {
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
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/role-grants", () => ({ ensureProjectRoles: vi.fn() }));

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
