import { describe, it, expect } from "vitest";
import { createElement, type FC, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import type { DeleteSummary } from "@/lib/cms/sections/contract";
import { DeleteConfirm, deleteLines } from "./DeleteConfirm";

/*
 * U12 (Release 4, spec 4.7): "Delete lesson" says that the lesson's
 * further-reading links go with it, and how many, in the page's language;
 * a lesson without links is summed up exactly as before.
 */

const IntlProvider = NextIntlClientProvider as FC<{
  locale: string;
  messages: typeof en;
  timeZone?: string;
  children?: ReactNode;
}>;

const NONE: DeleteSummary = { languages: [], textBlocks: 0, questionBlocks: 0, video: false, documents: 0 };

function render(summary: DeleteSummary, locale: "en" | "de" = "en") {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale, messages: (locale === "de" ? de : en) as typeof en, timeZone: "UTC" },
      createElement(DeleteConfirm, { name: "Wrap-up", summary, busy: false, error: null, onConfirm: () => {}, onKeep: () => {} })
    )
  ).replaceAll("<!-- -->", "");
}

describe("the delete confirmation and further reading", () => {
  it("lists the links after the documents", () => {
    const t = (k: string, v?: Record<string, string | number>) => `${k}${v ? JSON.stringify(v) : ""}`;
    expect(deleteLines({ ...NONE, documents: 1, links: 2 }, t, [], (x) => x.join(), (n) => `links ${n}`)).toEqual([
      'delete.documents{"count":1}',
      "links 2",
    ]);
    expect(deleteLines({ ...NONE, documents: 1 }, t, [], (x) => x.join(), (n) => `links ${n}`)).toEqual([
      'delete.documents{"count":1}',
    ]);
  });

  it("says how many further-reading links go, in the page's language", () => {
    expect(render({ ...NONE, links: 1 })).toContain("<li>1 further-reading link</li>");
    expect(render({ ...NONE, links: 3 })).toContain("<li>3 further-reading links</li>");
    expect(render({ ...NONE, links: 3 }, "de")).toContain("<li>3 Links zum Weiterlesen</li>");
    expect(render({ ...NONE, links: 3 })).not.toContain(en.lessonList.delete.nothing);
  });

  it("says nothing of links for a lesson without any", () => {
    expect(render(NONE)).toContain(en.lessonList.delete.nothing);
    expect(render({ ...NONE, links: 0 })).toContain(en.lessonList.delete.nothing);
  });
});
