import { notFound } from "next/navigation";
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
  // Test sign-in exists only on test copies; the live site has no such page.
  if (process.env.DEMO_LOGIN_DISABLED === "true") notFound();
  const profiles = DEMO_PROFILES.map(({ id, name, roleLabel, blurb }) => ({
    id,
    name,
    roleLabel,
    blurb,
  }));
  return <DemoAccess profiles={profiles} locale={locale} />;
}
