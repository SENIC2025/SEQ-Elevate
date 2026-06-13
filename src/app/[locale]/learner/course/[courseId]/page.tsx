import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { COURSE_META } from "@/data/course";
import { CoursePlayer } from "@/components/course/CoursePlayer";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; courseId: string }>;
}) {
  const { locale, courseId } = await params;
  setRequestLocale(locale);
  if (courseId !== COURSE_META.id) notFound();
  return <CoursePlayer />;
}
