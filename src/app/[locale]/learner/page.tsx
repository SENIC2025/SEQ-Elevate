import { setRequestLocale } from "next-intl/server";
import { listCourses } from "@/lib/cms";
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
  const courses = await listCourses("seq-elevate", loc);
  return <LearnerDashboard courses={courses} />;
}
