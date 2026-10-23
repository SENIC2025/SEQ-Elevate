/**
 * Clipboard HTML with a reviewer's marks: tracked changes and comments.
 *
 * HAND-BUILT, NOT CAPTURED. Written after the markup these programs write,
 * until the partners' real clipboards arrive on 9 November (spec 9.8,
 * item 3), which then join or replace these:
 * - Word desktop (Windows and Mac write the same HTML): a deletion as
 *   <span class=msoDel><del cite="mailto:…" datetime="…">, an insertion as
 *   <span class=msoIns><ins …>, with Word's styles for both in the head; a
 *   comment as the commented words in <a style='mso-comment-reference:…'>,
 *   then a span of class MsoCommentReference holding the "[MT1]" anchor
 *   (class msocomanchor, #_msocom_1) and Word's comment mark, and the
 *   comment itself after the text in a <div style='mso-element:comment-list'>,
 *   as in a document Word saved as a web page with comments and a Word for
 *   Mac clipboard of tracked changes;
 * - Word for the web: its TextRun spans, a deleted run of class
 *   TrackChangeTextDeletion inside a TrackChangeTextDeletionMarker, an
 *   inserted one of class TrackChangeTextInsertion, commented words of
 *   class CommentStart and CommentHighlightRest, as on pages pasted into
 *   from it;
 * - LibreOffice Writer: it leaves a tracked deletion's text out when it
 *   copies (its clipboard document drops deleted text), writes an insertion
 *   as plain text and a comment as an HTML comment (its HTML export).
 *
 * Addresses are example.org's. The text a reviewer deleted is
 * "Arbeitsagentur", "drei", "help.example.com", "Termin am 3. November"
 * and "alte"; the comment is "Logo bitte aktualisieren". None of them may
 * reach the lesson text.
 */

const DEL = (text: string) =>
  `<span class=msoDel><del cite="mailto:Maria%20Trainerin" datetime="2026-10-20T09:14">${text}</del></span>`;
const INS = (text: string) =>
  `<span class=msoIns><ins cite="mailto:Maria%20Trainerin" datetime="2026-10-20T09:14">${text}</ins></span>`;
const POINT = (n: "First" | "Middle" | "Last", text: string) =>
  `<p class=MsoListParagraphCxSp${n} style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-fareast-font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]><span lang=DE-AT>${text}</span><o:p></o:p></p>`;

/** The link whose words a reviewer updated, and where it goes. */
export const REVIEW_LINKS = {
  jobs: { text: "Bundesagentur für Arbeit", href: "https://example.org/jobs" },
  site: { text: "example.org", href: "https://www.example.org/" },
} as const;

export const WORD_REVIEW = `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta http-equiv=Content-Type content="text/html; charset=utf-8"><meta name=ProgId content=Word.Document><meta name=Generator content="Microsoft Word 15">
<style><!--
p.MsoNormal {margin:0cm;font-size:11.0pt;font-family:"Calibri",sans-serif;}
p.MsoCommentText {mso-style-link:"Kommentartext Zchn";margin:0cm;font-size:10.0pt;}
span.MsoCommentReference {mso-style-noshow:yes;font-size:8.0pt;}
span.msoIns {mso-style-type:export-only;mso-style-name:"";text-decoration:underline;text-underline:single;color:teal;}
span.msoDel {mso-style-type:export-only;mso-style-name:"";text-decoration:line-through;color:red;}
--></style></head>
<body lang=DE-AT link="#0563C1" vlink="#954F72" style='tab-interval:35.4pt;word-wrap:break-word'>
<!--StartFragment-->
<p class=MsoNormal><span lang=DE-AT>Stellenangebote finden Sie bei der <a href="${REVIEW_LINKS.jobs.href}">${DEL("Arbeitsagentur")}${INS(REVIEW_LINKS.jobs.text)}</a>. Der Kurs dauert ${DEL("drei")}${INS("vier")} Wochen.<o:p></o:p></span></p>
<p class=MsoNormal><span lang=DE-AT>Amtswege: <a href="${REVIEW_LINKS.site.href}">${DEL("help.example.com")}${INS(REVIEW_LINKS.site.text)}</a>.<o:p></o:p></span></p>
${POINT("First", "Anmeldung bis Freitag")}
${POINT("Middle", DEL("Termin am 3. November"))}
${POINT("Last", "Unterlagen mitbringen")}
<p class=MsoNormal><span lang=DE-AT>Gefördert durch das Programm <a style='mso-comment-reference:MT_1;mso-comment-date:20261020T0914'>Erasmus+</a></span><span class=MsoCommentReference><span lang=DE-AT style='font-size:8.0pt'><![if !supportAnnotations]><a class=msocomanchor id="_anchor_1" onmouseover="msoCommentShow('_anchor_1','_com_1')" onmouseout="msoCommentHide('_com_1')" href="#_msocom_1" language=JavaScript name="_msoanchor_1">[MT1]</a><![endif]><span style='mso-special-character:comment'>&nbsp;</span></span></span><span lang=DE-AT>.<o:p></o:p></span></p>
<!--EndFragment-->
<div style='mso-element:comment-list'><![if !supportAnnotations]>
<hr class=msocomoff align=left size=1 width="33%">
<![endif]>
<div style='mso-element:comment'><![if !supportAnnotations]>
<div id="_com_1" class=msocomtxt language=JavaScript onmouseover="msoCommentShow('_anchor_1','_com_1')" onmouseout="msoCommentHide('_com_1')"><![endif]><span style='mso-comment-author:"Maria Trainerin";mso-comment-providerid:None;mso-comment-userid:"Maria Trainerin"'><![if !supportAnnotations]><a name="_msocom_1"></a><![endif]></span>
<p class=MsoCommentText><span class=MsoCommentReference><span lang=DE-AT style='font-size:8.0pt'><span style='mso-special-character:comment'>&nbsp;<![if !supportAnnotations]><a href="#_msoanchor_1" class=msocomoff>[MT1]</a><![endif]></span></span></span><span lang=DE-AT>Logo bitte aktualisieren<o:p></o:p></span></p>
<![if !supportAnnotations]></div>
<![endif]></div>
</div>
</body></html>`;

/** Word's plain-text flavour beside it: the deleted words and the comment's reference as they show in Word's markup view. */
export const WORD_REVIEW_TEXT =
  "Stellenangebote finden Sie bei der ArbeitsagenturBundesagentur für Arbeit. Der Kurs dauert dreivier Wochen.\nAmtswege: help.example.comexample.org.\n·\tAnmeldung bis Freitag\n·\tTermin am 3. November\n·\tUnterlagen mitbringen\nGefördert durch das Programm Erasmus+[MT1].";

/** What a learner reads of it, line by line. */
export const WORD_REVIEW_READS = [
  "Stellenangebote finden Sie bei der Bundesagentur für Arbeit. Der Kurs dauert vier Wochen.",
  "Amtswege: example.org.",
  "Anmeldung bis Freitag",
  "Unterlagen mitbringen",
  "Gefördert durch das Programm Erasmus+.",
] as const;

/** Words of the review that must not reach the lesson text. */
export const REVIEW_LEFT_OUT = ["Arbeitsagentur", "drei", "help.example.com", "Termin am 3. November", "[MT1]", "Logo bitte aktualisieren", "alte"] as const;

export const WORD_ONLINE_REVIEW =
  `<div class="OutlineElement Ltr SCXW51234567 BCX8"><p class="Paragraph SCXW51234567 BCX8" xml:lang="DE-AT" lang="DE-AT" paraid="1838405722" paraeid="{0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d}{12}">` +
  `<span data-contrast="auto" xml:lang="DE-AT" lang="DE-AT" class="TextRun SCXW51234567 BCX8"><span class="NormalTextRun SCXW51234567 BCX8">Bitte die </span></span>` +
  `<span class="TrackChangeTextDeletionMarker TrackedChange SCXW51234567 BCX8"><span data-contrast="auto" xml:lang="DE-AT" lang="DE-AT" class="TextRun SCXW51234567 BCX8"><span class="NormalTextRun TrackChangeTextDeletion SCXW51234567 BCX8">alte</span></span></span>` +
  `<span class="TrackChangeTextInsertion TrackedChange SCXW51234567 BCX8"><span data-contrast="auto" xml:lang="DE-AT" lang="DE-AT" class="TextRun SCXW51234567 BCX8">neue</span></span>` +
  `<span data-contrast="auto" xml:lang="DE-AT" lang="DE-AT" class="TextRun SCXW51234567 BCX8"><span class="NormalTextRun SCXW51234567 BCX8"> Vorlage für den </span><span class="NormalTextRun CommentStart CommentHighlightPipeRest CommentHighlightRest SCXW51234567 BCX8">Lebenslauf</span><span class="NormalTextRun SCXW51234567 BCX8"> verwenden.</span></span>` +
  `<span class="EOP SCXW51234567 BCX8" data-ccp-props="{}">&nbsp;</span></p></div>`;
export const WORD_ONLINE_REVIEW_TEXT = "Bitte die neue Vorlage für den Lebenslauf verwenden.";
export const WORD_ONLINE_REVIEW_READS = "Bitte die neue Vorlage für den Lebenslauf verwenden.";

export const LIBREOFFICE_REVIEW = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">
<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"/><title></title><meta name="generator" content="LibreOffice 24.8.2.1 (Windows)"/>
<style type="text/css">p { line-height: 115%; margin-bottom: 0.25cm; background: transparent }</style></head>
<body lang="de-AT" link="#000080" vlink="#800000" dir="ltr"><p style="line-height: 100%; margin-bottom: 0cm">Bitte die neue Vorlage verwenden.<!-- Logo bitte aktualisieren --></p></body></html>`;
export const LIBREOFFICE_REVIEW_TEXT = "Bitte die neue Vorlage verwenden.";
export const LIBREOFFICE_REVIEW_READS = "Bitte die neue Vorlage verwenden.";
