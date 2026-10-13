"use client";

import { useTranslations } from "next-intl";
import { FilePenLine, Plus } from "lucide-react";
import type { LessonOutline } from "@/lib/cms/course-admin-types";
import type { Locale, StageKey } from "@/lib/cms/types";

/**
 * Jump links to every lesson, in learner order, with the lesson's own title
 * in the content language — plus, on a created course, "Add guided practice
 * / an applied scenario / a quick check" for the practice lessons it doesn't
 * have yet (named as learners will see them in the list). A lesson with an
 * unsaved-for-learners draft says "Draft" in words. Sticks beside the
 * lessons on wide screens.
 */
export function LessonNav({
  lessons,
  lang,
  lessonLabel,
  onAdd,
}: {
  lessons: LessonOutline[];
  lang: Locale;
  lessonLabel: (key: StageKey) => string;
  onAdd: (key: StageKey) => void;
}) {
  const t = useTranslations("courseManager.page");
  const tDraft = useTranslations("exerciseEditor.page");
  const draftMark = (
    <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full border border-dashed border-[var(--warning)] px-1.5 text-[10px] font-medium text-[var(--foreground)]">
      <FilePenLine className="h-3 w-3" aria-hidden />
      {tDraft("navDraft")}
    </span>
  );

  return (
    <nav
      aria-label={t("lessonsNav")}
      className="mb-6 lg:sticky lg:top-20 lg:mb-0 lg:max-h-[calc(100vh_-_6rem)] lg:self-start lg:overflow-y-auto"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        {t("lessonsNav")}
      </p>
      {/* Wrapping chips on small screens, a list beside the lessons on wide ones. */}
      <ol className="flex flex-wrap gap-1.5 text-sm lg:block lg:space-y-1">
        {lessons.map((lesson) => {
          if (lesson.addable) {
            const key = lesson.key as "simulation" | "scenario" | "assessment";
            return (
              <li key={lesson.key}>
                <button
                  type="button"
                  onClick={() => onAdd(lesson.key)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[var(--accent)]/40 px-3 py-1.5 text-left text-[var(--accent)] hover:bg-[var(--surface-muted)] lg:w-full lg:rounded-md lg:border-0 lg:px-2"
                >
                  <Plus className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                  {t(`addStage.${key}`)}
                  {lesson.draft ? draftMark : null}
                </button>
              </li>
            );
          }
          const title = lesson.byLang[lang].stage?.title;
          return (
            <li key={lesson.key}>
              <a
                href={`#lesson-${lesson.key}`}
                className="block rounded-full border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--surface-muted)] lg:rounded-md lg:border-0 lg:px-2"
              >
                <span className="font-medium">{lessonLabel(lesson.key)}</span>
                {lesson.draft ? draftMark : null}
                {title ? (
                  <span className="hidden truncate text-xs text-[var(--muted-foreground)] lg:block">
                    {title}
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
