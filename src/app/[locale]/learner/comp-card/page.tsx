import { setRequestLocale } from "next-intl/server";
import { CompCard } from "@/components/comp-card/CompCard";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CompCard />;
}
