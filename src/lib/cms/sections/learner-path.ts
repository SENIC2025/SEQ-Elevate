/**
 * The lessons learners get (D64, spec 3.2): one function decides which
 * lessons a course has for its learners, in what order, under what step
 * names, and how each is drawn — and the player, the dashboard, the
 * facilitator view, the statistics and publishing all ask it, so they can
 * never disagree.
 *
 *   Built-in course    all seven standard lessons, in the standard order,
 *                      by their stage screens, with the standard names.
 *   Kill switch        (legacyOnly, R2_LEARNER_PLAYER=off) exactly what
 *                      Release 1 learners get: presentStageKeys, by stage
 *                      screens, standard names.
 *   Created course     its lesson list (resolveOutline; an unreadable one
 *                      gives the derived list, which is also what learners
 *                      got before, D18), less hidden lessons and lessons
 *                      with nothing to show (`unseen`).
 *
 * How each lesson is drawn (lessonRenderKind): a standard lesson with only
 * its main content by today's stage screen ("stage"); a lesson of the
 * course's own, or one with extra content, by the sectioned view
 * ("section"). Hiding and reordering never change it. A stage lesson is
 * there when Release 1 had it (a text lesson, or an exercise saved for
 * learners); a section lesson when it has something to show
 * (lessonHasContent, the very rule the sectioned view applies).
 *
 * Step names (D58) come from nameSection, which gives a standard lesson
 * nobody renamed the name tStage gave before. The language never changes
 * which lessons there are: text is read in the first language that has
 * some.
 *
 * Pure. It reads the step-name messages, so the player imports the rules
 * of moving through the lessons from learner-nav.ts instead (re-exported
 * here for the server).
 */

import { STAGES } from "@/data/course";
import type { CourseKind } from "../course-admin-types";
import { presentStageKeys } from "../course-derive";
import { fallbackOrder, hasText } from "../text-fallback";
import type { Locale } from "../types";
import {
  isLegacySectionId,
  mainKindOf,
  type LabelSource,
  type ResolvedSection,
  type SectionFacts,
  type SectionId,
} from "./contract";
import { nameSection, standardName } from "./names";
import { resolveOutline } from "./outline";
import { lessonHasContent } from "./resolve";
import { partsOf } from "./section-parts";
import { sectionTitle } from "./views";

export { frontierOf, isReachable, nextAfter, nextLesson } from "./learner-nav";
export { lessonHasContent };

/** What visibility, the way a lesson is drawn and its step name need of its Lesson row. */
export interface LessonFacts {
  stageKey: string;
  structure: unknown | null;
  parts: unknown | null;
  /** Needed only for "s-…" rows (their title can name them); null is fine for standard rows. */
  narrative: unknown | null;
  hasVideo: boolean;
  publishedDocuments: number;
}

export type RenderKind = "stage" | "section";
export interface PlanLesson {
  id: SectionId;
  kind: RenderKind;
  label: string;
  /**
   * The language `label` is written in, when it isn't the plan's: a lesson
   * of the course's own named, or titled, only in another language. Shown
   * with it as its lang attribute (WCAG 3.1.2). Absent otherwise.
   */
  lang?: Locale;
}
export interface LessonPlan {
  /** The lessons learners get, in their order. */
  lessons: PlanLesson[];
  /** Listed but not shown: hidden, or nothing to show. A lesson finished there still counts. */
  unseen: SectionId[];
}

/**
 * "stage" for a standard lesson whose Lesson.parts is null, its main
 * content alone, or unreadable (read as main only, as the sectioned view
 * reads it); "section" for anything else.
 */
export function lessonRenderKind(id: SectionId, parts: unknown): RenderKind {
  if (!isLegacySectionId(id)) return "section";
  const items = partsOf(parts);
  return items === "unreadable" || items.length <= 1 ? "stage" : "section";
}

/** A listed lesson without a Lesson row: nothing written in it yet. */
const noRow = (stageKey: string): LessonFacts => ({
  stageKey,
  structure: null,
  parts: null,
  narrative: null,
  hasVideo: false,
  publishedDocuments: 0,
});

/** Release 1's rule for a lesson drawn by its stage screen: text lessons always, exercises once saved. */
function stageShown(section: ResolvedSection, row: LessonFacts): boolean {
  const kind = mainKindOf(section);
  return kind === "narrative" || kind === "reflection" || row.structure != null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The language a step name came from when it isn't `locale` (see
 * PlanLesson.lang): the first language with text, in the order the name or
 * title was read in (fallbackOrder, as sectionLabel and sectionTitle read
 * them). A standard, template or generic name is always in `locale`.
 */
function labelLang(
  section: ResolvedSection,
  row: LessonFacts,
  locale: Locale,
  source: LabelSource
): Locale | undefined {
  const firstWritten = (byLang: unknown, read: (v: unknown) => unknown) => {
    if (!isRecord(byLang)) return undefined;
    const lang = fallbackOrder(byLang, locale).find((k) => hasText(read(byLang[k])));
    return lang && lang !== locale ? (lang as Locale) : undefined;
  };
  if (source === "other-language") return firstWritten(section.label, (v) => v);
  if (source !== "title") return undefined;
  const kind = mainKindOf(section);
  return kind === "narrative" || kind === "reflection"
    ? firstWritten(row.narrative, (v) => (isRecord(v) ? v.title : undefined))
    : firstWritten(isRecord(row.structure) ? row.structure.title : undefined, (v) => v);
}

const standardLesson = (id: (typeof STAGES)[number], locale: Locale): PlanLesson => ({
  id,
  kind: "stage",
  label: standardName(id, locale),
});

export function lessonPlanOf(
  kind: CourseKind,
  rawOutline: unknown,
  facts: readonly LessonFacts[],
  locale: Locale,
  opts?: { legacyOnly?: boolean }
): LessonPlan {
  if (kind === "bundled") return { lessons: STAGES.map((id) => standardLesson(id, locale)), unseen: [] };

  const rows = facts as readonly (LessonFacts & SectionFacts)[];
  const outline = resolveOutline("cms", rawOutline, rows);
  const rowOf = new Map(rows.map((r) => [r.stageKey, r]));

  if (opts?.legacyOnly) {
    const lessons = presentStageKeys("cms", [...rows]).map((id) => standardLesson(id, locale));
    const shown = new Set<string>(lessons.map((l) => l.id));
    return { lessons, unseen: outline.sections.map((s) => s.id).filter((id) => !shown.has(id)) };
  }

  const lessons: PlanLesson[] = [];
  const unseen: SectionId[] = [];
  for (const section of outline.sections) {
    const row = rowOf.get(section.id) ?? noRow(section.id);
    const render = lessonRenderKind(section.id, row.parts);
    const shown =
      !section.hidden && (render === "stage" ? stageShown(section, row) : lessonHasContent(section, row));
    if (!shown) {
      unseen.push(section.id);
      continue;
    }
    const name = nameSection(section, locale, {
      // Never the draft: learners don't get it, so it can't name their step.
      title: sectionTitle({ narrative: row.narrative, structure: row.structure }, mainKindOf(section), locale),
      n: lessons.length + 1,
    });
    const lang = labelLang(section, row, locale, name.source);
    lessons.push({ id: section.id, kind: render, label: name.text, ...(lang ? { lang } : {}) });
  }
  return { lessons, unseen };
}
