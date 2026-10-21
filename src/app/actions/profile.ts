"use server";

/**
 * Release 3 (D78, D79, D101, spec 5.4): the profile step's action. The
 * signed-in person completes their own profile; nothing here takes whose
 * profile it is from the request.
 *
 * Two modes, chosen from the stored profile (parseProfileInput):
 * - the first completion stores the country, the Terms (version and time),
 *   the age rule (the invited statement only where an inviter recorded a
 *   guardian's permission), the consent when asked for, and the time;
 * - later calls (a new Terms version, consent becoming required, a blank
 *   name) store only the Terms, the consent and a name while none is
 *   stored. Country, age rule and organisation sent again change nothing:
 *   only an admin changes them (Q24).
 *
 * The organisation, on the first completion only, and only for someone who
 * holds no staff role (D101; through setPersonOrganisation, the one writer):
 *   none yet                       the one the country maps to (none when
 *                                  the country isn't mapped)
 *   set by an ADMIN (or backfill)  kept, whatever the country
 *   set by a partner admin, and    released (none), for an ADMIN to confirm
 *   the country maps elsewhere     or move: a partner admin who added an
 *                                  address in advance can't keep a learner
 *                                  who takes part in another country
 * Staff organisations are never touched by the country.
 *
 * The learner membership is made here, once the profile is complete, for
 * someone who holds no role at all and isn't on ADMIN_EMAILS (the rule of
 * learner-membership.ts; D79: not by the browser before the profile step).
 *
 * The profile row is made if there is none and locked for the whole
 * transaction, as a partner admin's claim of the same account does
 * (admin.ts addMember), so the two are decided one after the other.
 * Answers, never throws, a refusal.
 */

import { getCurrentUser } from "@/lib/auth-helpers";
import { isBootstrapAdmin } from "@/lib/admin-bootstrap";
import { isCountry } from "@/lib/countries";
import { needsLearnerMembership } from "@/lib/learner-membership";
import { setPersonOrganisation } from "@/lib/person-organisation";
import { prisma } from "@/lib/prisma";
import {
  isProfileComplete,
  parseProfileInput,
  profileRules,
  type ProfileError,
  type ProfileField,
} from "@/lib/profile";
import { CONSENT_VERSION } from "@/lib/r3-switches";
import type { Prisma } from "@prisma/client";

const PROJECT = "seq-elevate";

/** What the profile step answers: per field, so the form can say what to fix. */
export type CompleteProfileResult =
  | { ok: true }
  | { ok: false; errors: Partial<Record<ProfileField, ProfileError>> }
  | { ok: false; error: "signed-out" };

/** A submission the stored profile refuses: the transaction rolls back (nothing made or locked stays). */
class Refused extends Error {
  constructor(readonly errors: Partial<Record<ProfileField, ProfileError>>) {
    super("refused");
  }
}

/**
 * Completes the signed-in person's profile step, or stores a new Terms
 * acceptance, a consent or a name (see the top of this file). `{ ok: true }`
 * also when there was nothing left to store.
 */
export async function completeProfile(input: unknown): Promise<CompleteProfileResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "signed-out" };
  const rules = profileRules();
  const where = { userId_projectId: { userId: user.id, projectId: PROJECT } };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.projectProfile.createMany({ data: [{ userId: user.id, projectId: PROJECT }], skipDuplicates: true });
      await tx.$queryRaw`SELECT 1 FROM "ProjectProfile" WHERE "userId" = ${user.id} AND "projectId" = ${PROJECT} FOR UPDATE`;
      const stored = await tx.projectProfile.findUnique({
        where,
        select: {
          id: true,
          country: true,
          organisationId: true,
          organisationSource: true,
          profileCompletedAt: true,
          termsVersion: true,
          ageConfirmedAt: true,
          consentVersion: true,
          consentAt: true,
          guardianConsentRecordedAt: true,
        },
      });
      // Read again under the lock: a people manager may have named them meanwhile.
      const person = await tx.user.findUnique({ where: { id: user.id }, select: { name: true, email: true } });
      if (!stored || !person) throw new Error("The profile just made can't be read");

      const completed = stored.profileCompletedAt !== null;
      const parsed = parseProfileInput(input, {
        completed,
        nameRequired: !person.name?.trim(),
        termsCurrent: stored.termsVersion === rules.termsVersion,
        guardianConsentRecorded: stored.guardianConsentRecordedAt !== null,
        consent: rules.consent,
      });
      if (!parsed.ok) throw new Refused(parsed.errors);
      const value = parsed.value;
      const now = new Date();

      const data: Prisma.ProjectProfileUpdateInput = {};
      if (!completed) {
        Object.assign(data, {
          country: value.country,
          termsVersion: rules.termsVersion,
          termsAcceptedAt: now,
          ageRule: value.age === "invited" ? "INVITED_WITH_GUARDIAN_CONSENT" : "SELF_MIN_AGE",
          ageConfirmedAt: now,
          profileCompletedAt: now,
        });
      } else if (stored.termsVersion !== rules.termsVersion && value.termsAccepted) {
        Object.assign(data, { termsVersion: rules.termsVersion, termsAcceptedAt: now });
      }
      if (value.consent === true && (stored.consentAt === null || stored.consentVersion !== CONSENT_VERSION)) {
        Object.assign(data, { consentVersion: CONSENT_VERSION, consentAt: now });
      } else if (value.consent === false && stored.consentAt !== null) {
        // Unticked on the form, which shows a given consent ticked: withdrawn.
        Object.assign(data, { consentVersion: null, consentAt: null });
      }
      const name = value.name;
      if (name !== undefined) await tx.user.update({ where: { id: user.id }, data: { name } });
      if (Object.keys(data).length > 0) await tx.projectProfile.update({ where, data });
      if (name === undefined && Object.keys(data).length === 0) return;

      const roles = (
        await tx.membership.findMany({ where: { userId: user.id, projectId: PROJECT }, select: { role: true } })
      ).map((m) => m.role);
      const staff = roles.some((r) => r !== "LEARNER") || isBootstrapAdmin(person.email);

      if (!completed && !staff && isCountry(value.country)) {
        const mapped = await tx.countryMapping.findUnique({
          where: { projectId_country: { projectId: PROJECT, country: value.country } },
          select: { organisationId: true },
        });
        const mappedTo = mapped?.organisationId ?? null;
        if (stored.organisationId === null) {
          if (mappedTo) await setPersonOrganisation(tx, user.id, mappedTo, { actorId: null, source: "country" });
        } else if (stored.organisationSource === "partner-admin" && mappedTo !== stored.organisationId) {
          await setPersonOrganisation(tx, user.id, null, { actorId: null, source: "released" });
          await tx.auditLog.create({
            data: {
              projectId: PROJECT,
              actorId: user.id,
              action: "profile.organisation_released",
              entity: "ProjectProfile",
              entityId: stored.id,
            },
          });
        }
      }

      const complete = isProfileComplete(
        { name: name ?? person.name },
        {
          country: value.country ?? stored.country,
          termsVersion: (data.termsVersion as string | undefined) ?? stored.termsVersion,
          ageConfirmedAt: completed ? stored.ageConfirmedAt : now,
          consentAt: "consentAt" in data ? (data.consentAt as Date | null) : stored.consentAt,
        },
        rules
      );
      if (complete && needsLearnerMembership(roles, { bootstrapAdmin: isBootstrapAdmin(person.email) })) {
        await tx.membership.createMany({
          data: [{ userId: user.id, projectId: PROJECT, role: "LEARNER" }],
          skipDuplicates: true,
        });
      }

      await tx.auditLog.create({
        data: {
          projectId: PROJECT,
          actorId: user.id,
          action: "profile.completed",
          entity: "ProjectProfile",
          entityId: stored.id,
        },
      });
    });
  } catch (e) {
    if (e instanceof Refused) return { ok: false, errors: e.errors };
    throw e;
  }
  return { ok: true };
}
