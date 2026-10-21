import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/i18n/navigation", async () => {
  const { createElement: h } = await import("react");
  // As next-intl's Link does: the page's language goes in front.
  return { Link: ({ href, ...rest }: { href: string }) => h("a", { href: `/de${href}`, ...rest }) };
});

import { LegalBody } from "./LegalBody";

/*
 * Release 3 (D94, spec 12.2; UF1): a legal text rendered as elements, never
 * as an HTML string: markup in a text is shown as text, links to our own
 * pages keep the page's language, and a table is a named, focusable region
 * that may scroll sideways on a phone.
 */

const render = (source: string) => renderToStaticMarkup(createElement(LegalBody, { source, label: "Privacy notice" }));

describe("LegalBody", () => {
  it("renders headings, paragraphs, bold and lists two levels deep", () => {
    const html = render("## Who\nText with **bold**.\n\n### Rights\n- Access\n  - within a month");
    expect(html).toContain('<h2 class="mt-8 text-lg font-semibold">Who</h2>');
    expect(html).toContain("<p");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<h3");
    expect(html).toMatch(/<ul class="mt-3 ml-5 list-disc[^"]*"><li>Access<ul class="mt-1 ml-5 list-\[circle\][^"]*"><li>within a month<\/li><\/ul><\/li><\/ul>/);
  });

  it("breaks the line where the text does: an address keeps its lines", () => {
    const html = render("DIESIS Network\nBoulevard Charlemagne 74\n1000 Brussels");
    expect(html).toContain('<p class="mt-3">DIESIS Network<br/>Boulevard Charlemagne 74<br/>1000 Brussels</p>');
  });

  it("links our own pages in the page's language, and other sites as written", () => {
    const html = render("See [cookies](/legal/cookies), [help](/help) and [the authority](https://example.org/dpa).");
    expect(html).toContain('href="/de/legal/cookies"');
    expect(html).toContain('href="/de/help"');
    expect(html).toContain('href="https://example.org/dpa"');
  });

  it("shows markup and other addresses as text, never as HTML", () => {
    const html = render('<img src=x onerror="alert(1)"> [x](javascript:alert(1))');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x");
    expect(html).not.toContain('href="javascript');
    expect(html).toContain("[x](javascript:alert(1))");
  });

  it("puts a table in a focusable region named by the heading above it", () => {
    const html = render("## Cookies we set\n| Name | Purpose |\n|---|---|\n| NEXT_LOCALE | Language |");
    expect(html).toContain('<div role="region" aria-label="Cookies we set" tabindex="0"');
    expect(html).toContain('<th scope="col"');
    expect(html).toContain("<td");
    // With no heading above it, the document's name.
    expect(render("| A |\n|---|\n| b |")).toContain('aria-label="Privacy notice"');
  });
});
