"use client";

import { useTranslations } from "next-intl";
import { Link, getPathname } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import type {
  CourseKind,
  CourseStatus,
  LanguageCoverage,
  ReadinessIssue,
} from "@/lib/cms/course-admin-types";
import type { Locale, StageKey } from "@/lib/cms/types";
import { ContentLanguageSwitch } from "./ContentLanguageSwitch";
import { PublishControls } from "./PublishControls";
import {
  Archive,
  ChevronLeft,
  ExternalLink,
  PenLine,
  Radio,
} from "lucide-react";

/** A time as the server formatted it — relative for reading, exact on hover. */
export interface TimeLabel {
  iso: string;
  relative: string;
  absolute: string;
}

const NOTE_ICON = { published: Radio, draft: PenLine, archived: Archive };

// Stands in for {when} so the translated sentence keeps its own word order
// around the <time> element (an ICU argument can't be an element).
const WHEN = "\u2063when\u2063";

function LastEdited({ template, time }: { template: string; time: TimeLabel }) {
  const [before, after = ""] = template.split(WHEN);
  return (
    <>
      {before}
      <time dateTime={time.iso} title={time.absolute}>
        {time.relative}
      </time>
      {after}
    </>
  );
}

/**
 * Opens the learner player in a new tab, sandboxed (D35), in the content
 * language — menus included, as a learner with that language sees it — and
 * at `lesson` when given. A plain link on purpose: the i18n Link would also
 * switch the editor's own saved language (the locale cookie) to the one
 * being previewed.
 */
export function PreviewLink({
  slug,
  lang,
  lesson,
  className,
  children,
}: {
  slug: string;
  lang: Locale;
  lesson?: StageKey;
  className: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("courseManager.grid");
  const href = getPathname({
    locale: lang,
    href: {
      pathname: `/learner/course/${slug}`,
      query: lesson ? { preview: "1", lesson } : { preview: "1" },
    },
  });
  return (
    <a href={href} target="_blank" rel="noopener" className={className}>
      <ExternalLink className="h-4 w-4" aria-hidden />
      {children}
      <span className="sr-only"> {t("newTab")}</span>
    </a>
  );
}

/**
 * The top of the course page: back to all courses, the title in the content
 * language, whether learners can see the course (and so whether saves are
 * live — Q2, D33), the content-language switch, the learner preview and the
 * publishing controls.
 */
export function CourseHeader({
  slug,
  kind,
  title,
  lastEdited,
  status,
  enrolled,
  readiness,
  languages,
  lang,
  previewLesson,
  onLangChange,
  onStatusChange,
}: {
  slug: string;
  kind: CourseKind;
  title: string;
  lastEdited: TimeLabel | null;
  status: CourseStatus;
  enrolled: number;
  readiness: ReadinessIssue[];
  languages: Record<Locale, LanguageCoverage>;
  lang: Locale;
  /** Start the preview at this lesson (the first one open), if any. */
  previewLesson?: StageKey;
  onLangChange: (next: Locale) => void;
  onStatusChange: (next: CourseStatus) => void;
}) {
  const t = useTranslations("courseManager");
  const NoteIcon = NOTE_ICON[status];
  const note =
    status === "published"
      ? t("page.liveNote")
      : status === "draft"
        ? t("page.draftNote")
        : t("page.archivedNote");

  return (
    <header>
      <Link
        href="/content/courses"
        className="mb-3 inline-flex items-center gap-1 rounded text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {t("page.allCourses")}
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <Badge variant="muted" className="text-[10px]">
            {t(`kind.${kind}`)}
          </Badge>
          <h1 className="mt-2 break-words text-2xl font-bold tracking-tight sm:text-3xl">
            {title}
          </h1>
          {lastEdited ? (
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              <LastEdited
                template={t("page.lastEdited", { when: WHEN })}
                time={lastEdited}
              />
            </p>
          ) : null}
          <p
            className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
              status === "published"
                ? "bg-[var(--success)]/10 text-[var(--success)]"
                : "bg-[var(--surface-muted)] text-[var(--muted-foreground)]"
            }`}
          >
            <NoteIcon className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
            {note}
          </p>

          <div className="mt-4">
            <ContentLanguageSwitch
              lang={lang}
              languages={languages}
              onChange={onLangChange}
              trailing={
                <PreviewLink
                  slug={slug}
                  lang={lang}
                  lesson={previewLesson}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium hover:bg-[var(--surface-muted)]"
                >
                  {t("page.previewAsLearner")}
                </PreviewLink>
              }
            />
          </div>
        </div>

        <div className="lg:w-80 lg:flex-shrink-0">
          <PublishControls
            slug={slug}
            status={status}
            enrolled={enrolled}
            readiness={readiness}
            onStatusChange={onStatusChange}
          />
        </div>
      </div>
    </header>
  );
}
