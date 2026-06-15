import { setRequestLocale } from "next-intl/server";
import { ContentEditor } from "@/components/role/ContentEditor";
import { listCourses } from "@/lib/cms";
import type { Locale } from "@/lib/cms/types";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const loc = (["en", "de", "el"].includes(locale) ? locale : "en") as Locale;
  const courses = await listCourses("seq-elevate", loc);
  const courseOptions = courses
    .filter((c) => !c.comingSoon)
    .map((c) => ({ slug: c.slug, title: c.title }));
  return <ContentEditor courses={courseOptions} />;
}
