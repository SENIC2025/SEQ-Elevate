import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import type { CourseStage } from "@/lib/cms/types";

// The learner store, as the stage reads it: the saved practice answer.
const store = vi.hoisted(() => ({
  simulation: null as { choice: string; correct: boolean } | null,
  dispatched: [] as unknown[],
}));
vi.mock("@/store/demo-state", async () => {
  const { fakeCourse } = await import("./press.test-helpers");
  return {
    useDemoState: () => ({
      state: { course: fakeCourse({ simulation: store.simulation }), refusedKeys: {} },
      dispatch: (a: unknown) => store.dispatched.push(a),
    }),
  };
});
const announced = vi.hoisted(() => [] as string[]);
vi.mock("./PlayerAnnouncer", () => ({ useAnnounce: () => (t: string) => announced.push(t) }));
vi.mock("@/components/ui/button", async () => ({ Button: (await import("./press.test-helpers")).MockButton }));

import { SimulationStage } from "./SimulationStage";
import { did, fakePage, press } from "./press.test-helpers";

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone: string;
  children?: ReactNode;
}>;

const stage = {
  key: "simulation",
  title: "Guided practice",
  simulation: {
    prompt: "Your colleague is late again.",
    instruction: "Pick what you'd say.",
    options: [
      { id: "a", text: "Say nothing", isBest: false, feedback: "Hmm." },
      { id: "b", text: "Say how you feel", isBest: true, feedback: "Yes." },
    ],
  },
} as CourseStage;

let continued = 0;
function render(locale: "en" | "de" = "en", shown: CourseStage = stage): string {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale, messages: locale === "en" ? en : de, timeZone: "UTC" },
      createElement(SimulationStage, { stage: shown, onContinue: () => continued++ })
    )
  );
}

beforeEach(() => {
  store.simulation = null;
  store.dispatched.length = 0;
  announced.length = 0;
  continued = 0;
  const page = fakePage();
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("window", page.window);
});
afterEach(() => vi.unstubAllGlobals());

describe("SimulationStage", () => {
  // UA5 (spec 5.7): Release 1 hid Continue until an answer was chosen.
  it("shows Continue before an answer, with what it waits for above it, linked to it", () => {
    const html = render();
    const hintId = html.match(/<p id="([^"]+)"[^>]*>Choose an answer to continue.<\/p>/)?.[1];
    expect(hintId).toBeTruthy();
    expect(html).toMatch(new RegExp(`<button type="button" aria-describedby="${hintId}">Continue`));
    expect(html.indexOf("Choose an answer to continue.")).toBeLessThan(html.indexOf(">Continue"));
    expect(render("de")).toContain("Wähle eine Antwort, um weiterzumachen.");
  });

  it("says it as plain text, not as an announcement", () => {
    expect(render()).not.toMatch(/aria-live|role="status"|role="alert"/);
  });

  it("pressed before an answer: doesn't go on; names the item and the need; focuses the heading without the browser's scroll", () => {
    const html = render();
    const headingId = html.match(/<h2 id="([^"]+)" tabindex="-1"/)?.[1];
    expect(headingId).toBeTruthy();
    press("Continue");
    expect(continued).toBe(0);
    expect(announced).toEqual(["Guided practice: Choose an answer to continue."]);
    expect(did).toEqual([`focus ${headingId} preventScroll`]);
  });

  it("goes on once answered", () => {
    store.simulation = { choice: "a", correct: false };
    render();
    press("Continue");
    expect(continued).toBe(1);
    expect(announced).toEqual([]);
  });

  // UA5 (spec 5.8): Release 1 kept the choice in the screen's own state, so
  // it was gone on Back and after a reload.
  it("shows the learner's saved choice again: chosen, its feedback, the others locked", () => {
    store.simulation = { choice: "b", correct: true };
    const html = render();
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*Say how you feel/);
    expect(html).toMatch(/aria-pressed="false" disabled=""[^>]*>.*Say nothing/);
    expect(html).toContain("Yes.");
    expect(html).toContain("Try another");
    expect(html).not.toContain("Choose an answer to continue.");
  });

  it("ignores a saved choice that isn't one of this practice's options", () => {
    store.simulation = { choice: "gone", correct: true };
    const html = render();
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).toContain("Choose an answer to continue.");
  });

  it("exposes each option's pressed state", () => {
    const pressed = [...render().matchAll(/<button type="button" aria-pressed="(true|false)"/g)].map((m) => m[1]);
    expect(pressed).toEqual(["false", "false"]);
  });

  it("'Try another' keeps the saved answer, and moves focus to the heading before its button goes", () => {
    store.simulation = { choice: "a", correct: false };
    const html = render();
    const headingId = html.match(/<h2 id="([^"]+)"/)?.[1];
    press("Try another");
    expect(did).toEqual([`focus ${headingId}`]);
    expect(store.dispatched).toEqual([]);
  });
});

function renderInstruction(instruction: string): string {
  return render("en", {
    key: "simulation",
    title: "Practice",
    simulation: {
      prompt: "A customer is upset.",
      instruction,
      options: [{ id: "a", text: "Listen", isBest: true, feedback: "Good" }],
    },
  });
}

const INSTRUCTION = '<p class="mt-2 text-sm text-[var(--muted-foreground)]">';

describe("SimulationStage quick links", () => {
  // The course page's read view shows the instruction with its links
  // (FormattedText); learners must get the same links.
  it("links an address typed in the instruction", () => {
    expect(renderInstruction("Read https://example.org/policy first")).toContain(
      `${INSTRUCTION}Read <a href="https://example.org/policy" target="_blank" rel="noopener noreferrer" class="seq-link">https://example.org/policy<span class="sr-only"> (opens in a new tab)</span></a> first</p>`
    );
  });

  it("renders an instruction without an address exactly as before", () => {
    expect(renderInstruction("Pick the best reply.")).toContain(
      `${INSTRUCTION}Pick the best reply.</p>`
    );
  });
});
