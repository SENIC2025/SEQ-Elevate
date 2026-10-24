import "server-only";

/**
 * The course a learner plays (D63, spec 3.3), and what an editor's preview
 * shows: the same object, so preview shows what learners get (D35).
 *
 * Its lessons are the course's lesson plan (lessonPlanOf), in its order and
 * under its step names, each drawn one of two ways:
 *   "stage"    a standard lesson with only its main content: the very
 *              CourseStage getCourse built for it (`base`), media included —
 *              byte for byte what Release 1 learners got;
 *   "section"  a lesson of the course's own, or one with extra content:
 *              resolveSectionStage, as the editor's preview drew it in
 *              Release 1 (main content as learners read it, extra content's
 *              live versions only, video and published documents).
 * Built-in courses never reach the sectioned view: every stage is a stage
 * lesson. `unseen` lists the lessons not shown, so a finished one still
 * counts (course-progress.ts).
 *
 * Fails open (D18): any error gives `base`'s stages as stage lessons — what
 * learners got before Release 2 — and is logged. Answers are kept by
 * lesson and item id, so nothing is lost either way.
 *
 * Release 4 (D107, D108, spec 4.4): this is where a lesson's documents and
 * further-reading links are filtered by language for learners, since every
 * lesson the player gets comes from here. A learner gets the items for
 * every language, for the language the course text is shown in (`locale`,
 * Release 3's effective content language) and for the language of their
 * pages (`opts.requested`); a lesson whose only material is documents for
 * other languages shows them all, marked. Which lessons there are, and so
 * progress and completion, never depend on it: the plan counts every
 * published document.
 */

import { prisma } from "@/lib/prisma";
import { furtherReadingOn } from "@/lib/r4-switches";
import { forLanguage, lessonDocumentsFor, stageShowsOwnContent } from "./item-language";
import { documentRef, publishedLinksByLesson } from "./lesson-overlay";
import type { ItemLanguages, StageReading } from "./reading-types";
import { pickText } from "./structure";
import {
  isLegacySectionId,
  type SectionId,
  type SectionStage,
} from "./sections/contract";
import { previewDefaults } from "./sections/defaults";
import { lessonPlanOf, type LessonFacts } from "./sections/learner-path";
import { standardName } from "./sections/names";
import { resolveOutline } from "./sections/outline";
import { resolveSectionStage } from "./sections/resolve";
import { learnerPlayerOff } from "./sections/switches";
import type { CourseContent, CourseStage, LessonDocumentRef, Locale, StageKey } from "./types";

export { getLessonPlans } from "./lesson-plans";

export type LearnerLesson = (
  | { kind: "stage"; id: StageKey; label: string; stage: CourseStage }
  | {
      kind: "section";
      id: SectionId;
      label: string;
      section: SectionStage;
      /** The standard reflection questions, when the lesson's own questions replace them. */
      replacedPrompts?: { id: "p1" | "p2" | "p3"; label: string }[];
    }
) & {
  /**
   * The language `label` is written in, when it isn't the course's
   * (PlanLesson.lang): the player marks the name with it (WCAG 3.1.2).
   */
  lang?: Locale;
};

export interface LearnerCourse extends Omit<CourseContent, "stages"> {
  lessons: LearnerLesson[];
  unseen: SectionId[];
}

const isRecord = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);

/** A plan lesson's `lang`, only when it has one. */
const langOf = (lesson: { lang?: Locale }) => (lesson.lang ? { lang: lesson.lang } : {});

/** A stage as getCourse builds it since Release 4: its documents' languages, and its further reading. */
type ReadingStage = Omit<CourseStage, "documents"> & StageReading & { documents?: (LessonDocumentRef & ItemLanguages)[] };

/**
 * A stage lesson's documents and links for the languages a learner reads
 * in (spec 4.4). The very stage getCourse built when nothing is left out;
 * when the filter would leave a stage with nothing at all but documents for
 * other languages, all of its documents.
 */
function stageForLanguage(stage: CourseStage, locales: readonly Locale[]): CourseStage {
  const s: ReadingStage = stage;
  const all = s.documents ?? [];
  const documents = lessonDocumentsFor(all, locales, stageShowsOwnContent(stage));
  const links = forLanguage(s.links ?? [], locales);
  if (documents.length === all.length && links.length === (s.links?.length ?? 0)) return stage;
  const { documents: _d, links: _l, ...rest } = s;
  void _d;
  void _l;
  return { ...rest, ...(documents.length ? { documents } : {}), ...(links.length ? { links } : {}) } as CourseStage;
}

/** Every stage of `base` as a stage lesson, under its standard name. */
function asStages(base: CourseContent, locale: Locale, locales: readonly Locale[]): LearnerCourse {
  const { stages, ...rest } = base;
  return {
    ...rest,
    lessons: stages.map((stage) => ({
      kind: "stage",
      id: stage.key,
      label: standardName(stage.key, locale),
      stage: stageForLanguage(stage, locales),
    })),
    unseen: [],
  };
}

/**
 * `base` is what getCourse returned for the course (cms/index.ts), in
 * `locale`, the language the course text is shown in. `requested` is the
 * language of the learner's pages (default `locale`): documents and links
 * for it are shown too (D108). `editor` keeps the sectioned view's count of
 * content left out (drafts, questions not ready) for the preview's note;
 * learners get 0.
 */
export async function getLearnerCourse(
  projectId: string,
  slug: string,
  locale: Locale,
  base: CourseContent,
  opts?: { editor?: boolean; requested?: Locale }
): Promise<LearnerCourse> {
  const requested = opts?.requested ?? locale;
  const locales: Locale[] = requested === locale ? [locale] : [locale, requested];
  try {
    const course = await prisma.course.findFirst({
      where: { projectId, slug },
      select: { meta: true, outline: true },
    });
    // A built-in course: all seven stages, never the sectioned view.
    if (!course?.meta) return asStages(base, locale, locales);

    const rows = await prisma.lesson.findMany({
      where: { projectId, courseSlug: slug },
      select: {
        stageKey: true,
        narrative: true,
        structure: true,
        structureDraft: true,
        parts: true,
        video: true,
        // Learners only ever see published documents (D35).
        documents: {
          where: { published: true },
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          select: { id: true, name: true, url: true, mimeType: true, sizeBytes: true, published: true, languages: true },
        },
      },
    });
    const facts: LessonFacts[] = rows.map((r) => ({
      stageKey: r.stageKey,
      structure: r.structure ?? null,
      parts: r.parts ?? null,
      narrative: r.narrative ?? null,
      hasVideo: isRecord(r.video),
      publishedDocuments: r.documents.length,
    }));
    const plan = lessonPlanOf("cms", course.outline ?? null, facts, locale, { legacyOnly: learnerPlayerOff() });
    const sections = new Map(resolveOutline("cms", course.outline ?? null, rows).sections.map((s) => [s.id, s]));
    const rowOf = new Map(rows.map((r) => [r.stageKey, r]));
    const defaults = previewDefaults(locale);
    // Further reading for the lessons drawn piece by piece (a stage lesson's
    // comes with `base`); read on its own, so it never costs the lesson.
    const links =
      furtherReadingOn() && plan.lessons.some((l) => l.kind === "section")
        ? await publishedLinksByLesson(projectId, slug)
        : new Map<string, never[]>();

    const lessons: LearnerLesson[] = plan.lessons.map((lesson): LearnerLesson => {
      if (lesson.kind === "stage") {
        const stage = base.stages.find((s) => s.key === lesson.id);
        if (!stage) throw new Error(`lesson ${lesson.id} is in the plan but not in the course`);
        return { kind: "stage", id: stage.key, label: lesson.label, ...langOf(lesson), stage: stageForLanguage(stage, locales) };
      }
      const section = sections.get(lesson.id);
      const row = rowOf.get(lesson.id);
      const resolved =
        section &&
        resolveSectionStage({
          section,
          row: row && { ...row, documents: row.documents.map(documentRef), links: links.get(lesson.id) ?? [] },
          locale,
          itemLocales: locales,
          label: lesson.label,
          standardTitle: isLegacySectionId(lesson.id) ? standardName(lesson.id, locale) : lesson.label,
          defaults,
        });
      if (!resolved) throw new Error(`lesson ${lesson.id} is in the plan but has nothing to show`);
      const replaced =
        lesson.id === "reflection" &&
        resolved.parts.some((p) => p.id === "main" && p.type === "reflection" && p.prompts.length === 0);
      return {
        kind: "section",
        id: lesson.id,
        label: lesson.label,
        ...langOf(lesson),
        section: { ...resolved, skipped: opts?.editor ? resolved.skipped : 0 },
        ...(replaced
          ? {
              replacedPrompts: defaults.reflectionPrompts.map((p) => ({
                id: p.id as "p1" | "p2" | "p3",
                label: pickText(p.label, locale),
              })),
            }
          : {}),
      };
    });

    const { stages: _stages, ...rest } = base;
    void _stages;
    return { ...rest, lessons, unseen: plan.unseen };
  } catch (error) {
    console.error(`Couldn't build the lessons of "${slug}"; learners get its standard lessons.`, error);
    return asStages(base, locale, locales);
  }
}
