import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getCourse } from "@/lib/cms";
import type { Locale } from "@/lib/cms/types";
import { CoursePlayer } from "@/components/course/CoursePlayer";

/**
 * Course route. Fetches the authored CourseContent from the CMS client
 * (local or strapi, per CMS_SOURCE) server-side and hands it to the
 * generic player. Any published course renders here — no per-course code.
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

  return <CoursePlayer course={course} />;
}
