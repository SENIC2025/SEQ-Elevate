import { describe, it, expect, vi } from "vitest";
import type { CourseContent, NarrativeBlock } from "./types";

/*
 * A built-in course's lesson text, reworded by an editor in one language
 * (Lesson.narrative). A field cleared in the editor is stored as "" — and
 * must leave learners the course's own text in that language, never a
 * blank. (Built-in courses never borrow another language's wording.)
 */

vi.mock("server-only", () => ({}));

const para = (text: string): NarrativeBlock => ({ kind: "paragraph", text });

let narrative: unknown;
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lesson: {
      findMany: async () => [
        { stageKey: "context", narrative, video: null, documents: [] },
      ],
    },
  },
}));

const { applyLessonMedia } = await import("./lesson-overlay");

const builtIn = (): CourseContent =>
  ({
    slug: "workplace-conflict",
    locale: "de",
    stages: [
      {
        key: "context",
        title: "Die Situation",
        subtitle: "Worum es geht",
        blocks: [para("Eingebaut.")],
      },
    ],
  }) as unknown as CourseContent;

describe("applyLessonMedia on a built-in course", () => {
  it("keeps the built-in text for every field cleared in the editor", async () => {
    narrative = { de: { title: "  ", subtitle: "", blocks: [para(""), { kind: "list", items: [" "] }] } };
    const [stage] = (await applyLessonMedia("p", "workplace-conflict", builtIn())).stages;
    expect(stage.title).toBe("Die Situation");
    expect(stage.subtitle).toBe("Worum es geht");
    expect(stage.blocks).toEqual([para("Eingebaut.")]);
  });

  it("uses each reworded field on its own", async () => {
    narrative = { de: { title: "Neu", blocks: [para("")] } };
    const [stage] = (await applyLessonMedia("p", "workplace-conflict", builtIn())).stages;
    expect(stage.title).toBe("Neu");
    expect(stage.blocks).toEqual([para("Eingebaut.")]);
  });

  it("uses the reworded text", async () => {
    narrative = { de: { title: "Neu", subtitle: "Kurz", blocks: [para("Umformuliert.")] } };
    const [stage] = (await applyLessonMedia("p", "workplace-conflict", builtIn())).stages;
    expect(stage).toMatchObject({
      title: "Neu",
      subtitle: "Kurz",
      blocks: [para("Umformuliert.")],
    });
  });

  it("never borrows another language's rewording", async () => {
    narrative = { en: { title: "New", blocks: [para("Reworded.")] } };
    const [stage] = (await applyLessonMedia("p", "workplace-conflict", builtIn())).stages;
    expect(stage.title).toBe("Die Situation");
    expect(stage.blocks).toEqual([para("Eingebaut.")]);
  });
});
