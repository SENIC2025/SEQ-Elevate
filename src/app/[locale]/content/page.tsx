import { setRequestLocale } from "next-intl/server";
import { ContentEditor } from "@/components/role/ContentEditor";
import { AccessNotice } from "@/components/AccessNotice";
import { listCourses } from "@/lib/cms";
import { getViewerRoles } from "@/lib/server-queries";
import { canEditContent } from "@/lib/permissions";
import type { Locale } from "@/lib/cms/types";

// Reads the viewer's roles — never prerender.
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Decide BEFORE loading anything: the course list includes unpublished
  // drafts, which only editors may see.
  if (!canEditContent(await getViewerRoles())) {
    return (
      <AccessNotice title="Editors only">
        Sign in with an Editor or Admin account to create and edit courses. If
        you should have access, ask your project administrator for the Editor
        role.
      </AccessNotice>
    );
  }

  const loc = (["en", "de", "el"].includes(locale) ? locale : "en") as Locale;
  // Editors author drafts too, so the picker must include unpublished courses.
  const courses = await listCourses("seq-elevate", loc, {
    includeUnpublished: true,
  });
  const courseOptions = courses
    .filter((c) => !c.comingSoon)
    .map((c) => ({ slug: c.slug, title: c.title }));
  return <ContentEditor courses={courseOptions} locale={loc} />;
}
