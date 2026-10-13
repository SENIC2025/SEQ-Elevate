import { describe, it, expect, vi } from "vitest";
import { createElement, Fragment, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import type { ExerciseValue, StoredRating, StoredReflection } from "@/lib/cms/sections/contract";
import { emptyExercise } from "@/lib/cms/sections/part-kinds";

// The editor's actions are server actions; nothing is called while rendering.
vi.mock("@/app/actions/structure", () => ({}));
vi.mock("@/app/actions/parts", () => ({}));

import { ExerciseFields, StructureAuthor } from "@/components/role/StructureAuthor";

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone: string;
  children?: ReactNode;
}>;

const render = (...children: ReactNode[]) =>
  renderToStaticMarkup(
    createElement(IntlProvider, { locale: "en", messages: en, timeZone: "UTC" }, createElement(Fragment, null, ...children))
  );

const fields = (value: ExerciseValue, key: string) =>
  createElement(ExerciseFields, { key, value, locale: "de", onChange: () => {} });

/** Every id="…" in the markup, and every radio group's name. */
const idsIn = (html: string) => [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
const namesIn = (html: string) => [...html.matchAll(/ name="([^"]+)"/g)].map((m) => m[1]);

const reflection: StoredReflection = {
  kind: "reflection",
  title: { de: "Rückblick" },
  prompts: [
    { id: "p1", label: { de: "Was lief gut?" } },
    { id: "p2", label: { de: "Was nimmst du mit?" }, placeholder: { de: "Zum Beispiel …" } },
  ],
};
const rating: StoredRating = {
  kind: "rating",
  minLabel: { de: "Trifft gar nicht zu" },
  maxLabel: { de: "Trifft voll zu" },
  statements: [
    { id: "s1", text: { de: "Ich höre zu." } },
    { id: "s2", text: { de: "Ich frage nach." } },
  ],
};

describe("several exercises in one lesson", () => {
  it("never share an element id or a radio group", () => {
    // Two quick checks, two sets of reflection questions, two self-assessments.
    const html = render(
      fields(emptyExercise("assessment"), "a"),
      fields(emptyExercise("assessment"), "b"),
      fields(reflection, "c"),
      fields(reflection, "d"),
      fields(rating, "e"),
      fields(rating, "f")
    );
    const ids = idsIn(html);
    expect(ids.length).toBeGreaterThan(20);
    expect(ids.length).toBe(new Set(ids).size);
    const names = namesIn(html);
    expect(names.length).toBe(4);
    // One group per question per editor: two answers each, two editors.
    expect(new Set(names).size).toBe(2);
  });

  it("marks every box with the language it is written in", () => {
    const html = render(fields(reflection, "a"), fields(rating, "b"));
    const boxes = [...html.matchAll(/<(input|textarea)\b[^>]*>/g)].map((m) => m[0]);
    expect(boxes.length).toBeGreaterThan(5);
    for (const box of boxes) expect(box).toContain('lang="de"');
  });
});

describe("reflection questions", () => {
  const html = render(fields(reflection, "a"));

  it("names each question's boxes by its place", () => {
    expect(html).toContain("Question 1");
    expect(html).toContain("Question 2");
    expect(html).toContain('value="Was lief gut?"');
    expect(html).toContain('value="Zum Beispiel …"');
    // Each box is named "Question 2 Question", not one of several identical "Question".
    const labelled = [...html.matchAll(/aria-labelledby="([^"]+) ([^"]+)"/g)];
    expect(labelled.length).toBe(4);
  });

  it("moves and removes each question by name; the first can't go up, the last can't go down", () => {
    expect(html).toContain('aria-label="Move question 1 up"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Move question 1 up"/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Move question 2 down"/);
    expect(html).toContain('aria-label="Remove question 2"');
    expect(html).toContain("Add question");
  });

  it("keeps one question: no Remove while it is the only one", () => {
    const one = render(fields({ ...reflection, prompts: [reflection.prompts[0]] }, "a"));
    expect(one).not.toContain("Remove question 1");
  });
});

describe("self-assessment", () => {
  const html = render(fields(rating, "a"));

  it("has the labels of both ends and each statement", () => {
    expect(html).toContain("What 1 means");
    expect(html).toContain("What 5 means");
    expect(html).toContain('value="Trifft voll zu"');
    expect(html).toContain("Statement 2");
    expect(html).toContain('aria-label="Remove statement 1"');
    expect(html).toContain("Add statement");
    expect(html).toContain("Learners rate each statement from 1 to 5.");
  });
});

describe("StructureAuthor as a lesson's added content", () => {
  const target = {
    key: "c:concept:p-abcdefgh",
    kind: "rating" as const,
    scope: "part" as const,
    load: () => new Promise<never>(() => {}),
    save: vi.fn(),
    saveDraft: vi.fn(),
    discardDraft: vi.fn(),
  };

  it("says when learners get it, not that saving shows it to them at once", () => {
    const html = render(
      createElement(StructureAuthor, {
        courseSlug: "c",
        target,
        locale: "en",
        courseStatus: "published",
        regionLabel: "Self-assessment (1–5) · 2 of 3",
      })
    );
    expect(html).toContain("Self-assessment (1–5) · 2 of 3");
    expect(html).toContain(en.lessonBlocks.partHint.replace(/"/g, "&quot;"));
    expect(html).not.toContain("shows your changes to learners straight away");
    // Whether it is "added" is the content list's business, and there is no "Remove stage".
    expect(html).not.toContain(en.exerciseEditor.badge.notAdded);
    expect(html).not.toContain("Remove stage");
  });

  it("keeps the main content's words for a lesson's own exercise", () => {
    const html = render(
      createElement(StructureAuthor, {
        courseSlug: "c",
        kind: "assessment",
        stageKey: "s-abcdefgh",
        locale: "en",
        courseStatus: "published",
        regionLabel: en.exerciseEditor.region.assessment,
      })
    );
    expect(html).toContain("Interactive stage — Assessment");
    expect(html).toContain(en.exerciseEditor.badge.notAdded);
    expect(html).toContain("Save stage");
    expect(html).toContain("shows your changes to learners straight away");
  });
});
