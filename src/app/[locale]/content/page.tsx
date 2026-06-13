import { setRequestLocale } from "next-intl/server";
import { ContentEditor } from "@/components/role/ContentEditor";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ContentEditor />;
}
