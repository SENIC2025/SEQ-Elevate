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
let links: Record<string, unknown>[] | "fail" = [];
const linkFindMany = vi.fn(async (args?: unknown) => {
  void args;
  if (links === "fail") throw new Error("links down");
  return links;
});
vi.mock("@/lib/prisma", () => ({ prisma: { lesson: { findMany }, lessonLink: { findMany: linkFindMany } } }));

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
          // Release 4 (D108): the languages each is for (changed on purpose).
          select: { id: true, name: true, url: true, mimeType: true, sizeBytes: true, published: true, languages: true },
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

/*
 * U11, Release 4 (spec 4.4, D107, D108): getCourse is read by learners and
 * staff alike and doesn't know the page's language, so documents come with
 * the languages each is for and are never filtered here. Further reading is
 * read on its own: published links only, each address checked again, and a
 * failure there costs only the links, never the video or the documents.
 */
describe("applyLessonMedia and Release 4's further reading and languages", () => {
  const DOC = { id: "d1", name: "Arbeitsblatt.pdf", url: "https://blob.example/a.pdf", mimeType: "application/pdf", sizeBytes: 9, published: true };
  const VIDEO = { provider: "youtube", src: "https://youtu.be/abc", title: "Watch" };
  const link = (id: string, url: string, fields: Record<string, unknown> = {}) => ({
    id,
    title: `Reading ${id}`,
    url,
    description: "",
    languages: [],
    published: true,
    lesson: { stageKey: "context" },
    ...fields,
  });

  it("gives every document with its languages, whatever the page's language", async () => {
    rows = [
      {
        stageKey: "context",
        narrative: null,
        video: null,
        documents: [
          { ...DOC, languages: ["de"] },
          { ...DOC, id: "d2", languages: [] },
          { ...DOC, id: "d3", languages: ["en", "de", "el"] },
          { ...DOC, id: "d4", languages: null },
        ],
      },
    ];
    links = [];
    const [stage] = (await applyLessonMedia("p", "workplace-conflict", builtIn())).stages;
    expect(stage.documents).toEqual([
      { ...DOC, languages: ["de"] },
      { ...DOC, id: "d2" },
      { ...DOC, id: "d3" },
      { ...DOC, id: "d4" },
    ]);
    rows = null;
  });

  it("reads published links only, in order, and drops a stored address the check refuses", async () => {
    rows = [{ stageKey: "context", narrative: null, video: null, documents: [] }];
    links = [
      link("l1", "HTTPS://Example.org/One", { languages: ["el", "de"] }),
      link("l2", "javascript:alert(1)"),
      link("l3", "data:text/html,<script>alert(1)</script>"),
      link("l4", "not an address"),
      link("l5", "mailto:help@example.org", { description: "Write to us." }),
    ];
    const [stage] = (await applyLessonMedia("p", "workplace-conflict", builtIn())).stages;
    expect(linkFindMany.mock.calls.at(-1)?.[0]).toMatchObject({
      where: { published: true, lesson: { projectId: "p", courseSlug: "workplace-conflict" } },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    expect((stage as { links?: unknown }).links).toEqual([
      { id: "l1", title: "Reading l1", url: "https://example.org/One", kind: "web", description: "", languages: ["de", "el"], published: true },
      { id: "l5", title: "Reading l5", url: "mailto:help@example.org", kind: "email", description: "Write to us.", languages: [], published: true },
    ]);
    rows = null;
    links = [];
  });

  it("keeps the video and the documents when the links can't be read", async () => {
    rows = [{ stageKey: "context", narrative: null, video: VIDEO, documents: [DOC] }];
    links = "fail";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const [stage] = (await applyLessonMedia("p", "workplace-conflict", builtIn())).stages;
    expect(stage).toMatchObject({ video: VIDEO, documents: [DOC] });
    expect(stage).not.toHaveProperty("links");
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
    rows = null;
    links = [];
  });

  it("doesn't read the links with R4_FURTHER_READING=off", async () => {
    vi.stubEnv("R4_FURTHER_READING", "off");
    rows = [{ stageKey: "context", narrative: null, video: null, documents: [] }];
    links = [link("l1", "https://example.org/one")];
    linkFindMany.mockClear();
    const [stage] = (await applyLessonMedia("p", "workplace-conflict", builtIn())).stages;
    expect(linkFindMany).not.toHaveBeenCalled();
    expect(stage).not.toHaveProperty("links");
    vi.unstubAllEnvs();
    rows = null;
    links = [];
  });
});
