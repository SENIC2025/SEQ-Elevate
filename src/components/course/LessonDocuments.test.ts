import { describe, it, expect } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import type { ItemLanguages } from "@/lib/cms/reading-types";
import type { LessonDocumentRef, Locale } from "@/lib/cms/types";
import { ContentLangContext } from "./CourseText";
import { LessonDocuments } from "./LessonDocuments";
import { LessonDocumentViewer } from "./LessonDocumentViewer";

/*
 * Release 4 (D108, spec 4.5): a lesson's documents as learners see them,
 * each marked when it is for some languages only and none of them is the
 * one the course text is shown in (the other-language fallback of spec 4.4
 * included): "In German", in the page's words, and the name marked German.
 * A document for every language reads as the course text does, and looks
 * exactly as before when the course is in the page's language.
 */

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone: string;
  children?: ReactNode;
}>;

const doc = (id: string, languages?: Locale[]): LessonDocumentRef & ItemLanguages => ({
  id,
  name: `${id}.pdf`,
  url: `https://x/${id}.pdf`,
  mimeType: "application/pdf",
  sizeBytes: 2048,
  published: true,
  ...(languages ? { languages } : {}),
});

function render(documents: (LessonDocumentRef & ItemLanguages)[], page: Locale = "en", courseText?: Locale) {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: page, messages: (page === "de" ? de : en) as typeof en, timeZone: "Europe/Brussels" },
      createElement(ContentLangContext.Provider, { value: courseText }, createElement(LessonDocuments, { documents, stageNumber: 2 }))
    )
  );
}

describe("LessonDocuments and the languages documents are for", () => {
  it("marks a German-only document shown to someone reading the course in English", () => {
    const html = render([doc("arbeitsblatt", ["de"])]);
    expect(html).toContain('<span lang="de">arbeitsblatt.pdf</span>');
    expect(html).toContain(">In German</span>");
  });

  it("leaves a document for every language, or for the course text's, as it was", () => {
    const html = render([doc("all"), doc("en", ["en"]), doc("both", ["en", "de"])]);
    expect(html).not.toContain("lang=");
    expect(html).not.toMatch(/In (German|English|Greek)/);
    expect(html).toContain("<span>all.pdf</span>");
  });

  it("on a German page with the course in English: the German document German, the rest English", () => {
    const html = render([doc("all"), doc("de", ["de"])], "de", "en");
    expect(html).toContain('<span lang="en">all.pdf</span>');
    expect(html).toContain('<span lang="de">de.pdf</span>');
    expect(html.match(/Auf Deutsch/g)).toHaveLength(1);
  });
});

/*
 * Release 4, R2 (WCAG 3.1.2; the part 1 review's finding 8): the "Step
 * through" viewer shows the same name as the list, so it is marked the
 * same way: a German-only document's name, and its picture's alternative
 * text or its frame's title, in German, with "In German" beside the name.
 */
describe("LessonDocumentViewer and the languages documents are for", () => {
  const viewer = (d: LessonDocumentRef & ItemLanguages, page: Locale = "en", courseText?: Locale) =>
    renderToStaticMarkup(
      createElement(
        IntlProvider,
        { locale: page, messages: (page === "de" ? de : en) as typeof en, timeZone: "Europe/Brussels" },
        createElement(
          ContentLangContext.Provider,
          { value: courseText },
          createElement(LessonDocumentViewer, { documents: [d], startIndex: 0, stageNumber: 2, onClose: () => {} })
        )
      )
    );

  it("marks a German-only document's name, and its frame's title, shown to someone reading in English", () => {
    const html = viewer(doc("arbeitsblatt", ["de"]));
    expect(html).toMatch(/<span lang="de">arbeitsblatt\.pdf<\/span>/);
    expect(html).toContain(">In German</span>");
    expect(html).toMatch(/<iframe[^>]*lang="de"[^>]*title="arbeitsblatt\.pdf"|<iframe[^>]*title="arbeitsblatt\.pdf"[^>]*lang="de"/);
  });

  it("marks a picture's alternative text the same way", () => {
    const html = viewer({ ...doc("bild", ["de"]), name: "Bild.png", mimeType: "image/png" });
    expect(html).toMatch(/<img[^>]*lang="de"|<img[^>]*alt="Bild\.png"[^>]*lang="de"/);
  });

  it("leaves a document for every language as it was", () => {
    const html = viewer(doc("all"));
    expect(html).not.toContain("lang=");
    expect(html).not.toMatch(/In (German|English|Greek)/);
  });
});
