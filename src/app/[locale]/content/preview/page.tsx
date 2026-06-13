import { setRequestLocale } from "next-intl/server";
import { ContentLivePreview } from "@/components/role/ContentLivePreview";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ContentLivePreview />;
}
