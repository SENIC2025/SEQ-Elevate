import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LessonDocumentRef, Locale, NarrativeBlock } from "../types";
import type { ResolvedSection, SectionFacts, StoredPart } from "./contract";
import { MAIN_PART } from "./section-parts";

/*
 * One lesson of the editor's preview of a course learners can't get as
 * built yet (spec 9.2). Its main content must read exactly as learners read
 * it today — so these tests hold it against the real learner reader
 * (getDbCourse) on the same rows — and its extra content shows only what
 * would be live: never a draft, never a question that isn't ready.
 */

vi.mock("server-only", () => ({}));

let lessons: (SectionFacts & Record<string, unknown>)[] = [];
vi.mock("@/lib/prisma", () => ({
  prisma: {
    course: {
      findFirst: async () => ({
        slug: "c",
        cluster: "x",
        durationMinutes: 10,
        meta: { en: { title: "Course", tagline: "t", clusterLabel: "l" } },
      }),
    },
    lesson: { findMany: async () => lessons },
  },
}));

const { getDbCourse } = await import("../db-course");
const { previewDefaults } = await import("./defaults");
const { resolveSectionStage } = await import("./resolve");

const para = (text: string): NarrativeBlock => ({ kind: "paragraph", text });
const legacySection = (id: ResolvedSection["id"]): ResolvedSection => ({ id, template: id as never, custom: false });
const ownSection = (template: ResolvedSection["template"] = "text"): ResolvedSection => ({
  id: "s-abcdefgh",
  template,
  custom: true,
});
const parts = (...items: StoredPart[]) => ({ v: 1, items });

function stage(
  section: ResolvedSection,
  row: (SectionFacts & { video?: unknown; documents?: LessonDocumentRef[] }) | undefined,
  locale: Locale = "en",
  label = "My lesson"
) {
  return resolveSectionStage({
    section,
    row,
    locale,
    label,
    standardTitle: "Standard title",
    defaults: previewDefaults(locale),
  });
}

/** What learners get for this stage key today, from the same rows. */
async function learnerStage(key: string, locale: Locale = "en") {
  const course = await getDbCourse("p", "c", locale);
  return course?.stages.find((s) => s.key === key);
}

beforeEach(() => {
  lessons = [];
});

describe("the main reflection", () => {
  const cases: [string, unknown][] = [
    ["a written first paragraph", { en: { title: "Look back", blocks: [para("Think it over.")] } }],
    [
      "a formatted first paragraph",
      {
        en: {
          blocks: [
            {
              kind: "paragraph",
              text: "Bold idea",
              rich: { v: 1, doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Bold idea", marks: [{ type: "bold" }] }] }] } },
            },
          ],
        },
      },
    ],
    ["a subtitle only", { en: { title: "Back", subtitle: "Read this first" } }],
    ["a blank paragraph and a subtitle", { en: { subtitle: "Sub", blocks: [para("  ")] } }],
    ["nothing written", null],
    ["only German, read in Greek", { de: { title: "Rückblick", blocks: [para("Denk nach.")] } }],
  ];

  for (const [name, narrative] of cases) {
    for (const locale of ["en", "el"] as const) {
      it(`reads its title and intro as learners do: ${name} (${locale})`, async () => {
        lessons = [{ stageKey: "reflection", narrative, structure: null }];
        const learner = await learnerStage("reflection", locale);
        const s = stage(legacySection("reflection"), lessons[0], locale);
        expect(s?.title).toBe(learner?.title);
        const main = s?.parts.find((p) => p.id === "main");
        expect(main?.type).toBe("reflection");
        if (main?.type !== "reflection") return;
        expect(main.intro).toBe(learner?.reflection?.intro);
        expect(main.introRich).toEqual(learner?.reflection?.introRich);
        if (name === "a formatted first paragraph") expect(main.introRich).toBeDefined();
        expect(main.prompts.map(({ label, placeholder }) => ({ label, placeholder }))).toEqual(
          learner?.reflection?.prompts
        );
        expect(main.prompts.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
      });
    }
  }

  it("leaves out the standard questions when the lesson has its own", () => {
    const own: StoredPart = {
      id: "p-aaaaaaaa",
      type: "reflection",
      data: { kind: "reflection", prompts: [{ id: "q1", label: { en: "Mine?" } }] },
      draft: null,
    };
    const s = stage(legacySection("reflection"), { stageKey: "reflection", parts: parts(MAIN_PART, own) });
    expect(s?.parts).toEqual([
      expect.objectContaining({ id: "main", type: "reflection", prompts: [] }),
      { id: "p-aaaaaaaa", type: "reflection", prompts: [{ id: "q1", label: "Mine?", placeholder: "" }] },
    ]);
  });
});

describe("the main text", () => {
  it("reads as learners read it, field by field", async () => {
    lessons = [
      {
        stageKey: "concept",
        narrative: {
          en: { title: "Idea", subtitle: "Why", blocks: [para("Ask early.")] },
          de: { title: "Idee", blocks: [para(" ")] },
        },
      },
    ];
    const learner = await learnerStage("concept", "de");
    const s = stage(legacySection("concept"), lessons[0], "de");
    expect(s).toMatchObject({ key: "concept", title: learner?.title, subtitle: learner?.subtitle });
    expect(s?.parts).toEqual([{ id: "main", type: "text", blocks: learner?.blocks }]);
  });

  it("keeps a standard text lesson nobody wrote, as learners get it", () => {
    const s = stage(legacySection("context"), undefined);
    expect(s).toMatchObject({ key: "context", title: "Standard title", parts: [], skipped: 0 });
  });

  it("names a lesson of the course's own by its step name, never by its id", () => {
    // Learners' "Course — key" fallback would read "Course — s-abcdefgh".
    const s = stage(ownSection(), { stageKey: "s-abcdefgh", narrative: { en: { blocks: [para("Hi")] } } }, "en", "Warm-up");
    expect(s?.title).toBe("Warm-up");
    expect(s?.label).toBe("Warm-up");
    expect(s?.key).toBe("s-abcdefgh");
  });

  it("leaves out a lesson of the course's own with nothing to show", () => {
    expect(stage(ownSection(), undefined)).toBeNull();
    expect(stage(ownSection("quiz"), { stageKey: "s-abcdefgh", structureDraft: { kind: "assessment" } })).toBeNull();
  });
});

describe("the main exercise", () => {
  const live = {
    kind: "simulation",
    title: { en: "Practise", de: "" },
    prompt: { en: "What now?" },
    instruction: { en: "Pick one" },
    options: [
      { id: "a", isBest: true, text: { en: "Ask" }, feedback: { en: "Good" } },
      { id: "b", isBest: false, text: { en: "Wait" }, feedback: {} },
    ],
  };
  const draft = { ...live, prompt: { en: "DRAFT" } };

  it("reads the exercise learners get, never the draft beside it", async () => {
    lessons = [{ stageKey: "simulation", structure: live, structureDraft: draft }];
    const learner = await learnerStage("simulation", "de");
    const s = stage(legacySection("simulation"), lessons[0], "de");
    expect(s?.title).toBe(learner?.title);
    expect(s?.parts).toEqual([{ id: "main", type: "practice", simulation: learner?.simulation }]);
    expect(JSON.stringify(s)).not.toContain("DRAFT");
  });

  it("gives an exercise without a title the standard name", () => {
    const s = stage(legacySection("simulation"), { stageKey: "simulation", structure: { ...live, title: undefined } });
    expect(s?.title).toBe("Standard title");
  });

  it("leaves out an exercise that is only a draft, and counts it", () => {
    const s = stage(legacySection("simulation"), {
      stageKey: "simulation",
      structureDraft: draft,
      video: { provider: "youtube", src: "abc" },
    });
    expect(s?.parts).toEqual([]);
    expect(s?.skipped).toBe(1);
    expect(stage(legacySection("scenario"), { stageKey: "scenario", structureDraft: { kind: "scenario" } })).toBeNull();
  });

  it("reads a lesson of the course's own's exercise by its kind", () => {
    const quiz = {
      kind: "assessment",
      intro: { en: "Two questions" },
      questions: [{ id: "q1", correctOptionId: "x", question: { en: "Why?" }, options: [{ id: "x", text: { en: "So" } }, { id: "y", text: { en: "No" } }] }],
    };
    const s = stage(ownSection("quiz"), { stageKey: "s-abcdefgh", structure: quiz }, "en", "Check");
    expect(s?.title).toBe("Check");
    expect(s?.parts[0]).toMatchObject({ id: "main", type: "quiz", assessment: { intro: "Two questions" } });
  });

  it("skips an exercise that can't be read instead of failing", () => {
    const s = stage(legacySection("scenario"), {
      stageKey: "scenario",
      structure: { kind: "scenario", choices: "broken" },
      video: { provider: "youtube", src: "abc" },
    });
    expect(s?.parts).toEqual([]);
    expect(s?.skipped).toBe(1);
  });
});

describe("extra content", () => {
  const ready = {
    kind: "assessment",
    intro: { en: "One" },
    questions: [{ id: "q", correctOptionId: "a", question: { en: "Q?" }, options: [{ id: "a", text: { en: "A" } }, { id: "b", text: { en: "B" } }] }],
  };

  it("shows each part in the lesson's order, the main content where it sits", () => {
    const row = {
      stageKey: "concept",
      narrative: { en: { blocks: [para("Main")] } },
      parts: parts(
        { id: "p-aaaaaaaa", type: "text", blocks: { en: [para("Before")] } },
        MAIN_PART,
        { id: "p-bbbbbbbb", type: "quiz", data: ready as never, draft: null }
      ),
    };
    const s = stage(legacySection("concept"), row);
    expect(s?.parts.map((p) => [p.id, p.type])).toEqual([
      ["p-aaaaaaaa", "text"],
      ["main", "text"],
      ["p-bbbbbbbb", "quiz"],
    ]);
    expect(s?.skipped).toBe(0);
  });

  it("shows only what is saved for learners, never a draft", () => {
    const row = {
      stageKey: "concept",
      parts: parts(
        MAIN_PART,
        { id: "p-aaaaaaaa", type: "quiz", data: null, draft: ready as never },
        { id: "p-bbbbbbbb", type: "quiz", data: ready as never, draft: { ...ready, intro: { en: "DRAFT" } } as never }
      ),
    };
    const s = stage(legacySection("concept"), row);
    expect(s?.parts.map((p) => p.id)).toEqual(["p-bbbbbbbb"]);
    expect(s?.parts[0]).toMatchObject({ assessment: { intro: "One" } });
    expect(JSON.stringify(s)).not.toContain("DRAFT");
    expect(s?.skipped).toBe(1);
  });

  it("skips a question that isn't ready or can't be read, and counts it", () => {
    const row = {
      stageKey: "concept",
      parts: parts(
        MAIN_PART,
        { id: "p-aaaaaaaa", type: "rating", data: { kind: "rating", minLabel: {}, maxLabel: {}, statements: [] }, draft: null },
        { id: "p-bbbbbbbb", type: "practice", data: { kind: "simulation", options: 5 } as never, draft: null }
      ),
    };
    expect(stage(legacySection("concept"), row)).toMatchObject({ parts: [], skipped: 2 });
  });

  it("shows reflection questions and a self-assessment in the language, field by field", () => {
    const row = {
      stageKey: "s-abcdefgh",
      parts: parts(
        MAIN_PART,
        {
          id: "p-aaaaaaaa",
          type: "reflection",
          data: {
            kind: "reflection",
            title: { en: "Think", de: "Denk" },
            prompts: [{ id: "q1", label: { en: "Why?", de: " " }, placeholder: { de: "z. B." } }],
          },
          draft: null,
        },
        {
          id: "p-bbbbbbbb",
          type: "rating",
          data: {
            kind: "rating",
            intro: { en: "Rate it" },
            minLabel: { en: "No", de: "Nein" },
            maxLabel: { en: "Yes" },
            statements: [{ id: "s1", text: { el: "Λέω όχι." } }],
          },
          draft: null,
        }
      ),
    };
    expect(stage(ownSection("reflectionRating"), row, "de")?.parts).toEqual([
      { id: "p-aaaaaaaa", type: "reflection", title: "Denk", prompts: [{ id: "q1", label: "Why?", placeholder: "z. B." }] },
      {
        id: "p-bbbbbbbb",
        type: "rating",
        intro: "Rate it",
        minLabel: "Nein",
        maxLabel: "Yes",
        statements: [{ id: "s1", text: "Λέω όχι." }],
      },
    ]);
  });

  it("takes a text part in the first language that has text (addendum 9)", () => {
    const text = (blocks: Record<string, NarrativeBlock[]>): StoredPart => ({ id: "p-aaaaaaaa", type: "text", blocks });
    const row = (t: StoredPart) => ({ stageKey: "concept", parts: parts(MAIN_PART, t) });
    expect(stage(legacySection("concept"), row(text({ de: [para("Hallo")], en: [para("Hello")] })), "de")?.parts).toEqual([
      { id: "p-aaaaaaaa", type: "text", blocks: [para("Hallo")] },
    ]);
    // German blank: English, not an empty part.
    expect(stage(legacySection("concept"), row(text({ de: [para(" ")], el: [para("Γεια")], en: [para("Hello")] })), "de")?.parts).toEqual([
      { id: "p-aaaaaaaa", type: "text", blocks: [para("Hello")] },
    ]);
    // No English: the first language written.
    expect(stage(legacySection("concept"), row(text({ el: [para("Γεια")] })), "de")?.parts).toEqual([
      { id: "p-aaaaaaaa", type: "text", blocks: [para("Γεια")] },
    ]);
    expect(stage(legacySection("concept"), row(text({ en: [para("")] })), "de")).toMatchObject({ parts: [], skipped: 1 });
  });

  it("shows the main content alone when the content list can't be read", () => {
    const s = stage(legacySection("concept"), { stageKey: "concept", narrative: { en: { blocks: [para("Main")] } }, parts: { v: 9 } });
    expect(s?.parts).toEqual([{ id: "main", type: "text", blocks: [para("Main")] }]);
    expect(s?.skipped).toBe(1);
  });
});

describe("video and documents", () => {
  const doc = (id: string, published: boolean): LessonDocumentRef => ({
    id,
    name: `${id}.pdf`,
    url: `https://x/${id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 1,
    published,
  });

  it("come from the lesson's row, published documents only", () => {
    const video = { provider: "youtube", src: "abc" };
    const s = stage(ownSection(), { stageKey: "s-abcdefgh", video, documents: [doc("a", true), doc("b", false)] });
    expect(s).toMatchObject({ video, documents: [doc("a", true)], parts: [] });
  });

  it("are left out when there are none", () => {
    const s = stage(legacySection("context"), { stageKey: "context", video: null, documents: [doc("b", false)] });
    expect(s).not.toHaveProperty("video");
    expect(s).not.toHaveProperty("documents");
  });
});
