import { describe, it, expect, vi } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import type { LessonOutline } from "@/lib/cms/course-admin-types";
import type { PartView, SectionStage } from "@/lib/cms/sections/contract";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  Link: (props: { children?: ReactNode; href: unknown }) =>
    createElement("a", { href: String(props.href) }, props.children),
  getPathname: ({ href }: { href: { pathname: string } | string }) =>
    typeof href === "string" ? href : href.pathname,
}));
vi.mock("@/app/actions/parts", () => ({}));
vi.mock("@/app/actions/structure", () => ({}));
vi.mock("@/app/actions/lesson", () => ({}));
vi.mock("@/app/actions/course", () => ({}));

import { DirtyProvider } from "../dirty-registry";
import { LessonSection } from "../LessonSection";
import type { LessonSectionProps } from "../lesson-section-props";
import { MAIN, QUIZ, TEXT, lesson, section } from "./fixtures";

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone: string;
  children?: ReactNode;
}>;

const noop = () => {};
/** Text as React writes it into markup. */
const html_ = (text: string) => text.replaceAll("&", "&amp;").replaceAll("'", "&#x27;").replaceAll('"', "&quot;");

function render(
  l: LessonOutline,
  open: boolean,
  lang: "en" | "de" | "el" = "en",
  labelLang?: "en" | "de" | "el",
  overrides: Partial<LessonSectionProps> = {}
) {
  const props: LessonSectionProps = {
    lesson: l,
    label: "2. Skill concept",
    labelLang,
    slug: "my-course",
    kind: "cms",
    status: "draft",
    lang,
    open,
    rev: 0,
    enrolled: 0,
    reasons: [],
    onOpen: noop,
    onClose: noop,
    onNarrativeSaved: noop,
    onReread: noop,
    onStructureSaved: noop,
    onStructureDraftChanged: noop,
    onStructureCleared: noop,
    onVideoSaved: noop,
    onDocumentsChanged: noop,
    onOutline: noop,
    announce: noop,
    ...overrides,
  };
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: "en", messages: en, timeZone: "UTC" },
      createElement(DirtyProvider, null, createElement(LessonSection, props))
    )
  );
}

/** A quick check made as a lesson of the course's own. */
const ownQuiz: LessonOutline = {
  ...lesson([MAIN]),
  key: "s-quiz0001",
  body: "interactive",
  mainKind: "assessment",
  section: section("s-quiz0001", { template: "quiz", custom: true }),
  byLang: {
    en: { stage: null, narrative: null, sectioned: null },
    de: { stage: null, narrative: null, sectioned: null },
    el: { stage: null, narrative: null, sectioned: null },
  },
};

describe("LessonSection — the lesson's editors", () => {
  it("keeps today's ids, and edits a standard lesson's text in today's editor", () => {
    const html = render(lesson([MAIN]), true);
    expect(html).toContain('id="lesson-concept"');
    expect(html).toContain('id="lesson-concept-h"');
    expect(html).toContain("Lesson text (English)");
    expect(html).toContain("Lesson title");
    expect(html).toContain('aria-label="Add content after content 1: Text"');
  });

  it("edits a lesson of the course's own with its template's exercise editor", () => {
    const html = render(ownQuiz, true);
    expect(html).toContain('id="lesson-s-quiz0001"');
    expect(html).toContain("Interactive stage — Assessment");
    expect(html).toContain("Save stage");
    // Its video and documents can be added like any lesson's, before its content.
    const video = html.indexOf("Interactive video");
    const documents = html.indexOf("Lesson documents");
    expect(video).toBeGreaterThan(-1);
    expect(documents).toBeGreaterThan(video);
    expect(html.indexOf("Interactive stage — Assessment")).toBeGreaterThan(documents);
    expect(html).toContain('aria-label="Add content after content 1: Quick check"');
  });

  it("puts the lesson's own reflection questions in place of the standard ones", () => {
    const reflectionPart: PartView = {
      id: "p-refl0001",
      type: "reflection",
      data: null,
      draft: { kind: "reflection", prompts: [{ id: "p1", label: { en: "Mine?" } }] },
      versions: { data: null, draft: "d" },
      itemVersion: "i",
      issues: [],
    };
    const reflection: LessonOutline = {
      ...lesson([MAIN, reflectionPart]),
      key: "reflection",
      body: "reflection",
      mainKind: "reflection",
      section: section("reflection"),
    };
    const html = render(reflection, true);
    expect(html).toContain(en.lessonBlocks.ownQuestionsNote);
    expect(html).not.toContain("Questions learners answer privately");
  });
});

describe("LessonSection — the heading's language", () => {
  it("marks a name in the content language, and leaves the menu's unmarked", () => {
    expect(render(lesson([MAIN]), false, "de", "de")).toMatch(/<h2 id="lesson-concept-h" tabindex="-1" lang="de"/);
    expect(render(lesson([MAIN]), false)).toMatch(/<h2 id="lesson-concept-h" tabindex="-1" class=/);
  });
});

describe("LessonSection — a lesson not in the lesson list yet", () => {
  // An "Add an applied scenario" lesson, or one with only a draft: not in the
  // list until its first "Save stage". Its editor already sits where the
  // content list puts it, so that save doesn't remount it — which would wipe
  // "Saved" and drop focus to the page.
  const unlisted: LessonOutline = {
    ...lesson([MAIN]),
    key: "scenario",
    present: false,
    addable: true,
    body: "interactive",
    mainKind: "scenario",
    section: null,
    parts: null,
  };

  it("renders the editor inside the content list, with no list controls", () => {
    const html = render(unlisted, true);
    const listed = render(
      { ...unlisted, present: true, addable: false, section: section("scenario"), parts: lesson([MAIN]).parts },
      true
    );
    const editorAt = (h: string) => h.indexOf("Interactive stage");
    expect(editorAt(html)).toBeGreaterThan(-1);
    // The same wrappers lead to the editor either way.
    const wrapper = '<ol class="space-y-4"><li><div class="scroll-mt-24 space-y-2"><div id=';
    expect(html).toContain(wrapper);
    expect(listed).toContain(wrapper);
    expect(html.indexOf(wrapper)).toBeLessThan(editorAt(html));
    // Nothing to add, move or remove until it is in the list.
    expect(html).not.toContain(">Add content<");
    expect(html).not.toContain(html_(en.lessonBlocks.unreadable));
    expect(html).not.toContain(html_(en.lessonBlocks.liveLocked));
    expect(listed).toContain(">Add content<");
  });

  it("says nothing about a live course's locks while it isn't in the list", () => {
    const html = render(unlisted, true, "en", undefined, { status: "published" });
    expect(html).toContain("Interactive stage");
    expect(html).not.toContain(html_(en.lessonBlocks.liveLocked));
    expect(html).not.toContain(">Add content<");
  });
});

describe("LessonSection — closed", () => {
  const stage: SectionStage = {
    key: "concept",
    label: "Skill concept",
    title: "Skill concept",
    parts: [
      { id: "p-text0001", type: "text", blocks: [{ kind: "paragraph", text: "Extra words" }] },
      { id: "main", type: "text", blocks: [{ kind: "paragraph", text: "Main words" }] },
    ],
    skipped: 1,
  };
  const withExtras = lesson([TEXT, MAIN, QUIZ], {
    byLang: {
      en: { stage: null, narrative: null, sectioned: stage },
      de: { stage: null, narrative: null, sectioned: null },
      el: { stage: null, narrative: null, sectioned: null },
    },
  });

  it("reads each content in order, marking what learners don't see yet", () => {
    const html = render(withExtras, false);
    const extra = html.indexOf("Extra words");
    const main = html.indexOf("Main words");
    expect(extra).toBeGreaterThan(-1);
    expect(main).toBeGreaterThan(extra);
    // The quick check is only a draft: named, marked, and not shown.
    expect(html).toContain("Quick check");
    expect(html).toContain(">Draft<");
    expect(html).toContain(en.lessonBlocks.notShown);
    // The content is marked with its language; the headings (menu language) aren't.
    expect(html).toMatch(/<div lang="en">(?:(?!<\/li>).)*Extra words/);
  });

  it("keeps the interface's words in the menu language inside content marked with its own", () => {
    const practice: SectionStage = {
      key: "concept",
      label: "Skill concept",
      title: "Skill concept",
      parts: [
        {
          id: "p-prac0001",
          type: "practice",
          simulation: {
            prompt: "Ein Kollege bittet um Hilfe.",
            instruction: "",
            options: [
              { id: "a", text: "Fragen, was er versucht hat", feedback: "", isBest: true },
              { id: "b", text: "Es selbst machen", feedback: "", isBest: false },
            ],
          },
        },
      ],
      skipped: 0,
    };
    const practiceView: PartView = {
      id: "p-prac0001",
      type: "practice",
      data: {
        kind: "simulation",
        title: {},
        prompt: { de: "Ein Kollege bittet um Hilfe." },
        instruction: {},
        options: [
          { id: "a", isBest: true, text: { de: "Fragen, was er versucht hat" }, feedback: {} },
          { id: "b", isBest: false, text: { de: "Es selbst machen" }, feedback: {} },
        ],
      },
      draft: null,
      versions: { data: "d", draft: null },
      itemVersion: "i-prac",
      issues: [],
    };
    const html = render(
      lesson([MAIN, practiceView], {
        byLang: {
          en: { stage: null, narrative: null, sectioned: null },
          de: { stage: null, narrative: null, sectioned: practice },
          el: { stage: null, narrative: null, sectioned: null },
        },
      }),
      false,
      "de"
    );
    // Menu in English, content in German: the badge says "Best response" in English.
    expect(html).toMatch(/<div lang="de">(?:(?!<\/li>).)*Fragen, was er versucht hat/);
    expect(html).toMatch(/<span [^>]*lang="en"><svg(?:(?!<\/span>).)*Best response<\/span>/);
  });

  it("reads a standard lesson as today", () => {
    const standard = lesson([MAIN], {
      byLang: {
        en: {
          stage: { key: "concept", title: "Skill concept", blocks: [{ kind: "paragraph", text: "Main words" }] },
          narrative: null,
          sectioned: null,
        },
        de: { stage: null, narrative: null, sectioned: null },
        el: { stage: null, narrative: null, sectioned: null },
      },
    });
    const html = render(standard, false);
    expect(html).toContain("Main words");
    expect(html).not.toContain(en.lessonBlocks.notShown);
  });
});

describe("LessonSection — closed, a text not written in the content language", () => {
  // The text is written only in English; the preview shows the English text in German.
  const stage: SectionStage = {
    key: "concept",
    label: "Skill concept",
    title: "Skill concept",
    parts: [
      { id: "p-text0001", type: "text", blocks: [{ kind: "paragraph", text: "Extra words" }] },
      { id: "main", type: "text", blocks: [{ kind: "paragraph", text: "Main words" }] },
    ],
    skipped: 0,
  };
  const l = lesson([TEXT, MAIN], {
    byLang: {
      en: { stage: null, narrative: null, sectioned: null },
      de: { stage: null, narrative: null, sectioned: stage },
      el: { stage: null, narrative: null, sectioned: null },
    },
  });
  const html = render(l, false, "de");

  it("says the text isn't written in the content language yet", () => {
    expect(html).toMatch(/<h3[^>]*>(?:(?!<\/h3>).)*Not written in German yet/);
  });

  it("marks the text with the language it is actually in", () => {
    expect(html).toMatch(/<div lang="en">(?:(?!<\/li>).)*Extra words/);
    expect(html).not.toMatch(/<div lang="de">(?:(?!<\/li>).)*Extra words/);
  });
});
