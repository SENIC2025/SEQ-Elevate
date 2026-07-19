import { setRequestLocale } from "next-intl/server";
import { getAdminOrgs } from "@/lib/admin-queries";
import { OrgCohortManager } from "@/components/role/OrgCohortManager";
import { Link } from "@/i18n/navigation";
import { ChevronLeft, ShieldAlert } from "lucide-react";

// Reads the viewer's roles + live data — never prerender.
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const orgs = await getAdminOrgs();

  if (!orgs) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold">Admins only</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Sign in with an admin account to manage organisations and cohorts.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] mb-3"
      >
        <ChevronLeft className="h-4 w-4" />
        Admin
      </Link>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
        Organisations &amp; cohorts
      </h1>
      <p className="mt-1 mb-5 text-sm text-[var(--muted-foreground)]">
        Set up the partner organisations running the programme and the cohorts
        learners belong to.
      </p>
      <OrgCohortManager orgs={orgs} />
    </div>
  );
}
