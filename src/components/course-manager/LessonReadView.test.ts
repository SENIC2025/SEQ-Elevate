import { describe, it, expect, vi } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import type { LessonOutline } from "@/lib/cms/course-admin-types";
import type { StaffLessonLink } from "@/lib/cms/lesson-links";

/*
 * Release 4 (D107, D108; spec 4.6): a closed lesson on the course page shows
 * its further reading under its documents, every link with its draft and
 * language marks, and the languages of a document that isn't for every
 * language. A link whose stored address can't be used is text with its
 * address, never a link. Translated, like the page around it.
 */

// The editors' actions are server actions; nothing is called while rendering.
vi.mock("@/app/actions/structure", () => ({}));
vi.mock("@/app/actions/parts", () => ({}));

const { LessonReadView } = await import("./LessonReadView");

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone: string;
  children?: ReactNode;
}>;

const lesson = (over: Partial<LessonOutline> & { links?: StaffLessonLink[] } = {}): LessonOutline =>
  ({
    key: "context",
    present: true,
    addable: false,
    body: "narrative",
    mainKind: "narrative",
    editable: { body: true, media: true },
    byLang: {
      en: { stage: null, narrative: null, sectioned: null },
      de: { stage: null, narrative: null, sectioned: null },
      el: { stage: null, narrative: null, sectioned: null },
    },
    structure: null,
    draft: null,
    video: null,
    builtInVideo: false,
    documents: [],
    updatedAt: null,
    section: null,
    parts: null,
    contentVersion: null,
    live: true,
    ...over,
  }) as LessonOutline;

const LINKS: StaffLessonLink[] = [
  { id: "l1", title: "The guide", url: "https://example.org/guide", kind: "web", description: "", languages: [], published: true },
  { id: "l2", title: "Arbeitsblatt", url: "mailto:help@example.org", kind: "email", description: "", languages: ["de"], published: false },
  { id: "l3", title: "Broken", url: "javascript:alert(1)", kind: null, unusable: true, description: "", languages: [], published: true },
];

function render(l: LessonOutline, locale: "en" | "de" = "en") {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale, messages: (locale === "de" ? de : en) as typeof en, timeZone: "UTC" },
      createElement(LessonReadView, { lesson: l, stage: null })
    )
  ).replaceAll("<!-- -->", "");
}

describe("LessonReadView: further reading and languages", () => {
  it("lists the further reading under the documents, drafts and languages marked", () => {
    const html = render(lesson({ links: LINKS }));
    expect(html.indexOf(">Documents<")).toBeLessThan(html.indexOf(">Further reading<"));
    expect(html).toContain('<a href="https://example.org/guide" target="_blank" rel="noopener noreferrer" class="seq-link">The guide');
    expect(html).toContain(">example.org</span>");
    expect(html).toContain('<a href="mailto:help@example.org"');
    expect(html).toContain(">help@example.org</span>");
    expect(html).toContain(en.courseManager.page.read.draftDocument);
    expect(html).toContain(">For: German<");
  });

  it("never draws a link whose stored address can't be used: its title and address as text", () => {
    const html = render(lesson({ links: LINKS }));
    expect(html).toContain("Broken");
    expect(html).toContain("(javascript:alert(1))");
    expect(html).not.toContain('href="javascript:');
    expect([...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).every((h) => /^(https?:\/\/|mailto:)/.test(h))).toBe(true);
  });

  it("says when a lesson has no further reading, and shows nothing of it before the page names its links", () => {
    expect(render(lesson({ links: [] }))).toContain(">No further reading<");
    const before = render(lesson());
    expect(before).not.toContain("Further reading");
    expect(before).not.toContain("No further reading");
  });

  it("names a document's languages when it isn't for every language, in the page's language", () => {
    const documents = [
      { id: "d1", name: "all.pdf", url: "https://x/a.pdf", mimeType: "application/pdf", sizeBytes: 1, published: true },
      { id: "d2", name: "de-el.pdf", url: "https://x/b.pdf", mimeType: "application/pdf", sizeBytes: 1, published: true, languages: ["de", "el"] },
    ] as LessonOutline["documents"];
    expect(render(lesson({ documents }))).toContain(">For: German and Greek<");
    expect(render(lesson({ documents }), "de")).toContain(">Für: Deutsch und Griechisch<");
    expect(render(lesson({ documents })).match(/For: /g)).toHaveLength(1);
  });
});
