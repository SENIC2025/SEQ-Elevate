import { setRequestLocale } from "next-intl/server";
import { StorybookGallery } from "@/components/dev/StorybookGallery";

export const metadata = {
  title: "SEQ Elevate — Component Storybook",
};

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <StorybookGallery />;
}
