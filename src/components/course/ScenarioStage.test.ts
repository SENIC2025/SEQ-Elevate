import { describe, it, expect, vi } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import type { CourseStage } from "@/lib/cms/types";

vi.mock("@/store/demo-state", () => ({
  useDemoState: () => ({ state: {}, dispatch: () => {} }),
}));

import { ScenarioStage } from "./ScenarioStage";
import { scenarioContinueHint } from "./continue-hint";

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone: string;
  children?: ReactNode;
}>;

const stage = {
  key: "scenario",
  title: "Applied scenario",
  scenario: {
    setup: "Sam jokes about you in a meeting.",
    question: "What do you do?",
    followupQuestion: "And then?",
    choices: [
      {
        id: "private",
        text: "Talk to Sam later",
        outcome: "Calm.",
        quality: "best",
        followups: [
          { id: "boundary", text: "Set a boundary", outcome: "Ok.", quality: "best" },
        ],
      },
      { id: "public", text: "Snap back", outcome: "Ouch.", quality: "poor" },
    ],
  },
} as CourseStage;

describe("ScenarioStage", () => {
  it("says what's needed to continue while Continue is hidden, as plain text", () => {
    const html = renderToStaticMarkup(
      createElement(
        IntlProvider,
        { locale: "en", messages: en, timeZone: "UTC" },
        createElement(ScenarioStage, { stage, onContinue: () => {} })
      )
    );
    expect(html).not.toContain(">Continue<");
    expect(html).toContain("Choose what you would do to continue.");
    expect(html).not.toMatch(/aria-live|role="status"|role="alert"/);
  });
});

describe("scenarioContinueHint", () => {
  it("asks for a first choice, then for the follow-up when the choice has one", () => {
    expect(scenarioContinueHint({ rootChosen: false, followups: 0, followupChosen: false })).toBe(
      "scenario"
    );
    expect(scenarioContinueHint({ rootChosen: true, followups: 2, followupChosen: false })).toBe(
      "scenarioFollowup"
    );
  });

  it("has nothing to say once Continue shows", () => {
    expect(scenarioContinueHint({ rootChosen: true, followups: 0, followupChosen: false })).toBe(
      null
    );
    expect(scenarioContinueHint({ rootChosen: true, followups: 2, followupChosen: true })).toBe(
      null
    );
  });
});
