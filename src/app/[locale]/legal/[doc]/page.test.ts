import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";

/*
 * Release 3 (D94, spec 12.3; UF1): a legal page's version line, in the
 * page's language. A text written before counsel's is stored as
 * "pre-counsel" (what a profile records for the English Terms), but its
 * page says it is an interim text, in words a learner reads; counsel's
 * texts show their version.
 */

const MESSAGES = { en, de, el } as const;
const page = vi.hoisted(() => ({ locale: "en" }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: (locale: string) => {
    page.locale = locale;
  },
  getTranslations: async (namespace: string) =>
    createTranslator({
      locale: page.locale,
      messages: MESSAGES[page.locale as keyof typeof MESSAGES],
      namespace: namespace as never,
    }),
}));
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ href, ...rest }: { href: string }) => h("a", { href, ...rest }) };
});
// The Terms with a final English text of counsel's; the others still the legacy texts.
vi.mock("@/content/legal", () => ({
  FINAL_TEXTS: {
    en: { terms: { title: "Terms of use", version: "2026-11-06", lastUpdated: "2026-11-06", body: "## Terms\nText." } },
    de: {},
    el: {},
  },
}));

const { default: Page } = await import("./page");
const { LEGACY_VERSION } = await import("@/data/legal");

async function versionLine(locale: string, doc: string): Promise<string> {
  const element = (await Page({ params: Promise.resolve({ locale, doc }) })) as ReactElement;
  const html = renderToStaticMarkup(createElement(() => element));
  // The line right under the title.
  return /<\/h1><p[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? "";
}

describe("legal page: the version line", () => {
  it("calls a text written before counsel's an interim text, in the page's language, never by its stored version", async () => {
    for (const [locale, line] of [
      ["en", "Interim version · last updated 31 October 2026"],
      ["de", "Vorläufige Fassung · zuletzt aktualisiert am 31. Oktober 2026"],
      ["el", "Προσωρινή έκδοση · τελευταία ενημέρωση 31 Οκτωβρίου 2026"],
    ] as const) {
      for (const doc of ["privacy", "cookies", "accessibility"]) {
        const shown = await versionLine(locale, doc);
        expect(shown, `${locale}/${doc}`).toBe(line);
        expect(shown, `${locale}/${doc}`).not.toContain(LEGACY_VERSION);
      }
    }
  });

  it("shows the version of counsel's text", async () => {
    expect(await versionLine("en", "terms")).toBe("Version 2026-11-06 · last updated 6 November 2026");
    expect(await versionLine("de", "terms")).toBe("Version 2026-11-06 · zuletzt aktualisiert am 6. November 2026");
  });
});
