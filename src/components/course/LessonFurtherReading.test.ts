import { describe, it, expect } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import type { LessonLinkRef } from "@/lib/cms/reading-types";
import type { Locale } from "@/lib/cms/types";
import { ContentLangContext } from "./CourseText";
import { LessonFurtherReading } from "./LessonFurtherReading";

/*
 * U18 (Release 4, spec 4.5): a lesson's further reading as learners see it.
 * A section named "Further reading" with an h3 and a list; each title a
 * link that opens in a new tab, then the description. A web link's title
 * shows the site it opens in a box after its words, inside the link, as
 * named links in lesson text do (the owner's decision of 22 October 2026;
 * link-site.ts), so it is heard as "title, site (opens in a new tab)"; an
 * email link's bare address is under its title. An item for one
 * language that isn't the one the course text is shown in is marked with
 * that language and says so; the page's own words keep the page's language.
 */

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone: string;
  children?: ReactNode;
}>;

const link = (id: string, fields: Partial<LessonLinkRef> = {}): LessonLinkRef => ({
  id,
  title: `Title ${id}`,
  url: `https://example.org/${id}`,
  kind: "web",
  description: "",
  languages: [],
  published: true,
  ...fields,
});

/** The list on a page in `page`, with the course text in `courseText` (Release 3's context: set only when it isn't the page's). */
function render(links: LessonLinkRef[] | undefined, page: Locale = "en", courseText?: Locale) {
  const messages = (page === "de" ? de : en) as typeof en;
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: page, messages, timeZone: "Europe/Brussels" },
      createElement(ContentLangContext.Provider, { value: courseText }, createElement(LessonFurtherReading, { links }))
    )
  );
}

/** The site's box after a title's words, inside its link: a ", " only screen readers hear, then the site. */
const siteBox = (site: string) => `<span class="seq-link-sep">, </span><span class="seq-link-site">${site}</span>`;

/** What each link's text adds up to, in order, as a browser names an <a> whose parts are all inline but the cue. */
const linkNames = (html: string) =>
  [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) =>
    m[1]
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
  );

describe("LessonFurtherReading", () => {
  it("draws nothing for a lesson without links", () => {
    expect(render(undefined)).toBe("");
    expect(render([])).toBe("");
  });

  it("is a section named by its h3, Further reading, with one item per link, in order", () => {
    const html = render([link("a", { description: "A short guide." }), link("b")]);
    // Named by the heading it holds (aria-labelledby), so the name is said once and is the heading's.
    const named = html.match(/^<section aria-labelledby="([^"]+)"[^>]*><h3 id="([^"]+)"[^>]*>.*Further reading<\/h3><ul/);
    expect(named).not.toBeNull();
    expect(named![1]).toBe(named![2]);
    expect(html).not.toContain("aria-label=");
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html.indexOf("Title a")).toBeLessThan(html.indexOf("Title b"));
    expect(html).toContain("A short guide.");
  });

  it("links each title, in a new tab that screen readers hear about, its site in a box after its words and nowhere else", () => {
    const html = render([link("a")]);
    expect(html).toContain(
      `<a href="https://example.org/a" target="_blank" rel="noopener noreferrer" class="seq-link"><span class="font-medium">Title a</span>${siteBox(
        "example.org"
      )}<span class="sr-only"> (opens in a new tab)</span></a>`
    );
    expect(html).not.toContain(">example.org</p>");
    expect(linkNames(html)).toEqual(["Title a, example.org (opens in a new tab)"]);
  });

  it("names each title link with its site, in the page's words", () => {
    const links = [link("de", { url: "https://www.ams.at/arbeitsuchende", title: "AMS-Seite" }), link("el", { url: "https://www.efka.gov.gr/el/odigos", title: "οδηγό του ΕΦΚΑ" })];
    expect(linkNames(render(links))).toEqual(["AMS-Seite, ams.at (opens in a new tab)", "οδηγό του ΕΦΚΑ, efka.gov.gr (opens in a new tab)"]);
    expect(linkNames(render(links, "de"))).toEqual([
      "AMS-Seite, ams.at (öffnet in einem neuen Tab)",
      "οδηγό του ΕΦΚΑ, efka.gov.gr (öffnet in einem neuen Tab)",
    ]);
  });

  it("shows the site a link opens, never a host that begins with another site's name", () => {
    const html = render([link("x", { url: "https://paypal.com.evil.example/login", title: "PAYPAL.COM" })]);
    expect(linkNames(html)).toEqual(["PAYPAL.COM, evil.example (opens in a new tab)"]);
    expect(html.replace(/href="[^"]*"/g, "")).not.toContain("paypal.com.evil.example");
    expect(html).not.toContain(">evil.example</p>");
    // The registrable domain: a subdomain shows the site it belongs to.
    expect(linkNames(render([link("w", { url: "https://en.wikipedia.org/wiki/Mercury_(planet)", title: "Wikipedia" })]))).toEqual([
      "Wikipedia, wikipedia.org (opens in a new tab)",
    ]);
  });

  it("leaves the box out only when the whole title is the link's address", () => {
    for (const title of ["https://example.org/a", "example.org/a", "www.example.org/a/"]) {
      const html = render([link("a", { title })]);
      expect(html, title).not.toContain("seq-link-site");
      expect(linkNames(html), title).toEqual([`${title} (opens in a new tab)`]);
      expect(html, title).not.toContain(">example.org</p>");
    }
    // A title that names only the site of a longer address, or begins with it and goes on, keeps it.
    expect(linkNames(render([link("a", { title: "example.org" })]))).toEqual(["example.org, example.org (opens in a new tab)"]);
    expect(linkNames(render([link("a", { title: "example.org/a and more" })]))).toEqual(["example.org/a and more, example.org (opens in a new tab)"]);
  });

  it("shows an international site in punycode, as the address check normalised it", () => {
    const html = render([link("idn", { url: "https://xn--mnchen-3ya.example/kurs", title: "München" })]);
    expect(html).toContain(siteBox("xn--mnchen-3ya.example"));
    expect(html).not.toContain(">xn--mnchen-3ya.example</p>");
    expect(linkNames(html)).toEqual(["München, xn--mnchen-3ya.example (opens in a new tab)"]);
  });

  it("keeps the site after a right-to-left title, outside the title's language", () => {
    const html = render([link("he", { title: "\u05D4\u05DE\u05D3\u05E8\u05D9\u05DA", languages: ["de"] })]);
    expect(html).toContain(`<span lang="de" class="font-medium">\u05D4\u05DE\u05D3\u05E8\u05D9\u05DA</span>${siteBox("example.org")}`);
    expect(linkNames(html)).toEqual(["\u05D4\u05DE\u05D3\u05E8\u05D9\u05DA, example.org (opens in a new tab)"]);
  });

  it("shows an email link's domain in punycode when it isn't ASCII, as it shows a web host", () => {
    // Cyrillic е in "vеrein".
    const html = render([link("mail", { kind: "email", url: "mailto:info@v\u0435rein.de", title: "Kontakt" })]);
    expect(html).toContain(">info@xn--vrein-zwe.de</p>");
  });

  it("shows an email link's bare address under it, never mailto: or its subject, and no box", () => {
    const html = render([link("mail", { kind: "email", url: "mailto:help@example.org?subject=Course", title: "Write to us" })]);
    expect(html).toContain('href="mailto:help@example.org?subject=Course"');
    expect(html).toContain(">help@example.org</p>");
    expect(html).not.toContain(">mailto:");
    expect(html).not.toContain("seq-link-site");
    expect(html).not.toContain("seq-link-sep");
    expect(linkNames(html)).toEqual(["Write to us (opens in a new tab)"]);
  });

  it("marks an item for one language that isn't the course text's with that language, and says so in the page's words", () => {
    // An English page, the course in English: a German-only item.
    const html = render([link("de", { languages: ["de"], description: "Nur auf Deutsch." })]);
    expect(html).toContain('<span lang="de" class="font-medium">Title de</span>');
    expect(html).toContain(">In German</span>");
    expect(html).toContain('<p lang="de" class="mt-0.5 text-[var(--muted-foreground)]">Nur auf Deutsch.</p>');
    // The hidden "(opens in a new tab)" stays outside the item's language.
    expect(html).toMatch(/<\/span><span class="sr-only"> \(opens in a new tab\)<\/span><\/a>/);
  });

  it("marks nothing for an item in the course text's language, or for every language", () => {
    for (const languages of [["en"], [], ["en", "de"]] as Locale[][]) {
      const html = render([link("x", { languages })]);
      expect(html, languages.join()).not.toContain("lang=");
      expect(html, languages.join()).not.toContain("In German");
      expect(html, languages.join()).not.toContain("In English");
    }
  });

  it("on a German page with the course still in English, marks the German items German and leaves the rest English", () => {
    const html = render([link("all"), link("en", { languages: ["en"] }), link("de", { languages: ["de"] })], "de", "en");
    expect(html).toContain('<span lang="en" class="font-medium">Title all</span>');
    expect(html).toContain('<span lang="en" class="font-medium">Title en</span>');
    expect(html).toContain('<span lang="de" class="font-medium">Title de</span>');
    // The label is in the page's language: "Auf Deutsch".
    expect(html).toContain(">Auf Deutsch</span>");
    expect(html.match(/Auf Deutsch/g)).toHaveLength(1);
    expect(html).toMatch(/<h3 id="[^"]+"[^>]*>.*Zum Weiterlesen<\/h3>/);
  });

  it("with German switched on for the course, a German item reads as the course does", () => {
    const html = render([link("de", { languages: ["de"] })], "de");
    expect(html).not.toContain("lang=");
    expect(html).not.toContain("Auf Deutsch");
  });

  it("marks an item for German and Greek with the page's language when it is one of them", () => {
    expect(render([link("x", { languages: ["de", "el"] })], "de", "en")).toContain(">Auf Deutsch</span>");
    expect(render([link("x", { languages: ["de", "el"] })], "en")).toContain(">In German</span>");
  });
});
