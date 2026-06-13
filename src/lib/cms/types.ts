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
