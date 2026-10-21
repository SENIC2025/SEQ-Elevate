import { narrative, parts, structures, type R2LessonSeed } from "./r2-course";

/**
 * Release 2: the A-E1 course (spec 10.2) — a published course seeded the
 * way the course editor leaves it: two lessons of its own, "context" and
 * "reflection" hidden, the scenario moved before "behaviour", every step
 * named in English and German, extra content of every kind on "concept", a
 * video with an in-video question on a lesson of its own, and documents
 * (one published, one not).
 *
 * Shared read-only by e2e/r2-player.spec.ts (A-E1 and the tests after it)
 * and the recorded walk's phase 3 (e2e/r2-learner-walk.spec.ts, spec
 * 10.3), which records what a learner sees of it in
 * e2e/fixtures/r2-learner-baseline.json — so a change here is a change to
 * that recording, which is pinned (src/lib/r2-fixture-pin.test.ts).
 *
 * Release 3 (D90): seeded with German and Greek switched on for learners
 * (readyLocales ["de", "el"], seedR2Course's default), so its German walk
 * shows the German it recorded rather than the English a learner gets
 * until a language is switched on.
 */

/** The title, in English and German. */
export const AE1_TITLE = { en: "E2E Speak up as built", de: "E2E Sprich es an, wie gebaut" };

export const AE1_PARTS = {
  hallway: "p-hallway1",
  text: "p-extratx1",
  quiz: "p-extraqz1",
  reflection: "p-ownrefl1",
  rating: "p-ownrate1",
  practice: "p-extrapr1",
  ownPractice: "p-ownprac1",
};

const HALLWAY = {
  id: AE1_PARTS.hallway,
  type: "scenario",
  data: {
    kind: "scenario",
    title: { en: "The hallway", de: "Der Flur" },
    setup: { en: "A colleague talks over you in the hallway." },
    question: { en: "What do you do first?" },
    followupQuestion: { en: "They stop. What do you say next?" },
    choices: [
      {
        id: "hall-raise",
        quality: "best",
        text: { en: "Raise a hand and say you'd like to finish" },
        outcome: { en: "They pause and listen." },
        followups: [
          { id: "hall-finish", quality: "best", text: { en: "Finish your point briefly" }, outcome: { en: "Your point lands." } },
          { id: "hall-again", quality: "okay", text: { en: "Start again from the top" }, outcome: { en: "They drift off." } },
        ],
      },
      { id: "hall-walk", quality: "poor", text: { en: "Walk away" }, outcome: { en: "Nothing changes." } },
    ],
  },
  draft: null,
} as const;

const OWN_PRACTICE = {
  id: AE1_PARTS.ownPractice,
  type: "practice",
  data: {
    kind: "simulation",
    prompt: { en: "Your lead asks how the week went." },
    instruction: { en: "Choose what you would say." },
    options: [
      { id: "wrap-name", isBest: true, text: { en: "Name one thing that worked and one to change." }, feedback: { en: "Specific and fair." } },
      { id: "wrap-fine", isBest: false, text: { en: "It was fine." }, feedback: { en: "Nothing to build on." } },
    ],
  },
  draft: null,
} as const;

const video = (cueId: string) => ({
  provider: "file",
  src: "/demo/sample-lesson.webm",
  title: "E2E lesson video",
  captions: [{ src: "/demo/sample-lesson.en.vtt", label: "English", lang: "en", default: true }],
  cues: [
    {
      id: cueId,
      atSeconds: 4,
      question: "E2E: what helps most?",
      options: [
        { id: "early", text: "Speaking early" },
        { id: "late", text: "Waiting it out" },
      ],
      correctOptionId: "early",
    },
  ],
});

/**
 * The A-E1 course's lessons, in learner order. Its own lessons' ids and the
 * in-video question's id are the caller's: unique to a run in r2-player,
 * fixed in the recorded walk (phase 3), whose recording names them.
 */
export function ae1Lessons(ids: { warmup: string; wrapup: string; cueId: string }): R2LessonSeed[] {
  return [
    {
      id: ids.warmup,
      label: { en: "Warm-up", de: "Aufwärmen" },
      narrative: narrative({
        en: { title: "Before you start", text: "E2E warm-up text." },
        de: { title: "Bevor du anfängst", text: "E2E Aufwärmtext." },
      }),
      parts: [HALLWAY as never],
      documents: [
        { name: "E2E checklist.pdf", url: "https://example.org/e2e-r2-checklist.pdf" },
        { name: "E2E unpublished.pdf", url: "https://example.org/e2e-r2-draft.pdf", published: false },
      ],
    },
    {
      id: "context",
      hidden: true,
      narrative: narrative({ en: { title: "Hidden", text: "E2E hidden context text." } }),
    },
    {
      id: "concept",
      label: { en: "The idea", de: "Die Idee" },
      narrative: narrative({
        en: { title: "Why speaking up works", text: "E2E concept text." },
        de: { title: "Warum es wirkt", text: "E2E Konzepttext." },
      }),
      parts: [
        parts.text({ en: "E2E extra text: say it early.", de: "E2E Zusatztext: sag es früh." }, AE1_PARTS.text),
        parts.quiz("E2E: when do you speak up?", AE1_PARTS.quiz),
        parts.reflection([{ en: "E2E: when did you hold back?" }, { en: "E2E: what stopped you?" }], AE1_PARTS.reflection),
        parts.rating([{ en: "E2E: I say when I disagree." }, { en: "E2E: I ask for time to finish." }], AE1_PARTS.rating),
        parts.practice("E2E: you're interrupted a third time.", AE1_PARTS.practice),
      ],
    },
    {
      id: "scenario",
      label: { en: "Try it", de: "Probier es" },
      structure: structures.scenario("E2E: your lead cuts you off in a meeting."),
    },
    {
      id: "behaviour",
      narrative: narrative({
        en: { title: "What it looks like", text: "E2E behaviour text." },
        de: { title: "So sieht es aus", text: "E2E Verhaltenstext." },
      }),
    },
    {
      id: ids.wrapup,
      label: { en: "Wrap-up", de: "Abschluss" },
      narrative: narrative({
        en: { title: "Bringing it together", text: "E2E wrap-up text." },
        de: { title: "Alles zusammen", text: "E2E Abschlusstext." },
      }),
      parts: [OWN_PRACTICE as never],
      video: video(ids.cueId),
    },
    // A standard text lesson is always in the list unless deleted: hidden here.
    { id: "reflection", hidden: true },
    {
      id: "assessment",
      structure: structures.assessment("E2E: what do you say first?"),
    },
  ];
}

/** The step names learners see, in learner order. */
export const AE1_NAMES = {
  en: ["Warm-up", "The idea", "Try it", "Behaviour model", "Wrap-up", "Quick check"],
  de: ["Aufwärmen", "Die Idee", "Probier es", "Verhaltens-Modell", "Abschluss", "Schnellcheck"],
  // Named in English and German only: the course's own lessons keep their
  // English names, the standard ones their standard Greek names.
  el: ["Warm-up", "Έννοια δεξιότητας", "Εφαρμογή", "Μοντέλο συμπεριφοράς", "Wrap-up", "Σύντομος έλεγχος"],
};
