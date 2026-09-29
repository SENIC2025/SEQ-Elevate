"use client";

import { useTranslations } from "next-intl";
import { VideoBlockAuthor } from "@/components/role/VideoBlockAuthor";
import { LessonDocumentManager } from "@/components/role/LessonDocumentManager";
import { LessonNarrativeEditor } from "@/components/role/LessonNarrativeEditor";
import { CourseCatalogueManager } from "@/components/role/CourseCatalogueManager";
import { CompCardTemplateEditor } from "@/components/role/CompCardTemplateEditor";
import { StructureAuthor } from "@/components/role/StructureAuthor";
import type { Locale } from "@/lib/cms/types";

// Page sections, in the order an author works: the course first, then its
// lessons, then the project-wide Comp Card questions.
const SECTIONS = [
  {
    id: "courses",
    title: "Courses",
    intro: "Create a course, then publish it when it is ready for learners.",
  },
  {
    id: "lessons",
    title: "Lesson content",
    intro:
      "Each tool starts with the course and lesson stage you want to work on.",
  },
  {
    id: "comp-card",
    title: "Comp Card",
    intro:
      "The reflection questions learners answer on their Comp Card. Changes apply to every course.",
  },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/**
 * The "Create courses" workspace: every authoring tool on one page. Each tool
 * checks the editor's role itself and saves its own changes.
 */
export function ContentEditor({
  courses = [],
  locale = "en",
}: {
  courses?: { slug: string; title: string }[];
  locale?: Locale;
}) {
  const t = useTranslations("content");

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
        {t("title")}
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)]">
        {t("subtitle")}
      </p>

      <nav aria-label="Sections on this page" className="mt-4">
        <ul className="flex flex-wrap gap-2 text-sm">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="inline-flex rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 font-medium hover:bg-[var(--surface-muted)]"
              >
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="courses">
        <CourseCatalogueManager locale={locale} />
      </Section>

      <Section id="lessons">
        <LessonNarrativeEditor courses={courses} />
        <StructureAuthor />
        <VideoBlockAuthor courses={courses} />
        <LessonDocumentManager courses={courses} />
      </Section>

      <Section id="comp-card">
        <CompCardTemplateEditor />
      </Section>
    </div>
  );
}

function Section({
  id,
  children,
}: {
  id: SectionId;
  children: React.ReactNode;
}) {
  const { title, intro } = SECTIONS.find((s) => s.id === id)!;
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="mt-10 scroll-mt-20">
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        {title}
      </h2>
      <p className="mt-1 mb-3 text-sm text-[var(--muted-foreground)]">{intro}</p>
      <div className="space-y-6">{children}</div>
    </section>
  );
}
