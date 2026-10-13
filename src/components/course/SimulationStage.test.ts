import { describe, it, expect, vi } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import type { CourseStage } from "@/lib/cms/types";
import { SimulationStage } from "./SimulationStage";

// The stage only dispatches on a pick; rendering needs no real store.
vi.mock("@/store/demo-state", () => ({
  useDemoState: () => ({ dispatch: () => {} }),
}));

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  children?: ReactNode;
}>;

function render(instruction: string): string {
  const stage: CourseStage = {
    key: "simulation",
    title: "Practice",
    simulation: {
      prompt: "A customer is upset.",
      instruction,
      options: [{ id: "a", text: "Listen", isBest: true, feedback: "Good" }],
    },
  };
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: "en", messages: en },
      createElement(SimulationStage, { stage, onContinue: () => {} })
    )
  );
}

const INSTRUCTION = '<p class="mt-2 text-sm text-[var(--muted-foreground)]">';

describe("SimulationStage quick links", () => {
  // The course page's read view shows the instruction with its links
  // (FormattedText); learners must get the same links.
  it("links an address typed in the instruction", () => {
    expect(render("Read https://example.org/policy first")).toContain(
      `${INSTRUCTION}Read <a href="https://example.org/policy" target="_blank" rel="noopener noreferrer" class="seq-link">https://example.org/policy<span class="sr-only"> (opens in a new tab)</span></a> first</p>`
    );
  });

  it("renders an instruction without an address exactly as before", () => {
    expect(render("Pick the best reply.")).toContain(
      `${INSTRUCTION}Pick the best reply.</p>`
    );
  });
});
