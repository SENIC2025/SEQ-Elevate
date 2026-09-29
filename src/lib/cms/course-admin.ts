import "server-only";

/**
 * Loaders for the "Manage courses" screens (D33): the course grid and one
 * course's page. Plain server functions that the (server component) pages
 * call directly — not server actions, so they are never public endpoints.
 *
 * Both check the editor role themselves and return nothing to anyone else,
 * as a second line behind the page gate (viewerCanEditContent), because they
 * include drafts, draft documents and enrolment counts.
 *
 * "What learners see" always comes from getCourse, the one source of truth
 * the player uses; the rows are read alongside only for what getCourse
 * doesn't say (drafts, raw stored values, timestamps). The pure rules live in
 * course-derive.ts.
 */

import { prisma } from "@/lib/prisma";
import { viewerCanEditContent } from "@/lib/editor-gate";
import { STAGES } from "@/data/course";
import { getBaseCourseCopy, getCourse, listCourses } from "@/lib/cms";
import { normaliseStatus } from "./course-status";
import { readCopyOverride, applyCopy } from "./course-copy";
import { pickMeta, type CourseMeta } from "./db-course";
import { STRUCTURE_STAGE_KEYS, type StoredStructure } from "./structure";
import {
  presentStageKeys,
  languageCoverage,
  lastEdited,
  publishReadiness,
} from "./course-derive";
import {
  CONTENT_LOCALES,
  type CourseCopyState,
  type CourseGridEntry,
  type CourseKind,
  type CourseOutline,
  type LessonOutline,
  type NarrativeInitial,
} from "./course-admin-types";
import type {
  CourseContent,
  Locale,
  NarrativeBlock,
  StageKey,
  VideoContent,
} from "./types";

const PROJECT = "seq-elevate";

// Slugs are [a-z0-9-] (src/lib/slug.ts); anything else can't be a course.
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

const isInteractive = (key: StageKey) =>
  (STRUCTURE_STAGE_KEYS as readonly string[]).includes(key);

type NarrativeJson = Partial<
  Record<Locale, { title?: string; subtitle?: string; blocks?: NarrativeBlock[] }>
>;

/** Every course (drafts and archived included) as a card, in catalogue order. */
export async function getCourseGrid(locale: Locale): Promise<CourseGridEntry[]> {
  if (!(await viewerCanEditContent())) return [];

  const summaries = (
    await listCourses(PROJECT, locale, { includeUnpublished: true })
  ).filter((s) => !s.comingSoon);
  const slugs = summaries.map((s) => s.slug);

  const [rows, lessons] = await Promise.all([
    prisma.course.findMany({
      where: { projectId: PROJECT },
      select: {
        slug: true,
        meta: true,
        updatedAt: true,
        _count: { select: { enrollments: true } },
      },
    }),
    prisma.lesson.findMany({
      where: { projectId: PROJECT, courseSlug: { in: slugs } },
      select: {
        courseSlug: true,
        stageKey: true,
        narrative: true,
        structure: true,
        updatedAt: true,
        // Only the newest upload matters for "last edited".
        documents: {
          select: { createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
  ]);

  const rowBySlug = new Map(rows.map((r) => [r.slug, r]));
  const lessonsBySlug = new Map<string, typeof lessons>();
  for (const l of lessons) {
    const list = lessonsBySlug.get(l.courseSlug) ?? [];
    list.push(l);
    lessonsBySlug.set(l.courseSlug, list);
  }

  return summaries.map((s) => {
    const row = rowBySlug.get(s.slug);
    // `meta` present = created in the CMS (same rule as db-course.ts).
    const kind: CourseKind = row?.meta ? "cms" : "bundled";
    const courseLessons = lessonsBySlug.get(s.slug) ?? [];
    const lessonKeys = presentStageKeys(kind, courseLessons);
    return {
      slug: s.slug,
      title: s.title,
      tagline: s.tagline,
      clusterLabel: s.clusterLabel,
      kind,
      status: s.status,
      durationMinutes: s.durationMinutes,
      enrolled: row?._count.enrollments ?? 0,
      lessonKeys,
      languages: languageCoverage(kind, row?.meta ?? null, courseLessons, lessonKeys),
      lastEdited: lastEdited(row?.updatedAt ?? null, courseLessons),
    };
  });
}

/**
 * Everything the course page needs for one course, or null when the viewer
 * isn't an editor or there is no such course (the page then 404s).
 */
export async function getCourseOutline(
  slug: string
): Promise<CourseOutline | null> {
  if (!(await viewerCanEditContent())) return null;
  if (!SLUG.test(slug)) return null;

  // What learners see, per language (drafts included — getCourse ignores status).
  const byLang = await Promise.all(
    CONTENT_LOCALES.map((l) => getCourse(PROJECT, slug, l))
  );
  const en = byLang[0];
  if (!en) return null;

  const [row, lessons, baseCopy] = await Promise.all([
    prisma.course.findFirst({
      where: { projectId: PROJECT, slug },
      select: {
        meta: true,
        copyOverride: true,
        status: true,
        publishedAt: true,
        updatedAt: true,
        _count: { select: { enrollments: true } },
      },
    }),
    prisma.lesson.findMany({
      where: { projectId: PROJECT, courseSlug: slug },
      // Drafts included: editors manage every document.
      include: {
        documents: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
      },
    }),
    // Built-in wording, for "Built-in: …" (null for CMS courses).
    Promise.all(CONTENT_LOCALES.map((l) => getBaseCourseCopy(PROJECT, slug, l))),
  ]);

  const kind: CourseKind = row?.meta ? "cms" : "bundled";
  const meta = (row?.meta ?? null) as CourseMeta | null;
  const lessonByStage = new Map(lessons.map((l) => [l.stageKey, l]));
  const present = new Set(en.stages.map((s) => s.key));

  const copy = {} as Record<Locale, CourseCopyState>;
  CONTENT_LOCALES.forEach((l, i) => {
    copy[l] =
      kind === "cms"
        ? cmsCopy(meta, l)
        : bundledCopy(baseCopy[i], row?.copyOverride, l, byLang[i] ?? en);
  });

  const outlineLessons: LessonOutline[] = [];
  for (const key of STAGES) {
    const isPresent = present.has(key);
    const addable = !isPresent && kind === "cms" && isInteractive(key);
    if (!isPresent && !addable) continue;

    const lesson = lessonByStage.get(key);
    const narrative = (lesson?.narrative ?? null) as NarrativeJson | null;
    const body: LessonOutline["body"] =
      key === "reflection" ? "reflection" : isInteractive(key) ? "interactive" : "narrative";
    // Built-in reflection and interactive lessons come from code (Q3).
    const bodyEditable = body === "narrative" || kind === "cms";

    const lessonByLang = {} as LessonOutline["byLang"];
    CONTENT_LOCALES.forEach((l, i) => {
      const stage = byLang[i]?.stages.find((s) => s.key === key) ?? null;
      lessonByLang[l] = {
        stage,
        narrative:
          stage && bodyEditable && body !== "interactive"
            ? narrativeInitial(kind, body, stage, narrative, l)
            : null,
      };
    });

    outlineLessons.push({
      key,
      present: isPresent,
      addable,
      body,
      editable: { body: bodyEditable, media: isPresent },
      byLang: lessonByLang,
      structure:
        kind === "cms" && isInteractive(key)
          ? ((lesson?.structure ?? null) as StoredStructure | null)
          : null,
      video: (lesson?.video ?? null) as VideoContent | null,
      builtInVideo:
        kind === "bundled" &&
        !lesson?.video &&
        Boolean(en.stages.find((s) => s.key === key)?.video),
      documents: (lesson?.documents ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        url: d.url,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        published: d.published,
      })),
      updatedAt: lesson?.updatedAt.toISOString() ?? null,
    });
  }

  const presentKeys = STAGES.filter((k) => present.has(k));
  const outline: Omit<CourseOutline, "readiness"> = {
    slug,
    kind,
    // No row = a built-in course nobody has published or unpublished yet,
    // which the catalogue treats as published (course-status.ts).
    status: row ? normaliseStatus(row.status) : "published",
    publishedAt: row?.publishedAt?.toISOString() ?? null,
    durationMinutes: en.durationMinutes,
    enrolled: row?._count.enrollments ?? 0,
    lastEdited: lastEdited(row?.updatedAt ?? null, lessons),
    copy,
    languages: languageCoverage(kind, meta, lessons, presentKeys),
    lessons: outlineLessons,
  };
  return { ...outline, readiness: publishReadiness(outline) };
}

/* --------------------------------- helpers --------------------------------- */

/** A CMS course's copy in `locale`: its own, or what learners get instead. */
function cmsCopy(meta: CourseMeta | null, locale: Locale): CourseCopyState {
  const own = meta?.[locale];
  if (own) {
    return {
      title: own.title ?? "",
      tagline: own.tagline ?? "",
      clusterLabel: own.clusterLabel ?? "",
      source: "authored",
    };
  }
  const shown = pickMeta(meta, locale);
  const from =
    meta?.en ? "en" : (Object.keys(meta ?? {})[0] as Locale | undefined);
  return {
    title: shown?.title ?? "",
    tagline: shown?.tagline ?? "",
    clusterLabel: shown?.clusterLabel ?? "",
    source: "fallback",
    ...(from ? { fallbackFrom: from } : {}),
  };
}

/** A built-in course's copy in `locale`, with any editor rewording on top. */
function bundledCopy(
  base: { title: string; tagline: string; clusterLabel: string } | null,
  storedOverride: unknown,
  locale: Locale,
  shown: CourseContent
): CourseCopyState {
  const builtIn = base ?? {
    title: shown.title,
    tagline: shown.tagline,
    clusterLabel: shown.clusterLabel,
  };
  const override = readCopyOverride(storedOverride);
  const effective = applyCopy(builtIn, override, locale);
  return {
    title: effective.title,
    tagline: effective.tagline,
    clusterLabel: builtIn.clusterLabel,
    source: override[locale] ? "override" : "built-in",
    builtIn: { title: builtIn.title, tagline: builtIn.tagline },
  };
}

/**
 * What the narrative editor starts from for one lesson and language — the
 * same values getLessonContent (actions/lesson.ts) returns.
 */
function narrativeInitial(
  kind: CourseKind,
  body: "narrative" | "reflection",
  stage: NonNullable<LessonOutline["byLang"][Locale]["stage"]>,
  narrative: NarrativeJson | null,
  locale: Locale
): NarrativeInitial {
  const hasOverride = Boolean(narrative?.[locale]);
  // A CMS lesson not written in this language shows the English one
  // (db-course.ts: `narrative[locale] ?? narrative.en`).
  const fallbackFrom: Locale | undefined =
    kind === "cms" && !hasOverride && locale !== "en" && narrative?.en
      ? "en"
      : undefined;
  const base =
    body === "reflection"
      ? {
          title: stage.title,
          subtitle: "",
          // The editor shows the intro as a single paragraph (db-course.ts
          // reads back exactly the title and the first paragraph's text).
          blocks: [
            { kind: "paragraph" as const, text: stage.reflection?.intro ?? "" },
          ],
        }
      : {
          title: stage.title,
          subtitle: stage.subtitle ?? "",
          blocks: stage.blocks ?? [],
        };
  return { ...base, hasOverride, ...(fallbackFrom ? { fallbackFrom } : {}) };
}
