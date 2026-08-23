import { setRequestLocale } from "next-intl/server";
import { SignInForm } from "@/components/auth/SignInForm";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { locale } = await params;
  const { callbackUrl } = await searchParams;
  setRequestLocale(locale);
  // Demo link only where demo login is on; hidden on real prod (dead end there).
  const demoEnabled = process.env.DEMO_LOGIN_DISABLED !== "true";
  return (
    <SignInForm
      callbackUrl={callbackUrl ?? `/${locale}/learner`}
      demoEnabled={demoEnabled}
    />
  );
}
