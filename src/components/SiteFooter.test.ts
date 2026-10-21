import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ href, ...rest }: { href: string }) => h("a", { href, ...rest }) };
});

// The documents that have a text: as the code has them, or with the legal
// notice's English text in (spec 12.3).
const docs = vi.hoisted(() => ({ list: null as string[] | null }));
vi.mock("@/data/legal", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/data/legal")>();
  return {
    ...real,
    get LEGAL_DOCS() {
      return docs.list ?? real.LEGAL_DOCS;
    },
  };
});

import { SiteFooter } from "./SiteFooter";

/**
 * Review finding 9 on Stream A (spec 5.12: axe with no violations at 320 px
 * on the player page). Before Release 2 the footer's legal links were
 * 16 px tall rows 4 px apart, so in German at 320 px, where they wrap,
 * axe failed WCAG 2.5.8 (target size) on them; and the links' landmark was
 * named in English on German and Greek pages.
 *
 * Release 3 (spec 11.3, 12.3; UF1): the "Need help?" link to /help comes
 * first on every page, in the page's language, and the legal notice is
 * linked once it has a text, never before.
 */

const render = (locale: string) => renderToStaticMarkup(createElement(SiteFooter, { locale }));
const legalLinks = (html: string) => [...html.matchAll(/<a href="\/legal\/([^"]+)"/g)].map((m) => m[1]);

beforeEach(() => {
  docs.list = null;
});

describe("SiteFooter", () => {
  it("names the legal links' landmark in the page's language", () => {
    expect(render("en")).toContain('<nav aria-label="Legal and policies"');
    expect(render("de")).toContain('<nav aria-label="Rechtliches und Richtlinien"');
    expect(render("el")).toContain('<nav aria-label="Νομικά και πολιτικές"');
    expect(render("fr")).toContain('<nav aria-label="Legal and policies"');
  });

  it("gives each link a target at least 24 px tall (WCAG 2.5.8), however the links wrap", () => {
    const links = [...render("de").matchAll(/<a href="\/(?:legal\/[^"]+|help)" class="([^"]*)"/g)].map((m) => m[1]);
    expect(links).toHaveLength(5);
    for (const cls of links) expect(cls.split(" ")).toEqual(expect.arrayContaining(["inline-flex", "min-h-6", "items-center"]));
  });

  it("links every legal document that has a text, in order, and not the legal notice before its text is in", () => {
    expect(legalLinks(render("en"))).toEqual(["privacy", "terms", "cookies", "accessibility"]);
  });

  it("links the legal notice once its text is in, in each language's word for it", () => {
    docs.list = ["privacy", "terms", "cookies", "accessibility", "notice"];
    expect(legalLinks(render("en"))).toEqual(["privacy", "terms", "cookies", "accessibility", "notice"]);
    expect(render("en")).toContain('<a href="/legal/notice" class="inline-flex min-h-6 items-center text-xs');
    expect(render("en")).toMatch(/href="\/legal\/notice"[^>]*>Legal notice</);
    expect(render("de")).toMatch(/href="\/legal\/notice"[^>]*>Impressum</);
    expect(render("el")).toMatch(/href="\/legal\/notice"[^>]*>Νομική σημείωση</);
  });

  it("links /help first, before the legal links, in the page's language", () => {
    for (const [locale, words] of [
      ["en", "Need help?"],
      ["de", "Hilfe"],
      ["el", "Χρειάζεσαι βοήθεια;"],
      ["fr", "Need help?"],
    ] as const) {
      const html = render(locale);
      expect(html, locale).toMatch(new RegExp(`<a href="/help"[^>]*><svg[^>]*aria-hidden="true"[^>]*>.*?</svg>${words.replace("?", "\\?")}</a>`));
      expect(html.indexOf('href="/help"'), locale).toBeLessThan(html.indexOf("<nav"));
      // Outside the legal links' landmark: it is no legal document.
      expect(html.slice(html.indexOf("<nav"), html.indexOf("</nav>"))).not.toContain("/help");
    }
  });

  it("says who made the platform in the page's language (legal.poweredBy), SENIC linked (WCAG 3.1.2)", () => {
    for (const [locale, words] of [
      ["en", "SEQ Elevate · Created and powered by "],
      ["de", "SEQ Elevate · Entwickelt und betrieben von "],
      ["el", "SEQ Elevate · Δημιουργήθηκε και λειτουργεί από τη "],
      ["fr", "SEQ Elevate · Created and powered by "],
    ] as const) {
      const html = render(locale);
      expect(html, locale).toContain(`>${words}<a href="https://senic.world"`);
      expect(html, locale).toMatch(/<a href="https:\/\/senic.world"[^>]*>SENIC<\/a><\/p>/);
      if (locale === "de" || locale === "el") expect(html, locale).not.toContain("Created and powered by");
    }
  });
});
