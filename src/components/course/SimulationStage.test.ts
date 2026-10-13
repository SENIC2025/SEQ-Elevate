import { describe, it, expect, vi } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import type { CourseStage } from "@/lib/cms/types";

// The stage only dispatches on a pick; rendering needs no real store.
vi.mock("@/store/demo-state", () => ({
  useDemoState: () => ({ state: {}, dispatch: () => {} }),
}));

import { SimulationStage } from "./SimulationStage";

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

function render(locale: "en" | "de" = "en", shown: CourseStage = stage): string {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale, messages: locale === "en" ? en : de, timeZone: "UTC" },
      createElement(SimulationStage, { stage: shown, onContinue: () => {} })
    )
  );
}

describe("SimulationStage", () => {
  it("says what's needed to continue while Continue is hidden", () => {
    const html = render();
    expect(html).not.toContain(">Continue<");
    expect(html).toContain("Choose an answer to continue.");
    expect(render("de")).toContain("Wähle eine Antwort, um weiterzumachen.");
  });

  it("says it as plain text, not as an announcement", () => {
    expect(render()).not.toMatch(/aria-live|role="status"|role="alert"/);
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
