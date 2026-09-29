import { getTranslations } from "next-intl/server";
import { CourseCard } from "./CourseCard";
import { NewCourseCard } from "./NewCourseCard";
import type { CourseGridEntry } from "@/lib/cms/course-admin-types";
import type { Locale } from "@/lib/cms/types";

/**
 * "Manage courses": every course (drafts and archived included) as a card,
 * in catalogue order, after a "New course" card. The page gates on the
 * editor role before loading `entries`.
 */
export async function CourseGrid({
  entries,
  locale,
}: {
  entries: CourseGridEntry[];
  locale: Locale;
}) {
  const t = await getTranslations("courseManager.grid");

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
        {t("title")}
      </h1>
      <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
        {t("subtitle")}
      </p>
      {entries.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--muted-foreground)]">
          {t("empty")}
        </p>
      ) : null}

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Renders its own <li>, so it can widen to the full row when open. */}
        <NewCourseCard locale={locale} />
        {entries.map((entry) => (
          <li key={entry.slug}>
            <CourseCard entry={entry} locale={locale} />
          </li>
        ))}
      </ul>
    </div>
  );
}
