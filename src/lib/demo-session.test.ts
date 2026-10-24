import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Adapter, AdapterSession, AdapterUser } from "next-auth/adapters";
import { DEMO_SESSION_PREFIX, isDemoSessionToken, refusingDemoSessions } from "./demo-session";

/*
 * Release 3 hardening (SS6, D98): a demo sign-in makes a database session
 * whose token starts with "demo-" (src/app/actions/demo.ts). Wherever demo
 * sign-in isn't allowed (demoLoginAllowed() false: production, or demo
 * sign-in off), such a session resolves to no one, so a demo session left
 * in a database (a branch of production, a restore) can never act there.
 * Every other session resolves as Auth.js's adapter answers it.
 */

const ON = { DEMO_LOGIN_ENABLED: "true", DEMO_ACCESS_CODE: "a-private-code-1" };
const OFF = { DEMO_LOGIN_ENABLED: "", DEMO_ACCESS_CODE: "a-private-code-1" };
const PRODUCTION = { ...ON, VERCEL_ENV: "production" };

const user: AdapterUser = { id: "u-1", email: "stefan@senic.org", emailVerified: null, name: "Stefan" };

// A session's expiry is read from the clock (sessionOf), once by the adapter
// and once for the answer expected. The clock is frozen, so both are the same
// date however long the machine takes between the two reads: a clock that
// moved on by a millisecond in between failed the comparison under load.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T09:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

const sessionOf = (sessionToken: string): AdapterSession => ({
  sessionToken,
  userId: user.id,
  expires: new Date(Date.now() + 86_400_000),
});

/** An adapter that finds every session it is asked for. */
function finding() {
  const getSessionAndUser = vi.fn(async (sessionToken: string) => ({ session: sessionOf(sessionToken), user }));
  const updateSession = vi.fn(async (session: Partial<AdapterSession> & Pick<AdapterSession, "sessionToken">) => ({
    ...sessionOf(session.sessionToken),
    ...session,
  }));
  const deleteSession = vi.fn(async () => undefined);
  const adapter: Adapter = { getSessionAndUser, updateSession, deleteSession };
  return { adapter, getSessionAndUser, updateSession };
}

describe("demo session tokens (SS6)", () => {
  it("names a demo sign-in's token by its prefix, and nothing else", () => {
    expect(DEMO_SESSION_PREFIX).toBe("demo-");
    expect(isDemoSessionToken("demo-6b1f2c1e-0000-4000-8000-000000000000")).toBe(true);
    expect(isDemoSessionToken("8c2f5d1e3b4a")).toBe(false);
    expect(isDemoSessionToken("a-demo-token")).toBe(false);
    expect(isDemoSessionToken(undefined)).toBe(false);
  });
});

describe("refusingDemoSessions (SS6)", () => {
  it("resolves a demo session to no one where demo sign-in is off, without asking the database", async () => {
    const { adapter, getSessionAndUser } = finding();
    const wrapped = refusingDemoSessions(adapter, OFF);
    expect(await wrapped.getSessionAndUser!("demo-abc")).toBeNull();
    expect(getSessionAndUser).not.toHaveBeenCalled();
  });

  it("does the same on production, even with demo sign-in switched on", async () => {
    const { adapter } = finding();
    expect(await refusingDemoSessions(adapter, PRODUCTION).getSessionAndUser!("demo-abc")).toBeNull();
  });

  it("never extends a demo session where demo sign-in is off", async () => {
    const { adapter, updateSession } = finding();
    expect(await refusingDemoSessions(adapter, OFF).updateSession!({ sessionToken: "demo-abc", expires: new Date() })).toBeNull();
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("resolves every other session as the adapter does", async () => {
    const { adapter, getSessionAndUser } = finding();
    const wrapped = refusingDemoSessions(adapter, OFF);
    expect(await wrapped.getSessionAndUser!("8c2f5d1e3b4a")).toEqual({ session: sessionOf("8c2f5d1e3b4a"), user });
    expect(getSessionAndUser).toHaveBeenCalledWith("8c2f5d1e3b4a");
  });

  it("resolves a demo session where demo sign-in is allowed", async () => {
    const { adapter } = finding();
    expect(await refusingDemoSessions(adapter, ON).getSessionAndUser!("demo-abc")).toEqual({
      session: sessionOf("demo-abc"),
      user,
    });
  });

  it("reads the setting on every lookup, not once", async () => {
    const env: Record<string, string> = { ...ON };
    const { adapter } = finding();
    const wrapped = refusingDemoSessions(adapter, env);
    expect(await wrapped.getSessionAndUser!("demo-abc")).not.toBeNull();
    env.DEMO_LOGIN_ENABLED = "";
    expect(await wrapped.getSessionAndUser!("demo-abc")).toBeNull();
  });

  it("keeps the adapter's other methods as they are", () => {
    const { adapter } = finding();
    expect(refusingDemoSessions(adapter, OFF).deleteSession).toBe(adapter.deleteSession);
  });
});
