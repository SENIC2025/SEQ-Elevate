import { getTranslations, setRequestLocale } from "next-intl/server";
import { ContentEditor } from "@/components/role/ContentEditor";
import { AccessNotice } from "@/components/AccessNotice";
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

  // Decide BEFORE rendering any tool: the templates and the create form are
  // for editors only (each action checks the role again on the server).
  if (!canEditContent(await getViewerRoles())) {
    const t = await getTranslations("courseManager.editorsOnly");
    return <AccessNotice title={t("title")}>{t("body")}</AccessNotice>;
  }

  const loc = (["en", "de", "el"].includes(locale) ? locale : "en") as Locale;
  // New courses start in the page's language; existing ones are managed on
  // their own pages (/content/courses), so nothing is loaded here.
  return <ContentEditor locale={loc} />;
}
