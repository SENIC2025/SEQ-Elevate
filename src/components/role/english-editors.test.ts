import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import de from "@/messages/de.json";
import type { LessonDocumentRef, VideoContent } from "@/lib/cms/types";

/*
 * Release 3 (WCAG 3.1.2, D99): the editors inside Manage courses and Create
 * courses that stay English on every locale's page — a lesson's video, its
 * documents, its text and content blocks, and the Comp Card's wording — mark
 * their English lang="en", as the admin screens do
 * (src/app/[locale]/admin/english-pages.test.ts). What is written in them
 * carries its own language: a lesson's text and the Comp Card's wording the
 * language being edited; a video's text and a document's name, whose
 * language no one records, the page's (here German), as the lesson's read
 * view shows them. Rendered on a German page.
 */

vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl")>()),
  useLocale: () => "de",
  useTranslations: (namespace: string) => createTranslator({ locale: "de", messages: de, namespace: namespace as never }),
}));
vi.mock("@/app/actions/lesson", () => ({
  addLessonDocument: vi.fn(),
  removeLessonDocument: vi.fn(),
  setLessonDocumentOrder: vi.fn(),
  setLessonDocumentPublished: vi.fn(),
  getLessonMedia: vi.fn(),
  saveLessonVideo: vi.fn(),
  clearLessonVideo: vi.fn(),
  saveLessonNarrative: vi.fn(),
  clearLessonNarrative: vi.fn(),
}));
vi.mock("@/app/actions/comp-card-template", () => ({
  getCompCardEditorState: vi.fn(() => new Promise(() => {})),
  saveCompCardTemplate: vi.fn(),
  clearCompCardTemplate: vi.fn(),
}));
// The preview inside the video editor: a learner's view, in the page's words.
vi.mock("@/components/course/InteractiveVideoPlayer", async () => {
  const { createElement: h } = await import("react");
  return { InteractiveVideoPlayer: () => h("p", null, "Vorschau des Videos") };
});

const { LessonDocumentManager } = await import("./LessonDocumentManager");
const { VideoBlockAuthor } = await import("./VideoBlockAuthor");
const { BlockList, withKeys } = await import("./narrative/BlockList");
const { CompCardTemplateEditor } = await import("./CompCardTemplateEditor");
const { LessonNarrativeEditor } = await import("./LessonNarrativeEditor");

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

interface Piece {
  /** The text, or a field's value. */
  text: string;
  /** The language it is read in: the nearest lang (null: the page's own, here German). */
  lang: string | null;
  field: boolean;
}

/** Each text in `html`, and each field's value, with the language it is read in. */
function pieces(html: string): Piece[] {
  const stack: (string | null)[] = [];
  const out: Piece[] = [];
  const current = () => [...stack].reverse().find((l) => l !== null) ?? null;
  const attr = (token: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(token)?.[1] ?? null;
  const unescape = (s: string) => s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  for (const token of html.match(/<[^>]+>|[^<]+/g) ?? []) {
    if (token.startsWith("</")) stack.pop();
    else if (token.startsWith("<")) {
      const name = /^<([a-zA-Z0-9]+)/.exec(token)?.[1]?.toLowerCase() ?? "";
      const own = attr(token, "lang");
      if (name === "input" && attr(token, "type") !== "file" && attr(token, "value") !== null) {
        out.push({ text: unescape(attr(token, "value")!), lang: own ?? current(), field: true });
      }
      if (VOID.has(name) || token.endsWith("/>")) continue;
      stack.push(own);
    } else {
      const text = unescape(token).trim();
      if (text) out.push({ text, lang: current(), field: false });
    }
  }
  return out;
}

const render = (el: ReactElement) => pieces(renderToStaticMarkup(el));
/** Every text not marked English, but numbers and sizes. */
const notEnglish = (all: Piece[]) => all.filter((p) => p.lang !== "en" && !/^[\d\s.,·–()%/KMGB]+$/.test(p.text) && !p.field);
const langOf = (all: Piece[], text: string) => all.find((p) => p.text === text)?.lang;

describe("the English editors mark their English, and what is written in them its own language (WCAG 3.1.2)", () => {
  it("lesson documents: English, a document's name in the page's language", () => {
    const doc: LessonDocumentRef = {
      id: "d1",
      name: "Arbeitsblatt.pdf",
      url: "https://x.public.blob.vercel-storage.com/a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      published: true,
    };
    const all = render(createElement(LessonDocumentManager, { courseSlug: "c", stageKey: "concept", initialDocuments: [doc] }));
    expect(langOf(all, "Lesson documents")).toBe("en");
    expect(langOf(all, "Hide from learners")).toBe("en");
    expect(notEnglish(all)).toEqual([{ text: "Arbeitsblatt.pdf", lang: "de", field: false }]);
  });

  it("the video editor: English; the video's text in the page's language; the preview a learner's view", () => {
    const video: VideoContent = {
      provider: "file",
      src: "https://x.public.blob.vercel-storage.com/v.mp4",
      title: "Wie man es sagt",
      caption: "Ein kurzer Satz",
      captions: [{ src: "https://x.public.blob.vercel-storage.com/v.vtt", label: "Ελληνικά", lang: "el" }],
      cues: [
        {
          id: "q1",
          atSeconds: 5,
          question: "Was hörst du?",
          options: [
            { id: "a", text: "Ja" },
            { id: "b", text: "Nein" },
          ],
          correctOptionId: "a",
          explanation: "Weil es so ist.",
        },
      ],
    };
    const all = render(
      createElement(VideoBlockAuthor, { courseSlug: "c", stageKey: "concept", initialVideo: video, locale: "el", embedded: true })
    );
    expect(langOf(all, "Interactive video")).toBe("en");
    expect(langOf(all, "In-video questions")).toBe("en");
    // The language names, each in its own language.
    expect(langOf(all, "Deutsch")).toBe("de");
    expect(langOf(all, "Ελληνικά")).toBe("el");
    expect(notEnglish(all).filter((p) => !["Deutsch", "Ελληνικά"].includes(p.text))).toEqual([
      { text: "Vorschau des Videos", lang: "de", field: false },
    ]);
    const fields = Object.fromEntries(all.filter((p) => p.field).map((p) => [p.text, p.lang]));
    expect(fields).toMatchObject({
      "Wie man es sagt": "de",
      "Ein kurzer Satz": "de",
      "Was hörst du?": "de",
      Ja: "de",
      Nein: "de",
      "Weil es so ist.": "de",
      // The caption track's name, in the captions' language.
      "Ελληνικά": "el",
    });
  });

  it("content blocks: English; the blocks' text in the language being written", () => {
    const blocks = withKeys([
      { kind: "paragraph", text: "Ένα κείμενο για το μάθημα." },
      { kind: "list", items: ["Πρώτο σημείο"], listStyle: "bullet" },
      { kind: "compare", compare: [
        { label: "Αντί για", text: "Φωνάζεις.", tone: "negative" },
        { label: "Δοκίμασε", text: "Μιλάς ήρεμα.", tone: "positive" },
      ] },
    ]);
    const html = renderToStaticMarkup(
      createElement(BlockList, { blocks, onBlocksChange: () => {}, resetKey: 0, contentLang: "el" })
    );
    const all = pieces(html);
    expect(langOf(all, "Add block")).toBe("en");
    // The paragraph as learners see it, and the comparison's text boxes.
    expect(notEnglish(all)).toEqual([
      { text: "Ένα κείμενο για το μάθημα.", lang: "el", field: false },
      { text: "Φωνάζεις.", lang: "el", field: false },
      { text: "Μιλάς ήρεμα.", lang: "el", field: false },
    ]);
    expect(html).toMatch(/<textarea[^>]*lang="el"[^>]*>Φωνάζεις\.<\/textarea>/);
    for (const value of ["Πρώτο σημείο", "Αντί για", "Δοκίμασε"]) {
      expect(all.find((p) => p.field && p.text === value)?.lang, value).toBe("el");
    }
  });

  it("the lesson text editor (its English mode): English; its text in the language being edited; the page's words unmarked", () => {
    const all = render(
      createElement(LessonNarrativeEditor, {
        courseSlug: "c",
        stageKey: "reflection",
        locale: "el",
        initial: { title: "Κοίτα πίσω", subtitle: "", blocks: [], hasOverride: false, version: null },
        courseKind: "cms",
        mode: "reflection",
        promptsNote: de.lessonBlocks.ownQuestionsNote,
        embedded: true,
        onReread: () => {},
      })
    );
    expect(langOf(all, "Reflection text (Greek)")).toBe("en");
    expect(langOf(all, "Lesson title")).toBe("en");
    expect(all.find((p) => p.field && p.text === "Κοίτα πίσω")?.lang).toBe("el");
    // The note given by the course page is in the page's words.
    expect(notEnglish(all)).toEqual([{ text: de.lessonBlocks.ownQuestionsNote, lang: "de", field: false }]);
  });

  it("the Comp Card's wording: English, each language's name in its own language", () => {
    const all = render(createElement(CompCardTemplateEditor));
    expect(langOf(all, "Comp Card wording")).toBe("en");
    expect(langOf(all, "Loading…")).toBe("en");
    expect(notEnglish(all)).toEqual([
      { text: "Deutsch", lang: "de", field: false },
      { text: "Ελληνικά", lang: "el", field: false },
    ]);
  });
});
