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
 * SCOPE, deliberately: a CMS-created course carries the NARRATIVE stages
 * (context → concept → behaviour → reflection). The interactive stages
 * (simulation, branching scenario, assessment) still need the structure editor
 * that is on the roadmap, so they are omitted rather than faked. The player
 * already renders exactly the stages present in `stages`, so a shorter course
 * is a first-class citizen, not a broken one.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  CourseContent,
  CourseStage,
  CourseSummary,
  Locale,
  NarrativeBlock,
} from "./types";

/** Stages a CMS-created course ships with, in canonical order. */
const CMS_STAGES = ["context", "concept", "behaviour", "reflection"] as const;

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

    const stages: CourseStage[] = [];
    for (const key of CMS_STAGES) {
      const lesson = byStage.get(key);
      const narrative = (lesson?.narrative ?? null) as Record<
        string,
        { title?: string; subtitle?: string; blocks?: NarrativeBlock[] }
      > | null;
      const authored = narrative?.[locale] ?? narrative?.en ?? null;

      // A stage with no authored copy yet still appears, so the editor can
      // see the shape of the course they're building.
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
