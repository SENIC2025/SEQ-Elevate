import { describe, it, expect, vi } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import type { CourseStage } from "@/lib/cms/types";

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

function render(locale: "en" | "de" = "en"): string {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale, messages: locale === "en" ? en : de, timeZone: "UTC" },
      createElement(SimulationStage, { stage, onContinue: () => {} })
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
