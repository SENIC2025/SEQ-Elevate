"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { NewCourseForm } from "@/components/course-manager/NewCourseForm";
import { CompCardTemplateEditor } from "@/components/role/CompCardTemplateEditor";
import type { Locale } from "@/lib/cms/types";
import { ArrowRight } from "lucide-react";

/**
 * The "Create courses" workspace: start a new course (which then opens on
 * its own course page, D33), and edit the templates every course shares.
 * Existing courses — their lessons, videos, documents and publishing — are
 * managed one page per course under "Manage courses", so no tool here asks
 * which course you mean.
 */
export function ContentEditor({ locale = "en" }: { locale?: Locale }) {
  const t = useTranslations("content");

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
        {t("title")}
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)]">
        {t("subtitle")}
      </p>

      <Section
        id="new-course"
        title={t("newCourseTitle")}
        intro={t("newCourseIntro")}
      >
        <Card>
          <CardContent className="p-5">
            <NewCourseForm locale={locale} />
          </CardContent>
        </Card>
        <Link
          href="/content/courses"
          className="inline-flex items-center gap-1 rounded text-sm font-medium text-[var(--accent)] hover:underline"
        >
          {t("manageLink")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </Section>

      <Section
        id="templates"
        title={t("templatesTitle")}
        intro={t("templatesIntro")}
      >
        <CompCardTemplateEditor />
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="mt-10 scroll-mt-20"
    >
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        {title}
      </h2>
      <p className="mt-1 mb-3 text-sm text-[var(--muted-foreground)]">
        {intro}
      </p>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
