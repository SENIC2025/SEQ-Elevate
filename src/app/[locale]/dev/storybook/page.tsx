import { setRequestLocale } from "next-intl/server";
import { StorybookGallery } from "@/components/dev/StorybookGallery";
import { assertDevPagesAllowed } from "@/lib/dev-pages";

export const metadata = {
  title: "SEQ Elevate — Component Storybook",
};

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  assertDevPagesAllowed();
  const { locale } = await params;
  setRequestLocale(locale);
  return <StorybookGallery />;
}
