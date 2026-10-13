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

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { viewerCanEditContent } from "@/lib/editor-gate";
import { learnerUserWhere } from "@/lib/learner-scope";
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
  resolveNarrative,
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
  type LessonFacts,
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
import {
  INTERACTIVE_KEYS,
  SECTION_LIMITS,
  mainKindOf,
  type MainKind,
  type ResolvedOutline,
  type ResolvedSection,
  type SectionFacts,
  type SectionStage,
  type SectionsMeta,
  type SectionView,
} from "./sections/contract";
import { newOnlyReasons } from "./sections/guard";
import {
  canonicalInsertIndex,
  freeInteractiveKeys,
  labelVersion,
  outlineVersion,
  resolveOutline,
} from "./sections/outline";
import { previewDefaults } from "./sections/defaults";
import { nameSection, standardName } from "./sections/names";
import { resolveSectionStage } from "./sections/resolve";
import { sectionContentVersion } from "./sections/versions";
import {
  deleteSummary,
  hasExtraOrUnreadable,
  partsView,
  sectionTitle,
} from "./sections/views";
import type {
  CourseContent,
  CourseStage,
  LessonDocumentRef,
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

/*
 * "N learners enrolled" (and the unpublish warning) counts learners only.
 * Staff who still hold the LEARNER role an older release gave them, and
 * editors trying out their own course, aren't learners of it.
 */
const enrolledLearners = {
  _count: {
    select: { enrollments: { where: { user: learnerUserWhere(PROJECT) } } },
  },
};

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
        outline: true,
        updatedAt: true,
        ...enrolledLearners,
      },
    }),
    prisma.lesson.findMany({
      where: { projectId: PROJECT, courseSlug: { in: slugs } },
      select: {
        courseSlug: true,
        stageKey: true,
        narrative: true,
        structure: true,
        // A stored lesson list is read with each lesson's extra content
        // (resolveOutline keeps a standard lesson that has some).
        parts: true,
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
    const sections =
      kind === "cms" ? gridSections(row?.outline ?? null, courseLessons, locale) : null;
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
      ...(sections ? { sections } : {}),
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
        outline: true,
        copyOverride: true,
        status: true,
        publishedAt: true,
        updatedAt: true,
        ...enrolledLearners,
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

  if (kind === "cms") {
    const created = createdCourseLessons({
      outlineRaw: row?.outline ?? null,
      lessons,
      byLang,
      present,
      meta,
    });
    const outline: Omit<CourseOutline, "readiness"> = {
      slug,
      kind,
      status: row ? normaliseStatus(row.status) : "published",
      publishedAt: row?.publishedAt?.toISOString() ?? null,
      durationMinutes: en.durationMinutes,
      enrolled: row?._count.enrollments ?? 0,
      lastEdited: lastEdited(row?.updatedAt ?? null, lessons),
      copy,
      languages: created.languages,
      lessons: created.lessons,
      sections: created.sections,
    };
    return { ...outline, readiness: publishReadiness(outline) };
  }

  // A built-in course: its seven lessons, exactly as before Release 1.
  const outlineLessons: LessonOutline[] = [];
  for (const key of STAGES) {
    if (!present.has(key)) continue;

    const lesson = lessonByStage.get(key);
    const narrative = (lesson?.narrative ?? null) as NarrativeJson | null;
    const body: LessonOutline["body"] =
      key === "reflection" ? "reflection" : isInteractive(key) ? "interactive" : "narrative";
    // Built-in reflection and interactive lessons come from code (Q3).
    const bodyEditable = body === "narrative";

    const lessonByLang = {} as LessonOutline["byLang"];
    CONTENT_LOCALES.forEach((l, i) => {
      const stage = byLang[i]?.stages.find((s) => s.key === key) ?? null;
      lessonByLang[l] = {
        stage,
        narrative:
          stage && bodyEditable
            ? narrativeInitial(kind, body as "narrative", stage, narrative, l)
            : null,
        sectioned: null,
      };
    });

    outlineLessons.push({
      key,
      present: true,
      addable: false,
      body,
      mainKind: mainKindOf({ id: key, template: key }),
      editable: { body: bodyEditable, media: true },
      byLang: lessonByLang,
      structure: null,
      draft: null,
      video: (lesson?.video ?? null) as VideoContent | null,
      // From the platform's own course, not what learners see now: a stored
      // video hides the built-in one, which comes back if it's removed
      // (lesson-overlay.ts: `lesson.video ?? stage.video`).
      builtInVideo: Boolean(baseCopy[0]?.videoStages.includes(key)),
      documents: documentRefs(lesson?.documents),
      updatedAt: lesson?.updatedAt.toISOString() ?? null,
      // A built-in course's lesson list can't change.
      section: null,
      parts: null,
      contentVersion: null,
      live: true,
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
    sections: null,
  };
  return { ...outline, readiness: publishReadiness(outline) };
}

/* ------------------------- a created course's lessons ------------------------- */

type LessonRow = Prisma.LessonGetPayload<{ include: { documents: true } }>;

const bodyOf = (kind: MainKind): LessonOutline["body"] =>
  kind === "narrative" || kind === "reflection" ? kind : "interactive";

function documentRefs(
  documents: LessonRow["documents"] | undefined
): LessonDocumentRef[] {
  return (documents ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    url: d.url,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    published: d.published,
  }));
}

const factsOf = (l: LessonRow): SectionFacts => ({
  stageKey: l.stageKey,
  narrative: l.narrative,
  structure: l.structure,
  structureDraft: l.structureDraft,
  parts: l.parts,
  video: l.video,
  documentCount: l.documents.length,
});

/**
 * A created course's rows (spec 9.1): its lesson list in order — the stored
 * one, or today's while nothing is stored (resolveOutline) — and, for each
 * standard practice, scenario and quick check that isn't in it, today's
 * "Add …" row in its standard place. Each lesson carries its name in every
 * content language, its number, its content with the bases of every
 * change, and (for a lesson learners don't get as built) the preview's view
 * of it.
 *
 * Learners get exactly the lessons getCourse gives (`present` there), so
 * `live` comes from it; a lesson of the course's own has no learner stage,
 * and its text editor starts from the stored text.
 */
function createdCourseLessons(input: {
  outlineRaw: unknown;
  lessons: LessonRow[];
  byLang: (CourseContent | null)[];
  present: Set<string>;
  meta: CourseMeta | null;
}): {
  lessons: LessonOutline[];
  sections: SectionsMeta;
  languages: CourseOutline["languages"];
} {
  const { lessons, byLang, present, meta } = input;
  const rowOf = new Map(lessons.map((l) => [l.stageKey, l]));
  const facts = lessons.map(factsOf);
  const resolved = resolveOutline("cms", input.outlineRaw, facts);
  const reasons = newOnlyReasons("cms", resolved, facts);

  // Numbers follow what learners would get: visible lessons with something
  // in them (a standard list's are exactly today's numbers, 1 to n).
  const shown = (s: ResolvedSection) => {
    if (present.has(s.id)) return true;
    const row = rowOf.get(s.id);
    return (
      resolveSectionStage({
        section: s,
        row: row && { ...factsOf(row), documents: documentRefs(row.documents) },
        locale: "en",
        label: "",
        standardTitle: "",
        defaults: previewDefaults("en"),
      }) !== null
    );
  };
  const numbers = new Map<string, number>();
  for (const s of resolved.sections) {
    if (!s.hidden && shown(s)) numbers.set(s.id, numbers.size + 1);
  }

  const rows: LessonOutline[] = resolved.sections.map((s, i) =>
    sectionRow(s, i, resolved, rowOf.get(s.id), byLang, present, numbers.get(s.id) ?? null)
  );

  // Today's "Add guided practice / applied scenario / quick check" for each
  // one that isn't a lesson of the list, where it would go.
  for (const key of INTERACTIVE_KEYS) {
    if (resolved.sections.some((s) => s.id === key)) continue;
    const lesson = rowOf.get(key);
    rows.splice(canonicalInsertIndex(rows.map((r) => ({ id: r.key })), key), 0, {
      key,
      present: false,
      addable: true,
      body: "interactive",
      mainKind: key,
      editable: { body: true, media: false },
      byLang: Object.fromEntries(
        CONTENT_LOCALES.map((l) => [l, { stage: null, narrative: null, sectioned: null }])
      ) as LessonOutline["byLang"],
      structure: (lesson?.structure ?? null) as StoredStructure | null,
      draft: (lesson?.structureDraft ?? null) as StoredStructure | null,
      video: (lesson?.video ?? null) as VideoContent | null,
      builtInVideo: false,
      documents: documentRefs(lesson?.documents),
      updatedAt: lesson?.updatedAt.toISOString() ?? null,
      section: null,
      parts: null,
      contentVersion: null,
      live: false,
    });
  }

  // Coverage counts the lessons learners would get, each read by its main
  // content's kind (a lesson of the course's own may have no row yet).
  const coverageFacts: LessonFacts[] = resolved.sections.map((s) => ({
    ...(rowOf.get(s.id) ?? {}),
    stageKey: s.id,
    mainKind: mainKindOf(s),
  }));
  const languages = languageCoverage("cms", meta, coverageFacts, [...numbers.keys()]);

  const sections: SectionsMeta = {
    version: outlineVersion(resolved),
    resolved,
    reasons,
    freeKeys: freeInteractiveKeys(resolved, facts),
    hasLabels: resolved.sections.some((s) => s.label && Object.keys(s.label).length > 0),
    max: SECTION_LIMITS.maxSections,
    warnAbove: SECTION_LIMITS.warnAbove,
  };
  return { lessons: rows, sections, languages };
}

/** One lesson of a created course's list, as the course page shows it. */
function sectionRow(
  s: ResolvedSection,
  index: number,
  resolved: ResolvedOutline,
  lesson: LessonRow | undefined,
  byLang: (CourseContent | null)[],
  present: Set<string>,
  number: number | null
): LessonOutline {
  const mainKind = mainKindOf(s);
  const body = bodyOf(mainKind);
  const narrative = (lesson?.narrative ?? null) as NarrativeJson | null;
  const documents = documentRefs(lesson?.documents);
  const facts = lesson ? factsOf(lesson) : undefined;
  // The preview's view, for a lesson learners don't get as built.
  const ownView = s.custom || hasExtraOrUnreadable(lesson?.parts);

  const name = {} as SectionView["name"];
  const versions = {} as SectionView["labelVersion"];
  const lessonByLang = {} as LessonOutline["byLang"];
  CONTENT_LOCALES.forEach((l, i) => {
    name[l] = nameSection(s, l, {
      title: sectionTitle(facts, mainKind, l),
      n: number ?? index + 1,
    });
    versions[l] = labelVersion(resolved, s.id, l);

    const stage = byLang[i]?.stages.find((st) => st.key === s.id) ?? null;
    let sectioned: SectionStage | null = null;
    if (ownView) {
      sectioned = resolveSectionStage({
        section: s,
        row: facts && { ...facts, documents },
        locale: l,
        label: name[l].text,
        standardTitle: s.custom ? name[l].text : standardName(s.id as StageKey, l),
        defaults: previewDefaults(l),
      });
    }
    lessonByLang[l] = {
      stage,
      narrative:
        body === "interactive"
          ? null
          : narrativeInitial(
              "cms",
              body,
              stage ?? storedStage(body, resolveNarrative(narrative, l)),
              narrative,
              l
            ),
      sectioned,
    };
  });

  return {
    key: s.id,
    present: true,
    addable: false,
    body,
    mainKind,
    // The lesson is in the list, so its video and documents can be added.
    editable: { body: true, media: true },
    byLang: lessonByLang,
    structure:
      body === "interactive" ? ((lesson?.structure ?? null) as StoredStructure | null) : null,
    draft:
      body === "interactive" ? ((lesson?.structureDraft ?? null) as StoredStructure | null) : null,
    video: (lesson?.video ?? null) as VideoContent | null,
    builtInVideo: false,
    documents,
    updatedAt: lesson?.updatedAt.toISOString() ?? null,
    section: {
      id: s.id,
      template: s.template,
      custom: s.custom,
      hidden: s.hidden === true,
      recovered: s.recovered === true,
      label: s.label ?? {},
      labelVersion: versions,
      name,
      number,
      deleteSummary: deleteSummary(facts),
    },
    parts: partsView(lesson?.parts),
    contentVersion: sectionContentVersion(
      lesson
        ? {
            narrative: lesson.narrative,
            structure: lesson.structure,
            structureDraft: lesson.structureDraft,
            parts: lesson.parts,
            video: lesson.video,
            documentIds: lesson.documents.map((d) => d.id),
          }
        : null
    ),
    live: present.has(s.id),
  };
}

/**
 * The grid card's lesson names when a created course's list is stored, in
 * the grid's language, hidden lessons left out. Undefined otherwise: the card
 * names the standard lessons as before (CourseGrid.test.ts).
 */
function gridSections(
  outlineRaw: unknown,
  lessons: (SectionFacts & { stageKey: string })[],
  locale: Locale
): { id: string; name: string }[] | null {
  const resolved = resolveOutline("cms", outlineRaw, lessons);
  if (!resolved.materialised || resolved.unreadable) return null;
  const rowOf = new Map(lessons.map((l) => [l.stageKey, l]));
  return resolved.sections
    .filter((s) => !s.hidden)
    .map((s, i) => ({
      id: s.id,
      name: nameSection(s, locale, {
        title: sectionTitle(rowOf.get(s.id), mainKindOf(s), locale),
        n: i + 1,
      }).text,
    }));
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
 * learners see now, and whether this language has its own stored text. A
 * lesson of a created course's own has no learner stage yet: `stage` is then
 * its stored text as learners would read it (resolveNarrative).
 */
function narrativeInitial(
  kind: CourseKind,
  body: "narrative" | "reflection",
  stage: Pick<CourseStage, "title" | "subtitle" | "blocks" | "reflection">,
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
