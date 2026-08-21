import { setRequestLocale } from "next-intl/server";
import { LandingPage } from "@/components/role/LandingPage";
import { ProductionLanding } from "@/components/ProductionLanding";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // The launch switch (GO-LIVE §2) flips the whole environment to production
  // mode — including the front door. On real prod the home page is the real
  // welcome + magic-link sign-in; demo deploys keep the role-picker shell.
  const production = process.env.DEMO_LOGIN_DISABLED === "true";
  return production ? <ProductionLanding /> : <LandingPage />;
}
