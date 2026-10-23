import { cache } from "react";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getCourse } from "@/lib/cms";
import { getCourseStatus } from "@/lib/cms/course-overlay";
import { getViewerRoles } from "@/lib/server-queries";
import { canEditContent } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import type { Locale } from "@/lib/cms/types";
import { getLearnerCourse } from "@/lib/cms/learner-course";
import { learnerContentLocale } from "@/lib/cms/language-ready";
import { nextLesson } from "@/lib/cms/sections/learner-nav";
import { isSectionId, type SectionId } from "@/lib/cms/sections/contract";
import { completedLessonIds } from "@/lib/learner-progress/enrolment-read";
import { routing } from "@/i18n/routing";
import { CoursePlayer } from "@/components/course/CoursePlayer";
import { PreviewStateProvider } from "@/store/demo-state";
import { isFirstPartyMediaUrl, markExternalMedia, serverAppOrigin } from "@/lib/media-url";

const PROJECT = "seq-elevate";

/**
 * Whether the viewer may edit content — once per request, shared by the
 * page and its metadata. Read for every course, not only drafts: it
 * decides the draft gate, preview mode and the "Edit this lesson" link.
 * getViewerRoles uses the per-request cached memberships (the header loads
 * them anyway) and fails to [] — a DB error hides drafts rather than
 * showing them.
 */
const viewerCanEdit = cache(async () => canEditContent(await getViewerRoles()));

/**
 * The course as this viewer reads it, once per request: whether it's a
 * draft, whether this is an editor's preview, and the language it is shown
 * in (D90, spec 9.3). Learners get the language learnerContentLocale gives:
 * a created course whose German or Greek isn't switched on yet comes whole
 * in English. An editor's preview shows the requested language, so a
 * translator sees their German before signing it off; `learnerLocale` says
 * what learners get meanwhile, for the preview's banner.
 */
const loadCourse = cache(async (courseId: string, requested: Locale, previewAsked: boolean) => {
  const [canEdit, status, learnerLocale] = await Promise.all([
    viewerCanEdit(),
    getCourseStatus(PROJECT, courseId),
    learnerContentLocale(PROJECT, courseId, requested),
  ]);
  // No DB row yet → treat as published (a bundled course that predates seeding).
  const isDraft = status !== null && status !== "published";
  // An editor on a draft is always previewing: their clicks must never
  // enrol them in a course learners can't see yet.
  const preview = canEdit && (isDraft || previewAsked);
  const contentLocale = preview ? requested : learnerLocale;
  const course = await getCourse(PROJECT, courseId, contentLocale);
  if (!course) return null;
  return { course, isDraft, canEdit, preview, contentLocale, learnerLocale };
});

/**
 * Where a signed-in learner opens the course (spec 5.5): the first lesson
 * of the plan they haven't done, worked out from their enrolment here on
 * the server, so the player never flashes lesson 1 first; the completion
 * screen once they completed it; the last lesson when every lesson is done
 * but the course isn't completed (never the completion screen, which would
 * complete it). Null for a guest, with no lessons, or on any error: the
 * player then opens at the first lesson, and checks again once the
 * learner's progress has loaded.
 */
async function resumeFor(courseId: string, ids: readonly SectionId[]): Promise<SectionId | "complete" | null> {
  try {
    const user = await getCurrentUser();
    if (!user || !ids.length) return null;
    const row = await prisma.courseEnrollment.findFirst({
      where: { userId: user.id, course: { projectId: PROJECT, slug: courseId } },
      select: { stagesCompleted: true, sectionsCompleted: true, completedAt: true },
    });
    if (!row) return null;
    const at = nextLesson(ids, new Set(completedLessonIds(row)), row.completedAt?.toISOString() ?? null);
    return at === "empty" ? null : at;
  } catch (error) {
    console.error(`Couldn't read where the learner left "${courseId}"; it opens at its first lesson.`, error);
    return null;
  }
}

function asLocale(locale: string): Locale {
  return (["en", "de", "el"].includes(locale) ? locale : "en") as Locale;
}

/** A query value Next may hand over as a list (?a=1&a=2): take the first. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; courseId: string }>;
  searchParams: Promise<{ preview?: string | string[] }>;
}): Promise<Metadata> {
  const { locale, courseId } = await params;
  const sp = await searchParams;
  const loaded = await loadCourse(courseId, asLocale(locale), one(sp.preview) === "1");
  // A draft's title is for editors only — not even the tab title leaks it.
  if (!loaded || (loaded.isDraft && !loaded.canEdit)) return { title: "Course" };
  return { title: loaded.course.title };
}

/**
 * Course route. Fetches the authored CourseContent from the CMS client
 * (local or strapi, per CMS_SOURCE) server-side, turns it into the lessons
 * learners get (getLearnerCourse: the course's lesson plan, D63) and hands
 * them to the one player. Any published course renders here — no
 * per-course code.
 *
 * An unpublished course is a 404 for learners and guests. Editors and admins
 * still reach it so they can preview a draft before releasing it; the player
 * shows a draft banner so nobody mistakes a preview for the live course.
 *
 * Preview (`?preview=1`, and always for an editor on a draft) plays the
 * course in a sandbox: nothing is saved — no enrolment, progress, badge or
 * statistics. It shows exactly what learners get, for every course and
 * status (D35), plus the editors' note on content left out. Only preview
 * honours `?lesson=`, to start at any lesson learners get; learners keep
 * the step-by-step order (Q4) and open where they left off (spec 5.5). A
 * preview opened from the course page also says which menu language the
 * editor works in (`?ui=`), so its links back to editing use that one.
 *
 * Release 3 (D90): a learner using German or Greek gets a created course
 * whole in English until that language is switched on for it; the player
 * then says so. An editor's preview shows the requested language, with a
 * banner saying learners get English until it is switched on.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; courseId: string }>;
  searchParams: Promise<{
    lesson?: string | string[];
    preview?: string | string[];
    ui?: string | string[];
  }>;
}) {
  const { locale, courseId } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const requested = asLocale(locale);
  const loaded = await loadCourse(courseId, requested, one(sp.preview) === "1");
  if (!loaded) notFound();
  const { course, isDraft, canEdit, preview, contentLocale, learnerLocale } = loaded;
  if (isDraft && !canEdit) notFound();

  const ui = one(sp.ui);
  const editLocale =
    preview && (routing.locales as readonly string[]).includes(ui ?? "")
      ? (ui as Locale)
      : undefined;

  // A video or document stored on another host before Release 3 is shown
  // as a link out, never loaded in the page (D91).
  const origin = serverAppOrigin();
  // The lessons in the language of the course itself (`base`), so the fail
  // open of getLearnerCourse shows the same language. Release 4 (D108,
  // spec 4.4): documents and further reading for the page's language too,
  // so a German learner on a course still shown in English gets German-only
  // material, marked; in a preview both are the language asked for.
  const learner = markExternalMedia(
    await getLearnerCourse(PROJECT, courseId, contentLocale, course, { editor: preview, requested }),
    (url) => isFirstPartyMediaUrl(url, origin)
  );
  const ids = learner.lessons.map((l) => l.id);
  // Any lesson learners get, in a preview only: a hidden or unknown one
  // opens the first.
  const lesson = one(sp.lesson);
  const initialLesson = preview && isSectionId(lesson) && ids.includes(lesson) ? lesson : undefined;
  const serverResume = preview ? null : await resumeFor(courseId, ids);

  const player = (
    <CoursePlayer
      course={learner}
      draftPreview={isDraft}
      preview={preview}
      canEdit={canEdit}
      initialLesson={initialLesson}
      editLocale={editLocale}
      serverResume={serverResume}
      // A preview in a language learners don't get yet says so (D90).
      languageNotLive={preview && learnerLocale !== requested ? requested : undefined}
    />
  );
  return preview ? <PreviewStateProvider>{player}</PreviewStateProvider> : player;
}
