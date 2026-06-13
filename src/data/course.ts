/**
 * Course structure definitions.
 *
 * STRUCTURE (stage order, option ids, scenario tree shape, quality tags,
 * correct answers) lives here in TypeScript so the engine has typed access.
 * COPY (titles, narratives, option text) lives in /messages/{en,de,el}.json
 * under `course.<id>.*`, referenced by the ids below. This mirrors how the
 * real shell reads structured content from Strapi while keeping translatable
 * text in the i18n layer.
 *
 * Adding a course = add a CourseDef here + its localized text in messages.
 * No component code changes — the generic player renders it.
 */

export const STAGES = [
  "context",
  "concept",
  "behaviour",
  "simulation",
  "scenario",
  "reflection",
  "assessment",
] as const;

export type Stage = (typeof STAGES)[number];

export type OutcomeQuality = "best" | "okay" | "poor";

export interface ScenarioFollowupDef {
  id: string;
  quality: OutcomeQuality;
}

export interface ScenarioRootDef {
  id: string;
  quality: OutcomeQuality;
  followups: ScenarioFollowupDef[];
}

export interface AssessmentQDef {
  id: string;
  options: readonly string[];
  correct: string;
}

export interface CourseDef {
  id: string;
  /** Messages namespace under `course.*` holding this course's localized
   *  text (camelCase; the id/slug is hyphenated for clean URLs). */
  contentKey: string;
  cluster: SkillCluster;
  badgeId: string;
  durationMinutes: number;
  simulation: { options: readonly string[]; correct: string };
  scenario: { roots: ScenarioRootDef[] };
  assessment: readonly AssessmentQDef[];
}

export const SKILL_CLUSTERS = [
  "communicationEi",
  "resilience",
  "teamwork",
  "problemSolving",
  "adaptability",
  "leadership",
  "initiative",
] as const;

export type SkillCluster = (typeof SKILL_CLUSTERS)[number];

const ABCD = ["a", "b", "c", "d"] as const;

export const COURSE_DEFS: Record<string, CourseDef> = {
  "workplace-conflict": {
    id: "workplace-conflict",
    contentKey: "workplaceConflict",
    cluster: "communicationEi",
    badgeId: "voice-without-edges",
    durationMinutes: 20,
    simulation: {
      options: ["blame", "shrink", "iStatement", "avoid"],
      correct: "iStatement",
    },
    scenario: {
      roots: [
        {
          id: "confront",
          quality: "poor",
          followups: [
            { id: "confrontExplain", quality: "okay" },
            { id: "confrontDefensive", quality: "poor" },
            { id: "confrontBrush", quality: "poor" },
          ],
        },
        {
          id: "ignore",
          quality: "okay",
          followups: [
            { id: "ignoreTalk", quality: "best" },
            { id: "ignoreSlide", quality: "poor" },
            { id: "ignoreShift", quality: "okay" },
          ],
        },
        {
          id: "private",
          quality: "best",
          followups: [
            { id: "privateAccept", quality: "okay" },
            { id: "privateAskStop", quality: "best" },
            { id: "privateBoundary", quality: "best" },
          ],
        },
        {
          id: "manager",
          quality: "okay",
          followups: [
            { id: "managerTalk", quality: "best" },
            { id: "managerAvoid", quality: "poor" },
            { id: "managerBack", quality: "okay" },
          ],
        },
      ],
    },
    assessment: [
      { id: "q1", options: ABCD, correct: "b" },
      { id: "q2", options: ABCD, correct: "b" },
      { id: "q3", options: ABCD, correct: "b" },
    ],
  },

  "receiving-feedback": {
    id: "receiving-feedback",
    contentKey: "receivingFeedback",
    cluster: "resilience",
    badgeId: "feedback-as-fuel",
    durationMinutes: 20,
    simulation: {
      options: ["defend", "crumble", "clarify", "dismiss"],
      correct: "clarify",
    },
    scenario: {
      roots: [
        {
          id: "argue",
          quality: "poor",
          followups: [
            { id: "argueDouble", quality: "poor" },
            { id: "argueConcede", quality: "okay" },
            { id: "argueAsk", quality: "okay" },
          ],
        },
        {
          id: "deflate",
          quality: "okay",
          followups: [
            { id: "deflateSpiral", quality: "poor" },
            { id: "deflateRegroup", quality: "best" },
            { id: "deflateAsk", quality: "okay" },
          ],
        },
        {
          id: "askWhat",
          quality: "best",
          followups: [
            { id: "askFix", quality: "best" },
            { id: "askDefend", quality: "okay" },
            { id: "askOverwhelm", quality: "poor" },
          ],
        },
        {
          id: "takeTime",
          quality: "okay",
          followups: [
            { id: "takeReturn", quality: "best" },
            { id: "takeAvoid", quality: "poor" },
            { id: "takeRush", quality: "okay" },
          ],
        },
      ],
    },
    assessment: [
      { id: "q1", options: ABCD, correct: "b" },
      { id: "q2", options: ABCD, correct: "b" },
      { id: "q3", options: ABCD, correct: "b" },
    ],
  },
};

/** Order courses appear in lists / on the dashboard. */
export const COURSE_ORDER = ["workplace-conflict", "receiving-feedback"];

/** Back-compat: the original course meta, used by the DB seed. */
export const COURSE_META = {
  id: "workplace-conflict",
  cluster: "communicationEi",
  durationMinutes: 20,
  badgeId: "voice-without-edges",
} as const;
