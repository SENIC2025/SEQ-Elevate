import { setRequestLocale } from "next-intl/server";
import { requireUser, getMemberships } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { AccountView } from "@/components/account/AccountView";
import { UNVERSIONED_TERMS } from "@/lib/profile";
import { LEGACY_VERSION } from "@/data/legal";

// Reads the signed-in user — never prerender at build.
export const dynamic = "force-dynamic";

const PROJECT = "seq-elevate";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const memberships = await getMemberships();

  const [enrollmentsCount, badgesCount, compCard, profile] = await Promise.all([
    prisma.courseEnrollment.count({ where: { userId: user.id } }),
    prisma.userBadge.count({ where: { userId: user.id } }),
    prisma.compCard.findUnique({
      where: { userId_projectId: { userId: user.id, projectId: PROJECT } },
      select: { id: true },
    }),
    // Release 3 (spec 5.7): what the profile step recorded.
    prisma.projectProfile.findUnique({
      where: { userId_projectId: { userId: user.id, projectId: PROJECT } },
      select: {
        country: true,
        termsVersion: true,
        termsAcceptedAt: true,
        ageRule: true,
        ageConfirmedAt: true,
        organisation: { select: { name: true } },
      },
    }),
  ]);

  const projectMemberships = memberships.filter((m) => m.projectId === PROJECT);
  const roles = projectMemberships.map((m) => m.role);
  const projectName = projectMemberships[0]?.project.name ?? "SEQ Elevate";

  return (
    <AccountView
      email={user.email}
      name={user.name}
      memberSince={user.createdAt.toISOString()}
      roles={roles}
      projectName={projectName}
      stats={{
        courses: enrollmentsCount,
        badges: badgesCount,
        compCardStarted: !!compCard,
      }}
      profile={{
        country: profile?.country ?? null,
        organisationName: profile?.organisation?.name ?? null,
        // A version only for counsel's Terms (spec 12.2): a text without
        // one, or written before counsel's (its legal page calls it an
        // interim version, in words), ends the line at the date.
        termsVersion:
          profile?.termsVersion &&
          profile.termsVersion !== UNVERSIONED_TERMS &&
          profile.termsVersion !== LEGACY_VERSION
            ? profile.termsVersion
            : null,
        termsAcceptedAt: profile?.termsAcceptedAt?.toISOString() ?? null,
        ageRule: profile?.ageRule ?? null,
        ageConfirmedAt: profile?.ageConfirmedAt?.toISOString() ?? null,
      }}
    />
  );
}
