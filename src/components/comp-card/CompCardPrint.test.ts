import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";
import type { CompCardData } from "@/store/demo-state";

/*
 * The Comp Card's printout is in the page's language to its last line
 * (WCAG 3.1.2): the footer naming who made the platform and whose card it
 * is comes from the messages, as the form's labels do, never as English
 * on a German or Greek printout.
 */

const MESSAGES = { en, de, el } as const;
type Locale = keyof typeof MESSAGES;
let locale: Locale = "en";
vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl")>()),
  useTranslations: (namespace: string) =>
    createTranslator({ locale, messages: MESSAGES[locale], namespace: namespace as never }),
}));

const { CompCardPrint } = await import("./CompCardPrint");

const CARD: CompCardData = {
  wentWell: "",
  difficult: "",
  improve: "",
  behaviour: "",
  confidence: 3,
  sharing: "onlyMe",
  sharedAt: null,
  organisationName: null,
  updatedAt: null,
};

function printout(at: Locale): string {
  locale = at;
  const html = renderToStaticMarkup(
    createElement(CompCardPrint, {
      courseTitle: "Saying no",
      dateStr: "1 December 2026",
      scenarioSummary: "—",
      compCard: CARD,
    })
  );
  return html.replace(/<[^>]+>/g, "\n").replace(/&#x27;|&#39;/g, "'");
}

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

describe("the Comp Card printout's footer", () => {
  it.each(["en", "de", "el"] as const)("is in the page's language: %s", (at) => {
    const shown = lines(printout(at));
    const messages = MESSAGES[at].compCard as Record<string, unknown>;
    expect(shown).toContain(messages.printMadeBy);
    expect(shown).toContain(messages.printBelongs);
  });

  it.each(["de", "el"] as const)("has no English line on a %s printout", (at) => {
    const shown = printout(at);
    expect(shown).not.toContain("Created and Powered by");
    expect(shown).not.toContain("This Comp Card belongs to the learner.");
  });
});
