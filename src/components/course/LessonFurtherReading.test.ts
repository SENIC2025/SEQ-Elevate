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
 * link that opens in a new tab, where it goes under it (the host, or the
 * bare email address), then the description. An item for one language that
 * isn't the one the course text is shown in is marked with that language
 * and says so; the page's own words keep the page's language.
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

describe("LessonFurtherReading", () => {
  it("draws nothing for a lesson without links", () => {
    expect(render(undefined)).toBe("");
    expect(render([])).toBe("");
  });

  it("is a section named Further reading, with an h3 and one item per link, in order", () => {
    const html = render([link("a", { description: "A short guide." }), link("b")]);
    expect(html).toMatch(/^<section aria-label="Further reading"[^>]*><h3[^>]*>.*Further reading<\/h3><ul/);
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html.indexOf("Title a")).toBeLessThan(html.indexOf("Title b"));
    expect(html).toContain("A short guide.");
  });

  it("links each title, in a new tab that screen readers hear about, with the host under it", () => {
    const html = render([link("a")]);
    expect(html).toContain(
      '<a href="https://example.org/a" target="_blank" rel="noopener noreferrer" class="seq-link"><span class="font-medium">Title a</span><span class="sr-only"> (opens in a new tab)</span></a>'
    );
    expect(html).toContain(">example.org</p>");
  });

  it("shows an international host in punycode, as the address check normalised it", () => {
    const html = render([link("idn", { url: "https://xn--mnchen-3ya.example/kurs" })]);
    expect(html).toContain(">xn--mnchen-3ya.example</p>");
  });

  it("shows an email link's bare address under it, never mailto: or its subject", () => {
    const html = render([link("mail", { kind: "email", url: "mailto:help@example.org?subject=Course", title: "Write to us" })]);
    expect(html).toContain('href="mailto:help@example.org?subject=Course"');
    expect(html).toContain(">help@example.org</p>");
    expect(html).not.toContain(">mailto:");
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
    expect(html).toContain('aria-label="Zum Weiterlesen"');
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
