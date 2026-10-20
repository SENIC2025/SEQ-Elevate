/**
 * One lesson of an editor's preview of a course that learners can't get as
 * built yet (D56, spec 9.2): the course's own lessons, hidden ones left out
 * by the caller, extra content in its place. Never built for learners —
 * they keep getting getDbCourse's view, which this module doesn't touch.
 *
 * The main content reads exactly as learners read it today, by the same
 * code: a lesson's text field by field (resolveNarrative), the reflection's
 * intro as its first paragraph, else its subtitle, else the platform's
 * (db-course.ts), and an exercise from Lesson.structure only — never the
 * draft beside it (D52).
 *
 * Extra content shows only what would go live: a question's saved version
 * (`data`) once it passes the checks "Save stage" makes, and a text part in
 * the first language that has text in it (addendum 9). A draft, a question
 * that isn't ready, anything that can't be read, is left out and counted in
 * `skipped`, so the preview can tell the editor.
 *
 * Pure and total: a stored value of the wrong shape is skipped, never thrown
 * on.
 */

import { introFromBlocks } from "@/lib/rich-text/narrative";
import {
  pickText,
  resolveStructure,
  resolveAssessment,
  resolveScenario,
  resolveSimulation,
  type StoredStructure,
} from "../structure";
import { blocksHaveText, fallbackOrder, firstText, resolveNarrative } from "../text-fallback";
import type { LessonDocumentRef, Locale, NarrativeBlock, VideoContent } from "../types";
import {
  KIND_OF_PART,
  MAIN_PART_ID,
  isLegacySectionId,
  mainKindOf,
  type ExerciseValue,
  type ExtraPartId,
  type PartId,
  type ResolvedPart,
  type ResolvedSection,
  type ResolveSectionStage,
  type StoredPart,
} from "./contract";
import type { LessonFacts } from "./learner-path";
import { sanitizeExercise, validateExercise } from "./part-kinds";
import { MAIN_PART, partsOf, storedPartsValue } from "./section-parts";

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Text in the language, else English, else the first written; undefined when blank. */
const text = (t: Partial<Record<Locale, string>> | undefined, locale: Locale) =>
  firstText(pickText(t, locale));

/** A question the way the preview shows it, in one language. */
function resolveQuestion(id: PartId, v: ExerciseValue, locale: Locale): ResolvedPart {
  const title = text(v.title, locale);
  const titled = title ? { title } : {};
  switch (v.kind) {
    case "simulation":
      return { id, type: "practice", ...titled, simulation: resolveSimulation(v, locale) };
    case "scenario":
      return { id, type: "scenario", ...titled, scenario: resolveScenario(v, locale) };
    case "assessment":
      return { id, type: "quiz", ...titled, assessment: resolveAssessment(v, locale) };
    case "reflection": {
      const intro = text(v.intro, locale);
      return {
        id,
        type: "reflection",
        ...titled,
        ...(intro ? { intro } : {}),
        prompts: v.prompts.map((p) => ({
          id: p.id,
          label: pickText(p.label, locale),
          placeholder: pickText(p.placeholder, locale),
        })),
      };
    }
    case "rating": {
      const intro = text(v.intro, locale);
      return {
        id,
        type: "rating",
        ...titled,
        ...(intro ? { intro } : {}),
        minLabel: pickText(v.minLabel, locale),
        maxLabel: pickText(v.maxLabel, locale),
        statements: v.statements.map((s) => ({ id: s.id, text: pickText(s.text, locale) })),
      };
    }
  }
}

/**
 * The main exercise, from what learners get (Lesson.structure), resolved by
 * the learner reader's own resolveStructure. The heading is the stage's, so
 * the part has none. Null when the stored value is of another kind or the
 * wrong shape.
 */
function mainExercise(structure: unknown, kind: StoredStructure["kind"], locale: Locale) {
  if (!isRecord(structure) || structure.kind !== kind) return null;
  try {
    const resolved = resolveStructure(structure as unknown as StoredStructure, locale);
    if (resolved.simulation) return { id: MAIN_PART_ID, type: "practice", simulation: resolved.simulation } as const;
    if (resolved.scenario) return { id: MAIN_PART_ID, type: "scenario", scenario: resolved.scenario } as const;
    if (resolved.assessment) return { id: MAIN_PART_ID, type: "quiz", assessment: resolved.assessment } as const;
    return null;
  } catch {
    return null;
  }
}

/** A text part in the first language with text in it (addendum 9); null when none has. */
function textBlocks(blocks: Partial<Record<Locale, NarrativeBlock[]>>, locale: Locale) {
  const found = fallbackOrder(blocks, locale)
    .map((k) => blocks[k as Locale])
    .find(blocksHaveText);
  return found ?? null;
}

/** An extra part as it would go live, or null when it wouldn't (a draft, not ready, unreadable). */
function extraPart(item: Exclude<StoredPart, { type: "main" }>, locale: Locale): ResolvedPart | null {
  if (item.type === "text") {
    const blocks = textBlocks(item.blocks, locale);
    return blocks ? { id: item.id, type: "text", blocks } : null;
  }
  if (item.data === null) return null;
  const kind = KIND_OF_PART[item.type];
  // The stored value itself is its own allowance: only its shape is checked.
  const clean = sanitizeExercise(item.data, kind, [item.data]);
  if (!clean.ok || validateExercise(clean.value).length > 0) return null;
  return resolveQuestion(item.id, clean.value, locale);
}

export const resolveSectionStage: ResolveSectionStage = ({
  section,
  row,
  locale,
  label,
  standardTitle,
  defaults,
}) => {
  const kind = mainKindOf(section);
  const stored = partsOf(row?.parts);
  // Content that can't be read is one thing the preview leaves out.
  let skipped = stored === "unreadable" ? 1 : 0;
  const items = stored === "unreadable" ? [MAIN_PART] : stored;
  const authored = resolveNarrative(row?.narrative ?? null, locale);
  // A lesson of the course's own has no standard name: its step name, which
  // falls back to its template's name (sectionLabel), never "Course — s-…".
  const fallbackTitle = section.custom ? label : standardTitle;

  let title: string;
  let subtitle: string | undefined;
  let main: ResolvedPart | null = null;
  if (kind === "narrative") {
    title = authored.title ?? fallbackTitle;
    subtitle = authored.subtitle;
    if (authored.blocks) main = { id: MAIN_PART_ID, type: "text", blocks: authored.blocks };
  } else if (kind === "reflection") {
    // As db-course.ts builds the reflection stage learners get.
    title = authored.title ?? defaults.reflectionTitle;
    const intro = introFromBlocks(authored.blocks);
    const introText = firstText(intro?.text);
    // The lesson's own reflection questions replace the standard ones.
    const own = items.some((p) => p.type === "reflection");
    main = {
      id: MAIN_PART_ID,
      type: "reflection",
      intro: introText ?? authored.subtitle ?? defaults.reflectionIntro,
      ...(introText && intro?.rich ? { introRich: intro.rich } : {}),
      prompts: own
        ? []
        : defaults.reflectionPrompts.map((p) => ({
            id: p.id,
            label: pickText(p.label, locale),
            placeholder: "",
          })),
    };
  } else {
    title = fallbackTitle;
    if (row?.structure != null) {
      main = mainExercise(row.structure, kind, locale);
      if (main) title = text((row.structure as { title?: Partial<Record<Locale, string>> }).title, locale) ?? fallbackTitle;
      else skipped++;
    } else if (row?.structureDraft != null) {
      // Only a draft so far: learners get nothing, and neither does the preview.
      skipped++;
    }
  }

  const parts: ResolvedPart[] = [];
  for (const item of items) {
    if (item.type === "main") {
      if (main) parts.push(main);
      continue;
    }
    const part = extraPart(item, locale);
    if (part) parts.push(part);
    else skipped++;
  }

  const video = isRecord(row?.video) ? (row.video as unknown as VideoContent) : undefined;
  const documents: LessonDocumentRef[] = (row?.documents ?? []).filter((d) => d.published);
  const facts: LessonFacts = {
    stageKey: section.id,
    structure: row?.structure ?? null,
    parts: row?.parts ?? null,
    narrative: row?.narrative ?? null,
    hasVideo: video !== undefined,
    publishedDocuments: documents.length,
  };
  if (!lessonHasContent(section, facts)) return null;

  return {
    key: section.id,
    label,
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(video ? { video } : {}),
    ...(documents.length ? { documents } : {}),
    parts,
    skipped,
  };
};

/**
 * Does the lesson have anything to show learners (spec 3.2)? The one rule
 * the sectioned view (resolveSectionStage, above) and the lesson plans
 * (learner-path.ts) both apply, so the player and the counters can't drift
 * apart. The four standard text lessons are always there for learners,
 * written or not (db-course.ts); any other lesson needs its main content,
 * a live extra part, a video or a published document — an exercise nobody
 * saved, or a question that is only a draft, is left out as it is today.
 *
 * Text counts in any language (the first that has some is shown), so the
 * language never changes which lessons there are.
 */
export function lessonHasContent(section: ResolvedSection, f: LessonFacts): boolean {
  const kind = mainKindOf(section);
  if (isLegacySectionId(section.id) && (kind === "narrative" || kind === "reflection")) return true;
  if (f.hasVideo || f.publishedDocuments > 0) return true;
  const stored = partsOf(f.parts);
  const items = stored === "unreadable" ? [MAIN_PART] : stored;
  return items.some((item) => {
    if (item.type !== "main") return extraPart(item, "en") !== null;
    if (kind === "narrative") return resolveNarrative(f.narrative, "en").blocks !== undefined;
    if (kind === "reflection") return true;
    return f.structure != null && mainExercise(f.structure, kind, "en") !== null;
  });
}

/**
 * The one piece of extra content that is all learners get of a lesson,
 * or null: removing it would leave nothing to show (lessonHasContent), so
 * the lesson leaves what learners get (`unseen`) — the course page's
 * confirmation says so. Null when the lesson has nothing to show anyway,
 * or anything else to show (its main content, another piece, a video, a
 * published document), or content that can't be read.
 */
export function soleContentPart(section: ResolvedSection, f: LessonFacts): ExtraPartId | null {
  const stored = partsOf(f.parts);
  if (stored === "unreadable" || !lessonHasContent(section, f)) return null;
  const sole = stored.find(
    (item) =>
      item.type !== "main" &&
      !lessonHasContent(section, { ...f, parts: storedPartsValue(stored.filter((other) => other.id !== item.id)) })
  );
  return sole ? (sole.id as ExtraPartId) : null;
}
