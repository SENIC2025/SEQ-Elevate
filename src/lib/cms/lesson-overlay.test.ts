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
let rows: Record<string, unknown>[] | null = null;
/** Like Prisma: with a `select`, only the selected columns come back. */
const findMany = vi.fn(async (args: { select?: Record<string, unknown> }) =>
  (rows ?? [{ stageKey: "context", narrative, video: null, documents: [] }]).map((r) =>
    args.select ? Object.fromEntries(Object.entries(r).filter(([k]) => args.select![k])) : r
  )
);
vi.mock("@/lib/prisma", () => ({ prisma: { lesson: { findMany } } }));

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

/*
 * Release 1 (spec 9.4): learners' requests read only what they show — never
 * a lesson's extra content (Lesson.parts, up to 600,000 characters) or an
 * editor's draft — and get exactly what Release 0 gave them.
 */
describe("applyLessonMedia reads only what learners see", () => {
  const DOC = {
    id: "d1",
    name: "Checklist.pdf",
    url: "https://blob.example/c.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1200,
    published: true,
  };
  const VIDEO = { provider: "youtube", src: "https://youtu.be/abc", title: "Watch" };

  it("selects exactly the stage key, the text, the video and the published documents", async () => {
    rows = [];
    await applyLessonMedia("p", "workplace-conflict", builtIn());
    expect(findMany.mock.calls.at(-1)?.[0]).toEqual({
      where: { projectId: "p", courseSlug: "workplace-conflict" },
      select: {
        stageKey: true,
        narrative: true,
        video: true,
        documents: {
          where: { published: true },
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          select: { id: true, name: true, url: true, mimeType: true, sizeBytes: true, published: true },
        },
      },
    });
    rows = null;
  });

  it("gives learners what Release 0 gave them", async () => {
    rows = [
      {
        id: "lesson-1",
        stageKey: "context",
        narrative: { de: { title: "Neu", blocks: [para("Umformuliert.")] } },
        structure: null,
        structureDraft: { kind: "scenario" },
        parts: { v: 1, items: [{ id: "main", type: "main" }] },
        video: VIDEO,
        updatedAt: new Date(),
        documents: [{ ...DOC, lessonId: "lesson-1", order: 0, createdAt: new Date() }],
      },
      { id: "lesson-2", stageKey: "s-abcdefgh", narrative: null, video: VIDEO, documents: [] },
    ];
    const course = await applyLessonMedia("p", "workplace-conflict", builtIn());
    // Recorded on Release 0 (the `include` read) for these rows.
    expect(course.stages).toEqual([
      {
        key: "context",
        title: "Neu",
        subtitle: "Worum es geht",
        blocks: [para("Umformuliert.")],
        video: VIDEO,
        documents: [DOC],
      },
    ]);
    rows = null;
  });
});
