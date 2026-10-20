import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  return { Link: ({ href, ...rest }: { href: string }) => h("a", { href, ...rest }) };
});

import { SiteFooter } from "./SiteFooter";

/**
 * Review finding 9 on Stream A (spec 5.12: axe with no violations at 320 px
 * on the player page). Before Release 2 the footer's legal links were
 * 16 px tall rows 4 px apart, so in German at 320 px, where they wrap,
 * axe failed WCAG 2.5.8 (target size) on them; and the links' landmark was
 * named in English on German and Greek pages.
 */

const render = (locale: string) => renderToStaticMarkup(createElement(SiteFooter, { locale }));

describe("SiteFooter", () => {
  it("names the legal links' landmark in the page's language", () => {
    expect(render("en")).toContain('<nav aria-label="Legal and policies"');
    expect(render("de")).toContain('<nav aria-label="Rechtliches und Richtlinien"');
    expect(render("el")).toContain('<nav aria-label="Νομικά και πολιτικές"');
    expect(render("fr")).toContain('<nav aria-label="Legal and policies"');
  });

  it("gives each legal link a target at least 24 px tall (WCAG 2.5.8), however the links wrap", () => {
    const links = [...render("de").matchAll(/<a href="\/legal\/[^"]+" class="([^"]*)"/g)].map((m) => m[1]);
    expect(links).toHaveLength(4);
    for (const cls of links) expect(cls.split(" ")).toEqual(expect.arrayContaining(["inline-flex", "min-h-6", "items-center"]));
  });
});
