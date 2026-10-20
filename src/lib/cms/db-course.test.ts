import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NarrativeBlock } from "./types";

/*
 * What learners get from a course created in the CMS when an editor typed a
 * translation and then cleared it. The editor stores the cleared field as
 * "" (or only spaces), and that must read as "not written in this
 * language", not as text: learners get the English, never a blank.
 */

vi.mock("server-only", () => ({}));

const para = (text: string): NarrativeBlock => ({ kind: "paragraph", text });

let course: { slug: string; meta: unknown; cluster: string; durationMinutes: number; status: string; outline?: unknown };
let lessons: { stageKey: string; narrative?: unknown; structure?: unknown; parts?: unknown }[];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    course: {
      findFirst: async () => course,
      findMany: async () => [course],
    },
    lesson: {
      findMany: async ({ where }: { where: { stageKey?: { startsWith: string }; NOT?: { stageKey?: { startsWith: string } } } }) =>
        // The lesson plans ask for the standard lessons and the course's
        // own ("s-…") apart, each row with its count of published documents.
        lessons
          .filter((l) =>
            where.stageKey
              ? l.stageKey.startsWith(where.stageKey.startsWith)
              : !(where.NOT?.stageKey && l.stageKey.startsWith(where.NOT.stageKey.startsWith))
          )
          .map((l) => ({ courseSlug: course.slug, video: null, parts: null, structure: null, ...l, _count: { documents: 0 } })),
    },
  },
}));

const { getDbCourse, listDbCourses } = await import("./db-course");

beforeEach(() => {
  course = {
    slug: "asking-for-help",
    cluster: "communicationEi",
    durationMinutes: 15,
    status: "published",
    meta: {
      en: { title: "Asking for help", tagline: "Short and real", clusterLabel: "Communication" },
      // Typed in German, then cleared again.
      de: { title: "", tagline: "   ", clusterLabel: "" },
    },
  };
  lessons = [
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
        // A German title, but the body was cleared.
        de: { title: "Die Fähigkeit", blocks: [para("  ")] },
      },
    },
    {
      stageKey: "behaviour",
      // Only ever written in German.
      narrative: { de: { title: "So geht's", blocks: [para("Frag früh.")] } },
    },
    {
      stageKey: "reflection",
      narrative: {
        en: { title: "Look back", blocks: [para("Think about today.")] },
        de: { title: "", blocks: [para("")] },
      },
    },
    {
      stageKey: "simulation",
      structure: {
        kind: "simulation",
        title: { en: "Practise asking", de: "" },
        prompt: { en: "What do you say?", de: " " },
        instruction: { en: "Pick one", de: "Wähle eine" },
        options: [
          { id: "a", isBest: true, text: { en: "Ask", de: "" }, feedback: { en: "Good", de: "" } },
          { id: "b", isBest: false, text: { en: "Wait", de: "Warten" }, feedback: { en: "Hm" } },
        ],
      },
    },
    {
      stageKey: "assessment",
      structure: {
        kind: "assessment",
        // No title in any language: the generic one.
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
      },
    },
  ];
});

describe("getDbCourse with cleared translations", () => {
  it("shows the English course title and subtitle", async () => {
    const c = await getDbCourse("p", "asking-for-help", "de");
    expect(c?.title).toBe("Asking for help");
    expect(c?.tagline).toBe("Short and real");
    expect(c?.clusterLabel).toBe("Communication");
  });

  it("shows the English lesson when the German one is blank", async () => {
    const c = await getDbCourse("p", "asking-for-help", "de");
    const context = c?.stages.find((s) => s.key === "context");
    expect(context?.title).toBe("The situation");
    expect(context?.subtitle).toBe("Read first");
    expect(context?.blocks).toEqual([para("You are stuck.")]);
  });

  it("falls back field by field: the German title, the English text", async () => {
    const c = await getDbCourse("p", "asking-for-help", "de");
    const concept = c?.stages.find((s) => s.key === "concept");
    expect(concept?.title).toBe("Die Fähigkeit");
    expect(concept?.blocks).toEqual([para("Ask early.")]);
  });

  it("falls back to the first language written when there's no English", async () => {
    const c = await getDbCourse("p", "asking-for-help", "el");
    const behaviour = c?.stages.find((s) => s.key === "behaviour");
    expect(behaviour?.title).toBe("So geht's");
    expect(behaviour?.blocks).toEqual([para("Frag früh.")]);
  });

  it("shows the English reflection title and intro", async () => {
    const c = await getDbCourse("p", "asking-for-help", "de");
    const reflection = c?.stages.find((s) => s.key === "reflection");
    expect(reflection?.title).toBe("Look back");
    expect(reflection?.reflection?.intro).toBe("Think about today.");
  });

  it("shows the English exercise text, field by field", async () => {
    const c = await getDbCourse("p", "asking-for-help", "de");
    const sim = c?.stages.find((s) => s.key === "simulation");
    expect(sim?.title).toBe("Practise asking");
    expect(sim?.simulation?.prompt).toBe("What do you say?");
    expect(sim?.simulation?.instruction).toBe("Wähle eine");
    expect(sim?.simulation?.options.map((o) => o.text)).toEqual(["Ask", "Warten"]);
    expect(sim?.simulation?.options[0].feedback).toBe("Good");

    const quiz = c?.stages.find((s) => s.key === "assessment");
    expect(quiz?.title).toBe("Quick check");
    expect(quiz?.assessment?.questions[0].question).toBe("Why ask?");
    expect(quiz?.assessment?.questions[0].options[0].text).toBe("To learn");
  });

  it("still shows the German text where there is some", async () => {
    lessons[0].narrative = {
      en: { title: "The situation", blocks: [para("You are stuck.")] },
      de: { title: "Die Lage", blocks: [para("Du kommst nicht weiter.")] },
    };
    const c = await getDbCourse("p", "asking-for-help", "de");
    const context = c?.stages.find((s) => s.key === "context");
    expect(context?.title).toBe("Die Lage");
    expect(context?.blocks).toEqual([para("Du kommst nicht weiter.")]);
  });
});

describe("listDbCourses with a cleared translation", () => {
  it("lists the English title and subtitle", async () => {
    const [summary] = await listDbCourses("p", "de");
    expect(summary.title).toBe("Asking for help");
    expect(summary.tagline).toBe("Short and real");
  });
});

describe("listDbCourses lessons", () => {
  // The dashboard counts a course against these: a created course without
  // a scenario has six lessons, not seven.
  it("lists the lessons the course has, the ones the player plays", async () => {
    const [summary] = await listDbCourses("p", "en");
    expect(summary.stageKeys).toEqual([
      "context",
      "concept",
      "behaviour",
      "simulation",
      "reflection",
      "assessment",
    ]);
    const course = await getDbCourse("p", "asking-for-help", "en");
    expect(summary.stageKeys).toEqual(course?.stages.map((s) => s.key));
    expect(summary.unseenStageKeys).toEqual([]);
    expect(summary.stageLabels).toMatchObject({ context: "Context", simulation: "Guided practice" });
  });

  // Release 2 (D58, D64): the course's own order, lessons and step names,
  // and the lessons learners don't see, which a finished one counts from.
  it("lists a flexible course's lessons as the player plays them, with their step names", async () => {
    course.outline = {
      v: 1,
      sections: [
        { id: "concept", template: "concept", label: { en: "The idea" } },
        { id: "context", template: "context", hidden: true },
        { id: "s-abcdefgh", template: "text", label: { en: "My own" } },
        { id: "behaviour", template: "behaviour" },
        { id: "reflection", template: "reflection" },
      ],
    };
    lessons = [{ stageKey: "s-abcdefgh", narrative: { en: { title: "Mine", blocks: [para("Text")] } } }];
    const [summary] = await listDbCourses("p", "en");
    expect(summary.stageKeys).toEqual(["concept", "s-abcdefgh", "behaviour", "reflection"]);
    expect(summary.unseenStageKeys).toEqual(["context"]);
    expect(summary.stageLabels).toEqual({
      concept: "The idea",
      "s-abcdefgh": "My own",
      behaviour: "Behaviour model",
      reflection: "Reflection",
    });
  });
});
