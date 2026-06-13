import { setRequestLocale } from "next-intl/server";
import { LearnerDashboard } from "@/components/role/LearnerDashboard";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LearnerDashboard />;
}
