import { setRequestLocale } from "next-intl/server";
import { listCourses } from "@/lib/cms";
import { getLearnerEnrollments } from "@/lib/server-queries";
import type { Locale } from "@/lib/cms/types";
import { LearnerDashboard } from "@/components/role/LearnerDashboard";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const loc = (["en", "de", "el"].includes(locale) ? locale : "en") as Locale;
  const [courses, enrollments] = await Promise.all([
    listCourses("seq-elevate", loc),
    getLearnerEnrollments(),
  ]);
  return <LearnerDashboard courses={courses} enrollments={enrollments} />;
}
