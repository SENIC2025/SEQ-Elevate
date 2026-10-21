/**
 * Release 3 (D98, spec 13.8): when one-click demo sign-in may run. It is
 * opt-in, and never on the production deployment:
 *
 *   DEMO_LOGIN_ENABLED=true   and
 *   VERCEL_ENV is not "production"   and
 *   DEMO_ACCESS_CODE is set, at least DEMO_CODE_MIN characters
 *
 * There is no default access code in the code. DEMO_LOGIN_DISABLED is not
 * read here (Release 2 read it; production keeps it set for a rollback).
 * Never enable demo sign-in on a deployment that uses production's database
 * or a branch of it: a demo session is a database row, valid wherever that
 * database is served.
 *
 * Server environment variables, read on every call.
 */

import { timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

/** The shortest access code demo sign-in accepts being configured with. */
export const DEMO_CODE_MIN = 12;

/** The configured access code, or null when it is unset or too short. */
function configuredCode(env: Env): string | null {
  const code = env.DEMO_ACCESS_CODE?.trim() ?? "";
  return code.length >= DEMO_CODE_MIN ? code : null;
}

/** May demo sign-in run on this deployment? */
export function demoLoginAllowed(env: Env = process.env): boolean {
  return (
    env.DEMO_LOGIN_ENABLED?.trim() === "true" &&
    env.VERCEL_ENV?.trim() !== "production" &&
    configuredCode(env) !== null
  );
}

/**
 * Is `code` the configured access code? False whenever demo sign-in isn't
 * allowed, whatever is typed. Compared in constant time.
 */
export function demoCodeMatches(code: unknown, env: Env = process.env): boolean {
  if (!demoLoginAllowed(env) || typeof code !== "string") return false;
  const expected = Buffer.from(configuredCode(env)!);
  const given = Buffer.from(code.trim());
  return given.length === expected.length && timingSafeEqual(given, expected);
}
