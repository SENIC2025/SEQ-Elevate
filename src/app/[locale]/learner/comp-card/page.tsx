import { setRequestLocale } from "next-intl/server";
import { CompCard, type SharingContext } from "@/components/comp-card/CompCard";
import { getCurrentUser } from "@/lib/auth-helpers";
import { getCompCardTemplate } from "@/lib/cms";
import type { Locale } from "@/lib/cms/types";
import { prisma } from "@/lib/prisma";
import { effectiveSharing } from "@/lib/comp-card-visibility";

// The Comp Card wording is editable in the CMS, so resolve it per request.
export const dynamic = "force-dynamic";

const PROJECT = "seq-elevate";

/**
 * Whom the signed-in learner may share their Comp Card with (D80): the
 * facilitators of their own organisation, unless they have none, or were
 * invited under the guardian rule without a permission that covers it
 * (spec 5.6). The action checks the same again (setCompCardSharing). And
 * whether the card is shared now, so the page says so before the learner's
 * data has loaded into the store (and if it never does).
 */
async function sharingContext(): Promise<SharingContext> {
  const user = await getCurrentUser();
  if (!user) return { signedIn: false, organisationName: null, blocked: null };
  const where = { userId_projectId: { userId: user.id, projectId: PROJECT } };
  // Unreadable: "Only me", fixed, for now, and no choice shown as made
  // until the store has the card (which still loads).
  const [profile, card] = await Promise.all([
    prisma.projectProfile
      .findUnique({
        where,
        select: {
          ageRule: true,
          guardianSharingConsentAt: true,
          organisationId: true,
          organisation: { select: { name: true } },
        },
      })
      .catch(() => undefined),
    prisma.compCard
      .findUnique({ where, select: { privacy: true, sharedAt: true, sharedWithOrganisationId: true } })
      .catch(() => undefined),
  ]);
  const organisationName = profile?.organisation?.name ?? null;
  const blocked = !organisationName
    ? "no-organisation"
    : profile?.ageRule === "INVITED_WITH_GUARDIAN_CONSENT" && !profile.guardianSharingConsentAt
      ? "guardian-consent-needed"
      : null;
  const sharing = card ? effectiveSharing(card, profile?.organisationId ?? null) : "onlyMe";
  const saved =
    profile === undefined || card === undefined
      ? null
      : { sharing, sharedAt: sharing === "facilitators" ? (card?.sharedAt?.toISOString() ?? null) : null };
  return { signedIn: true, organisationName, blocked, saved };
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const loc = (["en", "de", "el"].includes(locale) ? locale : "en") as Locale;
  const [template, sharing] = await Promise.all([getCompCardTemplate("seq-elevate", loc), sharingContext()]);
  return <CompCard template={template} sharing={sharing} />;
}
