/**
 * Production admin bootstrap (D25). Addresses listed in the ADMIN_EMAILS env
 * var hold ADMIN + CONTENT_EDITOR in the project, so the consortium's admins
 * can manage people and author courses without anyone self-selecting a role.
 *
 * Applied in two places, both idempotent: at sign-in (auth.ts) and on the
 * next page load (auth-helpers getMemberships). The second one matters: adding
 * someone to the list takes effect after a redeploy without making them sign
 * out and back in (D26).
 *
 * Pure apart from reading the env once — no DB access here (see role-grants).
 */

import type { Role } from "@prisma/client";

/** The project the bootstrap roles apply to. */
export const BOOTSTRAP_PROJECT = "seq-elevate";

/** What an ADMIN_EMAILS address receives: manage people + author courses. */
export const BOOTSTRAP_ROLES: readonly Role[] = ["ADMIN", "CONTENT_EDITOR"];

/**
 * Parse an ADMIN_EMAILS value. Accepts comma, semicolon, space or newline
 * separators (people paste lists from Outlook with semicolons), ignores case,
 * and drops anything that isn't an email address.
 */
export function parseAdminEmails(raw: string | null | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@"))
  );
}

// Read once per server instance; an env change on Vercel needs a redeploy anyway.
const ADMIN_EMAILS = parseAdminEmails(process.env.ADMIN_EMAILS);

/** Is this address on the ADMIN_EMAILS allow-list? */
export function isBootstrapAdmin(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.has(email.trim().toLowerCase());
}
