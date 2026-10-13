/**
 * Course-page lessons for the content list's tests: a created course's
 * lesson as the loader sends it (course-admin.ts), with its content.
 */

import type { LessonOutline } from "@/lib/cms/course-admin-types";
import type { PartView, SectionView } from "@/lib/cms/sections/contract";
import { emptyExercise } from "@/lib/cms/sections/part-kinds";
import type { TextPartView } from "./part-list";

const para = (text: string) => ({ kind: "paragraph" as const, text });

export const MAIN: PartView = { id: "main", type: "main" };
export const TEXT: TextPartView = {
  id: "p-text0001",
  type: "text",
  blocks: { en: [para("Extra words")] },
  versions: { en: "ven", de: null, el: null },
  itemVersion: "i-text",
};
export const QUIZ: PartView = {
  id: "p-quiz0001",
  type: "quiz",
  data: null,
  draft: emptyExercise("assessment"),
  versions: { data: null, draft: "d1" },
  itemVersion: "i-quiz",
  issues: [
    { code: "assessmentQuestionText", params: { question: 1 } },
    { code: "assessmentCorrect", params: { question: 1 } },
  ],
};

const name = (text: string) => ({
  en: { text, source: "standard" as const },
  de: { text, source: "standard" as const },
  el: { text, source: "standard" as const },
});

export function section(id: string, overrides: Partial<SectionView> = {}): SectionView {
  return {
    id: id as SectionView["id"],
    template: (id.startsWith("s-") ? "text" : id) as SectionView["template"],
    custom: id.startsWith("s-"),
    hidden: false,
    recovered: false,
    label: {},
    labelVersion: { en: null, de: null, el: null },
    name: name("Skill concept"),
    number: 2,
    deleteSummary: { languages: [], textBlocks: 0, questionBlocks: 0, video: false, documents: 0 },
    ...overrides,
  };
}

/** A text lesson of a created course's list with `items` as its content. */
export function lesson(items: PartView[], overrides: Partial<LessonOutline> = {}): LessonOutline {
  const narrative = {
    title: "Skill concept",
    subtitle: "",
    blocks: [para("Main words")],
    hasOverride: true,
    version: "n1",
  };
  return {
    key: "concept",
    present: true,
    addable: false,
    body: "narrative",
    mainKind: "narrative",
    editable: { body: true, media: true },
    byLang: {
      en: { stage: null, narrative, sectioned: null },
      de: { stage: null, narrative, sectioned: null },
      el: { stage: null, narrative, sectioned: null },
    },
    structure: null,
    draft: null,
    video: null,
    builtInVideo: false,
    documents: [],
    updatedAt: null,
    section: section("concept"),
    parts: { items, order: "order-1" },
    contentVersion: "c1",
    live: true,
    ...overrides,
  };
}
