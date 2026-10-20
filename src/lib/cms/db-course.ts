import "server-only";

/**
 * Courses CREATED IN THE CMS — no bundled definition, no code.
 *
 * A bundled course gets its copy from the message catalogue via
 * local-provider.ts. A course an editor creates has none, so its copy lives in
 * `Course.meta` (per-locale title/tagline/clusterLabel) and its teaching text
 * in `Lesson.narrative` rows — the same rows the existing narrative editor
 * already writes.
 *
 * A CMS-created course always carries the NARRATIVE stages (context → concept
 * → behaviour → reflection). The INTERACTIVE stages (simulation, branching
 * scenario, assessment) appear only once an editor has authored their
 * structure (Lesson.structure); until then they're omitted rather than faked.
 * The player renders exactly the stages present, in canonical order, so a
 * course with or without the interactive stages is a first-class citizen.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { introFromBlocks } from "@/lib/rich-text/narrative";
import { getLessonPlans } from "./lesson-plans";
import type { LessonPlan } from "./sections/learner-path";
import {
  firstText,
  pickMeta,
  resolveNarrative,
  type CourseMeta,
  type CourseMetaEntry,
} from "./text-fallback";
import { courseBadgeSlug } from "./course-badge";
import {
  resolveStructure,
  pickText,
  type StoredStructure,
  type StructureStageKey,
} from "./structure";
import type {
  CourseContent,
  CourseStage,
  CourseSummary,
  Locale,
  StageKey,
} from "./types";

/**
 * The full WP3 sequence, in order. Narrative stages always render; the three
 * interactive stages render only when authored. Kept in this canonical order
 * so a CMS course reads simulation → scenario → assessment like a bundled one.
 */
const CANONICAL_ORDER: StageKey[] = [
  "context",
  "concept",
  "behaviour",
  "simulation",
  "scenario",
  "reflection",
  "assessment",
];

/**
 * Localised generic strings for the system-provided slots of a CMS course —
 * the reflection stage (a journaling stage the author doesn't write) and the
 * completion heading. Authored content overrides these; they exist so a fully
 * translated course doesn't leak English in the parts the author never types.
 */
const DEFAULTS: Record<
  Locale,
  {
    completionTitle: string;
    reflectionTitle: string;
    reflectionIntro: string;
    reflectionPrompts: string[];
  }
> = {
  en: {
    completionTitle: "Course complete",
    reflectionTitle: "Reflection",
    reflectionIntro: "Take a moment to reflect on what you just practised.",
    reflectionPrompts: [
      "What went well?",
      "What was hard?",
      "What will you try next time?",
    ],
  },
  de: {
    completionTitle: "Kurs abgeschlossen",
    reflectionTitle: "Reflexion",
    reflectionIntro:
      "Nimm dir einen Moment, um über das eben Geübte nachzudenken.",
    reflectionPrompts: [
      "Was ist gut gelaufen?",
      "Was war schwierig?",
      "Was probierst du beim nächsten Mal?",
    ],
  },
  el: {
    completionTitle: "Το μάθημα ολοκληρώθηκε",
    reflectionTitle: "Αναστοχασμός",
    reflectionIntro:
      "Αφιέρωσε μια στιγμή για να σκεφτείς αυτό που μόλις εξασκήθηκες.",
    reflectionPrompts: [
      "Τι πήγε καλά;",
      "Τι ήταν δύσκολο;",
      "Τι θα δοκιμάσεις την επόμενη φορά;",
    ],
  },
};

// The course's copy for a locale, field by field, blanks skipped (pure, in
// text-fallback.ts); re-exported for the callers that read it from here.
export { pickMeta, type CourseMeta, type CourseMetaEntry };

/** The step names not in the list's language, by lesson id; nothing when there are none. */
function stageLabelLangs(plan: LessonPlan): Pick<CourseSummary, "stageLabelLangs"> {
  const other = plan.lessons.flatMap((l) => (l.lang ? [[l.id, l.lang] as const] : []));
  return other.length ? { stageLabelLangs: Object.fromEntries(other) } : {};
}

function toSummary(
  slug: string,
  cluster: string,
  durationMinutes: number,
  status: string,
  entry: CourseMetaEntry,
  plan: LessonPlan,
  badgeSlug: string
): CourseSummary {
  return {
    slug,
    cluster,
    title: entry.title,
    clusterLabel: entry.clusterLabel,
    tagline: entry.tagline,
    durationMinutes,
    status: status === "draft" || status === "archived" ? status : "published",
    // The lessons the player plays, in its order, under its step names
    // (D58), and the ones a finished lesson still counts from (D64).
    stageKeys: plan.lessons.map((l) => l.id),
    unseenStageKeys: [...plan.unseen],
    stageLabels: Object.fromEntries(plan.lessons.map((l) => [l.id, l.label])),
    ...stageLabelLangs(plan),
    // The dashboard names a badge from the course list; without these it
    // showed a created course's badge as its slug.
    badgeSlug,
    badgeName: entry.title,
    badgeMeaning: entry.tagline,
  };
}

/**
 * The slug of a created course's badge: the Badge row it's linked to
 * (course-badge.ts), else the one the player has always awarded for it.
 */
function badgeSlugOf(row: { slug: string; badge: { slug: string } | null }) {
  return row.badge?.slug ?? courseBadgeSlug(row.slug);
}

/**
 * Health probe for the CMS-created-course path, for /dev/cms-check.
 *
 * Every read here is deliberately wrapped in try/catch so a DB problem
 * degrades instead of breaking the catalogue — which also means a missing
 * migration looks identical to "no courses created yet". This probe is the one
 * place that reports the error instead of swallowing it, so a deploy can be
 * verified rather than assumed.
 */
export async function probeDbCourses(
  projectId: string
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const count = await prisma.course.count({
      where: { projectId, NOT: { meta: { equals: Prisma.DbNull } } },
    });
    return { ok: true, count };
  } catch (e) {
    return { ok: false, count: 0, error: (e as Error).message.slice(0, 200) };
  }
}

/** Summaries for every CMS-created course (those carrying `meta`). */
export async function listDbCourses(
  projectId: string,
  locale: Locale
): Promise<CourseSummary[]> {
  try {
    const rows = await prisma.course.findMany({
      // `meta` present = created in the CMS; DB NULL = bundled course.
      where: { projectId, NOT: { meta: { equals: Prisma.DbNull } } },
      include: { badge: { select: { slug: true } } },
      orderBy: { createdAt: "asc" },
    });
    // Each course's lessons as the player plays them (lessonPlanOf), so the
    // dashboard counts a course against its own lessons rather than all
    // seven, and names them as the player does.
    const plans = await getLessonPlans(projectId, locale);
    const out: CourseSummary[] = [];
    for (const r of rows) {
      const entry = pickMeta(r.meta as CourseMeta | null, locale);
      const plan = plans.get(r.slug);
      if (!entry || !plan) continue;
      out.push(
        toSummary(
          r.slug,
          r.cluster,
          r.durationMinutes,
          r.status,
          entry,
          plan,
          badgeSlugOf(r)
        )
      );
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Assemble a full CourseContent for a CMS-created course. Returns null when
 * the slug has no `meta` — i.e. it's bundled, and the local provider owns it.
 */
export async function getDbCourse(
  projectId: string,
  slug: string,
  locale: Locale
): Promise<CourseContent | null> {
  try {
    const row = await prisma.course.findFirst({
      where: { projectId, slug },
      include: { badge: { select: { slug: true } } },
    });
    if (!row?.meta) return null;
    const entry = pickMeta(row.meta as CourseMeta | null, locale);
    if (!entry) return null;

    // Only what learners get. Never `structureDraft`: an editor's unfinished
    // stage stays on the course page until it is saved for learners.
    const lessons = await prisma.lesson.findMany({
      where: { projectId, courseSlug: slug },
      select: { stageKey: true, narrative: true, structure: true },
    });
    const byStage = new Map(lessons.map((l) => [l.stageKey, l]));
    const isInteractive = (k: StageKey): k is StructureStageKey =>
      k === "simulation" || k === "scenario" || k === "assessment";

    const stages: CourseStage[] = [];
    for (const key of CANONICAL_ORDER) {
      const lesson = byStage.get(key);

      if (isInteractive(key)) {
        // Interactive stages render only when their structure is authored.
        const structure = (lesson?.structure ?? null) as StoredStructure | null;
        if (!structure) continue;
        const DEFAULT_TITLE: Record<StructureStageKey, string> = {
          simulation: "Practice",
          scenario: "Branching scenario",
          assessment: "Quick check",
        };
        // pickText falls back field by field, blanks skipped: the author's
        // English title comes before the generic one.
        stages.push({
          key,
          title: pickText(structure.title, locale) || DEFAULT_TITLE[key],
          ...resolveStructure(structure, locale),
        });
        continue;
      }

      // Narrative-family stage — always present (may be empty until authored).
      // Each field comes from the learner's language, else English, else the
      // first language written; a blank field (typed, then cleared) counts
      // as not written, so learners never get a blank heading or lesson.
      const authored = resolveNarrative(lesson?.narrative ?? null, locale);

      if (key === "reflection") {
        // Reflection is a journaling stage: the player's ReflectionStage needs
        // a `reflection` object (intro + prompts), not narrative blocks. Reuse
        // any authored copy as the intro and provide generic private prompts,
        // localised so a translated course doesn't fall back to English here.
        const d = DEFAULTS[locale] ?? DEFAULTS.en;
        // The intro is the first paragraph: its plain text (a rich
        // paragraph's `text` is always saved beside it, or derived from
        // `rich` if that's all there is) and, once an author has formatted
        // it, its rich text (D36). The fallbacks stay plain.
        const intro = introFromBlocks(authored.blocks);
        const introText = firstText(intro?.text);
        stages.push({
          key,
          title: authored.title ?? d.reflectionTitle,
          reflection: {
            intro: introText ?? authored.subtitle ?? d.reflectionIntro,
            ...(introText && intro?.rich ? { introRich: intro.rich } : {}),
            prompts: d.reflectionPrompts.map((label) => ({
              label,
              placeholder: "",
            })),
          },
        });
        continue;
      }

      stages.push({
        key,
        title: authored.title ?? `${entry.title} — ${key}`,
        subtitle: authored.subtitle,
        blocks: authored.blocks ?? [],
      });
    }

    return {
      slug,
      locale,
      cluster: row.cluster,
      title: entry.title,
      clusterLabel: entry.clusterLabel,
      tagline: entry.tagline,
      durationMinutes: row.durationMinutes,
      badge: {
        slug: badgeSlugOf(row),
        name: entry.title,
        meaning: entry.tagline,
      },
      stages,
      completion: {
        title: (DEFAULTS[locale] ?? DEFAULTS.en).completionTitle,
        body: entry.tagline,
      },
    };
  } catch {
    return null;
  }
}

// Shared with the flexible editor (sections/defaults.ts), so the standard
// reflection questions it offers are the ones learners get here (spec 9.3).
export { DEFAULTS as CMS_STAGE_DEFAULTS };
