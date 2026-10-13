import { getTranslations } from "next-intl/server";
import {
  Archive,
  ArrowRight,
  BookOpen,
  CircleCheck,
  Clock,
  ExternalLink,
  Eye,
  PencilLine,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { LanguageChips } from "./LanguageChips";
import { editedAgo, editedAt } from "./edited-time";
import type {
  CourseGridEntry,
  CourseStatus,
} from "@/lib/cms/course-admin-types";
import type { Locale } from "@/lib/cms/types";

// Every status has its own icon as well as its word, so it never rests on
// colour alone.
const STATUS: Record<
  CourseStatus,
  { icon: LucideIcon; variant: "success" | "accent" | "muted" }
> = {
  published: { icon: CircleCheck, variant: "success" },
  draft: { icon: PencilLine, variant: "accent" },
  archived: { icon: Archive, variant: "muted" },
};

/**
 * One course on the "Manage courses" grid. The whole card opens the course
 * page: the title is a link whose ::after covers the card (the stretched-link
 * pattern of the workspace hub), so its accessible name is just the title.
 * The lesson shortcuts and "Preview as learner" sit above that layer as their
 * own links.
 *
 * Deliberately no publish buttons: publishing lives in one place, the course
 * page, so the card reads as navigation only.
 */
export async function CourseCard({
  entry,
  locale,
}: {
  entry: CourseGridEntry;
  /** The UI language — for dates, not the course's content language. */
  locale: Locale;
}) {
  const t = await getTranslations("courseManager");
  const tStage = await getTranslations("course.stageLabel");

  // A CMS course always has some title (it falls back across languages);
  // the slug only guards against an empty link name.
  const title = entry.title || entry.slug;
  const titleId = `course-${entry.slug}-title`;
  const coursePath = `/content/courses/${entry.slug}`;
  const status = STATUS[entry.status];
  const StatusIcon = status.icon;
  const subtitle = [entry.clusterLabel, entry.tagline]
    .filter(Boolean)
    .join(" · ");
  const ago = entry.lastEdited ? editedAgo(entry.lastEdited, locale) : null;
  // A created course's stored lesson list names its lessons itself (in the
  // grid's language, hidden ones left out); otherwise the standard lessons
  // learners see, by their standard names.
  const lessons =
    entry.sections ??
    entry.lessonKeys.map((key) => ({ id: key, name: tStage(key) }));

  return (
    <article
      aria-labelledby={titleId}
      className="relative flex h-full flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-shadow hover:shadow-md has-[[data-card-link]:focus-visible]:shadow-md has-[[data-card-link]:focus-visible]:ring-2 has-[[data-card-link]:focus-visible]:ring-[var(--ring)]"
    >
      <h2
        id={titleId}
        className="text-base font-semibold leading-snug break-words"
      >
        <Link
          href={coursePath}
          data-card-link
          className="after:absolute after:inset-0 after:rounded-xl"
        >
          {title}
        </Link>
      </h2>
      {/* After the heading, so someone jumping between headings with a
          screen reader hears the status next, not skips it. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant={status.variant}>
          <StatusIcon className="h-3.5 w-3.5" aria-hidden />
          {t(`status.${entry.status}`)}
        </Badge>
        <Badge>{t(`kind.${entry.kind}`)}</Badge>
      </div>
      {subtitle ? (
        <p className="mt-2 line-clamp-2 text-sm text-[var(--muted-foreground)]">
          {subtitle}
        </p>
      ) : null}

      <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Fact icon={BookOpen} term={t("grid.facts.lessons")}>
          {t("grid.lessons", { count: lessons.length })}
        </Fact>
        <Fact icon={Users} term={t("grid.facts.enrolled")}>
          {t("grid.enrolled", { count: entry.enrolled })}
        </Fact>
        <Fact icon={Clock} term={t("grid.facts.lastEdited")}>
          {entry.lastEdited && ago ? (
            // Above the card link, so hovering shows the exact time.
            <time
              dateTime={entry.lastEdited}
              title={editedAt(entry.lastEdited, locale) ?? undefined}
              className="relative z-10"
            >
              {t("grid.lastEdited", { when: ago })}
            </time>
          ) : (
            t("grid.neverEdited")
          )}
        </Fact>
        <div className="w-full">
          <dt className="text-xs font-medium text-[var(--muted-foreground)]">
            {t("grid.facts.languages")}
          </dt>
          <dd className="mt-1">
            <LanguageChips languages={entry.languages} />
          </dd>
        </div>
      </dl>

      {lessons.length > 0 ? (
        <nav
          aria-label={t("grid.lessonsNav", { title })}
          className="mt-3"
        >
          {/* The nav's own label says this to screen readers. */}
          <p
            aria-hidden
            className="text-xs font-medium text-[var(--muted-foreground)]"
          >
            {t("grid.facts.lessons")}
          </p>
          <ol className="mt-1 flex flex-wrap gap-1.5">
            {lessons.map(({ id, name }, i) => {
              const label = t("grid.lessonLink", {
                n: i + 1,
                stage: name,
              });
              return (
                <li key={id}>
                  <Link
                    href={{ pathname: coursePath, query: { lesson: id } }}
                    prefetch={false}
                    aria-label={label}
                    title={label}
                    className="relative z-10 inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm font-medium tabular-nums hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    {i + 1}
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      <div className="mt-auto pt-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[var(--border)] pt-4">
          {/* Visual cue only: the whole card is already the link. */}
          <span
            aria-hidden
            className="inline-flex items-center gap-1 text-sm font-medium text-[var(--accent)]"
          >
            {t("grid.open")} <ArrowRight className="h-4 w-4" />
          </span>
          <Link
            href={{
              pathname: `/learner/course/${entry.slug}`,
              query: { preview: "1" },
            }}
            prefetch={false}
            target="_blank"
            rel="noopener"
            className="relative z-10 inline-flex min-h-8 items-center gap-1.5 rounded-md text-sm font-medium underline-offset-4 hover:underline"
          >
            <Eye className="h-4 w-4" aria-hidden />
            {t("page.previewAsLearner")}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only"> {t("grid.newTab")}</span>
          </Link>
        </div>
      </div>
    </article>
  );
}

/** One "icon + value" fact; the term is for screen readers only. */
function Fact({
  icon: Icon,
  term,
  children,
}: {
  icon: LucideIcon;
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
      <dt className="sr-only">{term}</dt>
      <dd className="inline-flex items-center gap-1.5">
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        {children}
      </dd>
    </div>
  );
}
