import { setRequestLocale } from "next-intl/server";
import { getViewerRoles } from "@/lib/server-queries";
import { buildSampleAnalytics } from "@/lib/analytics-sample";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, ArrowRight } from "lucide-react";

// Reads the viewer's roles — never prerender.
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const roles = await getViewerRoles();
  const isStaff = roles.includes("FACILITATOR") || roles.includes("ADMIN");

  if (!isStaff) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
          <BarChart3 className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold">Learner statistics</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          This dashboard is for facilitators and admins. Open the demo access
          page and sign in as the Demo Teacher or Stefan to see it.
        </p>
        <Card className="mt-5">
          <CardContent className="p-4">
            <Link href="/demo">
              <Button size="md">
                Demo access
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const data = buildSampleAnalytics();
  return <AnalyticsDashboard data={data} />;
}
