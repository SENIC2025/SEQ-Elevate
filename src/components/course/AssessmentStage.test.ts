import { describe, it, expect } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import type { CourseStage } from "@/lib/cms/types";
import { AssessmentStage } from "./AssessmentStage";

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  children?: ReactNode;
}>;

function render(intro: string): string {
  const stage: CourseStage = {
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
      { locale: "en", messages: en },
      createElement(AssessmentStage, { stage, onContinue: () => {} })
    )
  );
}

const INTRO = '<p class="mt-2 text-sm text-[var(--muted-foreground)]">';

describe("AssessmentStage quick links", () => {
  // The course page's read view shows the intro with its links
  // (FormattedText); learners must get the same links.
  it("links an address typed in the intro", () => {
    expect(render("Questions? Write to help@example.org.")).toContain(
      `${INTRO}Questions? Write to <a href="mailto:help@example.org" target="_blank" rel="noopener noreferrer" class="seq-link">help@example.org<span class="sr-only"> (opens in a new tab)</span></a>.</p>`
    );
  });

  it("renders an intro without an address exactly as before", () => {
    expect(render("Three short questions.")).toContain(
      `${INTRO}Three short questions.</p>`
    );
  });
});
