import { setRequestLocale } from "next-intl/server";
import { FacilitatorWorkspace } from "@/components/role/FacilitatorWorkspace";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <FacilitatorWorkspace />;
}
