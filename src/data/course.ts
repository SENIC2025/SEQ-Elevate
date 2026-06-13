/**
 * Workplace Conflict — demo micro-course.
 *
 * STRUCTURE lives here in TypeScript so the engine has typed access.
 * COPY (titles, narratives, options) lives in /messages/{en,de,el}.json
 * referenced by the keys below. This mirrors how the real shell will
 * read structured content from Strapi while keeping translatable text
 * in the i18n layer.
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

export const SIMULATION_OPTIONS = [
  "blame",
  "shrink",
  "iStatement",
  "avoid",
] as const;

export type SimulationOption = (typeof SIMULATION_OPTIONS)[number];
export const SIMULATION_CORRECT: SimulationOption = "iStatement";

export const SCENARIO_ROOT_CHOICES = [
  "confront",
  "ignore",
  "private",
  "manager",
] as const;

export type ScenarioRootChoice = (typeof SCENARIO_ROOT_CHOICES)[number];

export const SCENARIO_FOLLOWUP: Record<ScenarioRootChoice, string[]> = {
  confront: ["confrontExplain", "confrontDefensive", "confrontBrush"],
  ignore: ["ignoreTalk", "ignoreSlide", "ignoreShift"],
  private: ["privateAccept", "privateAskStop", "privateBoundary"],
  manager: ["managerTalk", "managerAvoid", "managerBack"],
};

/** Best-path follow-ups, used to colour outcomes (best / okay / poor). */
export const SCENARIO_OUTCOME_QUALITY: Record<string, "best" | "okay" | "poor"> = {
  confront: "poor",
  ignore: "okay",
  private: "best",
  manager: "okay",
  confrontExplain: "okay",
  confrontDefensive: "poor",
  confrontBrush: "poor",
  ignoreTalk: "best",
  ignoreSlide: "poor",
  ignoreShift: "okay",
  privateAccept: "okay",
  privateAskStop: "best",
  privateBoundary: "best",
  managerTalk: "best",
  managerAvoid: "poor",
  managerBack: "okay",
};

export const ASSESSMENT = [
  { id: "q1", options: ["a", "b", "c", "d"] as const, correct: "b" },
  { id: "q2", options: ["a", "b", "c", "d"] as const, correct: "b" },
  { id: "q3", options: ["a", "b", "c", "d"] as const, correct: "b" },
] as const;

export const COURSE_META = {
  id: "workplace-conflict",
  cluster: "communicationEi",
  durationMinutes: 20,
  badgeId: "voice-without-edges",
} as const;

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
