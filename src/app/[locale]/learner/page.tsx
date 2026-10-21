import { setRequestLocale } from "next-intl/server";
import { learnerCatalogue } from "@/lib/cms/learner-catalogue";
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
  // Each course in the language the learner gets it in (D90): a created
  // course whose language isn't switched on yet is listed in English.
  const [courses, enrollments] = await Promise.all([
    learnerCatalogue("seq-elevate", loc),
    getLearnerEnrollments(),
  ]);
  return <LearnerDashboard courses={courses} enrollments={enrollments} />;
}
