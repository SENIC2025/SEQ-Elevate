import { cache } from "react";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getCourse } from "@/lib/cms";
import { getCourseStatus } from "@/lib/cms/course-overlay";
import { isStageKey } from "@/lib/cms/course-admin-types";
import { getViewerRoles } from "@/lib/server-queries";
import { canEditContent } from "@/lib/permissions";
import type { Locale } from "@/lib/cms/types";
import { routing } from "@/i18n/routing";
import { CoursePlayer } from "@/components/course/CoursePlayer";
import { PreviewStateProvider } from "@/store/demo-state";

/**
 * The course, whether it's a draft, and whether the viewer may edit content —
 * once per request, shared by the page and its metadata. Roles are read for
 * every course, not only drafts: they decide the draft gate, preview mode and
 * the "Edit this lesson" link. getViewerRoles uses the per-request cached
 * memberships (the header loads them anyway) and fails to [] — a DB error
 * hides drafts rather than showing them.
 */
const loadCourse = cache(async (courseId: string, loc: Locale) => {
  const course = await getCourse("seq-elevate", courseId, loc);
  if (!course) return null;
  const [status, roles] = await Promise.all([
    getCourseStatus("seq-elevate", courseId),
    getViewerRoles(),
  ]);
  // No DB row yet → treat as published (a bundled course that predates seeding).
  const isDraft = status !== null && status !== "published";
  return { course, isDraft, canEdit: canEditContent(roles) };
});

function asLocale(locale: string): Locale {
  return (["en", "de", "el"].includes(locale) ? locale : "en") as Locale;
}

/** A query value Next may hand over as a list (?a=1&a=2): take the first. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; courseId: string }>;
}): Promise<Metadata> {
  const { locale, courseId } = await params;
  const loaded = await loadCourse(courseId, asLocale(locale));
  // A draft's title is for editors only — not even the tab title leaks it.
  if (!loaded || (loaded.isDraft && !loaded.canEdit)) return { title: "Course" };
  return { title: loaded.course.title };
}

/**
 * Course route. Fetches the authored CourseContent from the CMS client
 * (local or strapi, per CMS_SOURCE) server-side and hands it to the
 * generic player. Any published course renders here — no per-course code.
 *
 * An unpublished course is a 404 for learners and guests. Editors and admins
 * still reach it so they can preview a draft before releasing it; the player
 * shows a draft banner so nobody mistakes a preview for the live course.
 *
 * Preview (`?preview=1`, and always for an editor on a draft) plays the
 * course in a sandbox: nothing is saved — no enrolment, progress, badge or
 * statistics. Only preview honours `?lesson=` to start at a chosen lesson;
 * learners always start at the beginning and keep the step-by-step order.
 * A preview opened from the course page also says which menu language the
 * editor works in (`?ui=`), so its links back to editing use that one.
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

  const loaded = await loadCourse(courseId, asLocale(locale));
  if (!loaded) notFound();
  const { course, isDraft, canEdit } = loaded;
  if (isDraft && !canEdit) notFound();

  const sp = await searchParams;
  // An editor on a draft is always previewing: their clicks must never
  // enrol them in a course learners can't see yet.
  const preview = canEdit && (isDraft || one(sp.preview) === "1");
  const lesson = one(sp.lesson);
  const initialStage = preview && isStageKey(lesson) ? lesson : undefined;
  const ui = one(sp.ui);
  const editLocale =
    preview && (routing.locales as readonly string[]).includes(ui ?? "")
      ? (ui as Locale)
      : undefined;

  const player = (
    <CoursePlayer
      course={course}
      draftPreview={isDraft}
      preview={preview}
      canEdit={canEdit}
      initialStage={initialStage}
      editLocale={editLocale}
    />
  );
  return preview ? <PreviewStateProvider>{player}</PreviewStateProvider> : player;
}
