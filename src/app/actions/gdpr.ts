"use server";

/**
 * GDPR self-service. A learner can export everything we hold about them
 * (Art. 15 right of access / Art. 20 portability) and delete their account
 * (Art. 17 right to erasure). Deleting cascades away all personal data; the
 * AuditLog keeps an *anonymised* record (its actorId is SetNull on delete),
 * so the legal trail survives without the PII.
 */

import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

const FALLBACK_PROJECT = "seq-elevate";

/** Record that the current user exported their data (for the audit trail). */
export async function logDataExport() {
  const user = await getCurrentUser();
  if (!user) return;
  await prisma.auditLog.create({
    data: {
      projectId: user.lastProjectId ?? FALLBACK_PROJECT,
      actorId: user.id,
      action: "account.exported",
      entity: "User",
      entityId: user.id,
      metadata: { selfService: true },
    },
  });
}

/**
 * Permanently delete the current user's account and all their personal data.
 * Writes an audit record first; the cascade then anonymises it (actorId →
 * null) while keeping the row. Returns true on success.
 */
export async function deleteMyAccount(confirmEmail: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "not-authenticated" };
  // Defence in depth: the UI already requires this, but never delete on a
  // mismatched confirmation.
  if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    return { ok: false as const, error: "confirmation-mismatch" };
  }

  await prisma.auditLog.create({
    data: {
      projectId: user.lastProjectId ?? FALLBACK_PROJECT,
      actorId: user.id,
      action: "account.deleted",
      entity: "User",
      entityId: user.id,
      metadata: { selfService: true },
    },
  });
  await prisma.user.delete({ where: { id: user.id } });

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
