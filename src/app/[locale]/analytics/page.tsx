import { setRequestLocale } from "next-intl/server";
import { getViewerRoles } from "@/lib/server-queries";
import { buildSampleAnalytics } from "@/lib/analytics-sample";
import { buildRealAnalytics } from "@/lib/analytics-real";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, ArrowRight } from "lucide-react";
import type { Locale } from "@/lib/cms/types";

// Reads the viewer's roles + live data — never prerender.
export const dynamic = "force-dynamic";

// On test copies, how many started learners before live data replaces the
// sample. `?live=1` / `?live=0` override. The live site never shows the sample.
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

  const production = process.env.DEMO_LOGIN_DISABLED === "true";
  const roles = await getViewerRoles();
  const isStaff = roles.includes("FACILITATOR") || roles.includes("ADMIN");

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
  const real = await buildRealAnalytics(loc);

  // The live site shows real activity only — or says there is none to show.
  if (production) {
    return real ? (
      <AnalyticsDashboard data={real} isSample={false} />
    ) : (
      <Notice>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          No statistics to show yet. They appear here as soon as a learner
          starts a course. If learners have already started, try reloading the
          page.
        </p>
      </Notice>
    );
  }

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
    />
  );
}

/** Centred message in place of the dashboard. */
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
        <BarChart3 className="h-6 w-6" />
      </div>
      <h1 className="text-xl font-bold">Learner statistics</h1>
      {children}
    </div>
  );
}
