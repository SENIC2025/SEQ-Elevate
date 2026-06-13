/**
 * Local CMS provider — builds CourseContent from the bundled i18n
 * messages + the structure in src/data/course.ts.
 *
 * This is the default content source. It keeps the app fully functional
 * with zero external dependencies, and serves as the reference shape that
 * the Strapi provider must reproduce. When the consortium authors content
 * in Strapi, flip CMS_SOURCE=strapi and the same CourseContent shape comes
 * from the API instead.
 */

import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";
import {
  STAGES,
  SIMULATION_OPTIONS,
  SIMULATION_CORRECT,
  SCENARIO_ROOT_CHOICES,
  SCENARIO_FOLLOWUP,
  SCENARIO_OUTCOME_QUALITY,
  ASSESSMENT,
  COURSE_META,
} from "@/data/course";
import type { CMSProvider } from "./provider";
import type {
  CourseContent,
  CourseStage,
  CourseSummary,
  CompCardTemplate,
  Locale,
  ScenarioChoice,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const MESSAGES: Record<Locale, any> = { en, de, el };

function msgs(locale: Locale) {
  return MESSAGES[locale] ?? MESSAGES.en;
}

function buildWorkplaceConflict(locale: Locale): CourseContent {
  const m = msgs(locale).course.workplaceConflict;
  const stageLabel = msgs(locale).course.stageSubtitle;

  const stages: CourseStage[] = STAGES.map((key): CourseStage => {
    const base = { key, title: m[key]?.title ?? "", subtitle: stageLabel[key] };

    if (key === "context") {
      return {
        ...base,
        blocks: [
          { kind: "paragraph", text: m.context.narrative },
          { kind: "callout", text: m.context.anchor },
        ],
      };
    }
    if (key === "concept") {
      return {
        ...base,
        blocks: [
          { kind: "paragraph", text: m.concept.body1 },
          { kind: "paragraph", text: m.concept.body2 },
          { kind: "list", items: [m.concept.point1, m.concept.point2] },
          { kind: "paragraph", text: m.concept.body3 },
        ],
      };
    }
    if (key === "behaviour") {
      return {
        ...base,
        blocks: [
          { kind: "paragraph", text: m.behaviour.intro },
          { kind: "callout", text: m.behaviour.formula },
          {
            kind: "compare",
            compare: [
              { label: m.behaviour.blamingLabel, text: m.behaviour.blaming, tone: "negative" },
              { label: m.behaviour.iStatementLabel, text: m.behaviour.iStatement, tone: "positive" },
            ],
          },
          { kind: "paragraph", text: m.behaviour.closing },
        ],
      };
    }
    if (key === "simulation") {
      return {
        ...base,
        simulation: {
          prompt: m.simulation.prompt,
          instruction: m.simulation.instruction,
          options: SIMULATION_OPTIONS.map((id) => ({
            id,
            text: m.simulation.options[id],
            isBest: id === SIMULATION_CORRECT,
            feedback: m.simulation.feedback[id],
          })),
        },
      };
    }
    if (key === "scenario") {
      const choices: ScenarioChoice[] = SCENARIO_ROOT_CHOICES.map((rootId) => ({
        id: rootId,
        text: m.scenario.choices[rootId],
        outcome: m.scenario.outcomes[rootId],
        quality: SCENARIO_OUTCOME_QUALITY[rootId],
        followups: SCENARIO_FOLLOWUP[rootId].map((fId) => ({
          id: fId,
          text: m.scenario.followup[fId],
          outcome: m.scenario.followupOutcomes[fId],
          quality: SCENARIO_OUTCOME_QUALITY[fId],
        })),
      }));
      return {
        ...base,
        scenario: {
          setup: m.scenario.setup,
          question: m.scenario.question,
          followupQuestion: m.scenario.followupQ,
          choices,
        },
      };
    }
    if (key === "reflection") {
      return {
        ...base,
        reflection: {
          intro: m.reflection.intro,
          prompts: [
            { label: m.reflection.prompt1, placeholder: m.reflection.placeholder1 },
            { label: m.reflection.prompt2, placeholder: m.reflection.placeholder2 },
            { label: m.reflection.prompt3, placeholder: m.reflection.placeholder3 },
          ],
        },
      };
    }
    // assessment
    return {
      ...base,
      assessment: {
        intro: m.assessment.intro,
        questions: ASSESSMENT.map((q) => ({
          id: q.id,
          question: m.assessment[q.id].question,
          options: q.options.map((o) => ({ id: o, text: m.assessment[q.id][o] })),
          correctOptionId: q.correct,
        })),
      },
    };
  });

  return {
    slug: COURSE_META.id,
    locale,
    cluster: COURSE_META.cluster,
    title: m.title,
    clusterLabel: m.cluster,
    tagline: m.tagline,
    durationMinutes: COURSE_META.durationMinutes,
    badge: {
      slug: COURSE_META.badgeId,
      name: m.completion.badgeName,
      meaning: m.completion.badgeMeaning,
    },
    stages,
    completion: { title: m.completion.title, body: m.completion.body },
  };
}

export const localProvider: CMSProvider = {
  async listCourses(_projectId, locale) {
    const c = buildWorkplaceConflict(locale);
    const summary: CourseSummary = {
      slug: c.slug,
      cluster: c.cluster,
      title: c.title,
      clusterLabel: c.clusterLabel,
      tagline: c.tagline,
      durationMinutes: c.durationMinutes,
      status: "published",
    };
    return [summary];
  },

  async getCourse(_projectId, slug, locale) {
    if (slug !== COURSE_META.id) return null;
    return buildWorkplaceConflict(locale);
  },

  async getCompCardTemplate(_projectId, locale) {
    const c = msgs(locale).compCard;
    const template: CompCardTemplate = {
      fields: [
        { key: "wentWell", label: c.fieldWentWell, placeholder: c.placeholder.wentWell, kind: "longtext" },
        { key: "difficult", label: c.fieldDifficult, placeholder: c.placeholder.difficult, kind: "longtext" },
        { key: "improve", label: c.fieldImprove, placeholder: c.placeholder.improve, kind: "longtext" },
        { key: "behaviour", label: c.fieldBehaviour, placeholder: c.placeholder.behaviour, kind: "longtext" },
        { key: "confidence", label: c.fieldConfidence, kind: "confidence" },
      ],
    };
    return template;
  },
};
