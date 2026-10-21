"use server";

/**
 * Release 3 (D93, spec 11.2; SP36): saving the safeguarding contacts of
 * /admin/safeguarding. An ADMIN with project scope only (the ADMIN role and
 * a complete profile of their own); partner admins don't edit them, not
 * even their own country's. Up to three contacts per country, every field
 * checked (lib/safeguarding.ts); a refused save writes nothing and says,
 * per country, entry and field, what to change.
 *
 * Audited as `safeguarding.saved` with the countries whose contacts
 * changed, never the contacts: they are staff's details and stay out of
 * the log. A save that changes nothing writes nothing.
 */

import { prisma } from "@/lib/prisma";
import { requireAdminProject } from "@/lib/scope";
import {
  changedCountries,
  parseSafeguarding,
  validateSafeguarding,
  type SafeguardingSetting,
  type SaveSafeguardingResult,
} from "@/lib/safeguarding";

const PROJECT = "seq-elevate";

/** Replaces every country's contacts with `contacts` ({ DE: [...], ... }; a country left out has none). */
export async function saveSafeguardingContacts(contacts: unknown): Promise<SaveSafeguardingResult> {
  const admin = await requireAdminProject();
  if (!admin?.user) return { ok: false, error: "forbidden" };
  const checked = validateSafeguarding(contacts);
  if (!checked.ok) {
    return checked.errors.length ? { ok: false, error: "invalid", errors: checked.errors } : { ok: false, error: "bad-input" };
  }
  return prisma.$transaction(async (tx) => {
    const stored = await tx.project.findUnique({ where: { id: PROJECT }, select: { safeguarding: true } });
    const before = parseSafeguarding(stored?.safeguarding ?? null);
    const changed = changedCountries(before.contacts, checked.contacts);
    if (!changed.length) return { ok: true as const, setting: before, changed };
    const setting: SafeguardingSetting = { v: 1, contacts: checked.contacts, updatedAt: new Date().toISOString() };
    await tx.project.update({ where: { id: PROJECT }, data: { safeguarding: setting as object } });
    await tx.auditLog.create({
      data: {
        projectId: PROJECT,
        actorId: admin.user!.id,
        action: "safeguarding.saved",
        entity: "Project",
        entityId: PROJECT,
        metadata: { countries: changed },
      },
    });
    return { ok: true as const, setting, changed };
  });
}
