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
  /** In-video questions, in any order (sorted by time at render). */
  cues?: VideoCue[];
}

/** The narrative stages (context / concept / behaviour) carry free-form blocks. */
export interface NarrativeBlock {
  /** "paragraph" | "list" | "callout" | "compare" — rendered generically */
  kind: "paragraph" | "list" | "callout" | "compare";
  text?: string;
  items?: string[];
  /** for "compare": two labelled sides */
  compare?: { label: string; text: string; tone: "negative" | "positive" }[];
}

export interface CourseStage {
  key: StageKey;
  title: string;
  subtitle?: string;
  /** Optional video block (with interactive cues) rendered above the stage. */
  video?: VideoContent;
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
    intro: string;
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
