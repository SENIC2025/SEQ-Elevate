/**
 * Source-agnostic content types — the contract between the app and the CMS.
 *
 * The platform reads content through these types regardless of whether the
 * bytes come from Strapi, our own Postgres, or local files. This is what
 * makes the CMS swappable (the "hybrid" decision): the app never imports
 * Strapi types directly. See src/lib/cms/provider.ts.
 *
 * Localisation: a CourseContent is requested for a specific locale and
 * returns fully-resolved strings for that locale. The provider is
 * responsible for falling back to the default locale for missing strings.
 */

import type { RichText } from "@/lib/rich-text/types";
import type { LessonLinkRef } from "./reading-types";

export type Locale = "en" | "de" | "el";

export type StageKey =
  | "context"
  | "concept"
  | "behaviour"
  | "simulation"
  | "scenario"
  | "reflection"
  | "assessment";

export type OutcomeQuality = "best" | "okay" | "poor";

/** A single option in a choose-response simulation. */
export interface SimulationOption {
  id: string;
  text: string;
  isBest: boolean;
  feedback: string;
}

/** A branch in the scenario tree (root choice or follow-up). */
export interface ScenarioChoice {
  id: string;
  text: string;
  outcome: string;
  quality: OutcomeQuality;
  /** Follow-up choices shown after this choice's outcome (root choices only). */
  followups?: ScenarioChoice[];
}

export interface AssessmentQuestion {
  id: string;
  question: string;
  options: { id: string; text: string }[];
  correctOptionId: string;
}

/**
 * A question shown at a moment in a video — "interactive video" / cue point.
 * When playback reaches `atSeconds` the video pauses and the question pops up;
 * answering resumes it. Formative (no grade), like the in-course checks.
 */
export interface VideoCue {
  id: string;
  /** When to pause and ask, in seconds from the start of the video. */
  atSeconds: number;
  question: string;
  options: { id: string; text: string }[];
  correctOptionId: string;
  /** Shown after answering, regardless of right/wrong. */
  explanation?: string;
}

/** A WebVTT caption/subtitle track (WCAG 2.2 SC 1.2.2). */
export interface VideoCaptionTrack {
  /** URL to a .vtt file. */
  src: string;
  /** Human label shown in the player's caption menu, e.g. "English". */
  label: string;
  /** BCP-47 language tag, e.g. "en", "de", "el". */
  lang: string;
  /** Show this track by default. */
  default?: boolean;
}

/**
 * A video block attached to a stage. The source is either a direct media
 * file (an uploaded .mp4/.webm or any direct video URL) or a shared platform
 * URL (YouTube). Optional `cues` turn it into an interactive video.
 */
export interface VideoContent {
  /** "file" = native <video> (uploaded file or direct URL); "youtube" = YouTube embed. */
  provider: "file" | "youtube";
  /** Direct media URL (provider "file") or a YouTube watch/share URL or id ("youtube"). */
  src: string;
  /** Heading shown above the player. */
  title?: string;
  /** Poster/thumbnail image URL (provider "file"). */
  poster?: string;
  /** Short caption/transcript-link line under the player. */
  caption?: string;
  /** WebVTT caption tracks (native player). Required for accessibility. */
  captions?: VideoCaptionTrack[];
  /** In-video questions, in any order (sorted by time at render). */
  cues?: VideoCue[];
  /**
   * Set on a learner's page only (markExternalMedia, D91): a file on
   * another host, stored before Release 3. The player shows it as a link
   * out and never loads it in the page.
   */
  external?: boolean;
}

/** The narrative stages (context / concept / behaviour) carry free-form blocks. */
export interface NarrativeBlock {
  /** "paragraph" | "list" | "callout" | "compare" — rendered generically */
  kind: "paragraph" | "list" | "callout" | "compare";
  text?: string;
  /**
   * paragraph/callout: structured rich text (D36). Absent = legacy plain
   * `text`. When present, `text` is server-derived from it.
   */
  rich?: RichText;
  items?: string[];
  /** list only. Absent = "number" (legacy lists always rendered <ol>). */
  listStyle?: "bullet" | "number";
  /** for "compare": two labelled sides */
  compare?: { label: string; text: string; tone: "negative" | "positive" }[];
}

/** An uploaded document attached to a lesson (PDF, Office, image, …). */
export interface LessonDocumentRef {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  /** Visible to learners. Editor sees drafts too; the player only gets published. */
  published: boolean;
  /**
   * Set on a learner's page only (markExternalMedia, D91): a document on
   * another host, stored before Release 3, offered as a link and never
   * shown inside the page.
   */
  external?: boolean;
  /**
   * Release 4 (D108): the languages it is for; absent or [] = every
   * language. Learners get it in those languages only (item-language.ts);
   * whether a lesson is there never depends on it.
   */
  languages?: Locale[];
}

export interface CourseStage {
  key: StageKey;
  title: string;
  subtitle?: string;
  /** Optional video block (with interactive cues) rendered above the stage. */
  video?: VideoContent;
  /** Documents attached to this lesson (authored in the CMS). */
  documents?: LessonDocumentRef[];
  /**
   * Release 4 (D107): the lesson's further reading, published links only,
   * each address checked again as it was read (lesson-links.ts). Never
   * content: it makes no lesson appear and counts for nothing.
   */
  links?: LessonLinkRef[];
  /** narrative stages */
  blocks?: NarrativeBlock[];
  /** simulation stage */
  simulation?: {
    prompt: string;
    instruction: string;
    options: SimulationOption[];
  };
  /** scenario stage */
  scenario?: {
    setup: string;
    question: string;
    choices: ScenarioChoice[];
    followupQuestion: string;
  };
  /** reflection stage */
  reflection?: {
    /** Plain text; with `introRich`, the text derived from it (D36). */
    intro: string;
    /**
     * A created course's intro as its author formatted it (D36), already
     * sanitized. Absent = plain `intro` (built-in courses, defaults, and
     * intros nobody has edited since rich text).
     */
    introRich?: RichText;
    prompts: { label: string; placeholder: string }[];
  };
  /** assessment stage */
  assessment?: {
    intro: string;
    questions: AssessmentQuestion[];
  };
}

export interface CourseContent {
  slug: string;
  locale: Locale;
  cluster: string;
  title: string;
  clusterLabel: string;
  tagline: string;
  durationMinutes: number;
  badge: {
    slug: string;
    name: string;
    meaning: string;
  };
  /** Ordered stages — always the WP3 7-step sequence. */
  stages: CourseStage[];
  completion: {
    title: string;
    body: string;
  };
}

/** Lightweight course descriptor for lists / dashboards. */
export interface CourseSummary {
  slug: string;
  cluster: string;
  title: string;
  clusterLabel: string;
  tagline: string;
  durationMinutes: number;
  status: "draft" | "published" | "archived";
  badgeSlug?: string;
  badgeName?: string;
  badgeMeaning?: string;
  /** Courses not yet authored render as "coming soon" (not clickable). */
  comingSoon?: boolean;
  /**
   * The lessons learners see in this course, in their order: all seven for
   * a built-in course; a created one's lesson plan (lessonPlanOf,
   * src/lib/cms/sections/learner-path.ts) — its own lessons ("s-…")
   * included, hidden ones and ones with nothing to show left out. Progress
   * is counted against these (src/lib/course-progress.ts). Absent = all
   * seven.
   */
  stageKeys?: string[];
  /**
   * A created course's lessons learners don't see (hidden, or nothing to
   * show): one a learner finished still counts towards their progress (D64).
   */
  unseenStageKeys?: string[];
  /**
   * A created course's step names (D58) by lesson id, in the list's
   * language. Absent for a built-in course: its standard names (tStage).
   */
  stageLabels?: Record<string, string>;
  /**
   * The language of a step name that isn't in the list's language (a
   * lesson of the course's own named only in another), by lesson id, for
   * its lang attribute (WCAG 3.1.2). Absent when every name is.
   */
  stageLabelLangs?: Record<string, Locale>;
  /**
   * Release 3 (D90): set by the learners' catalogue (learner-catalogue.ts)
   * when a created course is shown in English under another menu language,
   * because its language isn't switched on yet: the summary is then the
   * English one, and the dashboard marks it (lang, "In English").
   */
  contentLocale?: Locale;
}

/** A Comp Card template (fields the learner fills). Configurable per project. */
export interface CompCardTemplate {
  fields: {
    key: string;
    label: string;
    placeholder?: string;
    kind: "text" | "longtext" | "confidence";
  }[];
}
