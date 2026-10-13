/**
 * Course outlines of created courses as the loader sends them, for the
 * lesson list's markup tests. Test data only: nothing in the app imports it.
 */

import { STAGES } from "@/data/course";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";
import type { CourseOutline, LessonOutline } from "@/lib/cms/course-admin-types";
import type { CourseStatus } from "@/lib/cms/course-status";
import { newOnlyReasons } from "@/lib/cms/sections/guard";
import {
  freeInteractiveKeys,
  outlineVersion,
  resolveOutline,
} from "@/lib/cms/sections/outline";
import {
  INTERACTIVE_KEYS,
  mainKindOf,
  type ResolvedSection,
  type SectionFacts,
  type SectionsMeta,
  type StoredOutline,
} from "@/lib/cms/sections/contract";
import type { ContentNames } from "./list-model";
import { nameIn } from "./list-model";

const FILES = { en, de, el } as const;

export const NAMES: ContentNames = {
  standard: Object.fromEntries(
    (["en", "de", "el"] as const).map((l) => [
      l,
      Object.fromEntries(STAGES.map((k) => [k, FILES[l].course.stageLabel[k]])),
    ])
  ) as ContentNames["standard"],
  template: Object.fromEntries(
    (["en", "de", "el"] as const).map((l) => [l, FILES[l].course.sectionTemplate])
  ) as ContentNames["template"],
  numbered: { en: en.course.sectionNumbered, de: de.course.sectionNumbered, el: el.course.sectionNumbered },
};

const para = (text: string) => ({ kind: "paragraph", text });
export const TEXT = { en: { title: "T", blocks: [para("x")] } };
export const SIM = {
  kind: "simulation",
  prompt: { en: "Hi" },
  instruction: {},
  options: [
    { id: "a", isBest: true, text: { en: "A" }, feedback: {} },
    { id: "b", isBest: false, text: { en: "B" }, feedback: {} },
  ],
};

/** The four text lessons written, and a saved practice. */
export const STANDARD_ROWS: SectionFacts[] = [
  { stageKey: "context", narrative: TEXT },
  { stageKey: "concept", narrative: TEXT },
  { stageKey: "behaviour", narrative: TEXT },
  { stageKey: "simulation", structure: SIM },
  { stageKey: "reflection", narrative: TEXT },
];

export function sectionsMeta(raw: StoredOutline | null, rows: SectionFacts[] = STANDARD_ROWS): SectionsMeta {
  const resolved = resolveOutline("cms", raw, rows);
  return {
    version: outlineVersion(resolved),
    resolved,
    reasons: newOnlyReasons("cms", resolved, rows),
    freeKeys: freeInteractiveKeys(resolved, rows),
    hasLabels: resolved.sections.some((s) => s.label && Object.keys(s.label).length > 0),
    max: 15,
    warnAbove: 12,
  };
}

const EMPTY_BY_LANG: LessonOutline["byLang"] = {
  en: { stage: null, narrative: null, sectioned: null },
  de: { stage: null, narrative: null, sectioned: null },
  el: { stage: null, narrative: null, sectioned: null },
};

function sectionLesson(s: ResolvedSection, number: number | null, rows: SectionFacts[]): LessonOutline {
  const mainKind = mainKindOf(s);
  const row = rows.find((r) => r.stageKey === s.id);
  const name = (l: "en" | "de" | "el") => nameIn(s, l, NAMES, { n: number ?? 1 });
  return {
    key: s.id,
    present: true,
    addable: false,
    body: mainKind === "narrative" ? "narrative" : mainKind === "reflection" ? "reflection" : "interactive",
    mainKind,
    editable: { body: true, media: true },
    byLang: EMPTY_BY_LANG,
    structure: null,
    draft: (row?.structureDraft ?? null) as LessonOutline["draft"],
    video: null,
    builtInVideo: false,
    documents: [],
    updatedAt: null,
    section: {
      id: s.id,
      template: s.template,
      custom: s.custom,
      hidden: s.hidden === true,
      recovered: s.recovered === true,
      label: s.label ?? {},
      labelVersion: { en: null, de: null, el: null },
      name: { en: name("en"), de: name("de"), el: name("el") },
      number,
      deleteSummary: { languages: ["en"], textBlocks: 1, questionBlocks: 0, video: true, documents: 2 },
    },
    parts: null,
    contentVersion: row ? "cv" : null,
    live: !s.custom && !s.hidden && (row?.narrative != null || row?.structure != null),
  };
}

/** A created course as the course page gets it: its list, then today's "Add …" slots. */
export function createdOutline(
  raw: StoredOutline | null,
  opts: { rows?: SectionFacts[]; status?: CourseStatus; enrolled?: number } = {}
): CourseOutline {
  const rows = opts.rows ?? STANDARD_ROWS;
  const sections = sectionsMeta(raw, rows);
  let n = 0;
  const lessons: LessonOutline[] = sections.resolved.sections.map((s) => {
    const row = rows.find((r) => r.stageKey === s.id);
    const numbered = !s.hidden && (row?.narrative != null || row?.structure != null);
    return sectionLesson(s, numbered ? ++n : null, rows);
  });
  for (const key of INTERACTIVE_KEYS) {
    if (sections.resolved.sections.some((s) => s.id === key)) continue;
    const row = rows.find((r) => r.stageKey === key);
    const at = lessons.findIndex((l) => STAGES.indexOf(l.key as never) > STAGES.indexOf(key));
    lessons.splice(at === -1 ? lessons.length : at, 0, {
      ...sectionLesson({ id: key, template: key, custom: false }, null, rows),
      present: false,
      addable: true,
      editable: { body: true, media: false },
      draft: (row?.structureDraft ?? null) as LessonOutline["draft"],
      section: null,
      live: false,
    });
  }
  const coverage = { state: "partial" as const, covered: 1, total: lessons.length };
  return {
    slug: "asking-for-help",
    kind: "cms",
    status: opts.status ?? "draft",
    publishedAt: null,
    durationMinutes: 20,
    enrolled: opts.enrolled ?? 0,
    lastEdited: null,
    copy: {} as CourseOutline["copy"],
    languages: { en: coverage, de: coverage, el: coverage },
    lessons,
    readiness: sections.reasons.map((reason) => ({
      level: "blocker" as const,
      code: "needs-release-2" as const,
      reason,
      ...(reason.sectionId ? { stage: reason.sectionId } : {}),
    })),
    sections,
  };
}
