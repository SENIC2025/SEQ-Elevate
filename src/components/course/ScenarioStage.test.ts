import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import type { CourseStage } from "@/lib/cms/types";

// The learner store, as the stage reads it: the saved scenario path.
const store = vi.hoisted(() => ({
  scenario: { root: null, followup: null, rootLabel: null, followupLabel: null } as Record<string, string | null>,
  dispatched: [] as unknown[],
}));
vi.mock("@/store/demo-state", async () => {
  const { fakeCourse } = await import("./press.test-helpers");
  return {
    useDemoState: () => ({
      state: { course: fakeCourse({ scenario: store.scenario }), refusedKeys: {} },
      dispatch: (a: unknown) => store.dispatched.push(a),
    }),
  };
});
const announced = vi.hoisted(() => [] as string[]);
vi.mock("./PlayerAnnouncer", () => ({ useAnnounce: () => (t: string) => announced.push(t) }));
vi.mock("@/components/ui/button", async () => ({ Button: (await import("./press.test-helpers")).MockButton }));

import { ScenarioStage } from "./ScenarioStage";
import { scenarioContinueHint } from "./continue-hint";
import { did, fakePage, press } from "./press.test-helpers";

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

let continued = 0;
function render(): string {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: "en", messages: en, timeZone: "UTC" },
      createElement(ScenarioStage, { stage, onContinue: () => continued++ })
    )
  );
}

const saved = (root: string | null, followup: string | null = null) => {
  store.scenario = { root, followup, rootLabel: null, followupLabel: null };
};

beforeEach(() => {
  saved(null);
  store.dispatched.length = 0;
  announced.length = 0;
  continued = 0;
  const page = fakePage();
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("window", page.window);
});
afterEach(() => vi.unstubAllGlobals());

describe("ScenarioStage", () => {
  // UA5 (spec 5.7): Release 1 hid Continue until the path was complete.
  it("shows Continue from the start, with what it waits for above it, as plain text", () => {
    const html = render();
    const hintId = html.match(/<p id="([^"]+)"[^>]*>To continue, choose what you would do.<\/p>/)?.[1];
    expect(hintId).toBeTruthy();
    expect(html).toMatch(new RegExp(`<button type="button" aria-describedby="${hintId}">Continue`));
    expect(html).not.toMatch(/aria-live|role="status"|role="alert"/);
  });

  it("pressed before the first choice: focuses the heading and says what's needed", () => {
    const headingId = render().match(/<h2 id="([^"]+)" tabindex="-1"/)?.[1];
    press("Continue");
    expect(continued).toBe(0);
    expect(announced).toEqual(["Applied scenario: To continue, choose what you would do."]);
    expect(did).toEqual([`focus ${headingId} preventScroll`]);
  });

  it("pressed before the follow-up: focuses the follow-up question", () => {
    saved("private");
    const html = render();
    const followupId = html.match(/<p id="([^"]+)" tabindex="-1"[^>]*>And then\?<\/p>/)?.[1];
    expect(followupId).toBeTruthy();
    expect(html).toContain("Answer the follow-up question to continue.");
    press("Continue");
    expect(announced).toEqual(["Applied scenario: Answer the follow-up question to continue."]);
    expect(did).toEqual([`focus ${followupId} preventScroll`]);
  });

  // UA5 (spec 5.8): Release 1 kept the path in the screen's own state.
  it("shows the learner's saved path again: both choices, both outcomes, and Continue goes on", () => {
    saved("private", "boundary");
    const html = render();
    expect(html).toContain("Calm.");
    expect(html).toContain("Ok.");
    expect(html).toMatch(/disabled=""[^>]*>Snap back/);
    expect(html).not.toContain("And then?");
    press("Continue");
    expect(continued).toBe(1);
  });

  it("lets the follow-up's outcome take focus, where the follow-up buttons were (finding 10)", () => {
    // The follow-up button pressed goes once chosen: focus fell to <body>
    // (already in Release 1), while ScenarioPart moves it to the outcome.
    // Both outcomes stay what they were for the recorded walk (a status).
    saved("private", "boundary");
    const html = render();
    const outcomes = [...html.matchAll(/<div([^>]*role="status"[^>]*)>/g)].map((m) => m[1]);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).not.toMatch(/tabindex/);
    expect(outcomes[1]).toMatch(/tabindex="-1"/);
    expect(outcomes[1]).toMatch(/\sid="[^"]+"/);
  });

  it("ignores a saved path whose choices the scenario no longer has", () => {
    saved("gone", "boundary");
    expect(render()).toContain("To continue, choose what you would do.");
    saved("private", "gone");
    expect(render()).toContain("And then?");
  });

  it("'Try different choices' keeps the saved path, and moves focus to the heading first", () => {
    saved("public");
    const headingId = render().match(/<h2 id="([^"]+)"/)?.[1];
    press("Try different choices");
    expect(did).toEqual([`focus ${headingId}`]);
    expect(store.dispatched).toEqual([]);
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

  it("has nothing to say once the path is complete", () => {
    expect(scenarioContinueHint({ rootChosen: true, followups: 0, followupChosen: false })).toBe(
      null
    );
    expect(scenarioContinueHint({ rootChosen: true, followups: 2, followupChosen: true })).toBe(
      null
    );
  });
});
