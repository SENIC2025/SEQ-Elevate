/**
 * Resolved content of every kind, for the sectioned preview's tests. Shaped
 * as resolveSectionStage hands them over (one language, strings only).
 */
import type { ResolvedPart, SectionStage } from "@/lib/cms/sections/contract";

type Part<T extends ResolvedPart["type"]> = Extract<ResolvedPart, { type: T }>;

export const textPart: Part<"text"> = {
  id: "main",
  type: "text",
  blocks: [{ kind: "paragraph", text: "Speaking up starts small." }],
};

export const practicePart: Part<"practice"> = {
  id: "p-practc01",
  type: "practice",
  simulation: {
    prompt: "Your colleague interrupts you again.",
    instruction: "Choose what you would say.",
    options: [
      { id: "o1", text: "Let me finish, please.", isBest: true, feedback: "Clear and calm." },
      { id: "o2", text: "Say nothing.", isBest: false, feedback: "The pattern goes on." },
    ],
  },
};

export const scenarioPart: Part<"scenario"> = {
  id: "p-scenar01",
  type: "scenario",
  title: "The meeting",
  scenario: {
    setup: "Sam jokes about you in a meeting.",
    question: "What do you do?",
    followupQuestion: "And then?",
    choices: [
      {
        id: "private",
        text: "Talk to Sam later",
        outcome: "Calm.",
        quality: "best",
        followups: [{ id: "boundary", text: "Set a boundary", outcome: "Ok.", quality: "best" }],
      },
      { id: "public", text: "Snap back", outcome: "Ouch.", quality: "poor" },
    ],
  },
};

export const quizPart: Part<"quiz"> = {
  id: "p-quizaaaa",
  type: "quiz",
  assessment: {
    intro: "Two questions.",
    questions: [
      {
        id: "q1",
        question: "Which is an I-statement?",
        options: [
          { id: "a", text: "You always ignore me" },
          { id: "b", text: "I feel sidelined" },
        ],
        correctOptionId: "b",
      },
      {
        id: "q2",
        question: "When do you speak up?",
        options: [
          { id: "a", text: "Early" },
          { id: "b", text: "Never" },
        ],
        correctOptionId: "a",
      },
    ],
  },
};

/** A second quick check with the same question ids, in the same lesson. */
export const quizPart2: Part<"quiz"> = {
  ...quizPart,
  id: "p-quizbbbb",
  title: "One more check",
};

export const emptyQuizPart: Part<"quiz"> = {
  id: "p-quizzero",
  type: "quiz",
  assessment: { intro: "Nothing to answer yet.", questions: [] },
};

export const reflectionPart: Part<"reflection"> = {
  id: "p-reflct01",
  type: "reflection",
  intro: "Think about last week.",
  prompts: [
    { id: "r1", label: "What went well?", placeholder: "A moment…" },
    { id: "r2", label: "What would you change?", placeholder: "" },
  ],
};

export const ratingPart: Part<"rating"> = {
  id: "p-rating01",
  type: "rating",
  title: "How you speak up",
  minLabel: "Not at all like me",
  maxLabel: "Very much like me",
  statements: [
    { id: "s1", text: "I say when I disagree." },
    { id: "s2", text: "I ask for time to finish." },
    { id: "s3", text: "I name what I need." },
  ],
};

export const sectionStage: SectionStage = {
  key: "s-abcd1234",
  label: "Warm-up",
  title: "Warm-up",
  subtitle: "Before we start",
  parts: [textPart, practicePart, quizPart, quizPart2, reflectionPart, ratingPart],
  skipped: 0,
};
