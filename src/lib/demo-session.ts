/**
 * Release 3 hardening (SS6, D98): demo sessions resolve to no one wherever
 * demo sign-in isn't allowed.
 *
 * A demo sign-in (src/app/actions/demo.ts) makes a database session whose
 * token starts with DEMO_SESSION_PREFIX. A session row is valid wherever its
 * database is served, so one left in a database that a deployment without
 * demo sign-in serves (production, a branch of it, a restore) would still
 * sign someone in there. Auth.js looks every session up through its
 * adapter's getSessionAndUser (pages, server actions, route handlers and
 * /api/auth/session alike); refusingDemoSessions answers "no session" for a
 * demo token there whenever demoLoginAllowed() is false, read on every
 * lookup, and never extends one. Auth.js then treats the cookie as signed
 * out. Every other session is looked up as before. The go-live clean-up run
 * still deletes the rows themselves (account-data.ts).
 */

import type { Adapter } from "next-auth/adapters";
import { demoLoginAllowed } from "@/lib/demo-gate";

type Env = Record<string, string | undefined>;

/** The start of every demo sign-in's session token. */
export const DEMO_SESSION_PREFIX = "demo-";

/** Is `token` a demo sign-in's session token? */
export function isDemoSessionToken(token: unknown): boolean {
  return typeof token === "string" && token.startsWith(DEMO_SESSION_PREFIX);
}

/**
 * `adapter`, with a demo session found by no one and extended never while
 * demo sign-in isn't allowed under `env` (read on every call).
 */
export function refusingDemoSessions<A extends Adapter>(adapter: A, env: Env = process.env): A {
  const refused = (token: unknown) => isDemoSessionToken(token) && !demoLoginAllowed(env);
  const { getSessionAndUser, updateSession } = adapter;
  return {
    ...adapter,
    ...(getSessionAndUser
      ? {
          getSessionAndUser: (sessionToken: string) =>
            refused(sessionToken) ? null : getSessionAndUser.call(adapter, sessionToken),
        }
      : {}),
    ...(updateSession
      ? {
          updateSession: (session: Parameters<NonNullable<Adapter["updateSession"]>>[0]) =>
            refused(session.sessionToken) ? null : updateSession.call(adapter, session),
        }
      : {}),
  };
}
