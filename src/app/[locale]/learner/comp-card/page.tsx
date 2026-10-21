import { setRequestLocale } from "next-intl/server";
import { CompCard, type SharingContext } from "@/components/comp-card/CompCard";
import { getCurrentUser } from "@/lib/auth-helpers";
import { getCompCardTemplate } from "@/lib/cms";
import type { Locale } from "@/lib/cms/types";
import { prisma } from "@/lib/prisma";

// The Comp Card wording is editable in the CMS, so resolve it per request.
export const dynamic = "force-dynamic";

const PROJECT = "seq-elevate";

/**
 * Whom the signed-in learner may share their Comp Card with (D80): the
 * facilitators of their own organisation, unless they have none, or were
 * invited under the guardian rule without a permission that covers it
 * (spec 5.6). The action checks the same again (setCompCardSharing).
 */
async function sharingContext(): Promise<SharingContext> {
  const user = await getCurrentUser();
  if (!user) return { signedIn: false, organisationName: null, blocked: null };
  // Unreadable: "Only me", fixed, for now (the card itself still loads).
  const profile = await prisma.projectProfile
    .findUnique({
      where: { userId_projectId: { userId: user.id, projectId: PROJECT } },
      select: { ageRule: true, guardianSharingConsentAt: true, organisation: { select: { name: true } } },
    })
    .catch(() => null);
  const organisationName = profile?.organisation?.name ?? null;
  const blocked = !organisationName
    ? "no-organisation"
    : profile?.ageRule === "INVITED_WITH_GUARDIAN_CONSENT" && !profile.guardianSharingConsentAt
      ? "guardian-consent-needed"
      : null;
  return { signedIn: true, organisationName, blocked };
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
