import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getCourse } from "@/lib/cms";
import { getCourseStatus } from "@/lib/cms/course-overlay";
import { hasRole } from "@/lib/auth-helpers";
import type { Locale } from "@/lib/cms/types";
import { CoursePlayer } from "@/components/course/CoursePlayer";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; courseId: string }>;
}): Promise<Metadata> {
  const { locale, courseId } = await params;
  const loc = (["en", "de", "el"].includes(locale) ? locale : "en") as Locale;
  const course = await getCourse("seq-elevate", courseId, loc);
  return { title: course?.title ?? "Course" };
}

/**
 * Course route. Fetches the authored CourseContent from the CMS client
 * (local or strapi, per CMS_SOURCE) server-side and hands it to the
 * generic player. Any published course renders here — no per-course code.
 *
 * An unpublished course is a 404 for learners and guests. Editors and admins
 * still reach it so they can preview a draft before releasing it; the player
 * shows a draft banner so nobody mistakes a preview for the live course.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; courseId: string }>;
}) {
  const { locale, courseId } = await params;
  setRequestLocale(locale);
  const loc = (["en", "de", "el"].includes(locale) ? locale : "en") as Locale;

  const course = await getCourse("seq-elevate", courseId, loc);
  if (!course) notFound();

  // No DB row yet → treat as published (a bundled course that predates seeding).
  const status = await getCourseStatus("seq-elevate", courseId);
  const isDraft = status !== null && status !== "published";
  if (isDraft) {
    const mayPreview =
      (await hasRole("seq-elevate", "ADMIN")) ||
      (await hasRole("seq-elevate", "CONTENT_EDITOR"));
    if (!mayPreview) notFound();
  }

  return <CoursePlayer course={course} draftPreview={isDraft} />;
}
