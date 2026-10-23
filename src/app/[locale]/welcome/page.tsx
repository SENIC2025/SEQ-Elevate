import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader } from "@/components/AppHeader";
import { ProfileStepForm, type ProfileStepView } from "@/components/profile/ProfileStepForm";
import { SafeguardingBox } from "@/components/safeguarding/SafeguardingBox";
import { isBootstrapAdmin } from "@/lib/admin-bootstrap";
import { getCurrentUser, getProjectMemberships } from "@/lib/auth-helpers";
import { COUNTRIES, isCountry, type Country } from "@/lib/countries";
import { prisma } from "@/lib/prisma";
import { isProfileComplete, minimumAgeFor, profileRules } from "@/lib/profile";

/**
 * Release 3 (D78, spec 5.4): the profile step, for every signed-in person
 * whose profile isn't complete. The gate (requireCompleteProfile) sends
 * them here from the hub and the workspaces; it is outside every gated
 * segment, so it never sends anyone round in a loop.
 *
 *   signed out          → sign in
 *   profile complete    → the hub
 *   profile unreadable  → the error page (not a redirect: no loop)
 *   otherwise           → the form, with what the profile holds already
 *
 * The header keeps sign-out, the languages and Reading help, without the
 * workspace switcher; the safeguarding box sits after </main> as on the
 * learner pages.
 */

// Reads the signed-in person — never prerendered.
export const dynamic = "force-dynamic";

const PROJECT = "seq-elevate";

/** What the form needs, read from the person's own profile, or "complete". */
async function readStep(userId: string, name: string | null, email: string): Promise<ProfileStepView | "complete"> {
  const rules = profileRules();
  const [profile, mapping, memberships] = await Promise.all([
    prisma.projectProfile.findUnique({
      where: { userId_projectId: { userId, projectId: PROJECT } },
      select: {
        country: true,
        organisationId: true,
        organisationSource: true,
        profileCompletedAt: true,
        termsVersion: true,
        ageConfirmedAt: true,
        consentAt: true,
        guardianConsentRecordedAt: true,
        organisation: { select: { name: true } },
      },
    }),
    prisma.countryMapping.findMany({
      where: { projectId: PROJECT },
      select: { country: true, organisationId: true, organisation: { select: { name: true } } },
    }),
    getProjectMemberships(PROJECT),
  ]);
  if (isProfileComplete({ name }, profile, rules)) return "complete";

  const completed = !!profile?.profileCompletedAt;
  const staff = memberships.some((m) => m.role !== "LEARNER") || isBootstrapAdmin(email);
  const minAge = Object.fromEntries(COUNTRIES.map((c) => [c, minimumAgeFor(c)])) as Record<Country, number>;
  return {
    completed,
    termsChanged: completed && profile?.termsVersion !== rules.termsVersion,
    nameRequired: !name?.trim(),
    country: profile?.country && isCountry(profile.country) ? profile.country : null,
    staff,
    organisation:
      profile?.organisationId && profile.organisation
        ? {
            id: profile.organisationId,
            name: profile.organisation.name,
            byPartnerAdmin: profile.organisationSource === "partner-admin",
          }
        : null,
    // The invited statement only before the first completion, and only
    // where an inviter recorded a guardian's permission (spec 5.6).
    invited: !completed && !!profile?.guardianConsentRecordedAt,
    mapping: Object.fromEntries(
      mapping.map((m) => [m.country, { id: m.organisationId, name: m.organisation.name }])
    ) as ProfileStepView["mapping"],
    minAge,
    consent: rules.consent,
    consentGiven: !!profile?.consentAt,
    consentMissing: rules.consent === "required" && !profile?.consentAt,
  };
}

/** The page's own title: its heading, in the page's language (WCAG 2.4.2). */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "profile" });
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/signin`);
  // A failed read is thrown: the error page, never a redirect.
  const step = await readStep(user.id, user.name, user.email);
  if (step === "complete") redirect(`/${locale}`);
  return (
    <div className="flex-1 flex flex-col">
      <AppHeader showWorkspaces={false} />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <ProfileStepForm view={step} />
      </main>
      <SafeguardingBox />
    </div>
  );
}
