// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { cleanPastedHtml } from "./paste-cleanup";
import {
  LIBREOFFICE_REVIEW,
  LIBREOFFICE_REVIEW_READS,
  REVIEW_LEFT_OUT,
  WORD_ONLINE_REVIEW,
  WORD_ONLINE_REVIEW_READS,
  WORD_REVIEW,
  WORD_REVIEW_READS,
} from "../../../e2e/fixtures/paste/review-marks";

/**
 * A reviewer's marks in a paste (paste-review.ts), through the whole paste
 * cleanup in a page-less DOM (jsdom, whose HTML parser follows the HTML
 * standard, as the browser's does): Word's tracked deletions and Word's
 * comments are left out, and nothing else. Text in Word's Comment Text
 * style outside the comment list, and a <del> that a web page or Markdown
 * draws, keep their words. Pasting into the editor itself is in
 * e2e/rich-text-editor.spec.ts.
 */

/** Each line of the cleaned paste (its paragraphs, list points' too), as read. */
function lines(html: string): string[] {
  const box = document.createElement("div");
  box.innerHTML = cleanPastedHtml(html);
  return Array.from(box.querySelectorAll("p"), (p) => (p.textContent ?? "").replace(/\s+/g, " ").trim()).filter(
    (line) => line !== ""
  );
}

/** The cleaned paste's text, all of it. */
function text(html: string): string {
  const box = document.createElement("div");
  box.innerHTML = cleanPastedHtml(html);
  return box.textContent ?? "";
}

/** A Word clipboard around `fragment`: Word's namespaces, generator and comment styles. */
const word = (fragment: string) =>
  `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta name=Generator content="Microsoft Word 15"><style><!-- p.MsoCommentText {mso-style-link:"Kommentartext Zchn";margin:0cm;font-size:10.0pt;} span.MsoCommentReference {mso-style-noshow:yes;font-size:8.0pt;} --></style></head><body lang=DE-AT><!--StartFragment-->${fragment}<!--EndFragment--></body></html>`;

/** Word's comment mark, as Word writes it in a comment's text. */
const COMMENT_MARK = `<span class=MsoCommentReference><span lang=DE-AT style='font-size:8.0pt'><span style='mso-special-character:comment'>&nbsp;</span></span></span>`;

describe("a reviewer's marks: left out of a paste", () => {
  it("Word: the text reads as its review accepted; the comment, its reference and the deleted list point are left out", () => {
    expect(lines(WORD_REVIEW)).toEqual([...WORD_REVIEW_READS]);
    for (const gone of REVIEW_LEFT_OUT) expect(text(WORD_REVIEW)).not.toContain(gone);
  });

  it("Word for the web and LibreOffice: the same", () => {
    expect(lines(WORD_ONLINE_REVIEW)).toEqual([WORD_ONLINE_REVIEW_READS]);
    expect(lines(LIBREOFFICE_REVIEW)).toEqual([LIBREOFFICE_REVIEW_READS]);
    for (const gone of REVIEW_LEFT_OUT) {
      expect(text(WORD_ONLINE_REVIEW)).not.toContain(gone);
      expect(text(LIBREOFFICE_REVIEW)).not.toContain(gone);
    }
  });

  it("Word's tracked deletion is known by any of Word's marks: the author and time Word writes on it, its class msoDel, or a page Word wrote", () => {
    const author = `cite="mailto:Maria%20Trainerin"`;
    const time = `datetime="2026-10-20T09:14"`;
    for (const [html, why] of [
      [`<p>Der Kurs dauert <del ${author} ${time}>drei</del><ins ${author} ${time}>vier</ins> Wochen.</p>`, "author and time"],
      [`<p>Der Kurs dauert <del ${author}>drei</del><ins ${author}>vier</ins> Wochen.</p>`, "author"],
      [`<p>Der Kurs dauert <del ${time}>drei</del><ins ${time}>vier</ins> Wochen.</p>`, "time"],
      [`<p>Der Kurs dauert <del class=msoDel>drei</del><ins class=msoIns>vier</ins> Wochen.</p>`, "class"],
      [`<p>Der Kurs dauert <span class=msoDel><del>drei</del></span><span class=msoIns><ins>vier</ins></span> Wochen.</p>`, "span"],
      [word(`<p class=MsoNormal><span lang=DE-AT>Der Kurs dauert <del>drei</del><ins>vier</ins> Wochen.<o:p></o:p></span></p>`), "Word's page"],
    ]) {
      expect(lines(html), why).toEqual(["Der Kurs dauert vier Wochen."]);
    }
  });

  it("a tracked insertion, in Word's marks or not, is kept as text", () => {
    expect(lines(`<p>Der Kurs dauert <ins>vier</ins> Wochen.</p>`)).toEqual(["Der Kurs dauert vier Wochen."]);
    expect(cleanPastedHtml(`<p>Der Kurs dauert <ins>vier</ins> Wochen.</p>`)).not.toContain("<ins");
  });
});

describe("what an author pasted: kept, word for word", () => {
  it("text copied out of a Word comment (paragraph style Comment Text) pastes as text", () => {
    const copied = word(`<p class=MsoCommentText><span lang=DE-AT>Die Anmeldung endet am Freitag, 13. November.<o:p></o:p></span></p>`);
    expect(lines(copied)).toEqual(["Die Anmeldung endet am Freitag, 13. November."]);
  });

  it("the same with the comment's mark at its start: the text pastes as text", () => {
    const copied = word(`<p class=MsoCommentText>${COMMENT_MARK}<span lang=DE-AT>Die Anmeldung endet am Freitag.<o:p></o:p></span></p>`);
    expect(lines(copied)).toEqual(["Die Anmeldung endet am Freitag."]);
  });

  it("Word's other comment styles outside the comment list are text too (Comment Subject, a comment's block)", () => {
    const copied = word(
      `<p class=MsoCommentSubject><span lang=DE-AT>Anmeldung<o:p></o:p></span></p>` +
        `<div class=msocomtxt><p class=MsoNormal><span lang=DE-AT>Bis Freitag, 13. November.<o:p></o:p></span></p></div>`
    );
    expect(lines(copied)).toEqual(["Anmeldung", "Bis Freitag, 13. November."]);
  });

  it("a <del> that a web page or Markdown draws keeps its words as text (GitHub, Obsidian and Typora draw strikethrough so)", () => {
    for (const [html, from] of [
      [`<meta charset='utf-8'><p dir="auto">Bring <del>a laptop</del> a notebook.</p>`, "a GitHub page's"],
      [`<p>Bring <del>a laptop</del> a notebook.</p>`, "bare"],
      [`<meta charset='utf-8'><p><span>Bring </span><del><span>a laptop</span></del><span> a notebook.</span></p>`, "in spans"],
      [`<p>Bring <del cite="https://example.org/changes" datetime="2025-03-01">a laptop</del> a notebook.</p>`, "with the HTML standard's cite and date"],
    ]) {
      expect(lines(html), from).toEqual(["Bring a laptop a notebook."]);
    }
  });
});
