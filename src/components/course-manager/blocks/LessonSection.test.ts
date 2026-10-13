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

function render(l: LessonOutline, open: boolean) {
  const props: LessonSectionProps = {
    lesson: l,
    label: "2. Skill concept",
    slug: "my-course",
    kind: "cms",
    status: "draft",
    lang: "en",
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
