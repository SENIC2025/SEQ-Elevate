import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AccessNotice } from "@/components/AccessNotice";
import { CourseWorkspace } from "@/components/course-manager/CourseWorkspace";
import type { TimeLabel } from "@/components/course-manager/CourseHeader";
import { editedAgo, editedAt } from "@/components/course-manager/edited-time";
import { viewerCanEditContent } from "@/lib/editor-gate";
import { getCourseOutline } from "@/lib/cms/course-admin";
import { isContentLocale } from "@/lib/cms/course-admin-types";
import { isSectionId } from "@/lib/cms/sections/contract";
import type { Locale } from "@/lib/cms/types";

// Reads the viewer's roles and live course data — never prerender.
export const dynamic = "force-dynamic";

// Loaded once per request, shared by the metadata and the page.
const loadOutline = cache((slug: string) => getCourseOutline(slug));

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const uiLocale = (locale: string): Locale =>
  isContentLocale(locale) ? locale : "en";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: "courseManager" });
  // null for anyone but an editor, so a draft's title never reaches them.
  const outline = await loadOutline(slug);
  return {
    title: outline
      ? t("page.metaTitle", { title: outline.copy[uiLocale(locale)].title })
      : t("grid.title"),
  };
}

/**
 * One course's page in "Manage courses" (D33): its title and subtitle per
 * language, every lesson with its editors, preview and publishing.
 *
 * ?lang=en|de|el picks the content language (default: the page's language);
 * ?lesson=<lesson id> (a stage key, or "s-…" for a lesson of a created
 * course's own, while it is in the course) opens that lesson and scrolls to
 * it. Anything else in either is ignored.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{
    lesson?: string | string[];
    lang?: string | string[];
  }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  // Decide BEFORE loading anything: the outline holds drafts, draft
  // documents and enrolment counts, which only editors may see.
  if (!(await viewerCanEditContent())) {
    const t = await getTranslations("courseManager.editorsOnly");
    return <AccessNotice title={t("title")}>{t("body")}</AccessNotice>;
  }

  const outline = await loadOutline(slug);
  if (!outline) notFound();

  const sp = await searchParams;
  const lang = one(sp.lang);
  const lesson = one(sp.lesson);
  const loc = uiLocale(locale);

  return (
    <CourseWorkspace
      outline={outline}
      initialLang={isContentLocale(lang) ? lang : loc}
      initialLesson={
        isSectionId(lesson) && outline.lessons.some((l) => l.key === lesson)
          ? lesson
          : undefined
      }
      lastEdited={timeLabel(outline.lastEdited, loc)}
    />
  );
}

/**
 * "Last edited 3 days ago" plus the exact time, in the same wording as the
 * course cards, formatted here on the server so the client renders the same
 * text it hydrates (no clock mismatch).
 */
function timeLabel(iso: string | null, locale: Locale): TimeLabel | null {
  if (!iso) return null;
  const relative = editedAgo(iso, locale);
  const absolute = editedAt(iso, locale);
  return relative && absolute ? { iso, relative, absolute } : null;
}
