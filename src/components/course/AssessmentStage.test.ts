import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import type { CourseStage } from "@/lib/cms/types";
import type { AssessmentProgress } from "@/lib/assessment-progress";

// The learner store, as the stage reads it: only the quick check matters.
const store = vi.hoisted(() => ({
  assessment: { answers: {}, checked: false } as {
    answers: Record<string, string>;
    checked: boolean;
  },
  dispatch: (() => {}) as (action: unknown) => void,
}));
vi.mock("@/store/demo-state", () => ({
  useDemoState: () => ({
    state: { course: { assessment: store.assessment } },
    dispatch: store.dispatch,
  }),
}));

import { AssessmentStage } from "./AssessmentStage";

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone: string;
  children?: ReactNode;
}>;

/** A quiz made in the course editor: its own ids, and not three questions. */
const stage: CourseStage = {
  key: "assessment",
  title: "Quick check",
  assessment: {
    intro: "Two questions.",
    questions: [
      {
        id: "qk3f",
        question: "First?",
        options: [
          { id: "a1x", text: "Right one" },
          { id: "a2x", text: "Wrong one" },
        ],
        correctOptionId: "a1x",
      },
      {
        id: "q9zz",
        question: "Second?",
        options: [
          { id: "a3x", text: "Also wrong" },
          { id: "a4x", text: "Also right" },
        ],
        correctOptionId: "a4x",
      },
    ],
  },
} as CourseStage;

function render(progress: AssessmentProgress): string {
  store.assessment = progress;
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: "en", messages: en, timeZone: "UTC" },
      createElement(AssessmentStage, { stage, onContinue: () => {} })
    )
  );
}

/**
 * Each button: its name (its text, without what's hidden from screen
 * readers), whether it's pressed, and whether it's disabled.
 */
function buttons(html: string) {
  return [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map((m) => ({
    label: m[2]
      .replace(/<span aria-hidden="true"[^>]*>[^<]*<\/span>/g, "")
      .replace(/<[^>]+>/g, "")
      .trim(),
    pressed: /aria-pressed="true"/.test(m[1]),
    disabled: / disabled=""/.test(m[1]),
  }));
}

describe("AssessmentStage", () => {
  beforeEach(() => {
    store.dispatch = () => {};
  });

  it("shows the answers the learner chose earlier, keyed by question id", () => {
    const got = buttons(render({ answers: { qk3f: "a2x" }, checked: false }));
    expect(got.find((b) => b.label === "Wrong one")?.pressed).toBe(true);
    expect(got.find((b) => b.label === "Right one")?.pressed).toBe(false);
    // One question still open: "Check answers" waits for it.
    expect(got.find((b) => b.label === "Check answers")?.disabled).toBe(true);
  });

  it("brings a learner back to a checked quick check: answers locked, score and Continue", () => {
    const html = render({
      answers: { qk3f: "a1x", q9zz: "a3x" },
      checked: true,
    });
    const got = buttons(html);
    const options = got.filter((b) => b.label !== "Continue");
    expect(options).toHaveLength(4);
    expect(options.every((b) => b.disabled)).toBe(true);
    expect(got.some((b) => b.label === "Continue" && !b.disabled)).toBe(true);
    expect(got.some((b) => b.label === "Check answers")).toBe(false);
    expect(html).toContain("You got 1 out of 2 right.");
  });

  it("doesn't count a quiz as checked once its questions have changed", () => {
    // Checked before the editor added a question: the new one is open.
    const got = buttons(render({ answers: { qk3f: "a1x" }, checked: true }));
    expect(got.some((b) => b.label === "Continue")).toBe(false);
    expect(got.find((b) => b.label === "Also right")?.disabled).toBe(false);
  });

  it("ignores a saved answer that is no longer one of the question's options", () => {
    const got = buttons(
      render({ answers: { qk3f: "gone", q9zz: "a4x" }, checked: false })
    );
    expect(got.find((b) => b.label === "Check answers")?.disabled).toBe(true);
  });

  it("letters the options A, B, … by position, hidden from screen readers, never by their ids", () => {
    // The editor's answer ids ("a1x") are internal: neither seen nor read.
    const html = render({ answers: {}, checked: false });
    const letters = [
      ...html.matchAll(/<span aria-hidden="true" class="[^"]*rounded-full[^"]*">([^<]*)<\/span>/g),
    ].map((m) => m[1]);
    expect(letters).toEqual(["A", "B", "A", "B"]);
    expect(html).not.toMatch(/>a[1-4]x</);
    // The button's name is the answer itself.
    const names = buttons(html).map((b) => b.label);
    expect(names.slice(0, 4)).toEqual(["Right one", "Wrong one", "Also wrong", "Also right"]);
  });

  it("says what's needed to continue until the answers are checked, as plain text", () => {
    const open = render({ answers: { qk3f: "a1x" }, checked: false });
    expect(open).toContain(
      "Answer every question, then select “Check answers” to continue."
    );
    expect(open).not.toMatch(/aria-live|role="status"|role="alert"/);
    // The disabled "Check answers" button points to it.
    const id = open.match(/<p id="([^"]+)"[^>]*>Answer every question/)?.[1];
    expect(id).toBeTruthy();
    expect(open).toMatch(
      new RegExp(`<button[^>]*aria-describedby="${id}"[^>]*>Check answers`)
    );
    const done = render({ answers: { qk3f: "a1x", q9zz: "a4x" }, checked: true });
    expect(done).not.toContain("Answer every question");
  });
});

function renderIntro(intro: string): string {
  store.assessment = { answers: {}, checked: false };
  const withIntro: CourseStage = {
    key: "assessment",
    title: "Quick check",
    assessment: {
      intro,
      questions: [
        {
          id: "q1",
          question: "Which is best?",
          options: [{ id: "a", text: "Listen" }],
          correctOptionId: "a",
        },
      ],
    },
  };
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: "en", messages: en, timeZone: "UTC" },
      createElement(AssessmentStage, { stage: withIntro, onContinue: () => {} })
    )
  );
}

const INTRO = '<p class="mt-2 text-sm text-[var(--muted-foreground)]">';

describe("AssessmentStage quick links", () => {
  // The course page's read view shows the intro with its links
  // (FormattedText); learners must get the same links.
  it("links an address typed in the intro", () => {
    expect(renderIntro("Questions? Write to help@example.org.")).toContain(
      `${INTRO}Questions? Write to <a href="mailto:help@example.org" target="_blank" rel="noopener noreferrer" class="seq-link">help@example.org<span class="sr-only"> (opens in a new tab)</span></a>.</p>`
    );
  });

  it("renders an intro without an address exactly as before", () => {
    expect(renderIntro("Three short questions.")).toContain(
      `${INTRO}Three short questions.</p>`
    );
  });
});
