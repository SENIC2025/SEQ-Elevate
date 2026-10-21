import { setRequestLocale } from "next-intl/server";
import { getViewer } from "@/lib/scope";
import { canSupportLearners, seesWholeProject } from "@/lib/permissions";
import { demoLoginAllowed } from "@/lib/demo-gate";
import { statsFrom } from "@/lib/stats-from";
import { buildSampleAnalytics } from "@/lib/analytics-sample";
import { buildRealAnalytics } from "@/lib/analytics-real";
import { scopeOrganisationName } from "@/lib/server-queries";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { countingDay, emptyStatistics } from "@/components/analytics/counting";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, ArrowRight } from "lucide-react";
import type { Locale } from "@/lib/cms/types";

// Reads the viewer's roles + live data — never prerender.
export const dynamic = "force-dynamic";

// On test copies (demo sign-in allowed, D98), how many started learners
// before live data replaces the sample. `?live=1` / `?live=0` override
// (`?live=1` with no live data says why, as the live site does). Anywhere
// else, the live site included, the sample is never shown. Nothing in the
// address changes the date the figures count from (spec 7.5).
const MIN_LIVE_TEST_COPY = 5;

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ live?: string }>;
}) {
  const { locale } = await params;
  const { live } = await searchParams;
  setRequestLocale(locale);

  const production = !demoLoginAllowed();
  // Facilitators, partner admins and admins; whose learners is the scope's
  // to say (D74): an ADMIN the project, partner staff their organisation.
  const viewer = await getViewer();
  const isStaff = canSupportLearners(viewer.roles);

  if (!isStaff) {
    return (
      <Notice>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {production
            ? "This dashboard is for facilitators and admins. Ask your project administrator to grant you access."
            : "This dashboard is for facilitators and admins. On this test copy, use test sign-in and pick a facilitator or admin account."}
        </p>
        {production ? null : (
          <Card className="mt-5">
            <CardContent className="p-4">
              <Link href="/demo">
                <Button size="md">
                  Test sign-in
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </Notice>
    );
  }

  const loc = (["en", "de", "el"].includes(locale) ? locale : "en") as Locale;
  // Counted from STATS_FROM (spec 7.3): the figures and what the page says
  // of them use the same date.
  const from = statsFrom();
  const [read, organisation] = await Promise.all([
    buildRealAnalytics(viewer.scope, loc, from),
    scopeOrganisationName(viewer.scope),
  ]);
  const unreadable = read === "unreadable";
  const real = unreadable ? null : read;
  const counting = { from: from ? countingDay(from) : null, organisation };

  // No figures: say why — the account isn't linked to an organisation (as
  // the facilitator page does), it may see no learners for now, the read
  // failed, counting hasn't started, or no learner (of the organisation) has
  // started since.
  const empty = (
    <Notice>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        {emptyStatistics({
          from,
          organisation,
          noOrganisation: !seesWholeProject(viewer.roles) && !viewer.profile?.organisationId,
          noScope: viewer.scope.kind === "none",
          unreadable,
        })}
      </p>
    </Notice>
  );

  // The live site shows real activity only — or says why there is none.
  if (production) {
    return real ? <AnalyticsDashboard data={real} isSample={false} counting={counting} /> : empty;
  }
  if (!real && live === "1") return empty;

  const useReal =
    real !== null &&
    (live === "1" || (live !== "0" && real.cohortSize >= MIN_LIVE_TEST_COPY));
  const data = useReal ? real! : buildSampleAnalytics();

  return (
    <AnalyticsDashboard
      data={data}
      isSample={!useReal}
      realCount={real?.cohortSize ?? 0}
      sampleAvailable
      counting={counting}
    />
  );
}

/** Centred message in place of the dashboard: English, as the dashboard is, whatever the page's language. */
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div lang="en" className="mx-auto max-w-md px-4 py-16 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
        <BarChart3 className="h-6 w-6" />
      </div>
      <h1 className="text-xl font-bold">Learner statistics</h1>
      {children}
    </div>
  );
}
