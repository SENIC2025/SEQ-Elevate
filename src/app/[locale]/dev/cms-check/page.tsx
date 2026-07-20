import { setRequestLocale } from "next-intl/server";
import { getCourse, listCourses } from "@/lib/cms";
import { getCMSSource } from "@/lib/cms/provider";
import { probeDbCourses } from "@/lib/cms/db-course";
import type { Locale } from "@/lib/cms/types";

/**
 * Dev verification page: calls the CMS client server-side and renders the
 * resolved content. Proves the active provider (local | strapi) produces
 * valid CourseContent. Route: /[locale]/dev/cms-check
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const loc = (["en", "de", "el"].includes(locale) ? locale : "en") as Locale;

  const sourceLabel =
    getCMSSource() === "strapi"
      ? "source: Strapi (CMS_SOURCE=strapi)"
      : "source: local (bundled content)";

  const summaries = await listCourses("seq-elevate", loc, {
    includeUnpublished: true,
  });
  const course = await getCourse("seq-elevate", "workplace-conflict", loc);
  const dbCourses = await probeDbCourses("seq-elevate");

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 font-mono text-sm">
      <h1 className="text-xl font-bold mb-2">CMS check · {sourceLabel}</h1>
      <p className="text-[var(--muted-foreground)] mb-6">
        Locale: <strong>{loc}</strong> · provider output below proves the
        content client resolves real CourseContent.
      </p>

      <h2 className="font-bold mt-4 mb-1">listCourses()</h2>
      <ul className="mb-6">
        {summaries.map((s) => (
          <li key={s.slug}>
            ✓ {s.slug} — {s.title} ({s.durationMinutes}min, {s.status})
          </li>
        ))}
      </ul>

      <h2 className="font-bold mt-4 mb-1">CMS-created courses (DB)</h2>
      <div className="mb-6">
        {dbCourses.ok ? (
          <p className="text-[var(--success)]">
            ✓ schema OK (Course.meta present) — {dbCourses.count} course
            {dbCourses.count === 1 ? "" : "s"} created in the CMS
          </p>
        ) : (
          <p className="text-[var(--danger)]">
            ✗ DB course path unavailable — migration may not have been applied:{" "}
            {dbCourses.error}
          </p>
        )}
      </div>

      <h2 className="font-bold mt-4 mb-1">getCourse(&quot;workplace-conflict&quot;)</h2>
      {course ? (
        <div className="space-y-1">
          <p>title: {course.title}</p>
          <p>cluster: {course.clusterLabel}</p>
          <p>stages: {course.stages.map((s) => s.key).join(" → ")}</p>
          <p>
            simulation options:{" "}
            {course.stages.find((s) => s.key === "simulation")?.simulation
              ?.options.length ?? 0}
          </p>
          <p>
            scenario root choices:{" "}
            {course.stages.find((s) => s.key === "scenario")?.scenario?.choices
              .length ?? 0}
          </p>
          <p>
            assessment questions:{" "}
            {course.stages.find((s) => s.key === "assessment")?.assessment
              ?.questions.length ?? 0}
          </p>
          <p>badge: {course.badge.name}</p>
        </div>
      ) : (
        <p className="text-[var(--danger)]">getCourse returned null</p>
      )}
    </div>
  );
}
