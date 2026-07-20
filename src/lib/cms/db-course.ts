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
  NarrativeBlock,
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

export interface CourseMetaEntry {
  title: string;
  tagline: string;
  clusterLabel: string;
}
export type CourseMeta = Partial<Record<Locale, CourseMetaEntry>>;

/**
 * Pick the best copy for a locale: the requested one, else English, else the
 * first authored language. A half-translated course still renders instead of
 * showing blanks — the editor fills the gaps as they go.
 */
export function pickMeta(
  meta: CourseMeta | null,
  locale: Locale
): CourseMetaEntry | null {
  if (!meta) return null;
  return meta[locale] ?? meta.en ?? Object.values(meta)[0] ?? null;
}

function toSummary(
  slug: string,
  cluster: string,
  durationMinutes: number,
  status: string,
  entry: CourseMetaEntry
): CourseSummary {
  return {
    slug,
    cluster,
    title: entry.title,
    clusterLabel: entry.clusterLabel,
    tagline: entry.tagline,
    durationMinutes,
    status: status === "draft" || status === "archived" ? status : "published",
  };
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
      orderBy: { createdAt: "asc" },
    });
    const out: CourseSummary[] = [];
    for (const r of rows) {
      const entry = pickMeta(r.meta as CourseMeta | null, locale);
      if (!entry) continue;
      out.push(
        toSummary(r.slug, r.cluster, r.durationMinutes, r.status, entry)
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
    });
    if (!row?.meta) return null;
    const entry = pickMeta(row.meta as CourseMeta | null, locale);
    if (!entry) return null;

    const lessons = await prisma.lesson.findMany({
      where: { projectId, courseSlug: slug },
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
        stages.push({
          key,
          title: pickText(structure.title, locale) || DEFAULT_TITLE[key],
          ...resolveStructure(structure, locale),
        });
        continue;
      }

      // Narrative-family stage — always present (may be empty until authored).
      const narrative = (lesson?.narrative ?? null) as Record<
        string,
        { title?: string; subtitle?: string; blocks?: NarrativeBlock[] }
      > | null;
      const authored = narrative?.[locale] ?? narrative?.en ?? null;

      if (key === "reflection") {
        // Reflection is a journaling stage: the player's ReflectionStage needs
        // a `reflection` object (intro + prompts), not narrative blocks. Reuse
        // any authored copy as the intro and provide generic private prompts.
        const introText =
          authored?.blocks?.find((b) => b.kind === "paragraph")?.text ??
          authored?.subtitle ??
          "Take a moment to reflect on what you just practised.";
        stages.push({
          key,
          title: authored?.title ?? `${entry.title} — reflection`,
          reflection: {
            intro: introText,
            prompts: [
              { label: "What went well?", placeholder: "" },
              { label: "What was hard?", placeholder: "" },
              { label: "What will you try next time?", placeholder: "" },
            ],
          },
        });
        continue;
      }

      stages.push({
        key,
        title: authored?.title ?? `${entry.title} — ${key}`,
        subtitle: authored?.subtitle,
        blocks: authored?.blocks ?? [],
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
        slug: `${slug}-complete`,
        name: entry.title,
        meaning: entry.tagline,
      },
      stages,
      completion: {
        title: "Course complete",
        body: entry.tagline,
      },
    };
  } catch {
    return null;
  }
}
