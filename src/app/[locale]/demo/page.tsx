import { setRequestLocale } from "next-intl/server";
import { DemoAccess } from "@/components/DemoAccess";
import { DEMO_PROFILES } from "@/lib/demo-profiles";

// Provisions accounts + sets cookies — never prerender.
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const profiles = DEMO_PROFILES.map(({ id, name, roleLabel, blurb }) => ({
    id,
    name,
    roleLabel,
    blurb,
  }));
  const enabled = process.env.DEMO_LOGIN_DISABLED !== "true";
  return <DemoAccess profiles={profiles} locale={locale} enabled={enabled} />;
}
