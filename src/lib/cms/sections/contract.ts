/**
 * Release 1 — flexible lessons and their content (D56–D60).
 *
 * The one module every Release 1 stream codes against. Client-safe: types,
 * constants and tiny total guards only — no prisma, no "server-only".
 * Owned by the Foundation stream; after it merges, only the integration
 * lead edits this file.
 *
 * Vocabulary (code ↔ screen):
 *   section = a "lesson" on screen (en Lesson, de Lektion, el ενότητα)
 *   part    = "content" on screen ("Add content", "Quick check · 2 of 4")
 *   main    = the part that IS the lesson's Release 0 content, stored where
 *             Release 0 stores it: Lesson.narrative / structure / structureDraft.
 *             It never moves; Lesson.parts only holds a placeholder for it.
 */
import { STAGES } from "@/data/course";
import type { CourseKind, CourseOutline } from "@/lib/cms/course-admin-types";
import type { CourseStatus } from "@/lib/cms/course-status";
import type {
  CourseContent,
  CourseStage,
  LessonDocumentRef,
  Locale,
  NarrativeBlock,
  StageKey,
  VideoContent,
} from "@/lib/cms/types";
import type { RichText } from "@/lib/rich-text/types";
import type {
  LocalizedText,
  StoredAssessment,
  StoredScenario,
  StoredSimulation,
  StructureFieldCode,
  StructureIssue,
  StructureIssueCode,
} from "@/lib/cms/structure";
import type { StructureLimitBreach } from "@/lib/cms/structure-sanitize";

/* ------------------------------------------------------------------ ids --- */

/** Learner order of the standard layout (= db-course CANONICAL_ORDER = STAGES). */
export const LEGACY_ORDER: readonly StageKey[] = STAGES;

export const NARRATIVE_KEYS = ["context", "concept", "behaviour", "reflection"] as const;
export type NarrativeKey = (typeof NARRATIVE_KEYS)[number];
export const INTERACTIVE_KEYS = ["simulation", "scenario", "assessment"] as const;
export type InteractiveKey = (typeof INTERACTIVE_KEYS)[number];

/** A lesson added in Release 1: "s-" + 8 × [a-z0-9], generated on the server. */
export type CustomSectionId = `s-${string}`;
/** Legacy lessons keep their stage key as id, so ?lesson= and #lesson- links keep working. */
export type SectionId = StageKey | CustomSectionId;
export const CUSTOM_SECTION_ID = /^s-[a-z0-9]{8}$/;

export function isLegacySectionId(v: unknown): v is StageKey {
  return typeof v === "string" && (LEGACY_ORDER as readonly string[]).includes(v);
}
export function isCustomSectionId(v: unknown): v is CustomSectionId {
  return typeof v === "string" && CUSTOM_SECTION_ID.test(v);
}
export function isSectionId(v: unknown): v is SectionId {
  return isLegacySectionId(v) || isCustomSectionId(v);
}

/** The lesson's Release 0 content. Always present, exactly once. */
export const MAIN_PART_ID = "main" as const;
/** Extra content: "p-" + 8 × [a-z0-9], generated on the server. */
export type ExtraPartId = `p-${string}`;
export type PartId = typeof MAIN_PART_ID | ExtraPartId;
export const EXTRA_PART_ID = /^p-[a-z0-9]{8}$/;

export function isExtraPartId(v: unknown): v is ExtraPartId {
  return typeof v === "string" && EXTRA_PART_ID.test(v);
}
export function isPartId(v: unknown): v is PartId {
  return v === MAIN_PART_ID || isExtraPartId(v);
}

/** Release 2 response and telemetry key. Neither id can contain "/". */
export type PartKey = `${SectionId}/${PartId}`;
export function partKey(sectionId: SectionId, partId: PartId): PartKey {
  return `${sectionId}/${partId}`;
}

/**
 * How Release 2 reads today's CourseEnrollment answer columns — no backfill:
 * simulationChoice/Correct → simulation/main; scenarioRoot/Followup →
 * scenario/main; reflection {p1,p2,p3} → reflection/main prompts p1–p3;
 * assessment {answers, checked} → assessment/main.
 */
export const LEGACY_ANSWER_PART = {
  simulation: "simulation/main",
  scenario: "scenario/main",
  reflection: "reflection/main",
  assessment: "assessment/main",
} as const satisfies Record<string, PartKey>;

/** Ids of the platform's standard reflection questions (= CourseEnrollment.reflection keys). */
export const STANDARD_PROMPT_IDS = ["p1", "p2", "p3"] as const;

/* ------------------------------------------------------------ templates --- */

/** What a Release 1 lesson was made from. Informational: names its fallback and icon. */
export type NewSectionTemplate =
  | "blank"
  | "text"
  | "practice"
  | "scenario"
  | "quiz"
  | "reflectionRating";
export const NEW_SECTION_TEMPLATES: readonly NewSectionTemplate[] = [
  "blank",
  "text",
  "practice",
  "scenario",
  "quiz",
  "reflectionRating",
];
/** A legacy lesson's template is always its own key. */
export type SectionTemplate = StageKey | NewSectionTemplate;

/** What the lesson's main content is, i.e. which Release 0 editor edits it. */
export type MainKind = "narrative" | "reflection" | "simulation" | "scenario" | "assessment";

export function mainKindOf(s: { id: SectionId; template: SectionTemplate }): MainKind {
  if (isLegacySectionId(s.id)) {
    if (s.id === "reflection") return "reflection";
    if ((INTERACTIVE_KEYS as readonly string[]).includes(s.id)) return s.id as InteractiveKey;
    return "narrative";
  }
  switch (s.template) {
    case "practice":
      return "simulation";
    case "scenario":
      return "scenario";
    case "quiz":
      return "assessment";
    default:
      return "narrative";
  }
}

/** Practice / scenario / quiz reuse their standard key when it is free (D56). */
export const STANDARD_KEY_OF: Readonly<Partial<Record<NewSectionTemplate, InteractiveKey>>> = {
  practice: "simulation",
  scenario: "scenario",
  quiz: "assessment",
};

/** The "Add lesson" picker. restore:<key> re-adds a deleted standard lesson (empty). */
export type AddSectionChoice = NewSectionTemplate | `restore:${NarrativeKey}`;

/* -------------------------------------------------------------- outline --- */

/** One entry of Course.outline as stored. */
export interface StoredSection {
  id: SectionId;
  template: SectionTemplate;
  hidden?: true;
  /** Step name per language; at most SECTION_LIMITS.labelChars; blank locales dropped (D51). */
  label?: LocalizedText;
}
export interface StoredOutline {
  v: 1;
  sections: StoredSection[];
  /** Standard narrative lessons an editor deleted (else db-course would bring them back empty). */
  removed?: NarrativeKey[];
}

export interface ResolvedSection extends StoredSection {
  custom: boolean;
  /** A legacy lesson missing from the stored list, put back at its standard place. */
  recovered?: true;
}
export interface ResolvedOutline {
  sections: ResolvedSection[];
  removed: NarrativeKey[];
  /** Course.outline is non-null. */
  materialised: boolean;
  /** Course.outline holds something unreadable: writes refused, publishing blocked. */
  unreadable?: true;
}

/** One Lesson row as the pure rules read it (all JSON raw / untrusted). */
export interface SectionFacts {
  stageKey: string;
  narrative?: unknown;
  structure?: unknown;
  structureDraft?: unknown;
  parts?: unknown;
  video?: unknown;
  documentCount?: number;
}

/* ---------------------------------------------------------------- parts --- */

export type PartType = "text" | "practice" | "scenario" | "quiz" | "reflection" | "rating";
export type QuestionPartType = Exclude<PartType, "text">;

export interface StoredReflection {
  kind: "reflection";
  title?: LocalizedText;
  intro?: LocalizedText;
  prompts: { id: string; label: LocalizedText; placeholder?: LocalizedText }[];
}
/** A 1–5 self-assessment: statements rated 1 to 5 with labelled ends. The scale is fixed. */
export interface StoredRating {
  kind: "rating";
  title?: LocalizedText;
  intro?: LocalizedText;
  minLabel: LocalizedText;
  maxLabel: LocalizedText;
  statements: { id: string; text: LocalizedText }[];
}
export type ExerciseValue =
  | StoredSimulation
  | StoredScenario
  | StoredAssessment
  | StoredReflection
  | StoredRating;
export type ExerciseKind = ExerciseValue["kind"];

export const KIND_OF_PART: Readonly<Record<QuestionPartType, ExerciseKind>> = {
  practice: "simulation",
  scenario: "scenario",
  quiz: "assessment",
  reflection: "reflection",
  rating: "rating",
};

/** One item of Lesson.parts. */
export type StoredPart =
  | { id: typeof MAIN_PART_ID; type: "main" }
  | { id: ExtraPartId; type: "text"; blocks: Partial<Record<Locale, NarrativeBlock[]>> }
  | {
      id: ExtraPartId;
      type: QuestionPartType;
      /** What learners (and preview) get; passed validateExercise when written. */
      data: ExerciseValue | null;
      /** Editor-only unfinished version (Release 0 draft semantics, D52). */
      draft: ExerciseValue | null;
    };
export interface StoredParts {
  v: 1;
  items: StoredPart[];
}

/* --------------------------------------------------------------- limits --- */

export const SECTION_LIMITS = {
  /** Hard, server-enforced; hidden lessons count. */
  maxSections: 15,
  /** UI warning above this many visible lessons. */
  warnAbove: 12,
  labelChars: 40,
  /** Including main. */
  maxPartsPerSection: 12,
  /** Lesson.parts as JSON. */
  maxPartsJsonChars: 600_000,
} as const;

export const PART_LIMITS = {
  titleChars: 200,
  introChars: 2_000,
  reflectionPrompts: 10,
  promptChars: 300,
  placeholderChars: 200,
  ratingStatements: 12,
  statementChars: 300,
  endLabelChars: 60,
} as const;

/* ---------------------------------------------------------------- guard --- */

export type NewOnlyCode =
  | "custom-section"
  | "hidden-section"
  | "removed-section"
  | "reordered"
  | "extra-parts"
  | "unreadable";
/** Why learners would not get what the editor built. Labels are never a reason (D58). */
export interface NewOnlyReason {
  code: NewOnlyCode;
  sectionId?: SectionId;
}
export function reasonKey(r: NewOnlyReason): string {
  return `${r.code}:${r.sectionId ?? ""}`;
}

/* --------------------------------------------------------------- issues --- */

export type PartIssueCode =
  | StructureIssueCode
  | "reflectionNoPrompts"
  | "reflectionPromptText"
  | "ratingNoStatements"
  | "ratingStatementText"
  | "ratingEndLabels";
export type PartPlaces = NonNullable<StructureIssue["params"]> &
  Partial<Record<"prompt" | "statement", number>>;
export interface PartIssue {
  code: PartIssueCode;
  params?: PartPlaces;
}

export type PartFieldCode =
  | "partTitle"
  | "partIntro"
  | "reflectionPromptLabel"
  | "reflectionPromptPlaceholder"
  | "ratingMinLabel"
  | "ratingMaxLabel"
  | "ratingStatementText";
export type PartListCode = "reflectionPrompts" | "ratingStatements";
/** Where a part is over a limit; rendered by structure-limit-text.ts limitText. */
export type PartLimitBreach =
  | StructureLimitBreach
  | { limit: "text"; field: PartFieldCode; params?: PartPlaces; locale: Locale; max: number }
  | { limit: "list"; list: PartListCode; params?: PartPlaces; max: number; count: number };

/* ------------------------------------------------------- action results --- */

/** Fingerprints (stored-json.ts) of a question part's live version and draft. */
export interface PartBase {
  data: string | null;
  draft: string | null;
}
/** A question part as its editor loads it: same shape as actions/structure StructureState. */
export interface ExerciseState {
  structure: ExerciseValue | null;
  draft: ExerciseValue | null;
}

export type SectionsError =
  | "forbidden"
  | "bad-input"
  | "bad-locale"
  | "unknown-course"
  | "not-cms-course"
  | "outline-unreadable"
  | "not-a-section"
  | "unknown-part"
  | "too-many-sections"
  | "too-many-parts"
  | "at-edge"
  | "label-too-long"
  | "not-restorable"
  | "main-required"
  | "use-main-editor"
  | "kind-mismatch"
  | "parts-too-large"
  | "changed-elsewhere"
  | "live-course-standard-only"
  | "has-learners";

export type Refused =
  | {
      ok: false;
      error: Exclude<SectionsError, "changed-elsewhere" | "live-course-standard-only" | "has-learners">;
    }
  /** Structural actions include the fresh outline so the page shows the colleague's change (D39). */
  | { ok: false; error: "changed-elsewhere"; outline?: CourseOutline }
  | { ok: false; error: "live-course-standard-only"; reasons: NewOnlyReason[] }
  | { ok: false; error: "has-learners"; count: number };

/** Structural actions (lessons and parts): the whole course outline, to dispatch. */
export type OutlineResult =
  | { ok: true; outline: CourseOutline; id?: SectionId | ExtraPartId }
  | Refused;
/** Rename and text saves: the new base. */
export type VersionResult =
  | { ok: true; version: string | null }
  | Refused
  | { ok: false; error: "invalid"; issues: string[] };
export type ExerciseSaveResult =
  | { ok: true; structure: ExerciseValue }
  | Refused
  | { ok: false; error: "invalid"; issues: PartIssue[] }
  | { ok: false; error: "too-large"; at: PartLimitBreach };
export type ExerciseDraftResult =
  | { ok: true; draft: ExerciseValue; issues: PartIssue[] }
  | Refused
  | { ok: false; error: "too-large"; at: PartLimitBreach };
export type ExerciseDiscardResult = { ok: true } | Refused;
/** Added to setCourseStatus's result union (G1). */
export type PublishRefused = { ok: false; error: "needs-release-2"; reasons: NewOnlyReason[] };

/* ------------------------------------------------- course-page view types --- */

export type LabelSource = "own" | "standard" | "other-language" | "title" | "template" | "generic";

export interface DeleteSummary {
  languages: Locale[];
  textBlocks: number;
  questionBlocks: number;
  video: boolean;
  documents: number;
}

export interface SectionView {
  id: SectionId;
  template: SectionTemplate;
  custom: boolean;
  hidden: boolean;
  recovered: boolean;
  label: LocalizedText;
  /** Base for renameSection, per language. */
  labelVersion: Record<Locale, string | null>;
  /** Resolved step name per content language (sectionLabel). */
  name: Record<Locale, { text: string; source: LabelSource }>;
  /** Position learners would get, among visible lessons with content; null otherwise. */
  number: number | null;
  deleteSummary: DeleteSummary;
}

export type PartView =
  | { id: typeof MAIN_PART_ID; type: "main" }
  | {
      id: ExtraPartId;
      type: "text";
      blocks: Partial<Record<Locale, NarrativeBlock[]>>;
      versions: Record<Locale, string | null>;
      itemVersion: string;
    }
  | {
      id: ExtraPartId;
      type: QuestionPartType;
      data: ExerciseValue | null;
      draft: ExerciseValue | null;
      versions: PartBase;
      itemVersion: string;
      issues: PartIssue[];
    };
export interface PartsView {
  items: PartView[];
  /** partsOrderVersion: base for addPart / movePart / removePart. */
  order: string;
}

/** CourseOutline.sections (created courses only). */
export interface SectionsMeta {
  /** outlineVersion (labels excluded): base for add / move / hide / delete. */
  version: string;
  /** For client-side predictions with the same pure functions the server runs. */
  resolved: ResolvedOutline;
  reasons: NewOnlyReason[];
  /** Interactive keys an "Add practice / scenario / quiz" would reuse. */
  freeKeys: InteractiveKey[];
  hasLabels: boolean;
  max: typeof SECTION_LIMITS.maxSections;
  warnAbove: typeof SECTION_LIMITS.warnAbove;
}

/* --------------------------------------------------------- preview types --- */

export type ResolvedPart =
  | { id: PartId; type: "text"; blocks: NarrativeBlock[] }
  | {
      id: PartId;
      type: "practice";
      title?: string;
      simulation: {
        prompt: string;
        instruction: string;
        options: NonNullable<CourseStage["simulation"]>["options"];
      };
    }
  | {
      id: PartId;
      type: "scenario";
      title?: string;
      scenario: NonNullable<CourseStage["scenario"]>;
    }
  | {
      id: PartId;
      type: "quiz";
      title?: string;
      assessment: NonNullable<CourseStage["assessment"]>;
    }
  | {
      id: PartId;
      type: "reflection";
      title?: string;
      intro?: string;
      introRich?: RichText;
      prompts: { id: string; label: string; placeholder: string }[];
    }
  | {
      id: PartId;
      type: "rating";
      title?: string;
      intro?: string;
      minLabel: string;
      maxLabel: string;
      statements: { id: string; text: string }[];
    };

/** One lesson in an editor's preview of a non-standard course. Never built for learners. */
export interface SectionStage {
  key: SectionId;
  label: string;
  title: string;
  subtitle?: string;
  video?: VideoContent;
  documents?: LessonDocumentRef[];
  parts: ResolvedPart[];
  /** Parts left out because they are only a draft or not ready (editor-only note). */
  skipped: number;
}
export interface SectionedCourseContent extends Omit<CourseContent, "stages"> {
  sectioned: true;
  stages: SectionStage[];
}
export function isSectionedCourse(
  c: CourseContent | SectionedCourseContent
): c is SectionedCourseContent {
  return (c as Partial<SectionedCourseContent>).sectioned === true;
}

/* --------------------------------------------------- preview answers (C) --- */

export type PartAnswer =
  | { type: "practice"; optionId: string }
  | { type: "scenario"; rootId: string; followupId?: string }
  | { type: "quiz"; answers: Record<string, string>; checked: boolean }
  | { type: "reflection"; text: Record<string, string> }
  | { type: "rating"; values: Record<string, 1 | 2 | 3 | 4 | 5> };
export type SectionContinueState = { ready: true } | { ready: false; firstMissing: PartId };

/* ====================================================================== */
/* Pure functions. Each is implemented in the named module as             */
/* `export const name: Type = …`, so tsc checks the contract. All TOTAL:   */
/* none throws on malformed JSON.                                          */
/* ====================================================================== */

/** outline.ts — null = column empty; "unreadable" = not an object / not v1. Drops bad or
 *  duplicate ids, forces a legacy id's template to the id, maps an unknown custom template
 *  to "text". Never truncates. */
export type ParseStoredOutline = (raw: unknown) => StoredOutline | null | "unreadable";

/** outline.ts — bundled: all STAGES. cms + null: presentStageKeys("cms", lessons) order.
 *  cms + stored: parsed, then recovery (interactive key with structure, or narrative key not
 *  in `removed`, re-inserted at canonicalInsertIndex). Custom ids only from the outline. */
export type ResolveOutline = (
  kind: CourseKind,
  raw: unknown,
  lessons: readonly SectionFacts[]
) => ResolvedOutline;
export type ToStoredOutline = (o: ResolvedOutline) => StoredOutline;
/** Fingerprint of [id, template, hidden] in order. Labels excluded. */
export type OutlineVersion = (o: ResolvedOutline) => string;
export type LabelVersion = (o: ResolvedOutline, id: SectionId, locale: Locale) => string | null;
/** After the last legacy lesson ranked lower; else before the first ranked higher; else end. */
export type CanonicalInsertIndex = (sections: readonly { id: string }[], key: StageKey) => number;

export type OutlineOp =
  | { op: "add"; choice: AddSectionChoice; at: number | null; newId: CustomSectionId }
  | { op: "move"; id: SectionId; dir: -1 | 1 }
  | { op: "hide"; id: SectionId; hidden: boolean }
  | { op: "rename"; id: SectionId; locale: Locale; label: string }
  | { op: "delete"; id: SectionId };
export type OutlineOpError =
  | "unknown-section"
  | "too-many-sections"
  | "at-edge"
  | "label-too-long"
  | "not-restorable"
  | "bad-input";
export type ApplyOutlineOp = (
  o: ResolvedOutline,
  op: OutlineOp,
  lessons: readonly SectionFacts[]
) => { ok: true; outline: ResolvedOutline; id: SectionId } | { ok: false; error: OutlineOpError };

/** section-parts.ts — null/undefined → [MAIN]. */
export type PartsOf = (raw: unknown) => StoredPart[] | "unreadable";
/** [MAIN] → null (write Prisma.DbNull). */
export type StoredPartsValue = (items: readonly StoredPart[]) => StoredParts | null;
export type PartsOrderVersion = (items: readonly StoredPart[]) => string;
export type PartVersions = (item: StoredPart) => PartBase;
export type ItemVersion = (item: StoredPart) => string;
export type TextPartVersion = (item: StoredPart, locale: Locale) => string | null;
/** Base of deleteSection: narrative, structure, structureDraft, parts, video, sorted document ids. */
export type SectionContentVersion = (
  row: {
    narrative: unknown;
    structure: unknown;
    structureDraft: unknown;
    parts: unknown;
    video: unknown;
    documentIds: readonly string[];
  } | null
) => string | null;

export type PartOp =
  | { op: "add"; part: StoredPart; after: PartId | null }
  | { op: "move"; id: PartId; dir: -1 | 1 }
  | { op: "remove"; id: PartId };
export type PartOpError = "unknown-part" | "main-required" | "too-many-parts" | "at-edge";
export type ApplyPartOp = (
  items: readonly StoredPart[],
  op: PartOp
) => { ok: true; items: StoredPart[] } | { ok: false; error: PartOpError };

export interface PartDefaults {
  reflectionPrompts: { id: string; label: LocalizedText }[];
  ratingLabels: { min: LocalizedText; max: LocalizedText };
}
/** text → {blocks:{}}; question → {data:null, draft: emptyExercise(kind)}. */
export type EmptyPart = (type: PartType, id: ExtraPartId, defaults: PartDefaults) => StoredPart;
/** The items a new lesson starts with (always includes MAIN). */
export type PrefillParts = (
  choice: AddSectionChoice,
  newPartId: () => ExtraPartId,
  defaults: PartDefaults
) => StoredPart[];

/** guard.ts — §2.2 order; [] for bundled. */
export type NewOnlyReasons = (
  kind: CourseKind,
  o: ResolvedOutline,
  lessons: readonly SectionFacts[]
) => NewOnlyReason[];
/** Codes custom-section, hidden-section, removed-section, reordered, unreadable only. */
export type OutlineReasons = (kind: CourseKind, o: ResolvedOutline) => NewOnlyReason[];
/** Every reasonKey in `after` is already in `before`. */
export type LiveWriteAllowed = (
  before: readonly NewOnlyReason[],
  after: readonly NewOnlyReason[]
) => boolean;
/** Client mirror of G3 for a lesson op (the server is authoritative). */
export type PredictOutlineOp = (args: {
  kind: CourseKind;
  status: CourseStatus;
  outline: ResolvedOutline;
  reasons: readonly NewOnlyReason[];
  freeKeys: readonly InteractiveKey[];
  op: OutlineOp;
}) => { allowed: boolean; introduced: NewOnlyReason[] };
/** Client mirror of G3 for a content op inside lesson `sectionId`. */
export type PredictPartOp = (args: {
  status: CourseStatus;
  reasons: readonly NewOnlyReason[];
  sectionId: SectionId;
  op: "add" | "move" | "remove";
  extraPartsAfter: number;
}) => { allowed: boolean };

/** label.ts — §2.5 chain; never blank; never calls standardName with a custom id. */
export type SectionLabel = (
  s: Pick<StoredSection, "id" | "template" | "label">,
  locale: Locale,
  ctx: {
    standardName: (k: StageKey) => string;
    templateName: (t: NewSectionTemplate) => string;
    title?: string | null;
    generic: () => string;
  }
) => { text: string; source: LabelSource };

/** part-kinds.ts */
export type EmptyExercise = (kind: ExerciseKind) => ExerciseValue;
/** Legacy kinds delegate to sanitizeStructure unchanged; reflection/rating are whitelist
 *  rebuilds with the same "stored length may stay, growth refused" rule. */
export type SanitizeExercise = (
  input: unknown,
  kind: ExerciseKind,
  stored?: readonly unknown[]
) =>
  | { ok: true; value: ExerciseValue }
  | { ok: false; error: "bad-input" }
  | { ok: false; error: "too-large"; at: PartLimitBreach };
/** Legacy kinds → validateStructure. Reflection: ≥1 prompt, each with text. Rating: ≥1
 *  statement, each with text, both end labels with text. */
export type ValidateExercise = (v: ExerciseValue) => PartIssue[];
/** Like structure.ts fieldKey, plus the places prompt / statement. Release 0's boxes
 *  (StructureFieldCode, e.g. stageTitle) keep their fieldKey, so a size refusal of any
 *  box can point to it. */
export type PartFieldKey = (
  code: PartIssueCode | PartFieldCode | StructureFieldCode,
  params?: PartPlaces
) => string;
export type PartIssueField = (issue: PartIssue) => string | null;

/** resolve.ts — one lesson for the sectioned preview; null when it has nothing to show. */
export type ResolveSectionStage = (input: {
  section: ResolvedSection;
  row: (SectionFacts & { video?: unknown; documents?: LessonDocumentRef[] }) | undefined;
  locale: Locale;
  label: string;
  standardTitle: string;
  defaults: PartDefaults & { reflectionTitle: string; reflectionIntro: string };
}) => SectionStage | null;

/** sectioned/section-continue.ts (Stream C) — practice chosen; scenario root (+follow-up
 *  when the root has follow-ups); quiz checked. Reflection and rating never gate. */
export type SectionContinue = (
  sectionId: SectionId,
  parts: readonly ResolvedPart[],
  answers: Readonly<Partial<Record<PartKey, PartAnswer>>>
) => SectionContinueState;
