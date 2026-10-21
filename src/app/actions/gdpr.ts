"use server";

/**
 * GDPR self-service: a person deletes their own account (Art. 17). Their
 * data export (Art. 15 and 20) is the /api/me/export route.
 *
 * Deleting is eraseAccount (src/lib/account-data.ts), in one transaction:
 * the account and everything linked to it go, with the person's activity
 * records, sign-in links and rate-limit counters; other log rows about them
 * lose the link to them; one record that an account was deleted keeps its
 * id, without a name or an address, so the erasure can be applied again
 * after a restore from backup (D86). Notes they wrote as staff stay,
 * unsigned (D89).
 */

import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { eraseAccount } from "@/lib/account-data";

/**
 * Permanently delete the current user's account and all their personal data,
 * once they have typed their own address to confirm.
 */
export async function deleteMyAccount(confirmEmail: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "not-authenticated" };
  // Defence in depth: the UI already requires this, but never delete on a
  // mismatched confirmation.
  if (typeof confirmEmail !== "string" || confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    return { ok: false as const, error: "confirmation-mismatch" };
  }

  await prisma.$transaction((tx) => eraseAccount(tx, user.id, { by: "self" }));

  // Clear the session cookie ourselves rather than calling NextAuth signOut:
  // the cascade already deleted the Session row, so signOut's adapter would
  // throw (record-not-found) and log a SignOutError. Deleting the cookie here
  // signs the user out cleanly without that noise. Cover both the plain and
  // the Secure-prefixed cookie names (the latter is used over HTTPS).
  const jar = await cookies();
  jar.delete("authjs.session-token");
  jar.delete("__Secure-authjs.session-token");
  return { ok: true as const };
}
