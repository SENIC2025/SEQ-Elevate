import { cache } from "react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { getCourse } from "@/lib/cms";
import { getCourseStatus } from "@/lib/cms/course-overlay";
import { getCourseReferences } from "@/lib/cms/course-references";
import { learnerContentLocale } from "@/lib/cms/language-ready";
import { nameInSentence, sentenceStart } from "@/lib/cms/language-name";
import { canEditContent } from "@/lib/permissions";
import { furtherReadingOn } from "@/lib/r4-switches";
import { getViewerRoles } from "@/lib/server-queries";
import type { Locale } from "@/lib/cms/types";
import { RichTextView } from "@/components/rich-text/RichTextView";

// Reads who views it and the live list: never prerendered.
export const dynamic = "force-dynamic";

const PROJECT = "seq-elevate";

/** Whether the viewer may edit content, once per request (getViewerRoles fails to []: drafts stay hidden). */
const viewerCanEdit = cache(async () => canEditContent(await getViewerRoles()));

/**
 * What the page shows, once per request and shared by the page and its tab
 * title, so the two never disagree: null wherever the page answers "not
 * found" (spec 5.4) — R4_FURTHER_READING off; a course that is unknown;
 * a draft or archived course for a viewer who can't edit it; a built-in
 * course, or one without a list in any language.
 *
 * The list is in the language the course is shown in: for learners,
 * Release 3's learnerContentLocale (a course whose German isn't switched on
 * yet is English for a German learner); for an editor on a draft, or with
 * ?preview=1, the language asked for, as the course's preview shows it.
 * Within that, getCourseReferences falls back to English, then to the
 * first language written. A preview in a language learners don't get yet
 * says so (`languageNotLive`), as the course's preview does.
 */
const loadReferences = cache(async (courseId: string, requested: Locale, previewAsked: boolean) => {
  if (!furtherReadingOn()) return null;
  const [canEdit, status] = await Promise.all([viewerCanEdit(), getCourseStatus(PROJECT, courseId)]);
  // A created course always has its row: none (or an unreadable one) is no course here.
  if (status === null) return null;
  const isDraft = status !== "published";
  if (isDraft && !canEdit) return null;
  const preview = canEdit && (isDraft || previewAsked);
  const learnerLocale = await learnerContentLocale(PROJECT, courseId, requested);
  const contentLocale = preview ? requested : learnerLocale;
  const list = await getCourseReferences(PROJECT, courseId, contentLocale);
  if (!list) return null;
  const course = await getCourse(PROJECT, courseId, contentLocale);
  if (!course) return null;
  return {
    courseTitle: course.title,
    contentLocale,
    list,
    keepPreview: canEdit && previewAsked,
    languageNotLive: preview && learnerLocale !== requested ? requested : undefined,
  };
});

function asLocale(locale: string): Locale {
  return (["en", "de", "el"].includes(locale) ? locale : "en") as Locale;
}

/** A query value Next may hand over as a list (?a=1&a=2): take the first. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type Params = Promise<{ locale: string; courseId: string }>;
type SearchParams = Promise<{ preview?: string | string[]; from?: string | string[] }>;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const { locale, courseId } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "courseReferences" });
  const loaded = await loadReferences(courseId, asLocale(locale), one(sp.preview) === "1");
  // Whenever the page answers "not found", the tab names no course: not
  // even a draft's title reaches someone who can't edit it.
  return { title: loaded ? t("metaTitle", { course: loaded.courseTitle }) : t("title") };
}

/**
 * A created course's references and bibliography (D109, spec 5.4), on a
 * learner page of its own inside the learner layout (the profile step and
 * the safeguarding box apply). Read only: nothing is recorded for anyone.
 *
 * Each entry is set as reference lists are, with a hanging indent
 * (.seq-references, which the course page's editor shares, so authors see
 * this layout). Opened from a lesson (the player adds ?from=lesson and
 * opens it in a new tab) it says to close the tab to return; otherwise it
 * links back to the course. A list in another language than the page's is
 * marked with its language (WCAG 3.1.2), and a line says so; so is the
 * course's title when the course is shown in another language.
 */
export default async function Page({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { locale, courseId } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const requested = asLocale(locale);
  const loaded = await loadReferences(courseId, requested, one(sp.preview) === "1");
  if (!loaded) notFound();
  const t = await getTranslations("courseReferences");
  const tPlayer = await getTranslations("coursePlayer");
  const tCourses = await getTranslations("courseManager");
  const { courseTitle, contentLocale, list, keepPreview, languageNotLive } = loaded;
  const titleLang = contentLocale !== requested ? contentLocale : undefined;
  const listLang = list.locale !== requested ? list.locale : undefined;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      <p lang={titleLang} className="mt-1 text-[var(--muted-foreground)]">
        {courseTitle}
      </p>
      {one(sp.from) === "lesson" ? (
        <p className="mt-3 text-sm">{t("closeTab")}</p>
      ) : (
        <Link
          href={`/learner/course/${courseId}${keepPreview ? "?preview=1" : ""}`}
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[var(--accent)] underline underline-offset-2"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {t("back")}
        </Link>
      )}

      {languageNotLive ? (
        <p className="mt-3 text-sm font-medium">
          {sentenceStart(
            tPlayer("languageNotLive", {
              language: nameInSentence(tCourses(`languageName.${languageNotLive}`), requested),
            }),
            requested
          )}
        </p>
      ) : null}

      <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
        {listLang ? (
          <p className="mb-4 text-sm text-[var(--muted-foreground)]">{t(`shownIn.${listLang}`)}</p>
        ) : null}
        <RichTextView
          rich={list.rich}
          text={list.text}
          lang={listLang}
          className="seq-references text-base leading-relaxed"
        />
      </div>
    </div>
  );
}
