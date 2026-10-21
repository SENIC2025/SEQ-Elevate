import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import el from "@/messages/el.json";

/*
 * The Foundation's safeguarding stubs (D93, spec 11.3, 17.2): never empty
 * (112 is in code), a link to every country's contacts on /help, a box
 * that is a labelled landmark of its own, and a line for reflections that
 * says facilitators don't read them. Real messages behind next-intl's API,
 * in each language.
 */

const MESSAGES = { en, de, el } as const;
let locale: keyof typeof MESSAGES = "en";
vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl")>()),
  useTranslations: (namespace: string) =>
    createTranslator({ locale, messages: MESSAGES[locale], namespace: namespace as never }),
}));
vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ href, ...rest }: { href: string }) => h("a", { href: `/${locale}${href}`, ...rest }) };
});

const { SafeguardingBox } = await import("./SafeguardingBox");
const { SafeguardingHint } = await import("./SafeguardingHint");

describe("SafeguardingBox", () => {
  it.each(["en", "de", "el"] as const)("always shows 112 and links every country's contacts (%s)", (l) => {
    locale = l;
    const html = renderToStaticMarkup(createElement(SafeguardingBox));
    expect(html).toContain("112");
    expect(html).toContain(`href="/${l}/help"`);
    expect(html).toContain(MESSAGES[l].safeguarding.title);
  });

  it("is an aside named by its own heading", () => {
    locale = "en";
    const html = renderToStaticMarkup(createElement(SafeguardingBox));
    const labelled = /<aside aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelled).toBeTruthy();
    expect(html).toContain(`<h2 id="${labelled}"`);
  });
});

describe("SafeguardingHint", () => {
  it("links /help beside free text", () => {
    locale = "en";
    const html = renderToStaticMarkup(createElement(SafeguardingHint));
    expect(html).toContain('<a href="/en/help"');
    expect(html).toContain("Worried about your safety");
  });

  it("says, beside a reflection, that facilitators don't read it", () => {
    locale = "de";
    const html = renderToStaticMarkup(createElement(SafeguardingHint, { variant: "reflection" }));
    expect(html).toContain("Die Trainer:innen lesen nicht");
    expect(html).toContain('<a href="/de/help"');
  });
});
