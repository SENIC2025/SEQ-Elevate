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
import {
  fallbackOrder,
  metaFallbackFrom,
  metaHasText,
  narrativeHasText,
  pickMeta,
  type CourseMeta,
  type NarrativeVersion,
} from "./text-fallback";
import { STRUCTURE_STAGE_KEYS, type StoredStructure } from "./structure";
import { fingerprint } from "./stored-json";
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
import { introFromBlocks } from "@/lib/rich-text/narrative";
import type {
  CourseContent,
  CourseStage,
  Locale,
  StageKey,
  VideoContent,
} from "./types";

const PROJECT = "seq-elevate";

// Slugs are [a-z0-9-] (src/lib/slug.ts); anything else can't be a course.
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

const isInteractive = (key: StageKey) =>
  (STRUCTURE_STAGE_KEYS as readonly string[]).includes(key);

type NarrativeJson = Partial<Record<Locale, NarrativeVersion>>;

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
    // Built-in wording, for "Built-in: …", and which lessons ship a video
    // (null for CMS courses).
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
      draft:
        kind === "cms" && isInteractive(key)
          ? ((lesson?.structureDraft ?? null) as StoredStructure | null)
          : null,
      video: (lesson?.video ?? null) as VideoContent | null,
      // From the platform's own course, not what learners see now: a stored
      // video hides the built-in one, which comes back if it's removed
      // (lesson-overlay.ts: `lesson.video ?? stage.video`).
      builtInVideo:
        kind === "bundled" && Boolean(baseCopy[0]?.videoStages.includes(key)),
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

/**
 * A CMS course's copy in `locale`: its own, or what learners get instead. A
 * language whose title and subtitle are both blank (typed, then cleared)
 * has no copy of its own: learners get another language's, and the publish
 * warnings say so.
 */
function cmsCopy(meta: CourseMeta | null, locale: Locale): CourseCopyState {
  const own = meta?.[locale];
  if (own && metaHasText(own)) {
    return {
      title: own.title ?? "",
      tagline: own.tagline ?? "",
      clusterLabel: own.clusterLabel ?? "",
      source: "authored",
    };
  }
  const shown = pickMeta(meta, locale);
  const from = metaFallbackFrom(meta, locale);
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
 * What the narrative editor starts from for one lesson and language: what
 * learners see now, and whether this language has its own stored text.
 */
function narrativeInitial(
  kind: CourseKind,
  body: "narrative" | "reflection",
  stage: NonNullable<LessonOutline["byLang"][Locale]["stage"]>,
  narrative: NarrativeJson | null,
  locale: Locale
): NarrativeInitial {
  const own = narrative?.[locale];
  // A version with nothing but blanks (typed, then cleared) isn't written:
  // learners get another language's text, which the editor then starts from.
  const hasOverride = narrativeHasText(own);
  // A CMS lesson not written in this language shows another language's
  // text, in the order learners get it (db-course.ts: this language, then
  // English, then the first one written). English is no exception: a lesson
  // written only in German opens the English editor on the German text, and
  // the note says so before saving stores it as English.
  const fallbackFrom: Locale | undefined =
    kind === "cms" && !hasOverride && narrative
      ? (fallbackOrder(narrative, locale).find(
          (k) => k !== locale && narrativeHasText(narrative[k as Locale])
        ) as Locale | undefined)
      : undefined;
  // A CMS lesson written in this language starts from what is stored in it,
  // not from what learners see: they get English for any field still blank
  // here, and saving that would copy the English into this language.
  const source =
    kind === "cms" && hasOverride && own ? storedStage(body, own) : stage;
  const base =
    body === "reflection"
      ? {
          title: source.title,
          subtitle: "",
          // The editor shows the intro as a single paragraph (db-course.ts
          // reads back exactly the title and the first paragraph), with its
          // formatting when it has any (D36).
          blocks: [
            {
              kind: "paragraph" as const,
              text: source.reflection?.intro ?? "",
              ...(source.reflection?.introRich
                ? { rich: source.reflection.introRich }
                : {}),
            },
          ],
        }
      : {
          title: source.title,
          subtitle: source.subtitle ?? "",
          blocks: source.blocks ?? [],
        };
  return {
    ...base,
    hasOverride,
    version: fingerprint(narrative?.[locale]),
    ...(fallbackFrom ? { fallbackFrom } : {}),
  };
}

/**
 * One language's stored lesson text, shaped like the stage the editor
 * otherwise starts from: the reflection's intro is its first paragraph, as
 * db-course.ts reads it.
 */
function storedStage(
  body: "narrative" | "reflection",
  own: NarrativeVersion
): Pick<CourseStage, "title" | "subtitle" | "blocks" | "reflection"> {
  if (body === "reflection") {
    const intro = introFromBlocks(own.blocks);
    return {
      title: own.title ?? "",
      reflection: {
        intro: intro?.text ?? "",
        ...(intro?.rich ? { introRich: intro.rich } : {}),
        prompts: [],
      },
    };
  }
  return {
    title: own.title ?? "",
    subtitle: own.subtitle,
    blocks: own.blocks ?? [],
  };
}
