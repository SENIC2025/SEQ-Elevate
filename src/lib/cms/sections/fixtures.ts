/**
 * Lesson rows of every shape Release 0 can leave behind, for the golden
 * tests (sections.golden.test.ts) and the derivation check's smoke test.
 * Test data only: nothing in the app imports this.
 *
 * The first groups copy the row shapes the Release 0 tests use
 * (course-derive, db-course, db-course.drafts, course-admin), so the
 * golden properties are proved on exactly the data those tests pin. The
 * rest are the shapes Release 0 code writes but no test pinned: stray rows
 * the media actions create for any key, exercises that are only a draft,
 * media on a lesson learners don't get yet, and Lesson.parts values that
 * mean "main content only".
 */

import type { NarrativeBlock } from "../types";
import type { SectionFacts } from "./contract";

export interface LegacyFixture {
  name: string;
  lessons: SectionFacts[];
}

const para = (text: string): NarrativeBlock => ({ kind: "paragraph", text });
const written = (title: string, text: string) => ({ title, blocks: [para(text)] });
const narrative = (...locales: ("en" | "de" | "el")[]) =>
  Object.fromEntries(locales.map((l) => [l, { title: `T-${l}`, blocks: [para(l)] }]));

const sim = {
  kind: "simulation",
  prompt: { en: "Hi" },
  instruction: {},
  options: [
    { id: "a", isBest: true, text: { en: "Hi" }, feedback: {} },
    { id: "b", isBest: false, text: { en: "Hi" }, feedback: {} },
  ],
};
const scenario = {
  kind: "scenario",
  setup: { en: "Live setup" },
  question: { en: "Live question" },
  followupQuestion: {},
  choices: [
    { id: "c1", quality: "best", text: { en: "Live A" }, outcome: { en: "Fine." } },
    { id: "c2", quality: "poor", text: { en: "Live B" }, outcome: { en: "Not fine." } },
  ],
};
const scenarioDraft = { ...scenario, setup: { en: "DRAFT setup" } };
const quiz = {
  kind: "assessment",
  title: { en: "", de: "" },
  intro: { en: "Three questions" },
  questions: [
    {
      id: "q1",
      correctOptionId: "x",
      question: { en: "Why ask?", de: "" },
      options: [
        { id: "x", text: { en: "To learn", de: "  " } },
        { id: "y", text: { en: "To annoy" } },
      ],
    },
  ],
};

/** A Lesson row as Prisma returns it, every column present (db-course.drafts.test.ts). */
const row = (stageKey: string, cols: Record<string, unknown> = {}): SectionFacts =>
  ({
    id: stageKey,
    projectId: "seq-elevate",
    courseSlug: "my-course",
    stageKey,
    video: null,
    narrative: null,
    structure: null,
    structureDraft: null,
    parts: null,
    ...cols,
  }) as SectionFacts;

const MAIN_ONLY = { v: 1, items: [{ id: "main", type: "main" }] };

export const LEGACY_FIXTURES: LegacyFixture[] = [
  /* -------------------------- course-derive.test.ts -------------------------- */
  { name: "course-derive: no rows", lessons: [] },
  {
    name: "course-derive: a quick check written, a practice cleared",
    lessons: [
      { stageKey: "assessment", structure: { kind: "assessment" } },
      { stageKey: "simulation", structure: null },
    ],
  },
  { name: "course-derive: context in English", lessons: [{ stageKey: "context", narrative: narrative("en") }] },
  {
    name: "course-derive: context with German cleared to blanks",
    lessons: [
      {
        stageKey: "context",
        narrative: { ...narrative("en"), de: { title: " ", blocks: [{ kind: "paragraph", text: "" }] } },
      },
    ],
  },
  { name: "course-derive: reflection written", lessons: [{ stageKey: "reflection", narrative: narrative("en") }] },
  { name: "course-derive: reflection cleared", lessons: [{ stageKey: "reflection", narrative: { en: { title: "" } } }] },
  { name: "course-derive: practice written", lessons: [{ stageKey: "simulation", structure: sim }] },
  {
    name: "course-derive: three lessons in two languages",
    lessons: [
      { stageKey: "context", narrative: narrative("en", "de") },
      { stageKey: "concept", narrative: narrative("en", "de") },
      { stageKey: "behaviour", narrative: narrative("en") },
    ],
  },
  { name: "course-derive: context in Greek only", lessons: [{ stageKey: "context", narrative: narrative("el") }] },
  {
    name: "course-derive: documents only",
    lessons: [{ stageKey: "context", documents: [{ createdAt: "2026-09-01T10:00:00.000Z" }] } as SectionFacts],
  },
  {
    name: "course-derive: edit times",
    lessons: [
      { stageKey: "context", updatedAt: new Date("2026-09-03T00:00:00Z") } as SectionFacts,
      {
        stageKey: "concept",
        updatedAt: "2026-09-02T00:00:00Z",
        documents: [{ createdAt: "2026-09-05T00:00:00Z" }],
      } as SectionFacts,
    ],
  },

  /* ---------------------------- db-course.test.ts ---------------------------- */
  {
    name: "db-course: cleared translations, practice and quick check",
    lessons: [
      {
        stageKey: "context",
        narrative: {
          en: { title: "The situation", subtitle: "Read first", blocks: [para("You are stuck.")] },
          de: { title: " ", subtitle: "", blocks: [para(""), { kind: "list", items: ["", " "] }] },
        },
      },
      {
        stageKey: "concept",
        narrative: {
          en: { title: "The skill", blocks: [para("Ask early.")] },
          de: { title: "Die Fähigkeit", blocks: [para("  ")] },
        },
      },
      { stageKey: "behaviour", narrative: { de: { title: "So geht's", blocks: [para("Frag früh.")] } } },
      {
        stageKey: "reflection",
        narrative: {
          en: { title: "Look back", blocks: [para("Think about today.")] },
          de: { title: "", blocks: [para("")] },
        },
      },
      { stageKey: "simulation", structure: { ...sim, title: { en: "Practise asking", de: "" } } },
      { stageKey: "assessment", structure: quiz },
    ],
  },

  /* ------------------------- db-course.drafts.test.ts ------------------------- */
  { name: "db-course.drafts: no rows", lessons: [] },
  { name: "db-course.drafts: a scenario only as a draft", lessons: [row("scenario", { structureDraft: scenarioDraft })] },
  {
    name: "db-course.drafts: a scenario saved, a draft beside it",
    lessons: [row("scenario", { structure: scenario, structureDraft: scenarioDraft })],
  },

  /* --------------------------- course-admin.test.ts --------------------------- */
  {
    name: "course-admin: four lessons, German cleared",
    lessons: ["context", "concept", "behaviour", "reflection"].map((stageKey) =>
      row(stageKey, {
        documents: [],
        updatedAt: new Date("2026-10-01T10:00:00.000Z"),
        narrative: {
          en: written("Title", "Text"),
          el: written("Τίτλος", "Κείμενο"),
          de: { title: " ", blocks: [para("")] },
        },
      })
    ),
  },
  {
    name: "course-admin: a lesson written only in German",
    lessons: [
      row("context", { narrative: { en: { title: "", blocks: [para(" ")] }, de: written("Titel", "Text auf Deutsch") } }),
      row("concept", { narrative: { en: { title: "Concept", blocks: [para(" ")] } } }),
      row("behaviour", { narrative: { en: written("Title", "Text"), de: { title: "Titel", blocks: [] } } }),
    ],
  },

  /* ------------------------------- stray rows ------------------------------- */
  {
    name: "stray rows: an s- id, a made-up key, a key in capitals",
    lessons: [
      row("s-abcdefgh", { narrative: { en: written("Stray", "Text") }, structure: sim }),
      row("whatever", { video: { provider: "file", src: "https://x/v.mp4" } }),
      row("Context", { narrative: { en: written("Wrong case", "Text") } }),
      row("concept", { narrative: narrative("en") }),
    ],
  },
  {
    name: "stray rows with extra content that can't be read",
    lessons: [row("s-zzzzzzzz", { parts: "garbage" }), row("intro", { parts: { v: 9 } })],
  },

  /* ------------------------------- draft only ------------------------------- */
  {
    name: "draft only: every exercise",
    lessons: [
      row("simulation", { structureDraft: sim }),
      row("scenario", { structureDraft: scenario }),
      row("assessment", { structureDraft: quiz }),
    ],
  },
  {
    name: "draft only: one saved, two drafts",
    lessons: [
      row("simulation", { structureDraft: sim }),
      row("scenario", { structure: scenario }),
      row("assessment", { structureDraft: quiz }),
    ],
  },

  /* ----------------------- media on lessons not shown ----------------------- */
  {
    name: "media: a video and documents on exercises nobody wrote",
    lessons: [
      row("simulation", { video: { provider: "youtube", src: "abc" } }),
      row("assessment", { documentCount: 2 }),
    ],
  },

  /* ------------------------ "main content only" parts ------------------------ */
  {
    name: "parts: null written out on every lesson",
    lessons: ["context", "concept", "behaviour", "simulation", "scenario", "reflection", "assessment"].map((k) =>
      row(k, { parts: null })
    ),
  },
  {
    name: "parts: the main content alone, stored as a list, on exercises with and without one",
    lessons: [
      row("simulation", { parts: MAIN_ONLY }),
      row("scenario", { structure: scenario, parts: MAIN_ONLY }),
      row("assessment", { structureDraft: quiz, parts: MAIN_ONLY }),
      row("concept", { narrative: narrative("en"), parts: MAIN_ONLY }),
    ],
  },
  {
    name: "parts: undefined (a select without the column)",
    lessons: [{ stageKey: "scenario", structure: scenario }, { stageKey: "context" }],
  },
];

/** The ways a single Lesson row can be, for generated fixtures. */
export const ROW_STATES: Record<string, (key: string) => SectionFacts | null> = {
  absent: () => null,
  empty: (k) => row(k),
  narrative: (k) => row(k, { narrative: narrative("en", "de") }),
  blankNarrative: (k) => row(k, { narrative: { en: { title: " ", blocks: [para("")] } } }),
  structure: (k) => row(k, { structure: k === "scenario" ? scenario : k === "assessment" ? quiz : sim }),
  draft: (k) => row(k, { structureDraft: sim }),
  structureAndDraft: (k) => row(k, { structure: scenario, structureDraft: scenarioDraft }),
  video: (k) => row(k, { video: { provider: "youtube", src: "abc" } }),
  documents: (k) => row(k, { documentCount: 3 }),
  partsNull: (k) => row(k, { parts: null }),
  mainOnly: (k) => row(k, { parts: MAIN_ONLY }),
  structureMainOnly: (k) => row(k, { structure: sim, parts: MAIN_ONLY }),
};

/** Stray rows Release 0 can leave: never lessons. */
export const STRAY_ROWS: SectionFacts[] = [
  row("s-abcdefgh", { narrative: narrative("en") }),
  row("s-00000000", { structure: sim }),
  row("nonsense", { video: { provider: "file", src: "x" } }),
];
