import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AccessNotice } from "@/components/AccessNotice";
import { CourseGrid } from "@/components/course-manager/CourseGrid";
import { viewerCanEditContent } from "@/lib/editor-gate";
import { getCourseGrid } from "@/lib/cms/course-admin";
import { isContentLocale } from "@/lib/cms/course-admin-types";

// Reads the viewer's roles and live course data — never prerender.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  // The page's name only — nothing here depends on the viewer's role.
  const t = await getTranslations({ locale, namespace: "courseManager.grid" });
  return { title: t("title") };
}

/** "Manage courses": every course as a card, drafts included (D33). */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Decide BEFORE loading anything: the grid lists drafts and enrolment
  // counts, which only editors may see.
  if (!(await viewerCanEditContent())) {
    const t = await getTranslations("courseManager.editorsOnly");
    return <AccessNotice title={t("title")}>{t("body")}</AccessNotice>;
  }

  const loc = isContentLocale(locale) ? locale : "en";
  const entries = await getCourseGrid(loc);
  return <CourseGrid entries={entries} locale={loc} />;
}
