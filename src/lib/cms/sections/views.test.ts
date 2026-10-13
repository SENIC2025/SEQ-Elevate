import { describe, it, expect } from "vitest";
import { deleteSummary, partsView, sectionTitle } from "./views";
import { partsOrderVersion } from "./versions";

/*
 * What the course page is sent about a lesson's content (spec 9.1): the
 * bases of every change, what a delete would remove, and the title a step
 * name falls back to.
 */

const para = (text: string) => ({ kind: "paragraph", text });
const MAIN = { id: "main", type: "main" } as const;

describe("partsView", () => {
  it("is the main content alone for an empty column, and null when it can't be read", () => {
    expect(partsView(null)).toEqual({ items: [MAIN], order: partsOrderVersion([MAIN]) });
    expect(partsView({ v: 1, items: [MAIN, MAIN] })).toBeNull();
  });

  it("gives each part its bases, and a question what keeps its newest version from learners", () => {
    const view = partsView({
      v: 1,
      items: [
        MAIN,
        { id: "p-text0001", type: "text", blocks: { de: [para("Hallo")] } },
        { id: "p-refl0001", type: "reflection", data: null, draft: { kind: "reflection", prompts: [] } },
      ],
    });
    const [, text, question] = view!.items;
    expect(text).toMatchObject({
      versions: { en: null, de: expect.any(String), el: null },
      itemVersion: expect.any(String),
    });
    expect(question).toMatchObject({
      versions: { data: null, draft: expect.any(String) },
      issues: [{ code: "reflectionNoPrompts" }],
    });
  });
});

describe("deleteSummary", () => {
  it("lists the languages, texts, questions, video and documents a delete removes", () => {
    expect(
      deleteSummary({
        narrative: { en: { title: "T", blocks: [para("x")] }, de: { title: " ", blocks: [] } },
        structureDraft: { kind: "simulation" },
        parts: {
          v: 1,
          items: [
            MAIN,
            { id: "p-text0001", type: "text", blocks: { el: [para("Γεια")] } },
            { id: "p-quiz0001", type: "quiz", data: null, draft: null },
          ],
        },
        video: { provider: "youtube", src: "x" },
        documentCount: 2,
      })
    ).toEqual({ languages: ["en", "el"], textBlocks: 2, questionBlocks: 2, video: true, documents: 2 });
    expect(deleteSummary(undefined)).toEqual({
      languages: [],
      textBlocks: 0,
      questionBlocks: 0,
      video: false,
      documents: 0,
    });
  });
});

describe("sectionTitle", () => {
  it("is the text's title, or the exercise's (saved, else the draft), in the language", () => {
    expect(sectionTitle({ narrative: { de: { title: "Titel" } } }, "narrative", "en")).toBe("Titel");
    expect(
      sectionTitle({ structure: null, structureDraft: { title: { en: "Draft title" } } }, "assessment", "en")
    ).toBe("Draft title");
    expect(sectionTitle(undefined, "scenario", "en")).toBeNull();
  });
});
