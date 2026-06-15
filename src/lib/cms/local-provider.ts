/**
 * Local CMS provider — builds CourseContent from the bundled i18n
 * messages + the structure definitions in src/data/course.ts.
 *
 * This is the default content source. It keeps the app fully functional
 * with zero external dependencies, and serves as the reference shape that
 * the Strapi provider must reproduce. The builder is generic over
 * CourseDef, so any number of bundled courses render through it.
 */

import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";
import { STAGES, COURSE_DEFS, COURSE_ORDER, type CourseDef } from "@/data/course";
import type { CMSProvider } from "./provider";
import type {
  CourseContent,
  CourseStage,
  CourseSummary,
  CompCardTemplate,
  Locale,
  ScenarioChoice,
  VideoContent,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const MESSAGES: Record<Locale, any> = { en, de, el };

function msgs(locale: Locale) {
  return MESSAGES[locale] ?? MESSAGES.en;
}

/**
 * The demo interactive video for the hero course (workplace-conflict). A
 * placeholder clip with one in-video quiz cue, so the consortium can see the
 * mechanic; they replace src + cues in the CMS. Returns undefined for other
 * courses so only the hero course shows it.
 */
function buildDemoVideo(
  def: CourseDef,
  locale: Locale
): VideoContent | undefined {
  if (def.id !== "workplace-conflict") return undefined;
  const v = msgs(locale).video?.demo ?? msgs("en").video?.demo;
  if (!v) return undefined;
  return {
    provider: "file",
    src: "/demo/sample-lesson.webm",
    title: v.title,
    caption: v.caption,
    captions: [
      {
        src: "/demo/sample-lesson.en.vtt",
        label: "English",
        lang: "en",
        default: true,
      },
    ],
    cues: [
      {
        id: "concept-check",
        atSeconds: 4,
        question: v.question,
        options: [
          { id: "blame", text: v.optBlame },
          { id: "feel", text: v.optFeel },
          { id: "who", text: v.optWho },
        ],
        correctOptionId: "feel",
        explanation: v.explanation,
      },
    ],
  };
}

function buildCourse(def: CourseDef, locale: Locale): CourseContent {
  // Fall back to English if this course isn't translated for the locale yet.
  // Mirrors how the real CMS handles a course awaiting DE/EL translation.
  const m =
    msgs(locale).course[def.contentKey] ?? msgs("en").course[def.contentKey];
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
        // Demo interactive video on the hero course's teaching stage — shows
        // the in-video quiz mechanic. The consortium swaps src + cues in the
        // CMS for their own lesson videos.
        video: buildDemoVideo(def, locale),
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
          options: def.simulation.options.map((id) => ({
            id,
            text: m.simulation.options[id],
            isBest: id === def.simulation.correct,
            feedback: m.simulation.feedback[id],
          })),
        },
      };
    }
    if (key === "scenario") {
      const choices: ScenarioChoice[] = def.scenario.roots.map((root) => ({
        id: root.id,
        text: m.scenario.choices[root.id],
        outcome: m.scenario.outcomes[root.id],
        quality: root.quality,
        followups: root.followups.map((f) => ({
          id: f.id,
          text: m.scenario.followup[f.id],
          outcome: m.scenario.followupOutcomes[f.id],
          quality: f.quality,
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
        questions: def.assessment.map((q) => ({
          id: q.id,
          question: m.assessment[q.id].question,
          options: q.options.map((o) => ({ id: o, text: m.assessment[q.id][o] })),
          correctOptionId: q.correct,
        })),
      },
    };
  });

  return {
    slug: def.id,
    locale,
    cluster: def.cluster,
    title: m.title,
    clusterLabel: m.cluster,
    tagline: m.tagline,
    durationMinutes: def.durationMinutes,
    badge: {
      slug: def.badgeId,
      name: m.completion.badgeName,
      meaning: m.completion.badgeMeaning,
    },
    stages,
    completion: { title: m.completion.title, body: m.completion.body },
  };
}

function summarise(c: CourseContent): CourseSummary {
  return {
    slug: c.slug,
    cluster: c.cluster,
    title: c.title,
    clusterLabel: c.clusterLabel,
    tagline: c.tagline,
    durationMinutes: c.durationMinutes,
    status: "published",
    badgeSlug: c.badge.slug,
    badgeName: c.badge.name,
    badgeMeaning: c.badge.meaning,
  };
}

export const localProvider: CMSProvider = {
  async listCourses(_projectId, locale) {
    return COURSE_ORDER.filter((id) => COURSE_DEFS[id]).map((id) =>
      summarise(buildCourse(COURSE_DEFS[id], locale))
    );
  },

  async getCourse(_projectId, slug, locale) {
    const def = COURSE_DEFS[slug];
    if (!def) return null;
    return buildCourse(def, locale);
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
